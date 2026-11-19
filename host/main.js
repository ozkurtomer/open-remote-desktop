const {
  app, BrowserWindow, ipcMain, dialog, desktopCapturer, session, Tray, Menu, Notification, net, safeStorage, nativeImage,
  systemPreferences,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');

// Tailscale/VPN gibi ağlarda mDNS ile gizlenen adresler bağlantıyı bozar; host adaylarını gizleme.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

let win, tray, quitting = false;
let embedded = null; // kişisel modda uygulamanın içinde çalışan sunucu
let input;
try { input = require('./input'); } catch (e) { console.error('input modülü yüklenemedi:', e.message); }

// ---- Yapılandırma (userData/config.json). Cihaz token'ı OS anahtar deposuyla şifrelenir. ----
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const dataDir = () => path.join(app.getPath('userData'), 'server-data');
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
const saveCfg = (c) => {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(c), { mode: 0o600 });
};
const enc = (t) => (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(t).toString('base64') : 'raw:' + t);
const dec = (s) => (s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')) : s.slice(4));

// ---- Kişisel mod: sunucu bu uygulamanın içinde çalışır ----
// Paketlenmiş uygulamada sunucu ve arayüz bundled/ klasöründedir (scripts/prepare.js kopyalar).
const serverDir = app.isPackaged ? path.join(__dirname, 'bundled', 'server') : path.join(__dirname, '..', 'server');
function startEmbedded(port) {
  // Herkese açık STUN (ücretsiz). Çoğu bağlantı doğrudan kurulur.
  process.env.ICE_SERVERS ||= JSON.stringify([{ urls: 'stun:stun.cloudflare.com:3478' }]);
  const { start } = require(path.join(serverDir, 'server'));
  embedded = start({ port, dataDir: dataDir(), single: true, authMode: 'local', quiet: true });
  return new Promise((resolve, reject) => {
    embedded.server.once('listening', resolve);
    embedded.server.once('error', (e) => { embedded = null; reject(e); });
  });
}
function stopEmbedded() { if (embedded) { embedded.close(); embedded = null; } }

// Bu bilgisayara hangi adreslerden ulaşılabilir (Tailscale adresi öne alınır)
function accessUrls(port) {
  const out = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [o1, o2] = a.address.split('.').map(Number);
      const kind = o1 === 100 && o2 >= 64 && o2 <= 127 ? 'tailscale' : 'lan';
      out.push({ kind, iface, url: `http://${a.address}:${port}` });
    }
  }
  return out.sort((a, b) => (a.kind === 'tailscale' ? -1 : 0) - (b.kind === 'tailscale' ? -1 : 0));
}

function showWindow() { if (win) { win.show(); win.focus(); } }

function createWindow() {
  win = new BrowserWindow({
    width: 460, height: 640, show: !process.argv.includes('--hidden'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  win.loadFile('host.html');
  // Pencere kapanınca uygulama arka planda çalışmaya devam eder (tepsi).
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Uzak Masaüstü Host');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Pencereyi aç', click: showWindow },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    // Renderer getDisplayMedia() çağırdığında birincil ekranı ver (kullanıcı etkileşimi gerekmez).
    session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
      desktopCapturer.getSources({ types: ['screen'] })
        .then((s) => cb(s[0] ? { video: s[0] } : {}))
        .catch((err) => { console.error('Ekran kaynağı alınamadı:', err.message); cb({}); }); // izin yoksa getDisplayMedia reddedilir
    });
    // macOS: fare/klavye kontrolü için Accessibility iznini iste (yoksa sistem diyaloğu açar).
    if (process.platform === 'darwin') systemPreferences.isTrustedAccessibilityClient(true);
    // Oturum açılınca otomatik başla (yalnızca paketlenmiş uygulamada).
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });

    const c = loadCfg();
    if (c.personal) {
      try { await startEmbedded(c.port); }
      catch (e) { dialog.showErrorBox('Sunucu başlatılamadı', `${c.port} portu kullanılamıyor: ${e.message}`); }
    }
    createWindow();
    createTray();
  });
  app.on('before-quit', () => { quitting = true; stopEmbedded(); });
  app.on('window-all-closed', () => {}); // tepside çalışmaya devam et
  app.on('activate', showWindow);
}

