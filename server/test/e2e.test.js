const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WS = require('ws');
const { start } = require('../server');
const auth = require('../auth');

let app, base, dir;
const PW = 'correct-horse-battery';

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-test-'));
  app = start({ port: 0, dataDir: dir, quiet: true });
  await new Promise((r) => app.server.on('listening', r));
  base = `127.0.0.1:${app.server.address().port}`;
  const d = app.db.get();
  d.users.alice = { pw: auth.hashPw(PW) };
  d.users.bob = { pw: auth.hashPw(PW) };
  app.db.save();
});
after(() => { app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const post = (p, body, cookie) =>
  fetch(`http://${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: JSON.stringify(body) });
const login = async (u) => {
  const r = await post('/api/login', { username: u, password: PW });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
};
const register = async (u, name) => (await (await post('/api/device/register', { username: u, password: PW, name, platform: 'test' })).json());

function open(cookie) {
  return new Promise((res) => {
    const w = new WS(`ws://${base}`, cookie ? { headers: { Cookie: cookie } } : {});
    w.q = [];
    w.on('message', (d) => w.q.push(JSON.parse(d)));
    w.on('open', () => res(w));
  });
}
const next = async (w) => {
  for (let i = 0; i < 100; i++) { if (w.q.length) return w.q.shift(); await new Promise((r) => setTimeout(r, 20)); }
  return null;
};
const tx = (w, o) => w.send(JSON.stringify(o));

test('yanlış parola reddedilir, boş parola reddedilir', async () => {
  assert.equal((await post('/api/login', { username: 'alice', password: 'x' })).status, 401);
  assert.equal((await post('/api/login', { username: 'alice', password: '' })).status, 401);
  assert.equal((await fetch(`http://${base}/api/devices`)).status, 401);
});

test('kullanıcı yalnızca kendi cihazlarını listeler', async () => {
  const a = await register('alice', 'Alice PC');
  const b = await register('bob', 'Bob PC');
  const ca = await login('alice');
  const list = await (await fetch(`http://${base}/api/devices`, { headers: { Cookie: ca } })).json();
  assert.deepEqual(list.devices.map((d) => d.id), [a.deviceId]);
  assert.ok(!list.devices.some((d) => d.id === b.deviceId));
});

test('alice kendi cihazına bağlanır, bob alice\'in cihazına bağlanamaz', async () => {
  const a = await register('alice', 'Alice PC');
  const host = await open();
  tx(host, { type: 'hello', deviceId: a.deviceId, token: a.token });
  assert.equal((await next(host)).type, 'ready');

  // bob, alice'in cihaz ID'sini biliyor olsa bile reddedilir
  const bob = await open(await login('bob'));
  tx(bob, { type: 'connect', deviceId: a.deviceId });
  const err = await next(bob);
  assert.equal(err.type, 'error');
  assert.equal(err.message, 'Cihaz bulunamadı');
  assert.equal(host.q.length, 0, 'host\'a istek gitmemeli');

  // giriş yapmamış biri
  const anon = await open();
  tx(anon, { type: 'connect', deviceId: a.deviceId });
  assert.equal((await next(anon)).code, 'auth');

  // alice bağlanır; sinyal iki yönde iletilir
  const alice = await open(await login('alice'));
  tx(alice, { type: 'connect', deviceId: a.deviceId });
  assert.equal((await next(alice)).type, 'waiting');
  const req = await next(host);
  assert.equal(req.type, 'request');
  assert.equal(req.user, 'alice');
  tx(host, { type: 'accept' });
  assert.equal((await next(alice)).type, 'accept');
  tx(alice, { type: 'signal', data: { x: 1 } });
  assert.deepEqual((await next(host)).data, { x: 1 });
  tx(host, { type: 'signal', data: { y: 2 } });
  assert.deepEqual((await next(alice)).data, { y: 2 });

  // ikinci bağlantı meşgul
  const alice2 = await open(await login('alice'));
  tx(alice2, { type: 'connect', deviceId: a.deviceId });
  assert.equal((await next(alice2)).message, 'Cihaz şu an meşgul');
  [host, bob, anon, alice, alice2].forEach((w) => w.close());
});

test('geçersiz cihaz token\'ı reddedilir', async () => {
  const a = await register('alice', 'X');
  const h = await open();
  tx(h, { type: 'hello', deviceId: a.deviceId, token: 'yanlis' });
  const m = await next(h);
  assert.equal(m.code, 'auth');
  const h2 = await open();
  tx(h2, { type: 'hello', deviceId: '__proto__', token: 'x' });
  assert.equal((await next(h2)).code, 'auth');
});

test('farklı origin\'den gelen websocket reddedilir (CSWSH)', async () => {
  const a = await register('alice', 'Y');
  const cookie = await login('alice');
  const w = await new Promise((res) => {
    const s = new WS(`ws://${base}`, { headers: { Cookie: cookie, Origin: 'http://evil.example' } });
    s.q = []; s.on('message', (d) => s.q.push(JSON.parse(d))); s.on('open', () => res(s));
  });
  tx(w, { type: 'connect', deviceId: a.deviceId });
  assert.equal((await next(w)).message, 'Geçersiz origin');
});

test('cihaz silinince sahibi dışında kimse silemez', async () => {
  const a = await register('alice', 'Z');
  const cb = await login('bob');
  const r = await fetch(`http://${base}/api/devices/${a.deviceId}`, { method: 'DELETE', headers: { Cookie: cb, 'Content-Type': 'application/json' } });
  assert.equal(r.status, 404);
  const ca = await login('alice');
  const r2 = await fetch(`http://${base}/api/devices/${a.deviceId}`, { method: 'DELETE', headers: { Cookie: ca, 'Content-Type': 'application/json' } });
  assert.equal(r2.status, 200);
});
