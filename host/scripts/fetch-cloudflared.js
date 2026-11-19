// Resmi cloudflared sürümünü indirir, SHA-256'sını doğrular ve vendor/cloudflared/ içine koyar.
// Paketleme sırasında uygulamanın içine gömülür (kullanıcı ayrıca bir şey kurmaz).
//   node scripts/fetch-cloudflared.js [--platform darwin|win32|linux] [--arch arm64|x64]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

const VERSION = '2026.11.1';
const BASE = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/`;
// Özetler GitHub'ın resmi sürüm sayfasındaki asset digest değerleridir. Sürümü yükseltirken güncelle.
const ASSETS = {
  'darwin-arm64': { file: 'cloudflared-darwin-arm64.tgz', sha: '02fe4bcf08f2c09699cff30658228a739a0c47fb75f3653d1b8772a27ade4462', tgz: true, name: 'cloudflared' },
  'darwin-x64': { file: 'cloudflared-darwin-amd64.tgz', sha: '5e0403b188dfee71fbd9b995e7dc9910d61b661c52371935ab6475d41185632f', tgz: true, name: 'cloudflared' },
  'win32-x64': { file: 'cloudflared-windows-amd64.exe', sha: '341deda3db5ec498a0482254d6c38c0b7cf01a30c37bb5dd95d2216d08955e35', name: 'cloudflared.exe' },
  'linux-x64': { file: 'cloudflared-linux-amd64', sha: '97bb3b02d23a5980fc9c15a1a270e692da1923f103f920d5b16d4931d5ab55e7', name: 'cloudflared' },
};

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const key = `${arg('platform', process.platform)}-${arg('arch', process.arch)}`;
const a = ASSETS[key];
if (!a) { console.error(`cloudflared: ${key} için hazır paket yok, tünel özelliği bu platformda devre dışı kalır.`); process.exit(0); }

const out = path.join(__dirname, '..', 'vendor', 'cloudflared');
const stamp = path.join(out, '.stamp');
if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === `${key}@${VERSION}`) {
  console.log(`cloudflared ${VERSION} (${key}) zaten hazır`);
  process.exit(0);
}

(async () => {
  console.log(`cloudflared ${VERSION} (${key}) indiriliyor...`);
  const res = await fetch(BASE + a.file);
  if (!res.ok) throw new Error(`indirilemedi: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== a.sha) throw new Error(`SHA-256 uyuşmuyor!\n beklenen: ${a.sha}\n gelen:    ${sha}`);

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  if (a.tgz) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfd-')), a.file);
    fs.writeFileSync(tmp, buf);
    execFileSync('tar', ['xzf', tmp, '-C', out]);
  } else {
    fs.writeFileSync(path.join(out, a.name), buf);
  }
  fs.chmodSync(path.join(out, a.name), 0o755);
  fs.writeFileSync(stamp, `${key}@${VERSION}`);
  console.log('cloudflared hazır, SHA-256 doğrulandı:', path.join(out, a.name));
})().catch((e) => { console.error(e.message); process.exit(1); });
