// Basit JSON dosya deposu (kullanıcılar + cihazlar) ve audit log.
// Küçük/orta ölçek için yeterli. Büyürse SQLite/Postgres ile değiştirilebilir.
const fs = require('fs');
const path = require('path');

function open(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'db.json');
  let mtime = 0;
  let data = null;

  function load() {
    try {
      const st = fs.statSync(file);
      if (data && st.mtimeMs === mtime) return;
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
      mtime = st.mtimeMs;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (!data) data = {};
    }
    data.users ??= {};
    data.devices ??= {};
  }
  function save() {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    mtime = fs.statSync(file).mtimeMs;
  }
  function audit(ev) {
    fs.appendFile(path.join(dir, 'audit.log'), JSON.stringify({ t: new Date().toISOString(), ...ev }) + '\n', () => {});
  }
  load();
  return { get() { load(); return data; }, save, audit };
}

module.exports = { open };
