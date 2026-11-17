// 輸家補償 buff。每個只能拿一次；哪裡生效寫在註解。
export const BUFFS = {
  vital:  { glyph: '血', name: '厚血',     desc: '最大生命 +35' },                 // 主機
  plate:  { glyph: '甲', name: '護甲片',   desc: '開局自帶 50 護甲' },             // 主機
  regen:  { glyph: '癒', name: '再生',     desc: '4 秒沒受傷後，每秒回 6 生命' },   // 主機
  leech:  { glyph: '吸', name: '吸血',     desc: '造成傷害的 25% 轉成自己的生命' }, // 主機
  tough:  { glyph: '硬', name: '硬皮',     desc: '受到的傷害 −15%' },              // 主機
  power:  { glyph: '重', name: '重彈',     desc: '傷害 +15%' },                    // 開槍方
  swift:  { glyph: '疾', name: '疾走',     desc: '移動速度 +15%' },                // 本機
  hop:    { glyph: '跳', name: '二段跳',   desc: '在空中可以再跳一次' },           // 本機
  hands:  { glyph: '快', name: '快手',     desc: '換彈、切槍快 35%' },             // 本機
  mag:    { glyph: '匣', name: '擴充彈匣', desc: '彈匣容量 +50%' },                // 本機
  demo:   { glyph: '拆', name: '拆除專家', desc: '對方塊的傷害 ×2.5' },            // 本機
  steady: { glyph: '穩', name: '穩定握把', desc: '散布 −40%、後座力 −30%' },       // 本機
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

// 把 buff 清單換算成本機用的倍率
export function buffMods(buffs = []) {
  const has = (b) => buffs.includes(b);
  return {
    dmg: has('power') ? 1.15 : 1,
    speed: has('swift') ? 1.15 : 1,
    airJumps: has('hop') ? 1 : 0,
    handling: has('hands') ? 0.65 : 1,
    mag: has('mag') ? 1.5 : 1,
    block: has('demo') ? 2.5 : 1,
    spread: has('steady') ? 0.6 : 1,
    recoil: has('steady') ? 0.7 : 1,
  };
}
