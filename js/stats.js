import { store } from './util.js';

// 戰績：存在這台電腦的瀏覽器裡（localStorage）。對戰和練習分開記。
const blank = () => ({ matches: 0, wins: 0, rounds: 0, rwins: 0, kills: 0, deaths: 0, hs: 0, wb: 0, knife: 0, shots: 0, hits: 0, dmg: 0, w: {}, recent: [] });

export class Stats {
  constructor() {
    const s = store.get('stats', null) || {};
    this.d = { duel: { ...blank(), ...(s.duel || {}) }, practice: { ...blank(), ...(s.practice || {}) } };
  }
  save() { store.set('stats', this.d); }
  reset(mode) { this.d[mode] = blank(); this.save(); }

  // 一局結束。r: { win, kill（是我擊倒的）, died, head, wb（穿牆）, weapon, shots, hits, dmg }
  round(mode, r) {
    const s = this.d[mode]; if (!s) return;
    s.rounds++; if (r.win) s.rwins++;
    if (r.kill) { s.kills++; if (r.head) s.hs++; if (r.wb) s.wb++; if (r.weapon === 'knife') s.knife++; if (r.weapon) s.w[r.weapon] = (s.w[r.weapon] || 0) + 1; }
    if (r.died) s.deaths++;
    s.shots += r.shots | 0; s.hits += r.hits | 0; s.dmg += r.dmg | 0;
    this.save();
  }
  // 一場結束。m: { win, my, their, opp, map }
  match(mode, m) {
    const s = this.d[mode]; if (!s) return;
    s.matches++; if (m.win) s.wins++;
    s.recent.unshift({ t: Date.now(), win: !!m.win, my: m.my, their: m.their, opp: String(m.opp || '').slice(0, 14), map: m.map });
    s.recent.length = Math.min(s.recent.length, 12);
    this.save();
  }
}
