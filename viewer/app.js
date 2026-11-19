const $ = (i) => document.getElementById(i);
let ICE = [], ws, pc, dc, pollTimer, connected = false;

async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Hata'), { status: r.status });
  return j;
}
function show(name) {
  $('login').style.display = name === 'login' ? '' : 'none';
  $('devices').style.display = name === 'devices' ? '' : 'none';
  $('screen').style.display = name === 'screen' ? 'block' : 'none';
  $('bar').style.display = name === 'screen' ? 'flex' : 'none';
}

// ---------- giriş / cihaz listesi ----------
$('login').onsubmit = async (e) => {
  e.preventDefault();
  $('loginMsg').textContent = '';
  try {
    const me = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('user').value, password: $('pw').value }) });
    $('pw').value = '';
    showDevices(me.username);
  } catch (err) { $('loginMsg').textContent = err.message; }
};
$('logout').onclick = async () => {
  clearInterval(pollTimer);
  await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {});
  show('login');
};

function showDevices(username) {
  $('hello').textContent = 'Cihazlarım (' + username + ')';
  show('devices');
  refresh();
  clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 5000);
}
async function refresh() {
  try { render((await api('/api/devices')).devices); }
  catch (e) { if (e.status === 401) { clearInterval(pollTimer); show('login'); } }
}
function render(devices) {
  const ul = $('list');
  ul.replaceChildren();
  if (!devices.length) {
    const li = document.createElement('li');
    li.textContent = 'Henüz cihaz yok. Bilgisayara host uygulamasını kurup hesabınla bağla.';
    ul.append(li);
    return;
  }
  for (const d of devices) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot' + (d.online ? ' on' : '');
    const info = document.createElement('div');
    info.className = 'info';
    info.textContent = d.name;
    const small = document.createElement('small');
    small.textContent = (d.platform || '') + ' · ' + (d.busy ? 'meşgul' : d.online ? 'çevrimiçi' : 'çevrimdışı');
    info.append(small);
    const go = document.createElement('button');
    go.textContent = 'Bağlan';
    go.disabled = !d.online || d.busy;
    go.onclick = () => connect(d);
    const del = document.createElement('button');
    del.textContent = 'Sil';
    del.className = 'danger';
    del.onclick = async () => {
      if (!confirm(d.name + ' cihazı hesabından kaldırılsın mı?')) return;
      await api('/api/devices/' + d.id, { method: 'DELETE' }).catch((e) => ($('msg').textContent = e.message));
      refresh();
    };
    li.append(dot, info, go, del);
    ul.append(li);
  }
}

// ---------- bağlantı ----------
function connect(dev) {
  $('msg').textContent = 'Bağlanılıyor...';
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host);
  connected = false;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'connect', deviceId: dev.id }));
  ws.onmessage = onMsg;
  ws.onclose = () => { if (ws) end(connected ? 'Bağlantı kapandı' : $('msg').textContent); };
}
const sig = (data) => ws.send(JSON.stringify({ type: 'signal', data }));

async function onMsg(e) {
  const m = JSON.parse(e.data);
  if (m.type === 'error') { $('msg').textContent = m.message; if (m.code === 'auth') show('login'); ws.close(); }
  else if (m.type === 'waiting') { if (m.ice) ICE = m.ice; $('msg').textContent = 'Cihaza bağlanılıyor...'; }
  else if (m.type === 'reject') end('Cihaz bağlantıyı reddetti');
  else if (m.type === 'bye') end('Cihaz bağlantıyı kapattı');
  else if (m.type === 'accept') startPeer();
  else if (m.type === 'signal' && pc) {
    if (m.data.description) await pc.setRemoteDescription(m.data.description);
    else if (m.data.candidate) await pc.addIceCandidate(m.data.candidate);
  }
}

async function startPeer() {
  pc = new RTCPeerConnection({ iceServers: ICE });
  pc.addTransceiver('video', { direction: 'recvonly' });
  dc = pc.createDataChannel('input');
  pc.onicecandidate = (e) => e.candidate && sig({ candidate: e.candidate });
  pc.ontrack = (e) => {
    const v = $('screen');
    v.srcObject = e.streams[0];
    connected = true;
    clearInterval(pollTimer);
    show('screen');
    v.focus();
    bindInput(v);
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed'].includes(pc.connectionState)) end('Bağlantı koptu');
  };
  await pc.setLocalDescription(await pc.createOffer());
  sig({ description: pc.localDescription });
}

$('off').onclick = () => { try { ws.send(JSON.stringify({ type: 'bye' })); } catch {} end('Bağlantı kesildi'); };

function end(text) {
  unbindInput();
  if (pc) pc.close();
  pc = dc = null;
  const w = ws;
  ws = null;
  try { w && w.close(); } catch {}
  $('screen').srcObject = null;
  connected = false;
  show('devices');
  $('msg').textContent = text || '';
  refresh();
  clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 5000);
}

