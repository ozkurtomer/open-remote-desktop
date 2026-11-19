const $ = (i) => document.getElementById(i);
let cfg, ws, pc, stream, ICE = [], retry = 0, timer, stopped = false;

const status = (t, cls = '') => { $('status').textContent = t; $('status').className = cls; };
const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

async function init() {
  cfg = await window.api.getCfg();
  if (cfg.registered) {
    $('setupBox').style.display = 'none';
    $('main').style.display = 'grid';
    $('devName').textContent = cfg.deviceName;
    $('devInfo').textContent = cfg.personal ? 'Kişisel mod (sunucu bu uygulamada çalışıyor)' : `${cfg.user} · ${cfg.server}`;
    $('consent').checked = cfg.requireConsent;
    $('personalBox').style.display = cfg.personal ? 'grid' : 'none';
    if (cfg.personal) loadNet();
    stopped = false;
    connect();
  } else {
    $('main').style.display = 'none';
    $('setupBox').style.display = 'grid';
    $('pName').value = $('name').value = cfg.deviceName;
  }
}

// ---------- kurulum ----------
function tab(personal) {
  $('formP').style.display = personal ? 'grid' : 'none';
  $('formS').style.display = personal ? 'none' : 'grid';
  $('tabP').classList.toggle('on', personal);
  $('tabS').classList.toggle('on', !personal);
}
$('tabP').onclick = () => tab(true);
$('tabS').onclick = () => tab(false);

$('formP').onsubmit = async (e) => {
  e.preventDefault();
  $('pMsg').textContent = 'Başlatılıyor...';
  const r = await window.api.personalSetup({ password: $('pPw').value, name: $('pName').value });
  $('pPw').value = '';
  if (!r.ok) return ($('pMsg').textContent = r.error);
  $('pMsg').textContent = '';
  init();
};
$('formS').onsubmit = async (e) => {
  e.preventDefault();
  $('setupMsg').textContent = 'Bağlanılıyor...';
  const r = await window.api.register({ server: $('server').value, username: $('user').value, password: $('pw').value, name: $('name').value });
  $('pw').value = '';
  if (!r.ok) return ($('setupMsg').textContent = r.error);
  $('setupMsg').textContent = '';
  init();
};

// ---------- ana ekran ----------
async function loadNet() {
  const n = await window.api.netInfo();
  const box = $('urls');
  box.replaceChildren();
  if (!n || !n.urls.length) { box.textContent = 'Ağ bağlantısı bulunamadı'; return; }
  for (const u of n.urls) {
    const row = document.createElement('div');
    const code = document.createElement('code');
    code.textContent = u.url;
    row.append(code, ' ', u.kind === 'tailscale' ? '(Tailscale, her yerden)' : '(aynı Wi-Fi)');
    box.append(row);
  }
  $('qr').src = n.qr;
  $('qr').style.display = n.qr ? 'block' : 'none';
  $('tsHint').style.display = n.urls.some((u) => u.kind === 'tailscale') ? 'none' : 'block';
}
// ---------- internetten erişim (Cloudflare tüneli) ----------
let tunnelOn = false;
const TUNNEL_LABEL = 'İnternetten erişimi aç (Cloudflare, ücretsiz)';
function tunnelClosed() {
  tunnelOn = false;
  $('tunnelInfo').style.display = 'none';
  $('tunnelBtn').textContent = TUNNEL_LABEL;
}
$('tunnelBtn').onclick = async () => {
  if (tunnelOn) { await window.api.tunnelStop(); return tunnelClosed(); }
  $('tunnelBtn').disabled = true;
  $('tunnelMsg').textContent = 'Tünel açılıyor (10-40 saniye sürebilir)...';
  const r = await window.api.tunnelStart();
  $('tunnelBtn').disabled = false;
  if (!r.ok) { $('tunnelMsg').textContent = r.error; return; }
  tunnelOn = true;
  $('tunnelMsg').textContent = '';
  $('tunnelUrl').textContent = r.url;
  $('tunnelQr').src = r.qr;
  $('tunnelInfo').style.display = 'grid';
  $('tunnelBtn').textContent = 'İnternetten erişimi kapat';
};
window.api.onTunnelClosed(tunnelClosed);

