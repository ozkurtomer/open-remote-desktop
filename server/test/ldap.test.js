const { test } = require('node:test');
const assert = require('node:assert/strict');
const ldap = require('../ldap');
const auth = require('../auth');

// Sahte LDAP istemcisi: gerçek sunucu olmadan akışı ve filtre kaçışını doğrular.
function fakeClientFactory(log, { entries, goodPassword }) {
  return class FakeClient {
    async startTLS() { log.push('starttls'); }
    async bind(dn, pw) {
      log.push(['bind', dn]);
      if (dn !== 'cn=svc,dc=corp' && pw !== goodPassword) throw new Error('invalid credentials');
    }
    async search(base, opts) { log.push(['search', opts.filter]); return { searchEntries: entries }; }
    async unbind() {}
  };
}
const cfg = {
  url: 'ldaps://dc.corp', bindDn: 'cn=svc,dc=corp', bindPassword: 's', baseDn: 'dc=corp',
  userFilter: '(sAMAccountName={u})', idAttr: 'sAMAccountName', requiredGroup: '',
};

test('LDAP: doğru parola kanonik kimliği döndürür', async () => {
  const log = [];
  const C = fakeClientFactory(log, { entries: [{ dn: 'cn=Ali,dc=corp', sAMAccountName: 'AliV' }], goodPassword: 'pw' });
  assert.equal(await ldap.authenticate(cfg, 'ali', 'pw', C), 'aliv');
  assert.deepEqual(log.find((l) => l[0] === 'bind' && l[1] !== 'cn=svc,dc=corp'), ['bind', 'cn=Ali,dc=corp']);
});

test('LDAP: yanlış parola, bulunamayan ve belirsiz kullanıcı reddedilir', async () => {
  const mk = (entries) => fakeClientFactory([], { entries, goodPassword: 'pw' });
  assert.equal(await ldap.authenticate(cfg, 'ali', 'bad', mk([{ dn: 'x', sAMAccountName: 'ali' }])), null);
  assert.equal(await ldap.authenticate(cfg, 'ali', 'pw', mk([])), null);
  assert.equal(await ldap.authenticate(cfg, 'ali', 'pw', mk([{ dn: 'a' }, { dn: 'b' }])), null);
});

test('LDAP: filtre enjeksiyonu kaçışlanır, grup kısıtı eklenir', async () => {
  const log = [];
  const C = fakeClientFactory(log, { entries: [], goodPassword: 'pw' });
  await ldap.authenticate({ ...cfg, requiredGroup: 'cn=rc,dc=corp' }, 'a*)(uid=*', 'pw', C);
  const filter = log.find((l) => l[0] === 'search')[1];
  assert.equal(filter, '(&(sAMAccountName=a\\2a\\29\\28uid=\\2a)(memberOf=cn=rc,dc=corp))');
});

test('LDAP: düz metin ldap:// varsayılan olarak reddedilir', () => {
  assert.throws(() => ldap.configFromEnv({ LDAP_URL: 'ldap://dc', LDAP_BASE_DN: 'dc=x' }));
  assert.ok(ldap.configFromEnv({ LDAP_URL: 'ldap://dc', LDAP_BASE_DN: 'dc=x', LDAP_STARTTLS: '1' }).startTls);
  assert.equal(ldap.configFromEnv({}), null);
});

test('authenticator: boş parola LDAP\'a hiç gitmez; ilk girişte kullanıcı kaydedilir', async () => {
  const users = {};
  const db = { get: () => ({ users }), save() {} };
  let calls = 0;
  const C = class { async bind() { calls++; } async search() { return { searchEntries: [{ dn: 'd', sAMAccountName: 'ali' }] }; } async unbind() {} };
  const a = auth.makeAuthenticator({ db, mode: 'ldap', ldapCfg: cfg, ldapClient: C });
  assert.equal(await a('ali', ''), null);
  assert.equal(calls, 0);
  assert.equal(await a('ali', 'secret'), 'ali');
  assert.ok(users.ali.ldap);
});
