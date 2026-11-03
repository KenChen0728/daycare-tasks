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

// 第二個勾的名稱：多數是「已送出」，報告書這類是「已印出」。
export const sendLabel = t => t.sendLabel || '已送出';
export const pendingLabel = t => '待' + sendLabel(t).slice(1);
export const eitherLabel = '主任或行政皆可';

/* 加一個月，遇到月份天數不同時取該月最後一天。 */
export function addMonth(s) {
  let y = +s.slice(0, 4), m = +s.slice(5, 7) + 1; const d = +s.slice(8, 10);
  if (m > 12) { m = 1; y++; }
  return y + '-' + pad(m) + '-' + pad(Math.min(d, lastDay(y, m)));
}

/* 完成時自動新增的事項。編號固定，同一期不會重複新增。 */
const followUpsOf = t => t.followUps || (t.followUp ? [t.followUp] : []);
export const followUpIds = (t, key) => followUpsOf(t).map((f, i) => 'fu__' + t.id + '__' + key + (i ? '__' + i : ''));
export function followUpTasks(t, key, doneDate) {
  const ids = followUpIds(t, key);
  return followUpsOf(t).map((f, i) => ({ id: ids[i], who: f.who, group: '交辦', freq: 'once', title: f.title, months: [], day: 31, lead: f.lead || 0, gov: false, verify: false,
    note: `${+doneDate.slice(5, 7)} 月${t.title}完成後自動新增`, needSend: !!f.needSend, rollover: false, from: doneDate, order: Date.now() + i, date: addMonth(doneDate),
    either: !!f.either, ...(f.sendLabel ? { sendLabel: f.sendLabel } : {}) }));
}

/* 學期 KPI：下學期 2–7 月、上學期 8–1 月。key 是學期最後一個月，例如 2027-01。 */
export function termOf(key) {
  const y = +key.slice(0, 4), up = key.endsWith('-01'), ay = y - 1 - 1911;
  return { key, up, ay, name: `${ay} 學年度${up ? '上' : '下'}學期`, range: up ? '8–1 月' : '2–7 月', end: key + '-31', yearKeys: [y + '-01', y + '-07'], halfKey: up ? (y - 1) + '-12' : y + '-06' };
}
export function keyEnd(key) {
  return key + '-' + pad(lastDay(+key.slice(0, 4), +key.slice(5, 7)));
}
export function termKey(today) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  return m === 1 ? y + '-01' : m <= 7 ? y + '-07' : (y + 1) + '-01';
}
export const shiftTerm = (key, n) => { let y = +key.slice(0, 4), up = key.endsWith('-01'); for (let i = 0; i < Math.abs(n); i++) { if (n > 0) { if (up) up = false; else { up = true; y++; } } else { if (up) { up = false; y--; } else up = true; } } return y + (up ? '-01' : '-07'); };

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

/* 日曆用：某年某月內的每一期到期日。每個上班日與不定期事項不列入。 */
export function monthOccs(t, y, m, get) {
  const ym = y + '-' + pad(m), out = [];
  const push = (key, due) => { if (due.slice(0, 7) === ym) { const r = get(t.id, key); out.push({ key, due, stage: stageOf(t, r), closed: isClosed(t, r) }); } };
  if (t.freq === 'once') push('once', t.date || '');
  if (t.freq === 'weekly') {
    const wd = t.weekday || 5;
    for (let d = 1; d <= lastDay(y, m); d++) {
      const due = ym + '-' + pad(d);
      if (dow(due) === wd && (!t.from || due >= t.from)) push(addDays(due, 1 - wd), due);
    }
  }
  if (t.freq === 'monthly' || t.freq === 'months') {
    // 上個月底順延過來的那一期也算在這個月。
    for (const [yy, mm] of [m === 1 ? [y - 1, 12] : [y, m - 1], [y, m]]) {
      if (!(t.months || []).includes(mm)) continue;
      const raw = yy + '-' + pad(mm) + '-' + pad(Math.min(t.day || 31, lastDay(yy, mm)));
      const due = t.rollover ? rollDue(raw) : raw;
      if (!t.from || due >= t.from) push(yy + '-' + pad(mm), due);
    }
  }
  return out;
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
  const tags = [x.t.gov ? '交縣府' : '', x.t.either ? eitherLabel : '', x.o.stage === 'send' ? '已完成，' + pendingLabel(x.t) : ''].filter(Boolean);
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
