// macOS (Apple Silicon) imzasız uygulamayı açmaz. Geliştirici sertifikası olmadan ücretsiz "ad-hoc" imza at.
// (Apple Developer hesabın varsa bunun yerine package.json'da mac.identity ile gerçek imza + notarization kullan.)
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  // Masaüstü/iCloud gibi klasörlerde eklenen xattr'lar ("detritus") imzayı bozar, önce temizle.
  try { execFileSync('xattr', ['-cr', app]); } catch {}
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log('ad-hoc imzalandı:', app);
};
