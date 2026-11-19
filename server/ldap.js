// LDAP / Active Directory doğrulaması.
// Akış: servis hesabıyla kullanıcıyı ara -> bulunan DN ile kullanıcının parolasıyla bind et.
const fs = require('fs');

const NAME_RE = /^[a-z0-9._@-]{1,64}$/;

// LDAP filtre enjeksiyonunu önlemek için özel karakterleri kaçışla (RFC 4515).
const esc = (s) => String(s).replace(/[\\*()\0]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));

function configFromEnv(env = process.env) {
  if (!env.LDAP_URL) return null;
  if (!env.LDAP_BASE_DN) throw new Error('LDAP_BASE_DN gerekli');
  const url = env.LDAP_URL;
  const startTls = env.LDAP_STARTTLS === '1';
  if (url.startsWith('ldap://') && !startTls && env.LDAP_ALLOW_PLAINTEXT !== '1') {
    throw new Error('LDAP parolaları düz metin gider. ldaps:// kullanın veya LDAP_STARTTLS=1 verin.');
  }
  return {
    url,
    startTls,
    bindDn: env.LDAP_BIND_DN || '',
    bindPassword: env.LDAP_BIND_PASSWORD || '',
    baseDn: env.LDAP_BASE_DN,
    // {u} yerine kaçışlanmış kullanıcı adı konur.
    userFilter: env.LDAP_USER_FILTER || '(|(sAMAccountName={u})(uid={u})(userPrincipalName={u}))',
    // Kullanıcının kalıcı kimliği (cihaz sahipliği buna bağlanır).
    idAttr: env.LDAP_ID_ATTR || 'sAMAccountName',
    // Opsiyonel: yalnızca bu gruptaki kullanıcılar girebilir (DN).
    requiredGroup: env.LDAP_REQUIRED_GROUP || '',
    ca: env.LDAP_CA_FILE ? fs.readFileSync(env.LDAP_CA_FILE) : undefined,
    insecureTls: env.LDAP_TLS_INSECURE === '1',
  };
}

async function authenticate(cfg, name, password, Client = require('ldapts').Client) {
  const tls = { ca: cfg.ca, rejectUnauthorized: !cfg.insecureTls };
  async function connect() {
    const c = new Client({ url: cfg.url, timeout: 8000, connectTimeout: 8000, tlsOptions: tls });
    if (cfg.startTls) await c.startTLS(tls);
    return c;
  }

  let filter = cfg.userFilter.replaceAll('{u}', esc(name));
  if (cfg.requiredGroup) filter = `(&${filter}(memberOf=${esc(cfg.requiredGroup)}))`;

  let entry;
  const svc = await connect().catch((e) => { console.error('LDAP bağlantı hatası:', e.message); return null; });
  if (!svc) return null;
  try {
    if (cfg.bindDn) await svc.bind(cfg.bindDn, cfg.bindPassword);
    const { searchEntries } = await svc.search(cfg.baseDn, { scope: 'sub', filter, attributes: [cfg.idAttr], sizeLimit: 2 });
    if (searchEntries.length !== 1) return null; // yok veya belirsiz
    entry = searchEntries[0];
  } catch (e) {
    console.error('LDAP arama hatası:', e.message);
    return null;
  } finally {
    await svc.unbind().catch(() => {});
  }

  // Kullanıcının kendi parolasıyla doğrula. Boş parola anonim bind olarak başarılı olabilir, çağıran engeller.
  const usr = await connect().catch(() => null);
  if (!usr) return null;
  try {
    await usr.bind(entry.dn, password);
  } catch {
    return null;
  } finally {
    await usr.unbind().catch(() => {});
  }

  let id = entry[cfg.idAttr];
  if (Array.isArray(id)) id = id[0];
  id = String(id || name).toLowerCase();
  return NAME_RE.test(id) ? id : null;
}

module.exports = { configFromEnv, authenticate, esc, NAME_RE };
