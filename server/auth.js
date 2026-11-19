const crypto = require('crypto');
const ldap = require('./ldap');

const hashPw = (pw) => {
  const s = crypto.randomBytes(16);
  return s.toString('hex') + ':' + crypto.scryptSync(pw, s, 32).toString('hex');
};
const checkPw = (pw, stored) => {
  const [s, h] = stored.split(':');
  const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 32);
  return crypto.timingSafeEqual(a, Buffer.from(h, 'hex'));
};
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const DUMMY = hashPw('dummy-password-for-timing');

// Başarısız denemeleri sınırla: `max` hatadan sonra `lockMs` boyunca engelle.
function limiter(max, lockMs) {
  const m = new Map();
  return {
    blocked: (k) => { const f = m.get(k); return !!f && Date.now() < f.until; },
    fail: (k) => {
      const f = m.get(k) || { n: 0, until: 0 };
      f.n++;
      if (f.n >= max) { f.until = Date.now() + lockMs; f.n = 0; }
      m.set(k, f);
    },
    ok: (k) => m.delete(k),
  };
}

// mode: 'local' | 'ldap' | 'both' (both: yerel hesap varsa yerel, yoksa LDAP)
// Başarılıysa kalıcı kullanıcı kimliğini (string), değilse null döner.
function makeAuthenticator({ db, mode, ldapCfg, ldapClient }) {
  if ((mode === 'ldap' || mode === 'both') && !ldapCfg) throw new Error(`AUTH_MODE=${mode} için LDAP_URL ve LDAP_BASE_DN gerekli`);
  return async function authenticate(rawName, password) {
    const name = String(rawName || '').trim().toLowerCase();
    if (!ldap.NAME_RE.test(name) || typeof password !== 'string' || password.length === 0 || password.length > 256) {
      return null; // boş parola LDAP'ta anonim bind olabilir, kesinlikle reddet
    }
    const users = db.get().users;
    const local = Object.hasOwn(users, name) && users[name].pw ? users[name] : null;

    if (mode === 'local' || (mode === 'both' && local)) {
      const ok = checkPw(password, local ? local.pw : DUMMY); // zamanlama farkını azalt
      return local && ok ? name : null;
    }
    const id = await ldap.authenticate(ldapCfg, name, password, ldapClient);
    if (!id) return null;
    const u = db.get().users;
    if (!Object.hasOwn(u, id)) { u[id] = { ldap: true, created: new Date().toISOString() }; db.save(); }
    return id;
  };
}

module.exports = { hashPw, checkPw, sha256, safeEq, limiter, makeAuthenticator };
