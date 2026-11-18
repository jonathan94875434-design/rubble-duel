// 可自訂的按鍵。左鍵開火、右鍵瞄準是固定的；這裡的「瞄準」是額外再給一個鍵（預設左 Shift）。
export const DEFAULT_BINDS = {
  fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'KeyC', ads: 'ShiftLeft',
  reload: 'KeyR', primary: 'Digit1', secondary: 'Digit2', knife: 'Digit3', swap: 'KeyQ', he: 'KeyG', flash: 'KeyF', smoke: 'KeyV', molotov: 'KeyX',
  spray: 'KeyT', emote: 'KeyZ', buy: 'KeyB', talk: 'KeyK', skill1: 'KeyE', skill2: 'Digit4',
};
export const BIND_LABELS = {
  fwd: '前進', back: '後退', left: '往左', right: '往右', jump: '跳', crouch: '蹲下', ads: '瞄準',
  reload: '換彈', primary: '主武器', secondary: '副武器', knife: '刀', swap: '切回上一把', he: '丟手榴彈', flash: '丟閃光彈', smoke: '丟煙霧彈', molotov: '丟燃燒瓶',
  spray: '噴漆', emote: '表情動作', buy: '熱身時開商店', talk: '語音（按住說話）', skill1: '技能 1（Roguelike）', skill2: '技能 2（Roguelike）',
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
  if (!saved || typeof saved !== 'object') return b;
  const had = (a) => typeof saved[a] === 'string' && !!saved[a];
  for (const a of BIND_ACTIONS) if (had(a)) b[a] = saved[a];
  // 改版後才新增的動作（你的存檔裡沒有）：它的預設鍵如果已經被你綁給別的動作，就改用一個沒人用的鍵，免得兩個動作搶同一顆
  const spare = ['KeyE', 'Digit4', 'Digit5', 'KeyH', 'KeyJ', 'KeyY', 'KeyU', 'KeyN'];
  for (const a of BIND_ACTIONS) {
    if (had(a) || !BIND_ACTIONS.some((o) => o !== a && b[o] === b[a])) continue;
    b[a] = spare.find((k) => !BIND_ACTIONS.some((o) => b[o] === k)) || b[a];
  }
  return b;
}
