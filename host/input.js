// Viewer'dan gelen fare/klavye olaylarını işletim sistemine uygular.
const { screen } = require('electron');
const { mouse, keyboard, Key, Button, Point } = require('@nut-tree-fork/nut-js');

mouse.config.mouseSpeed = 0;
keyboard.config.autoDelayMs = 0;

const BTN = [Button.LEFT, Button.MIDDLE, Button.RIGHT];
const SPECIAL = {
  Enter: Key.Enter, Backspace: Key.Backspace, Tab: Key.Tab, Escape: Key.Escape,
  Delete: Key.Delete, Space: Key.Space,
  ArrowLeft: Key.Left, ArrowRight: Key.Right, ArrowUp: Key.Up, ArrowDown: Key.Down,
  Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
  ShiftLeft: Key.LeftShift, ShiftRight: Key.RightShift,
  ControlLeft: Key.LeftControl, ControlRight: Key.RightControl,
  AltLeft: Key.LeftAlt, AltRight: Key.RightAlt,
  MetaLeft: Key.LeftSuper, MetaRight: Key.RightSuper,
};

const clamp = (n) => Math.min(1, Math.max(0, Number(n) || 0));

function pos(ev) {
  const b = screen.getPrimaryDisplay().bounds;
  let p = { x: Math.round(b.x + clamp(ev.x) * (b.width - 1)), y: Math.round(b.y + clamp(ev.y) * (b.height - 1)) };
  if (process.platform === 'win32') p = screen.dipToScreenPoint(p); // DPI ölçekleme
  return new Point(p.x, p.y);
}

// Ctrl/Cmd kısayolları için code -> Key (KeyA -> Key.A, Digit1 -> Key.Num1)
function comboKey(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return Key[m[1]];
  if ((m = /^Digit([0-9])$/.exec(code))) return Key['Num' + m[1]];
  return null;
}

async function run(ev) {
  switch (ev.t) {
    case 'move': await mouse.setPosition(pos(ev)); break;
    case 'down': await mouse.setPosition(pos(ev)); await mouse.pressButton(BTN[ev.b] ?? Button.LEFT); break;
    case 'up':   await mouse.setPosition(pos(ev)); await mouse.releaseButton(BTN[ev.b] ?? Button.LEFT); break;
    case 'wheel': {
      const n = Math.max(1, Math.min(10, Math.round(Math.abs(Number(ev.dy) || 0) / 40)));
      await (ev.dy > 0 ? mouse.scrollDown(n) : mouse.scrollUp(n));
      break;
    }
    case 'kd':
    case 'ku': {
      const down = ev.t === 'kd';
      const code = String(ev.code || '').slice(0, 20);
      const key = String(ev.key || '');
      const special = SPECIAL[code];
      if (special !== undefined) {
        await (down ? keyboard.pressKey(special) : keyboard.releaseKey(special));
      } else if (ev.ctrl || ev.meta || ev.alt) {
        const k = comboKey(code);
        if (k !== undefined && k !== null) await (down ? keyboard.pressKey(k) : keyboard.releaseKey(k));
      } else if (down && key.length === 1) {
        await keyboard.type(key);
      }
      break;
    }
  }
}

// Olayları sırayla işle; arka arkaya gelen move'ları birleştir.
let q = Promise.resolve();
let pendingMove = null;
exports.handle = (ev) => {
  if (!ev || typeof ev !== 'object') return;
  if (ev.t === 'move') {
    const first = !pendingMove;
    pendingMove = ev;
    if (!first) return;
    q = q.then(() => { const e = pendingMove; pendingMove = null; return run(e); }).catch(console.error);
  } else if (['down', 'up', 'wheel', 'kd', 'ku'].includes(ev.t)) {
    q = q.then(() => run(ev)).catch(console.error);
  }
};
