// Kişisel mod: host uygulaması sunucuyu içine gömer, tek "owner" hesabı ve kendi cihazını doğrudan kaydeder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WS = require('ws');
const { start } = require('../server');
const auth = require('../auth');

test('kişisel mod: /api/info single döner, gömülü cihaz bağlanır, parola değişince oturumlar kapanır', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-personal-'));
  const app = start({ port: 0, dataDir: dir, single: true, authMode: 'local', quiet: true });
  await new Promise((r) => app.server.on('listening', r));
  const base = `127.0.0.1:${app.server.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`http://${base}/api/info`)).json(), { single: true });

    // main.js'in yaptığı gibi: owner hesabı + cihaz
    const d = app.db.get();
    d.users.owner = { pw: auth.hashPw('uzun-bir-parola-123') };
    app.db.save();
    const { deviceId, token } = app.createDevice('owner', 'Benim PC', 'darwin', 'local');

    // host bağlanır
    const host = await new Promise((res) => { const w = new WS(`ws://${base}`); w.q = []; w.on('message', (m) => w.q.push(JSON.parse(m))); w.on('open', () => res(w)); });
    host.send(JSON.stringify({ type: 'hello', deviceId, token }));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(host.q[0].type, 'ready');

    // tarayıcı girişi ve cihaz listesi
    const login = await fetch(`http://${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'uzun-bir-parola-123' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const list = await (await fetch(`http://${base}/api/devices`, { headers: { Cookie: cookie } })).json();
    assert.equal(list.devices.length, 1);
    assert.equal(list.devices[0].online, true);

    // parola değiştirilince (main.js: sessions.clear) eski oturum geçersiz olur
    app.sessions.clear();
    assert.equal((await fetch(`http://${base}/api/devices`, { headers: { Cookie: cookie } })).status, 401);
    host.close();
  } finally {
    app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