// ---------- girdi yakalama ----------
const send = (o) => dc && dc.readyState === 'open' && dc.send(JSON.stringify(o));
// Videonun ekranda gerçekten çizildiği alan (letterbox hariç)
function vrect() {
  const v = $('screen'), r = v.getBoundingClientRect();
  const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
  const w = v.videoWidth * s, h = v.videoHeight * s;
  return { ox: r.left + (r.width - w) / 2, oy: r.top + (r.height - h) / 2, w, h };
}
const toNorm = (cx, cy) => { const q = vrect(); return { x: (cx - q.ox) / q.w, y: (cy - q.oy) / q.h }; };
const norm = (e) => toNorm(e.clientX, e.clientY);
// Ekran klavyesi odaktayken yazı tuşlarını input olayı yönetir; yalnızca adlandırılmış tuşlar doğrudan gider.
const NAMED = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Home', 'End', 'PageUp', 'PageDown']);
const keyEv = (t) => (e) => {
  if (document.activeElement === $('kbd') && !NAMED.has(e.key)) return;
  e.preventDefault();
  send({ t, key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey });
};
const H = {
  mousemove: (e) => send({ t: 'move', ...norm(e) }),
  mousedown: (e) => send({ t: 'down', b: e.button, ...norm(e) }),
  mouseup: (e) => send({ t: 'up', b: e.button, ...norm(e) }),
  wheel: (e) => { e.preventDefault(); send({ t: 'wheel', dy: e.deltaY, ...norm(e) }); },
  contextmenu: (e) => e.preventDefault(),
  keydown: keyEv('kd'),
  keyup: keyEv('ku'),
};
function bindInput(v) {
  for (const k of ['mousemove', 'mousedown', 'mouseup', 'contextmenu']) v.addEventListener(k, H[k]);
  v.addEventListener('wheel', H.wheel, { passive: false });
  for (const [k, f] of Object.entries(TOUCH)) v.addEventListener(k, f, { passive: false });
  window.addEventListener('keydown', H.keydown);
  window.addEventListener('keyup', H.keyup);
}
function unbindInput() {
  const v = $('screen');
  for (const k of ['mousemove', 'mousedown', 'mouseup', 'contextmenu', 'wheel']) v.removeEventListener(k, H[k]);
  for (const [k, f] of Object.entries(TOUCH)) v.removeEventListener(k, f);
  touchReset();
  $('kbd').blur();
  window.removeEventListener('keydown', H.keydown);
  window.removeEventListener('keyup', H.keyup);
}

// ---------- mobil: dokunmatik kontrol ----------
// "İmleç modu": tek parmak imleci kaydırır (trackpad gibi), dokunma = tık.
// "Doğrudan mod": imleç parmağın bastığı yere gider.
//   dokunma = sol tık · iki parmakla dokunma = sağ tık · iki parmakla kaydırma = tekerlek · uzun basma = basılı tut/sürükle
let tmode = 'pad', cur = { x: 0.5, y: 0.5 }, T = null;
const ACC = 1.8;
const clamp01 = (n) => Math.min(1, Math.max(0, n));
const sendPos = (t, extra = {}) => send({ t, x: cur.x, y: cur.y, ...extra });

function touchReset() {
  if (T) { clearTimeout(T.timer); if (T.drag) sendPos('up', { b: 0 }); }
  T = null;
}
const TOUCH = {
  touchstart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      T = { t0: Date.now(), x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY, moved: false, fingers: 1, drag: false, scrolled: false, acc: 0, done: false };
      if (tmode === 'direct') { cur = toNorm(t.clientX, t.clientY); sendPos('move'); }
      T.timer = setTimeout(() => {
        if (T && !T.moved && T.fingers === 1) { T.drag = true; sendPos('down', { b: 0 }); navigator.vibrate?.(30); }
      }, 450);
    } else if (e.touches.length === 2 && T) {
      clearTimeout(T.timer);
      if (T.drag) { sendPos('up', { b: 0 }); T.drag = false; }
      T.fingers = 2; T.t2 = Date.now(); T.scrolled = false; T.acc = 0;
      T.ly = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  },
  touchmove(e) {
    e.preventDefault();
    if (!T) return;
    if (T.fingers === 1 && e.touches.length === 1) {
      const t = e.touches[0];
      if (Math.hypot(t.clientX - T.x, t.clientY - T.y) > 8) { T.moved = true; if (!T.drag) clearTimeout(T.timer); }
      if (tmode === 'direct') cur = toNorm(t.clientX, t.clientY);
      else { const q = vrect(); cur = { x: clamp01(cur.x + (t.clientX - T.lx) * ACC / q.w), y: clamp01(cur.y + (t.clientY - T.ly) * ACC / q.h) }; }
      T.lx = t.clientX; T.ly = t.clientY;
      sendPos('move');
    } else if (T.fingers === 2 && e.touches.length === 2) {
      const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      T.acc += T.ly - y; T.ly = y; // parmak yukarı = aşağı kaydır
      if (Math.abs(T.acc) >= 16) { T.scrolled = true; sendPos('wheel', { dy: T.acc * 2 }); T.acc = 0; }
    }
  },
  touchend(e) {
    e.preventDefault();
    if (!T) return;
    clearTimeout(T.timer);
    const rem = e.touches.length;
    if (T.fingers === 2) {
      if (!T.done && !T.scrolled && Date.now() - T.t2 < 400) { sendPos('down', { b: 2 }); sendPos('up', { b: 2 }); }
      T.done = true;
      if (rem === 0) T = null;
      return;
    }
    if (rem === 0) {
      if (T.drag) sendPos('up', { b: 0 });
      else if (!T.moved && Date.now() - T.t0 < 400) { sendPos('move'); sendPos('down', { b: 0 }); sendPos('up', { b: 0 }); }
      T = null;
    }
  },
  touchcancel() { touchReset(); },
};