// ---- IPC ----
ipcMain.handle('cfg:get', () => {
  const c = loadCfg();
  return {
    registered: !!(c.server && c.deviceId && c.token),
    server: c.server || '', deviceId: c.deviceId || '', deviceName: c.deviceName || os.hostname(),
    token: c.token ? dec(c.token) : '', requireConsent: !!c.requireConsent, user: c.user || '',
    personal: !!c.personal, port: c.port || 8080,
  };
});
ipcMain.handle('cfg:set', (e, patch) => {
  const c = loadCfg();
  if (typeof patch?.requireConsent === 'boolean') c.requireConsent = patch.requireConsent;
  saveCfg(c);
});
ipcMain.handle('reset', () => {
  stopEmbedded();
  try { fs.unlinkSync(cfgFile()); } catch {}
  try { fs.rmSync(dataDir(), { recursive: true, force: true }); } catch {}
});

// Kişisel kurulum: sunucuyu başlat, tek hesabı ("owner") parolayla oluştur, bu bilgisayarı kaydet.
ipcMain.handle('personal:setup', async (e, { password, name, port }) => {
  try {
    if (String(password || '').length < 10) return { ok: false, error: 'Parola en az 10 karakter olmalı' };
    const p = Number(port) || 8080;
    if (!Number.isInteger(p) || p < 1024 || p > 65535) return { ok: false, error: 'Port 1024-65535 arasında olmalı' };
    try { await startEmbedded(p); }
    catch (err) { return { ok: false, error: `${p} portu kullanılamıyor (${err.code || err.message}). Başka bir port deneyin.` }; }
    const auth = require(path.join(serverDir, 'auth'));
    const d = embedded.db.get();
    d.users.owner = { pw: auth.hashPw(password), created: new Date().toISOString() };
    embedded.db.save();
    const { deviceId, token } = embedded.createDevice('owner', name || os.hostname(), process.platform, 'local');
    saveCfg({ personal: true, port: p, server: `http://127.0.0.1:${p}`, deviceId, token: enc(token), deviceName: name || os.hostname(), user: 'owner', requireConsent: false });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('personal:setPassword', (e, { password }) => {
  if (!embedded) return { ok: false, error: 'Sunucu çalışmıyor' };
  if (String(password || '').length < 10) return { ok: false, error: 'Parola en az 10 karakter olmalı' };
  const auth = require(path.join(serverDir, 'auth'));
  const d = embedded.db.get();
  d.users.owner = { ...d.users.owner, pw: auth.hashPw(password) };
  embedded.db.save();
  embedded.sessions.clear(); // açık tüm tarayıcı oturumları kapanır
  return { ok: true };
});
ipcMain.handle('net:info', async () => {
  const c = loadCfg();
  if (!c.personal) return null;
  const urls = accessUrls(c.port);
  const qr = urls[0] ? await QRCode.toDataURL(urls[0].url, { margin: 1, width: 180 }) : '';
  return { urls, qr };
});

// Şirket sunucusuna bağlan: kullanıcı adı/parola ile bu cihazı hesaba bağla. Parola saklanmaz.
// net.fetch Chromium sertifika deposunu kullanır; şirket CA'sı işletim sistemine kuruluysa güvenilir sayılır.
ipcMain.handle('register', async (e, { server, username, password, name }) => {
  try {
    const url = new URL(String(server).trim().replace(/\/+$/, ''));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Adres http(s):// ile başlamalı');
    const r = await net.fetch(url.origin + '/api/device/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, name, platform: process.platform }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error || 'Sunucu hatası (' + r.status + ')' };
    const prev = loadCfg();
    saveCfg({ server: url.origin, deviceId: j.deviceId, token: enc(j.token), deviceName: name, user: String(username).toLowerCase(), requireConsent: !!prev.requireConsent });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Sunucuya ulaşılamadı: ' + err.message };
  }
});

// Her bağlantı için isteğe bağlı açık onay (ayar açıksa).
ipcMain.handle('confirm', async (e, user) => {
  showWindow();
  const r = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['İzin ver', 'Reddet'], defaultId: 1, cancelId: 1,
    message: `${String(user).slice(0, 64)} ekranınızı görmek ve kontrol etmek istiyor.`,
    detail: 'Yalnızca tanıdığınız birine izin verin.',
  });
  return r.response === 0;
});
ipcMain.on('notify', (e, title, body) => {
  if (Notification.isSupported()) new Notification({ title: String(title).slice(0, 80), body: String(body).slice(0, 200) }).show();
});
ipcMain.on('input', (e, ev) => input && input.handle(ev));
