// Paketlemeden önce sunucuyu ve web arayüzünü host uygulamasının içine kopyalar (bundled/).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'bundled');
fs.rmSync(out, { recursive: true, force: true });

const skip = (src) => !/(^|\/)(node_modules|data|test|\.DS_Store)(\/|$)/.test(src.replace(/\\/g, '/'));
fs.cpSync(path.join(root, '..', 'server'), path.join(out, 'server'), { recursive: true, filter: skip });
fs.cpSync(path.join(root, '..', 'viewer'), path.join(out, 'viewer'), { recursive: true, filter: skip });
console.log('bundled/ hazır:', fs.readdirSync(path.join(out, 'server')).join(', '));
