// 輸家補償 buff。每個只能拿一次；哪裡生效寫在註解。
export const BUFFS = {
  vital:  { glyph: '血', name: '厚血',     desc: '最大生命 +50' },                 // 主機
  plate:  { glyph: '甲', name: '護甲片',   desc: '每局自帶 100 護甲（是防彈衣的兩倍）' },             // 主機
  regen:  { glyph: '癒', name: '再生',     desc: '3 秒沒受傷後，每秒回 10 生命' },   // 主機
  leech:  { glyph: '吸', name: '吸血',     desc: '造成傷害的 35% 轉成自己的生命' }, // 主機
  tough:  { glyph: '硬', name: '硬皮',     desc: '受到的傷害 −25%' },              // 主機
  power:  { glyph: '重', name: '重彈',     desc: '傷害 +25%' },                    // 開槍方
  swift:  { glyph: '疾', name: '疾走',     desc: '移動速度 +20%' },                // 本機
  hop:    { glyph: '跳', name: '三段跳',   desc: '在空中可以再跳兩次' },           // 本機
  hands:  { glyph: '快', name: '快手',     desc: '換彈、切槍快 50%' },             // 本機
  mag:    { glyph: '匣', name: '擴充彈匣', desc: '彈匣容量 +75%' },                // 本機
  demo:   { glyph: '拆', name: '拆除專家', desc: '對方塊的傷害 ×3.5' },            // 本機
  steady: { glyph: '穩', name: '穩定握把', desc: '散布 −55%、後座力 −45%' },       // 本機
};
export const BUFF_IDS = Object.keys(BUFFS);

export function rollBuffChoices(owned, n = 3) {
  const pool = BUFF_IDS.filter((b) => !owned.includes(b));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

// 換算成倍率：一般模式的強化和 Roguelike 共用 cards.js 的 cardMods
