// 到期規則：網頁與 LINE 提醒共用同一份，確保兩邊算出來一樣。
export const WHO = { director: '主任', admin: '行政' };
const DAY = 864e5;
const pad = n => String(n).padStart(2, '0');
const toUtc = s => { const [a, b, c] = s.split('-').map(Number); return Date.UTC(a, b - 1, c); };
const fromUtc = t => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => fromUtc(toUtc(s) + n * DAY);
export const diff = (a, b) => Math.round((toUtc(a) - toUtc(b)) / DAY);
export const dow = s => new Date(toUtc(s)).getUTCDay();
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const taipeiToday = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// 已完成、已送出分開記：需要送出的事項，送出才算結案。
export const collectionFor = t => (t.freq === 'daily' || t.freq === 'weekly') ? 'quick' : 'records';
export const recordId = (id, key) => id + '__' + key;
export const isClosed = (t, r) => !!r && (t.needSend ? !!r.sentAt : !!r.doneAt);
export const stageOf = (t, r) => (r && r.doneAt && t.needSend && !r.sentAt) ? 'send' : 'todo';
const openOcc = (t, key, due, get) => { const r = get(t.id, key); return isClosed(t, r) ? null : { key, due, stage: stageOf(t, r) }; };

// 遇假日順延：週末與固定日期的國定假日。春節、補假每年不同，不在此列。
const FIXED_HOLIDAYS = ['01-01', '02-28', '04-04', '04-05', '05-01', '09-28', '10-10', '10-25', '12-25'];
export const isHoliday = s => dow(s) === 0 || dow(s) === 6 || FIXED_HOLIDAYS.includes(s.slice(5));
export function rollDue(s) { while (isHoliday(s)) s = addDays(s, 1); return s; }

/* 最早一期還沒結案的事項；沒有就回傳 null。 */
export function nextOcc(t, today, get) {
  if (t.freq === 'adhoc') return null;
  if (t.freq === 'once') return openOcc(t, 'once', t.date, get);
  if (t.freq === 'daily') { const w = dow(today); return (w === 0 || w === 6) ? null : openOcc(t, today, today, get); }
  if (t.freq === 'weekly') {
    const mon = addDays(today, -((dow(today) + 6) % 7));
    // 要送出的每週事項，前幾週沒送出不會消失（最多回看 4 週，對應保留的紀錄期間）。
    for (let i = t.needSend ? 4 : 0; i >= 0; i--) {
      const m = addDays(mon, -7 * i), due = addDays(m, (t.weekday || 5) - 1);
      if (i > 0 && (!t.from || due < t.from)) continue;
      const o = openOcc(t, m, due, get);
      if (o) return o;
    }
    return null;
  }
  const from = t.from || today;
  // 只回看 13 個月：紀錄保留 400 天，再舊的查不到，不可誤判成逾期。
  const floor = addDays(today, -395), start = from > floor ? from : floor;
  let y = +start.slice(0, 4), m = +start.slice(5, 7);
  for (let i = 0; i < 40; i++) {
    if ((t.months || []).includes(m)) {
      const raw = y + '-' + pad(m) + '-' + pad(Math.min(t.day || 31, lastDay(y, m))), key = y + '-' + pad(m);
      const due = t.rollover ? rollDue(raw) : raw;
      if (due >= start) { const o = openOcc(t, key, due, get); if (o) return o; }
    }
    if (++m > 12) { m = 1; y++; }
  }
  return null;
}

export function bucket(t, o, today) {
  const d = diff(o.due, today);
  if (d < 0) return 'over';
  if (t.freq === 'daily' || d === 0) return 'today';
  if (t.freq === 'weekly') return 'week';
  return d <= (t.lead || 0) ? 'soon' : 'later';
}

const byDue = (a, b) => a.o.due.localeCompare(b.o.due) || (+!!b.t.gov - +!!a.t.gov) || (a.t.order || 0) - (b.t.order || 0);

/* 每日 LINE 提醒的內容。規則與舊的每日提醒相同：不列每日、不定期；每週事項只在明天到期時列入快到期。 */
export function buildReminder(tasks, today, get) {
  const out = { director: { over: [], today: [], soon: [] }, admin: { over: [], today: [], soon: [] } };
  const soonIds = [];
  for (const t of tasks) {
    if (t.freq === 'daily' || t.freq === 'adhoc') continue;
    const o = nextOcc(t, today, get);
    if (!o || !out[t.who]) continue;
    let b = bucket(t, o, today);
    if (b === 'week') b = diff(o.due, today) === 1 ? 'soon' : null;
    if (b === 'later') b = null;
    if (!b) continue;
    out[t.who][b].push({ t, o });
    if (b === 'soon') soonIds.push(t.id + '__' + o.key);
  }
  for (const w of Object.values(out)) for (const l of Object.values(w)) l.sort((a, b) => (+!!b.t.gov - +!!a.t.gov) || byDue(a, b));
  return { lists: out, soonIds };
}

const WZ = '日一二三四五六';
const md = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}（${WZ[dow(s)]}）`;
function item(x, today) {
  const d = diff(x.o.due, today), when = d < 0 ? `逾期 ${-d} 天` : d === 0 ? '今天到期' : `剩 ${d} 天`;
  const tags = [x.t.gov ? '交縣府' : '', x.o.stage === 'send' ? '已完成，待送出' : ''].filter(Boolean);
  return `・${x.t.title}\n　${md(x.o.due)} ${when}${tags.length ? '｜' + tags.join('｜') : ''}`;
}

export function formatReminder(rem, url, today) {
  const c = k => rem.lists.director[k].length + rem.lists.admin[k].length;
  const sum = [['over', '逾期'], ['today', '今天到期'], ['soon', '快到期']].filter(([k]) => c(k)).map(([k, n]) => `${n} ${c(k)} 件`).join('、');
  const parts = [`📋 待辦提醒 ${md(today)}\n${sum}`];
  for (const who of ['director', 'admin']) {
    const l = rem.lists[who], sec = [];
    if (l.over.length) sec.push('🔴 逾期\n' + l.over.map(x => item(x, today)).join('\n'));
    if (l.today.length) sec.push('🟠 今天到期\n' + l.today.map(x => item(x, today)).join('\n'));
    if (l.soon.length) sec.push('🟡 快到期\n' + l.soon.map(x => item(x, today)).join('\n'));
    if (sec.length) parts.push(`━━ ${WHO[who]} ━━\n` + sec.join('\n\n'));
  }
  parts.push('打開待辦 👇\n' + url);
  return parts.join('\n\n');
}

export function shouldSend(rem, prevSoon = []) {
  const all = Object.values(rem.lists);
  if (all.some(l => l.over.length || l.today.length)) return true;
  const prev = new Set(prevSoon);
  return rem.soonIds.some(id => !prev.has(id));
}

/* LINE 單則上限 5000 字，一次最多 5 則。 */
export function splitText(text, max = 4800, limit = 5) {
  const out = []; let cur = '';
  for (const p of text.split('\n')) {
    if (cur && (cur.length + p.length + 1) > max) { out.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + p;
  }
  if (cur) out.push(cur);
  return out.slice(0, limit);
}
