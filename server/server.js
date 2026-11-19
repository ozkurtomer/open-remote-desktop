// Signaling + hesap/cihaz sunucusu.
// Video ve girdi verisi buradan GEÇMEZ (WebRTC P2P / TURN röle, uçtan uca şifreli).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const dbmod = require('./db');
const auth = require('./auth');
const ldap = require('./ldap');

const VIEWER_DIR = path.join(__dirname, '..', 'viewer');
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const SESSION_MS = 12 * 3600 * 1000;
const MAX_DEVICES_PER_USER = 20;
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'unsafe-inline'; connect-src 'self' ws: wss:; media-src 'self' blob:; frame-ancestors 'none'",
};

function start(opts = {}) {
  const port = opts.port ?? (process.env.PORT || 8080);
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
  const trustProxy = process.env.TRUST_PROXY === '1';
  const mode = opts.authMode || process.env.AUTH_MODE || 'local';

  const db = dbmod.open(dataDir);
  const authenticate = auth.makeAuthenticator({
    db,
    mode,
    ldapCfg: opts.ldapCfg || (mode === 'local' ? null : ldap.configFromEnv()),
    ldapClient: opts.ldapClient,
  });

  const BASE_ICE = JSON.parse(process.env.ICE_SERVERS || '[]');
  const TURN_URLS = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const TURN_SECRET = process.env.TURN_SECRET || '';

  const sessions = new Map(); // sid -> { user, exp }
  const online = new Map();   // deviceId -> { ws, viewer, owner }
  const loginLimit = auth.limiter(10, 5 * 60 * 1000);
  const hostLimit = auth.limiter(10, 5 * 60 * 1000);

  // coturn --use-auth-secret ile uyumlu, 1 saat geçerli geçici TURN kimlik bilgisi
  function iceFor(user) {
    const servers = [...BASE_ICE];
    if (TURN_URLS.length && TURN_SECRET) {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const username = `${exp}:${user}`;
      const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
      servers.push({ urls: TURN_URLS, username, credential });
    }
    return servers;
  }

  const clientIp = (req) =>
    (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
  const isSecure = (req) => process.env.COOKIE_SECURE === '1' || (trustProxy && req.headers['x-forwarded-proto'] === 'https');
  const sameOrigin = (req) => {
    const o = req.headers.origin;
    if (!o) return true;
    try { return new URL(o).host === req.headers.host; } catch { return false; }
  };
  const getDevice = (id) => {
    const d = db.get().devices;
    return typeof id === 'string' && Object.hasOwn(d, id) ? d[id] : null;
  };
  const cookieSid = (req) => (/(?:^|;\s*)rc_sid=([a-f0-9]{48})/.exec(req.headers.cookie || '') || [])[1];
  function sessionUser(req) {
    const sid = cookieSid(req);
    const s = sid && sessions.get(sid);
    if (!s) return null;
    if (s.exp < Date.now() || !Object.hasOwn(db.get().users, s.user)) { sessions.delete(sid); return null; }
    return s.user;
  }

  // ---------- HTTP ----------
  const json = (res, code, obj, extra = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...SEC_HEADERS, ...extra });
    res.end(JSON.stringify(obj));
  };
  const readJson = (req) => new Promise((ok, no) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 10000) { req.destroy(); no(new Error('big')); } });
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { no(new Error('bad json')); } });
    req.on('error', no);
  });
  const cleanName = (s) => String(s || '').replace(/[\x00-\x1f]/g, '').slice(0, 60) || 'Bilgisayar';

  // Cihazı kullanıcıya bağla, kalıcı token üret (yalnızca SHA-256 özeti saklanır).
  function createDevice(user, name, platform, ip) {
    const deviceId = crypto.randomBytes(8).toString('hex');
    const token = crypto.randomBytes(32).toString('hex');
    db.get().devices[deviceId] = {
      owner: user, name: cleanName(name), platform: String(platform || '').slice(0, 20),
      tokenHash: auth.sha256(token), created: new Date().toISOString(),
    };
    db.save();
    db.audit({ ev: 'device_register', user, device: deviceId, ip });
    return { deviceId, token };
  }

  async function api(req, res, p) {
    const ip = clientIp(req);
    if (req.method !== 'GET' && (!sameOrigin(req) || !String(req.headers['content-type'] || '').startsWith('application/json'))) {
      return json(res, 403, { error: 'Geçersiz istek' });
    }

    if (p === '/api/login' && req.method === 'POST') {
      const b = await readJson(req);
      const name = String(b.username || '').trim().toLowerCase();
      if (loginLimit.blocked('ip:' + ip) || loginLimit.blocked('u:' + name))
        return json(res, 429, { error: 'Çok fazla deneme, 5 dakika sonra tekrar deneyin' });
      const user = await authenticate(b.username, b.password);
      if (!user) {
        loginLimit.fail('ip:' + ip); loginLimit.fail('u:' + name);
        db.audit({ ev: 'login_fail', user: name, ip });
        return json(res, 401, { error: 'Kullanıcı adı veya parola hatalı' });
      }
      loginLimit.ok('ip:' + ip); loginLimit.ok('u:' + name);
      const sid = crypto.randomBytes(24).toString('hex');
      sessions.set(sid, { user, exp: Date.now() + SESSION_MS });
      db.audit({ ev: 'login', user, ip });
      const cookie = `rc_sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${isSecure(req) ? '; Secure' : ''}`;
      return json(res, 200, { username: user }, { 'Set-Cookie': cookie });
    }

    if (p === '/api/logout' && req.method === 'POST') {
      const sid = cookieSid(req);
      if (sid) sessions.delete(sid);
      return json(res, 200, {}, { 'Set-Cookie': 'rc_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }

    // Host uygulaması: kullanıcı kimlik bilgisiyle bu cihazı hesabına bağlar, kalıcı cihaz token'ı alır.
    if (p === '/api/device/register' && req.method === 'POST') {
      const b = await readJson(req);
      const name = String(b.username || '').trim().toLowerCase();
      if (loginLimit.blocked('ip:' + ip) || loginLimit.blocked('u:' + name))
        return json(res, 429, { error: 'Çok fazla deneme, 5 dakika sonra tekrar deneyin' });
      const user = await authenticate(b.username, b.password);
      if (!user) {
        loginLimit.fail('ip:' + ip); loginLimit.fail('u:' + name);
        db.audit({ ev: 'register_fail', user: name, ip });
        return json(res, 401, { error: 'Kullanıcı adı veya parola hatalı' });
      }
      loginLimit.ok('ip:' + ip); loginLimit.ok('u:' + name);
      const d = db.get();
      if (Object.values(d.devices).filter((x) => x.owner === user).length >= MAX_DEVICES_PER_USER)
        return json(res, 409, { error: 'Cihaz sınırına ulaşıldı' });
      const { deviceId, token } = createDevice(user, b.name, b.platform, ip);
      return json(res, 200, { deviceId, token });
    }

    // Tek kullanıcılı (kişisel) kurulumda arayüz kullanıcı adını sormaz.
    if (p === '/api/info' && req.method === 'GET') return json(res, 200, { single: !!opts.single });

    const user = sessionUser(req);
    if (!user) return json(res, 401, { error: 'Oturum gerekli' });

    if (p === '/api/me' && req.method === 'GET') return json(res, 200, { username: user });

    if (p === '/api/devices' && req.method === 'GET') {
      const devices = Object.entries(db.get().devices)
        .filter(([, d]) => d.owner === user)
        .map(([id, d]) => ({ id, name: d.name, platform: d.platform, online: online.has(id), busy: !!online.get(id)?.viewer }));
      return json(res, 200, { devices });
    }

    const m = /^\/api\/devices\/([a-f0-9]{16})$/.exec(p);
    if (m && req.method === 'DELETE') {
      const dev = getDevice(m[1]);
      if (!dev || dev.owner !== user) return json(res, 404, { error: 'Cihaz bulunamadı' });
      delete db.get().devices[m[1]];
      db.save();
      db.audit({ ev: 'device_delete', user, device: m[1], ip });
      online.get(m[1])?.ws.close();
      return json(res, 200, {});
    }

    json(res, 404, { error: 'Bulunamadı' });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const p = new URL(req.url, 'http://x').pathname;
      if (p.startsWith('/api/')) return await api(req, res, p);
      if (req.method === 'GET' && p === '/healthz') { res.writeHead(200); return res.end('ok'); }
      const f = req.method === 'GET' && Object.hasOwn(STATIC, p) ? STATIC[p] : null;
      if (!f) { res.writeHead(404, SEC_HEADERS); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)], ...SEC_HEADERS });
      fs.createReadStream(path.join(VIEWER_DIR, f)).pipe(res);
    } catch (e) {
      if (!res.headersSent) json(res, 400, { error: 'Geçersiz istek' });
    }
  });

  // ---------- WebSocket (signaling) ----------
  const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
  const send = (ws, o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

  function hello(ws, m) {
    if (hostLimit.blocked('ip:' + ws.ip)) { send(ws, { type: 'error', code: 'auth', message: 'Çok fazla deneme' }); return ws.close(); }
    const dev = getDevice(m.deviceId);
    if (!dev || typeof m.token !== 'string' || !auth.safeEq(auth.sha256(m.token), dev.tokenHash)) {
      hostLimit.fail('ip:' + ws.ip);
      send(ws, { type: 'error', code: 'auth', message: 'Cihaz kaydı geçersiz. Hesabı yeniden bağlayın.' });
      return ws.close();
    }
    const old = online.get(m.deviceId);
    if (old) {
      if (old.viewer) { send(old.viewer, { type: 'bye' }); old.viewer.role = null; }
      old.ws.role = null;
      old.ws.close();
    }
    online.set(m.deviceId, { ws, viewer: null, owner: dev.owner });
    ws.role = 'host';
    ws.deviceId = m.deviceId;
    send(ws, { type: 'ready', owner: dev.owner });
  }

  function connectViewer(ws, req, m) {
    if (!sameOrigin(req)) return send(ws, { type: 'error', message: 'Geçersiz origin' });
    const user = sessionUser(req);
    if (!user) return send(ws, { type: 'error', code: 'auth', message: 'Oturum süresi doldu, tekrar giriş yapın' });
    const id = m.deviceId;
    const dev = getDevice(id);
    // Başkasının cihazı ile olmayan cihaz aynı cevabı verir (cihaz ID'leri taranamasın).
    if (!dev || dev.owner !== user) return send(ws, { type: 'error', message: 'Cihaz bulunamadı' });
    const entry = online.get(id);
    if (!entry) return send(ws, { type: 'error', message: 'Cihaz çevrimdışı' });
    if (entry.viewer) return send(ws, { type: 'error', message: 'Cihaz şu an meşgul' });
    entry.viewer = ws;
    ws.role = 'viewer';
    ws.deviceId = id;
    ws.user = user;
    db.audit({ ev: 'connect_request', user, device: id, ip: ws.ip });
    send(entry.ws, { type: 'request', user, ice: iceFor(user) });
    send(ws, { type: 'waiting', ice: iceFor(user) });
  }

  function onMessage(ws, req, m) {
    if (!ws.role) {
      if (m.type === 'hello') return hello(ws, m);
      if (m.type === 'connect') return connectViewer(ws, req, m);
      return;
    }
    const e = online.get(ws.deviceId);
    if (!e) return;
    const msg = { type: m.type, data: m.data };

    if (ws.role === 'host') {
      if (e.ws !== ws || !e.viewer || !['accept', 'reject', 'signal', 'bye'].includes(m.type)) return;
      send(e.viewer, msg);
      if (m.type === 'accept') db.audit({ ev: 'session_start', user: e.viewer.user, device: ws.deviceId, ip: e.viewer.ip });
      if (m.type === 'reject' || m.type === 'bye') {
        if (m.type === 'reject') db.audit({ ev: 'session_rejected', user: e.viewer.user, device: ws.deviceId });
        else db.audit({ ev: 'session_end', user: e.viewer.user, device: ws.deviceId, by: 'host' });
        e.viewer.role = null;
        e.viewer = null;
      }
    } else if (ws.role === 'viewer') {
      if (e.viewer !== ws || !['signal', 'bye'].includes(m.type)) return;
      send(e.ws, msg);
      if (m.type === 'bye') {
        db.audit({ ev: 'session_end', user: ws.user, device: ws.deviceId, by: 'viewer' });
        e.viewer = null;
        ws.role = null;
      }
    }
  }

  function onClose(ws) {
    const e = online.get(ws.deviceId);
    if (!e) return;
    if (ws.role === 'host' && e.ws === ws) {
      if (e.viewer) { send(e.viewer, { type: 'bye' }); e.viewer.role = null; }
      online.delete(ws.deviceId);
    } else if (ws.role === 'viewer' && e.viewer === ws) {
      e.viewer = null;
      send(e.ws, { type: 'bye' });
      db.audit({ ev: 'session_end', user: ws.user, device: ws.deviceId, by: 'disconnect' });
    }
  }

  wss.on('connection', (ws, req) => {
    ws.alive = true;
    ws.ip = clientIp(req);
    ws.on('pong', () => (ws.alive = true));
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (m && typeof m === 'object') onMessage(ws, req, m);
    });
    ws.on('close', () => onClose(ws));
  });

  const hb = setInterval(() => wss.clients.forEach((w) => {
    if (!w.alive) return w.terminate();
    w.alive = false;
    w.ping();
  }), 30000);

  server.listen(port, () => {
    if (!opts.quiet) console.log(`Sunucu :${server.address().port} (kimlik doğrulama: ${mode}, veri: ${dataDir})`);
  });

  return {
    server, db, sessions, createDevice,
    close() { clearInterval(hb); wss.clients.forEach((w) => w.terminate()); wss.close(); server.close(); },
  };
}

if (require.main === module) start();
module.exports = { start };