// ---------- mobil: ekran klavyesi + özel tuşlar ----------
const mods = { ctrl: false, meta: false, alt: false };
const MODCODE = { ctrl: 'ControlLeft', meta: 'MetaLeft', alt: 'AltLeft' };
const NOFLAGS = { ctrl: false, meta: false, alt: false, shift: false };
function refreshMods() {
  for (const [k, id] of [['ctrl', 'tbCtrl'], ['meta', 'tbMeta'], ['alt', 'tbAlt']]) $(id).classList.toggle('on', mods[k]);
}
const rawKey = (key, code, flags = NOFLAGS) => { send({ t: 'kd', key, code, ...flags }); send({ t: 'ku', key, code, ...flags }); };
// Yapışkan Ctrl/⌘/Alt açıksa önce onları bas, tuşa bas, sonra bırak.
function press(key, code) {
  const active = Object.keys(mods).filter((k) => mods[k]);
  const flags = { ...NOFLAGS, ctrl: mods.ctrl, meta: mods.meta, alt: mods.alt };
  for (const k of active) send({ t: 'kd', key: k, code: MODCODE[k], ...flags });
  rawKey(key, code, flags);
  for (const k of active.reverse()) send({ t: 'ku', key: k, code: MODCODE[k], ...flags });
  if (active.length) { mods.ctrl = mods.meta = mods.alt = false; refreshMods(); }
}
function typeChar(ch) {
  let code = '';
  if (/^[a-z]$/i.test(ch)) code = 'Key' + ch.toUpperCase();
  else if (/^[0-9]$/.test(ch)) code = 'Digit' + ch;
  if (mods.ctrl || mods.meta || mods.alt) return press(ch, code);
  send({ t: 'kd', key: ch, code, ...NOFLAGS });
}

// Gizli input'un içeriği farkıyla yazılanı/silineni bul (otomatik düzeltme ve IME ile de çalışır).
const SEED = ' '.repeat(40);
let prevVal = '';
$('kbd').addEventListener('input', () => {
  const k = $('kbd'), val = k.value;
  let i = 0;
  while (i < prevVal.length && i < val.length && prevVal[i] === val[i]) i++;
  for (let n = prevVal.length - i; n > 0; n--) rawKey('Backspace', 'Backspace');
  for (const ch of val.slice(i)) typeChar(ch);
  prevVal = val;
  if (val.length > 200 || val.length < 5) { k.value = SEED; prevVal = SEED; }
});
$('tbKbd').onclick = () => { const k = $('kbd'); k.value = SEED; prevVal = SEED; k.focus(); };
$('tbEsc').onclick = () => press('Escape', 'Escape');
$('tbTab').onclick = () => press('Tab', 'Tab');
$('tbL').onclick = () => press('ArrowLeft', 'ArrowLeft');
$('tbU').onclick = () => press('ArrowUp', 'ArrowUp');
$('tbD').onclick = () => press('ArrowDown', 'ArrowDown');
$('tbR').onclick = () => press('ArrowRight', 'ArrowRight');
for (const [k, id] of [['ctrl', 'tbCtrl'], ['meta', 'tbMeta'], ['alt', 'tbAlt']]) {
  $(id).onclick = () => { mods[k] = !mods[k]; refreshMods(); };
}
$('tbMode').onclick = () => {
  tmode = tmode === 'pad' ? 'direct' : 'pad';
  $('tbMode').textContent = tmode === 'pad' ? 'İmleç modu' : 'Doğrudan mod';
};
// Çubuk düğmeleri klavyeyi kapatmasın / odağı çalmasın
$('bar').addEventListener('touchstart', (e) => e.stopPropagation());

// ---------- açılış ----------
// Kişisel (tek kullanıcılı) kurulumda kullanıcı adı alanını gizle.
api('/api/info').then((i) => { if (i.single) { $('user').value = 'owner'; $('user').style.display = 'none'; } }).catch(() => {});
api('/api/me').then((me) => showDevices(me.username)).catch(() => show('login'));