$('formPw').onsubmit = async (e) => {
  e.preventDefault();
  const r = await window.api.personalSetPassword({ password: $('newPw').value });
  $('pwMsg').textContent = r.ok ? 'Parola güncellendi, açık oturumlar kapatıldı.' : r.error;
  if (r.ok) $('newPw').value = '';
};
$('consent').onchange = () => { cfg.requireConsent = $('consent').checked; window.api.setCfg({ requireConsent: cfg.requireConsent }); };
$('stop').onclick = () => { send({ type: 'bye' }); cleanup(); status('Bağlantı kesildi, hazır'); };
$('reset').onclick = async () => {
  stopped = true;
  clearTimeout(timer);
  cleanup();
  if (ws) ws.close();
  tunnelClosed();
  await window.api.reset();
  init();
};

// ---------- sunucu bağlantısı (kopunca otomatik yeniden dener) ----------
function connect() {
  clearTimeout(timer);
  ws = new WebSocket(cfg.server.replace(/^http/, 'ws'));
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', deviceId: cfg.deviceId, token: cfg.token }));
  ws.onmessage = onMsg;
  ws.onclose = () => {
    cleanup();
    if (stopped) return;
    status('Sunucuya ulaşılamıyor, yeniden denenecek...', 'err');
    timer = setTimeout(connect, Math.min(60000, 2000 * 2 ** retry++));
  };
}

async function onMsg(e) {
  const m = JSON.parse(e.data);
  if (m.type === 'ready') { retry = 0; status('Hazır, uzaktan bağlantı bekleniyor'); }
  else if (m.type === 'error') {
    status(m.message, 'err');
    if (m.code === 'auth') stopped = true; // kayıt geçersiz: yeniden denemenin anlamı yok
  }
  else if (m.type === 'request') {
    if (m.ice) ICE = m.ice;
    if (cfg.requireConsent && !(await window.api.confirm(m.user))) return send({ type: 'reject' });
    try { await startPeer(); } catch (err) {
      send({ type: 'reject' });
      return status('Ekran yakalanamadı. macOS: Sistem Ayarları > Gizlilik ve Güvenlik > Ekran Kaydı\'nda bu uygulamaya izin verip yeniden başlatın. (' + err.name + ')', 'err');
    }
    send({ type: 'accept' });
    $('stop').disabled = false;
    status(`UZAKTAN KONTROL AKTİF (${m.user})`, 'live');
    window.api.notify('Uzaktan kontrol aktif', `${m.user} bu bilgisayara bağlandı.`);
  }
  else if (m.type === 'signal' && pc) {
    if (m.data.description) {
      await pc.setRemoteDescription(m.data.description);
      if (m.data.description.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        send({ type: 'signal', data: { description: pc.localDescription } });
      }
    } else if (m.data.candidate) {
      await pc.addIceCandidate(m.data.candidate);
    }
  }
  else if (m.type === 'bye') { cleanup(); status('Bağlantı sona erdi, hazır'); }
}

async function startPeer() {
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
  pc = new RTCPeerConnection({ iceServers: ICE });
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  pc.onicecandidate = (e) => e.candidate && send({ type: 'signal', data: { candidate: e.candidate } });
  pc.ondatachannel = (e) => {
    e.channel.onmessage = (msg) => { try { window.api.input(JSON.parse(msg.data)); } catch {} };
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      send({ type: 'bye' }); cleanup(); status('Bağlantı koptu, hazır');
    }
  };
}

function cleanup() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (pc) pc.close();
  stream = pc = null;
  $('stop').disabled = true;
}

init();
