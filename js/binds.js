// 可自訂的按鍵。左鍵開火、右鍵瞄準是固定的；這裡的「瞄準」是額外再給一個鍵（預設左 Shift）。
export const DEFAULT_BINDS = {
  fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'KeyC', ads: 'ShiftLeft',
  reload: 'KeyR', primary: 'Digit1', secondary: 'Digit2', swap: 'KeyQ', he: 'KeyG', flash: 'KeyF', smoke: 'KeyV',
};
export const BIND_LABELS = {
  fwd: '前進', back: '後退', left: '往左', right: '往右', jump: '跳', crouch: '蹲下', ads: '瞄準',
  reload: '換彈', primary: '主武器', secondary: '副武器', swap: '切換武器', he: '丟手榴彈', flash: '丟閃光彈', smoke: '丟煙霧彈',
};
export const BIND_ACTIONS = Object.keys(DEFAULT_BINDS);

const NAMES = {
  Space: '空白鍵', ShiftLeft: '左 Shift', ShiftRight: '右 Shift', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl',
  AltLeft: '左 Alt', AltRight: '右 Alt', MetaLeft: '左 ⌘', MetaRight: '右 ⌘', Tab: 'Tab', CapsLock: 'Caps', Enter: 'Enter', Backspace: '←刪除',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Mouse1: '滑鼠中鍵', Mouse3: '滑鼠側鍵 1', Mouse4: '滑鼠側鍵 2',
};
export function keyName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return '數字鍵 ' + code.slice(6);
  return code;
}

export function loadBinds(saved) {
  const b = { ...DEFAULT_BINDS };
  if (saved && typeof saved === 'object') for (const a of BIND_ACTIONS) if (typeof saved[a] === 'string' && saved[a]) b[a] = saved[a];
  return b;
}
