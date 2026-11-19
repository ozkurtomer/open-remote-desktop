#!/usr/bin/env node
// Yönetim komutları. Sunucu çalışırken de kullanılabilir (veri dosyası otomatik yeniden okunur).
//   npm run admin -- add-user <kullanici>      (yerel hesap; LDAP kullanıyorsanız gerekmez)
//   npm run admin -- set-password <kullanici>
//   npm run admin -- del-user <kullanici>      (cihazlarını da siler)
//   npm run admin -- list-users | list-devices | del-device <id>
const path = require('path');
const dbmod = require('./db');
const auth = require('./auth');
const { NAME_RE } = require('./ldap');

const db = dbmod.open(process.env.DATA_DIR || path.join(__dirname, 'data'));
const [cmd, arg] = process.argv.slice(2);

function readPassword(prompt) {
  if (process.env.RC_PASSWORD) return Promise.resolve(process.env.RC_PASSWORD);
  return new Promise((res) => {
    if (!process.stdin.isTTY) { // boru ile verilmiş
      let s = '';
      process.stdin.on('data', (c) => (s += c)).on('end', () => res(s.split('\n')[0]));
      return;
    }
    process.stdout.write(prompt);
    let s = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const on = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', on);
          process.stdout.write('\n');
          return res(s);
        }
        if (ch === '\u0003') process.exit(1);
        if (ch === '\u007f') s = s.slice(0, -1); else s += ch;
      }
    };
    process.stdin.on('data', on);
  });
}

async function main() {
  const d = db.get();
  const name = String(arg || '').toLowerCase();
  switch (cmd) {
    case 'add-user':
    case 'set-password': {
      if (!NAME_RE.test(name)) return console.error('Geçersiz kullanıcı adı (a-z 0-9 . _ @ -)');
      const exists = Object.hasOwn(d.users, name);
      if (cmd === 'add-user' && exists) return console.error('Kullanıcı zaten var');
      if (cmd === 'set-password' && !exists) return console.error('Kullanıcı yok');
      const pw = await readPassword('Parola (min 10 karakter): ');
      if (pw.length < 10) return console.error('Parola en az 10 karakter olmalı');
      d.users[name] = { ...(d.users[name] || {}), pw: auth.hashPw(pw), created: d.users[name]?.created || new Date().toISOString() };
      db.save();
      return console.log(cmd === 'add-user' ? `Kullanıcı eklendi: ${name}` : 'Parola güncellendi');
    }
    case 'del-user': {
      if (!Object.hasOwn(d.users, name)) return console.error('Kullanıcı yok');
      delete d.users[name];
      for (const [id, dev] of Object.entries(d.devices)) if (dev.owner === name) delete d.devices[id];
      db.save();
      return console.log('Kullanıcı ve cihazları silindi (açık oturumlar en geç 12 saatte biter)');
    }
    case 'list-users':
      for (const [u, v] of Object.entries(d.users)) console.log(u, v.ldap ? '(ldap)' : '(yerel)');
      return;
    case 'list-devices':
      for (const [id, v] of Object.entries(d.devices)) console.log(id, v.owner, v.name, v.platform);
      return;
    case 'del-device':
      if (!Object.hasOwn(d.devices, arg)) return console.error('Cihaz yok');
      delete d.devices[arg];
      db.save();
      return console.log('Cihaz silindi');
    default:
      console.log('Komutlar: add-user, set-password, del-user, list-users, list-devices, del-device');
  }
}
main().then(() => process.exit(0));
