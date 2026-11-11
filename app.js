import { firebaseConfig, APP_URL } from './firebase-config.js';
import * as fb from './vendor/firebase.js';
import { WHO, nextOcc, bucket, dow, diff, addDays, taipeiToday, collectionFor, recordId, stageOf, monthOccs, sendLabel, pendingLabel, eitherLabel, followUpTasks, followUpIds, planTasks, needsPick, pickDays, pickDeadline, linkPicks, titleOf, termOf, termKey, shiftTerm, keyEnd } from './logic.js';
import { renderHelp } from './help.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MZ = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'], WZ = '日一二三四五六';
const GROUPS = ['交辦', '自辦研習', '每日', '每週', '每月', '每季', '每半年', '每學期', '每年', '不定期'];
const GMAP = { once: '交辦', daily: '每日', weekly: '每週', monthly: '每月', adhoc: '不定期' };
const rocDate = s => { const [y, m, d] = s.split('-').map(Number); return `民國 ${y - 1911} 年 ${m} 月 ${d} 日（${WZ[dow(s)]}）`; };
const short = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
const today = () => taipeiToday();
function ruleText(t) {
  if (t.pickOf && taskOf(t.pickOf)) return `跟${taskOf(t.pickOf).title}同一天截止，一起交`;
  if (t.pick) return '每月兩次，選核銷日期，前一個工作天截止';
  if (t.monthTitle) return (t.dueBefore ? `前一個月 ${t.dueBefore} 號前做好下個月的` : '每月 1 號前做好當月的') + '，遇假日提前' + (t.showPrev ? `，前一個月 ${t.showPrev} 號起提醒` : '');
  if (t.shift) return '每週' + WZ[t.weekday || 5] + '，遇假日改到同週其他天';
  if (t.freq === 'daily') return '每個上班日';
  if (t.freq === 'weekly') return '每週' + WZ[t.weekday || 5] + '前';
  if (t.freq === 'adhoc') return '有需要時';
  if (t.freq === 'once') return '只做一次';
  const end = (t.day || 31) >= 31 ? '月底' : t.day + ' 號';
  const roll = (t.rollover ? '，遇假日順延' : '') + (t.showLast ? `，最後 ${t.showLast} 天才提醒` : t.showFrom ? `，${t.showFrom} 號起提醒` : '');
  if (t.freq === 'monthly') return '每月' + ((t.day || 31) >= 31 ? '底' : ' ' + t.day + ' 號') + roll;
  return (t.months || []).map(m => MZ[m] + '月').join('、') + '（' + end + '）' + roll;
}

// 身分由登入帳號決定，不用自己選。這裡存的是信箱的雜湊值，專案公開也不會直接露出信箱。
const PEOPLE = { 'b97e50eefac19a3b8b06647c29f7da8f4f3a249b10988b40e1cbe04610e327a9': '行政', '655df5cc1ff2921edad3246c3e5a1876c13d8235469f40a689ccb067a05cbcbe': '主任', '83e86d990327eeb937a1f55b6161cfd52371e98499c73aaa977bfeeb1835ece8': '協助者' };
async function nameOf(email) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  return PEOPLE[[...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')] || email;
}
let myName = '';
let db, auth, user, tasks = [], recs = new Map(), meta = null, ready = { tasks: false, records: false, quick: false };
const VIEWS = ['today', 'all', 'cal', 'kpi', 'log', 'set', 'help'];
const PAGES = { today: '今天', all: '全部事項', cal: '日曆', kpi: 'KPI', log: '完成紀錄', set: '設定', help: '說明' };
const MARKS = ['vouchers', 'rules1105', 'rules1105b', 'rules1105c', 'rules1105d', 'rules1109', 'rules1111'];   // 事項上的資料調整標記
const MORE_VIEWS = ['log', 'set', 'help'];   // 手機收在「更多」裡的頁面
const CAL_SIDE = matchMedia('(min-width:1200px)');   // 這麼寬時，當天清單在日曆右邊，和 style.css 同步
const VERSION = '2026.11.11.1';   // 改版時一起改，設定頁看得到
const CAL_BARS = 3;   // 日曆每格最多顯示幾件，其餘寫「還有 N 件」
let helpTopic = '', helpStep = 0, calMonth = '', calSel = '', kpiTerm = '', shownDay = '';
let view = 'today', who = 'all', editing = null, delArmed = false, unsub = [], importData = null;
try { who = localStorage.getItem('who') || 'all'; } catch (e) {}

function toast(m, undo) {
  const e = $('toast'); e.textContent = '';
  const t = document.createElement('span'); t.textContent = m; e.append(t);
  if (undo) { const b = document.createElement('button'); b.type = 'button'; b.className = 'undo'; b.textContent = '復原'; b.onclick = () => { e.hidden = true; undo(); }; e.append(b); }
  e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, undo ? 6000 : 2600);
}
// 寫入追蹤：要等雲端確認才算存好。超過 3 秒沒確認就明白告訴使用者，不讓人以為已經存好。
let saving = 0, slowTimer = null, slowShown = false, netDown = false;
const NET = { slow: '網路不穩，剛才的動作還沒存好。連上網路後會自動補存，在那之前請不要關掉 App。', down: '現在沒有網路。畫面可能不是最新的，打勾要等連上網路才會存好，在那之前請不要關掉 App。' };
function netBar() { const e = $('netBar'); const m = slowShown ? NET.slow : netDown ? NET.down : ''; e.textContent = m; e.hidden = !m; }
function tracked(p) {
  saving++; if (!slowTimer) slowTimer = setTimeout(() => { slowShown = true; netBar(); }, 3000);
  const end = () => { if (--saving) return; clearTimeout(slowTimer); slowTimer = null; const was = slowShown; slowShown = false; netBar(); if (was) toast('已經補存好了'); };
  p.then(end, end); return p;
}
const wr = { setDoc: (...a) => tracked(fb.setDoc(...a)), updateDoc: (...a) => tracked(fb.updateDoc(...a)), deleteDoc: (...a) => tracked(fb.deleteDoc(...a)), commit: b => tracked(b.commit()) };
addEventListener('offline', () => { netDown = true; netBar(); });
addEventListener('online', () => { netDown = false; netBar(); });
function setStatus(m) { const e = $('status'); e.textContent = m || ''; e.hidden = !m; }
const show = t => who === 'all' || t.who === who || !!t.either;
const showRec = d => who === 'all' || d.who === who || !!(taskOf(d.taskId) || {}).either;
const getRec = (id, key) => recs.get(recordId(id, key));
const taskOf = id => tasks.find(t => t.id === id);

function pills(t) { return `${t.either ? `<span class="pill p-either">${eitherLabel}</span>` : `<span class="pill p-${t.who}">${WHO[t.who]}</span>`}${t.gov ? '<span class="pill p-gov">交縣府</span>' : ''}${t.verify ? '<span class="pill p-check">日期待確認</span>' : ''}`; }
function whenText(t, o, b, now) {
  const d = diff(o.due, now);
  if (b === 'over') return `<span class="when-bad">已逾期 ${-d} 天（${short(o.due)}）</span>`;
  if (t.freq === 'daily') return '';
  if (needsPick(t, o.key)) return `<span class="when-warn">${t.pickOf ? '憑證還沒選日期' : '還沒選日期'}</span>`;
  if (d === 0) return '<span class="when-bad">今天到期</span>';
  if (d <= 7) return `<span class="when-warn">剩 ${d} 天（${short(o.due)}）</span>`;
  return `<span>${short(o.due)} 到期，剩 ${d} 天</span>`;
}
function ticks(t, key) {
  const r = getRec(t.id, key), a = `data-id="${esc(t.id)}" data-key="${esc(key)}"`;
  const done = !!(r && r.doneAt), sent = !!(r && r.sentAt), checked = !!(r && r.reviewAt);
  let h = `<button class="tick" role="checkbox" aria-checked="${done}" aria-label="完成：${esc(titleOf(t, key))}" data-act="${done ? 'undoDone' : 'done'}" ${a} ${sent || checked ? 'disabled' : ''}><i>✓</i>完成</button>`;
  // 要覆核的事項一步一步出現：完成 → 主管覆核 → 已送件。
  if (t.review && done) h += `<button class="tick" role="checkbox" aria-checked="${checked}" aria-label="主管覆核：${esc(t.title)}" data-act="${checked ? 'undoReview' : 'review'}" ${a} ${sent || myName !== '主任' ? 'disabled' : ''}><i>✓</i>主管覆核</button>`;
  if (t.needSend && (!t.review || checked)) h += `<button class="tick" role="checkbox" aria-checked="${sent}" aria-label="${sendLabel(t)}：${esc(titleOf(t, key))}" data-act="${sent ? 'undoSent' : 'sent'}" ${a}><i>✓</i>${sendLabel(t)}</button>`;
  return `<div class="ticks">${h}</div>`;
}
// 核銷日期下拉選單：截止日自動算成前一天。送件後就不能改。
function pickSelect(t, key) {
  if (!t.pick) return '';
  const src = t.pickOf && taskOf(t.pickOf);
  if (src) { const d = (t.picks || {})[key]; return `<div class="pick">${+key.slice(5)} 月核銷日期跟著${esc(titleOf(src, key))}：${d ? `${short(d)}（${WZ[dow(d)]}）` : '還沒選'}</div>`; }
  const cur = (t.picks || {})[key] || '', r = getRec(t.id, key);
  const opts = pickDays(key).map(d => `<option value="${d}"${d === cur ? ' selected' : ''}>${short(d)}（${WZ[dow(d)]}）</option>`).join('');
  return `<label class="pick">${+key.slice(5)} 月核銷日期<select data-pick data-id="${esc(t.id)}" data-key="${esc(key)}"${r && r.sentAt ? ' disabled' : ''}><option value="">請選擇</option>${opts}</select></label>`;
}
const nextStep = (t, o) => o.stage === 'review' ? `<span class="when-warn">${myName === '主任' ? '請主任覆核' : '等主任覆核'}</span>` : o.stage === 'send' ? `<span class="when-warn">${pendingLabel(t, o.stage)}</span>` : '';
const editBtn = t => `<button class="edit" data-act="edit" data-id="${esc(t.id)}" aria-label="修改：${esc(t.title)}">修改</button>`;
const row = (t, o, b, now) => `<div class="row${b === 'over' ? ' over' : ''}">${ticks(t, o.key)}<div class="main"><div class="title">${esc(titleOf(t, o.key))}</div>${pickSelect(t, o.key)}<div class="meta">${pills(t)}${nextStep(t, o)}${whenText(t, o, b, now)}${t.note ? `<span>${esc(t.note)}</span>` : ''}</div></div>${editBtn(t)}</div>`;
const section = (title, sub, rows, cls) => rows.length ? `<section><h2 class="${cls || ''}">${title}<small>${sub || rows.length + ' 件'}</small></h2><div class="list">${rows.join('')}</div></section>` : '';

function renderToday() {
  const now = today(), b = { over: [], today: [], week: [], soon: [], month: [], send: [] };
  for (const t of tasks.filter(show)) {
    const o = nextOcc(t, now, getRec); if (!o) continue;
    const k = bucket(t, o, now);
    if (o.stage !== 'todo') b.send.push({ t, o, k });
    else if (b[k]) b[k].push({ t, o, k });
  }
  for (const k in b) b[k].sort((x, y) => x.o.due.localeCompare(y.o.due) || (+!!y.t.gov - +!!x.t.gov) || (x.t.order || 0) - (y.t.order || 0));
  const r = k => b[k].map(x => row(x.t, x.o, x.k, now));
  const fin = [...recs.values()].filter(d => (d.doneDate === now || d.sentDate === now) && showRec(d)).filter(d => { const t = taskOf(d.taskId); return !t || stageOf(t, d) === 'todo'; })
    .map(d => { const t = taskOf(d.taskId) || { id: d.taskId, title: d.title, who: d.who }; return `<div class="row">${ticks(t, d.key)}<div class="main"><div class="title">${esc(d.title)}</div><div class="meta"><span class="pill p-${esc(d.who)}">${WHO[d.who] || ''}</span></div></div></div>`; });
  const open = b.over.length + b.today.length + b.week.length + b.soon.length + b.month.length + b.send.length;
  $('tally').innerHTML = `${b.over.length ? `<span class="bad">逾期 <b>${b.over.length}</b></span>` : ''}<span>今天 <b>${b.today.length}</b></span><span>本週 <b>${b.week.length}</b></span><span class="warn">快到期 <b>${b.soon.length}</b></span><span>本月 <b>${b.month.length}</b></span><span>待送出 <b>${b.send.length}</b></span>`;
  // 手機由上到下排，電腦分左右兩欄：左邊是現在要處理的，右邊是接下來的。
  const left = section('已完成、還沒結案', '最後一個勾打完才算結案', r('send')) + section('已逾期', '', r('over'), 'bad') + section('今天要做', '', r('today')) + section('本週要做', '', r('week'));
  const right = section('快到期', '截止前 7 天內', r('soon')) + section('本月待辦事項', '', r('month')) + section('今天已處理', '再按一次可取消', fin);
  return (open ? '' : '<div class="empty">目前沒有要處理的事項。</div>') + `<div class="twocol">${left ? `<div class="col">${left}</div>` : ''}${right ? `<div class="col">${right}</div>` : ''}</div>`;
}
function renderAll() {
  const now = today(); let h = '<div class="actions start"><button class="btn primary" data-act="planNew">＋ 自辦研習計畫生成</button></div><div class="cols">';
  for (const g of GROUPS) {
    const rows = tasks.filter(t => show(t) && t.group === g).sort((a, b) => (a.order || 0) - (b.order || 0)).map(t => {
      const o = nextOcc(t, now, getRec);
      const last = t.freq === 'adhoc' ? [...recs.values()].filter(d => d.taskId === t.id).sort((a, b) => b.doneDate.localeCompare(a.doneDate))[0] : null;
      const next = t.freq === 'adhoc' ? (last ? `上次 ${short(last.doneDate)}` : '') : o ? (t.freq === 'daily' || t.freq === 'weekly' ? '' : needsPick(t, o.key) ? `${+o.key.slice(5)} 月還沒選日期` : `下次 ${short(o.due)}`) : '本期已結案';
      return `<div class="row"><div class="main"><div class="title">${esc(o ? titleOf(t, o.key) : t.title)}</div>${o ? pickSelect(t, o.key) : ''}<div class="meta">${pills(t)}<span>${esc(ruleText(t))}</span>${t.needSend ? `<span>要${esc(sendLabel(t).slice(1))}</span>` : ''}${next ? `<span>${next}</span>` : ''}${t.note ? `<span>${esc(t.note)}</span>` : ''}</div></div>${t.freq === 'adhoc' ? `<button class="log" data-act="done" data-id="${esc(t.id)}" data-key="${now}">今天做了</button>` : ''}${editBtn(t)}</div>`;
    });
    h += section(g, '', rows);
  }
  return h + '</div>';
}
function renderLog() {
  const list = [...recs.values()].filter(d => (d.doneDate || d.sentDate) && showRec(d));
  if (!list.length) return '<div class="empty">打勾的事項會記在這裡，方便日後查證。</div>';
  const by = {}; list.forEach(d => (by[d.doneDate || d.sentDate] ||= []).push(d));
  return Object.keys(by).sort().reverse().slice(0, 60).map(k => section(rocDate(k), '', by[k].map(d => {
    const t = taskOf(d.taskId) || { id: d.taskId, title: d.title, who: d.who };
    return `<div class="row">${ticks(t, d.key)}<div class="main"><div class="title">${esc(d.title)}</div><div class="meta"><span class="pill p-${esc(d.who)}">${WHO[d.who] || ''}</span>${d.doneAt ? `<span>${esc(d.doneBy)} 完成</span>` : ''}${d.reviewAt ? `<span>${esc(d.reviewBy)} ${short(d.reviewDate)} 覆核</span>` : ''}${d.sentAt ? `<span>${esc(d.sentBy)} ${short(d.sentDate)} ${esc(sendLabel(t).slice(1))}</span>` : ''}</div></div></div>`;
  }))).join('');
}
function calItems(ym, now) {
  const [y, m] = ym.split('-').map(Number), by = {};
  for (const t of tasks.filter(show)) {
    const cur = nextOcc(t, now, getRec);
    for (const o of monthOccs(t, y, m, getRec)) {
      // 逾期判斷與「今天」頁相同，只看目前最早一期還沒結案的事項。
      const state = o.closed ? 'done' : (cur && cur.key === o.key && o.due < now) ? 'over' : 'open';
      (by[o.due] ||= []).push({ t, o, state });
    }
  }
  return by;
}
function renderCal() {
  const now = today(); calMonth ||= now.slice(0, 7); calSel ||= now;
  const [y, m] = calMonth.split('-').map(Number), by = calItems(calMonth, now);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate(), blank = dow(calMonth + '-01');
  let cells = '<span class="cblank"></span>'.repeat(blank);
  for (let d = 1; d <= days; d++) {
    const ds = `${calMonth}-${String(d).padStart(2, '0')}`, l = by[ds] || [], w = dow(ds);
    const rank = { over: 0, open: 1, done: 2 }, over = l.some(x => x.state === 'over');
    l.sort((a, b) => rank[a.state] - rank[b.state] || (+!!b.t.gov - +!!a.t.gov) || (a.t.order || 0) - (b.t.order || 0));
    const bars = l.slice(0, CAL_BARS).map(x => `<span class="ev ${x.state === 'open' ? 'e-' + (x.t.either ? 'either' : x.t.who) : 'e-' + x.state}">${esc(titleOf(x.t, x.o.key))}</span>`).join('') + (l.length > CAL_BARS ? `<span class="evmore">還有 ${l.length - CAL_BARS} 件</span>` : '');
    const label = `${m} 月 ${d} 日，${l.length ? `${l.length} 件${over ? '，有逾期' : ''}` : '沒有事項'}`;
    cells += `<button class="cday${ds === now ? ' today' : ''}${w === 0 ? ' sun' : w === 6 ? ' sat' : ''}" data-act="calDay" data-id="${ds}" aria-label="${label}" aria-pressed="${ds === calSel}"><span class="dnum">${d}</span>${bars}</button>`;
  }
  const sel = calSel.slice(0, 7) === calMonth ? calSel : '', list = (by[sel] || []).sort((a, b) => (+!!b.t.gov - +!!a.t.gov) || (a.t.order || 0) - (b.t.order || 0));
  const rows = list.map(({ t, o, state }) => `<div class="row${state === 'over' ? ' over' : ''}">${ticks(t, o.key)}<div class="main"><div class="title">${esc(titleOf(t, o.key))}</div>${pickSelect(t, o.key)}<div class="meta">${pills(t)}${state === 'over' ? `<span class="when-bad">已逾期 ${diff(now, o.due)} 天</span>` : ''}${o.stage !== 'todo' ? `<span class="when-warn">${pendingLabel(t, o.stage)}</span>` : ''}${t.note ? `<span>${esc(t.note)}</span>` : ''}</div></div>${editBtn(t)}</div>`);
  const head = `<div class="calhead"><button class="btn" data-act="calPrev" aria-label="上個月">‹</button><h2>民國 ${y - 1911} 年 ${m} 月</h2><button class="btn" data-act="calNext" aria-label="下個月">›</button><button class="btn" data-act="calToday">回到今天</button></div>`;
  const grid = `<div class="calendar"><div class="cweek" aria-hidden="true">${[...WZ].map(z => `<span>${z}</span>`).join('')}</div><div class="cgrid">${cells}</div></div>`;
  const legend = '<div class="meta legend"><span><i class="dot e-director"></i>主任</span><span><i class="dot e-admin"></i>行政</span><span><i class="dot e-either"></i>皆可</span><span><i class="dot e-over"></i>逾期</span><span><i class="dot e-done"></i>已結案</span></div>';
  const day = !sel ? '<div class="empty">點日期可以看當天的事項。</div>' : rows.length ? section(rocDate(sel), '', rows) : `<div class="empty">${rocDate(sel)}沒有到期的事項。</div>`;
  return `<div class="calwrap"><div class="calmain">${head}${grid}${legend}</div><div id="calDay">${day}</div></div>`;
}
// 學期 KPI：一頁看完這學期做到哪裡。事項本身仍是一般事項，LINE 提醒與日曆照常運作。
function kpiRow(t, key, label, now) {
  const r = getRec(t.id, key), done = !!(r && r.doneAt), due = keyEnd(key), late = !done && due < now;
  const state = done ? `<span>${esc(r.doneBy || '')} ${short(r.doneDate)} 完成</span>` : late ? `<span class="when-bad">已逾期 ${diff(now, due)} 天</span>` : `<span>${short(due)} 前完成</span>`;
  return `<div class="row${late ? ' over' : ''}">${ticks(t, key)}<div class="main"><div class="title">${esc(label)}</div><div class="meta">${pills(t)}${state}${t.note ? `<span>${esc(t.note)}</span>` : ''}</div></div></div>`;
}
const kpiBar = (n, all) => `<div class="kpibar" role="img" aria-label="完成 ${n} 件，共 ${all} 件"><i style="width:${all ? n / all * 100 : 0}%"></i></div>`;
function renderKpi() {
  const now = today(); kpiTerm ||= termKey(now);
  const T = termOf(kpiTerm), left = diff(T.end, now);
  const term = tasks.filter(t => t.kpi === 'term').sort((a, b) => (a.order || 0) - (b.order || 0));
  const year = tasks.filter(t => t.kpi === 'year').sort((a, b) => (a.order || 0) - (b.order || 0));
  const isDone = (t, k) => { const r = getRec(t.id, k); return !!(r && r.doneAt); };
  const half = tasks.filter(t => t.kpi === 'half').sort((a, b) => (a.order || 0) - (b.order || 0));
  const n = term.filter(t => isDone(t, T.key)).length;
  const head = `<div class="calhead"><button class="btn" data-act="kpiPrev" aria-label="上一學期">‹</button><h2>${T.name}</h2><button class="btn" data-act="kpiNext" aria-label="下一學期">›</button><button class="btn" data-act="kpiNow">本學期</button></div>`;
  const a = `<section><h2>每學期一次<small>${T.range}，完成 ${n} / ${term.length}${left >= 0 ? `，還有 ${left} 天` : ''}</small></h2>${kpiBar(n, term.length)}<div class="list">${term.map(t => kpiRow(t, T.key, t.title, now)).join('')}</div></section>`;
  const h = half.length ? `<section><h2>每半年一次<small>6、12 月底前</small></h2><div class="list">${half.map(t => kpiRow(t, T.halfKey, t.title, now)).join('')}</div></section>` : '';
  const b = year.map(t => {
    const c = T.yearKeys.filter(k => isDone(t, k)).length;
    const rows = T.yearKeys.map((k, i) => kpiRow(t, k, `${t.title} 第 ${i + 1} 次`, now));
    return `<section><h2>一學年兩次<small>${T.ay} 學年度，完成 ${c} / 2</small></h2>${kpiBar(c, 2)}<div class="list">${rows.join('')}</div><p class="hint">通常上、下學期各一次。上學期就做完兩次時，兩個都打勾，下學期就不會再提醒。</p></section>`;
  }).join('');
  return head + (term.length || year.length ? `<div class="cols">${a + h + b}</div>` : '<div class="empty">KPI 事項設定中，請稍後再開一次。</div>');
}
function renderSet() {
  const m = meta ? `${esc(meta.date)} ${hm(meta.at)}：${esc(meta.sent)}` : '還沒有紀錄';
  const q = meta && meta.limit ? `<div>這個月已經用了 ${esc(meta.used)} 則，上限 ${esc(meta.limit)} 則。</div>` : '';
  return `<section><h2>帳號</h2><div class="card"><div>${esc(user.email)}（${esc(myName)}）</div><div class="actions start"><button class="btn" data-act="changePw">修改密碼</button><button class="btn logout" data-act="logout">登出</button></div></div></section>
  <section><h2>LINE 每日提醒</h2><div class="card"><div>上次檢查：${m}</div>${q}</div></section>
  <section><h2>加到桌面與主畫面</h2><div class="card"><div>iPhone：用 Safari 開啟這一頁，點「分享」，再點「加入主畫面」。</div><div>電腦：用 Chrome 或 Edge 開啟，點網址列右側的「安裝」圖示。</div></div></section>
  <section><h2>資料</h2><div class="card"><div>目前有 ${tasks.length} 件事項。匯入只會新增還沒有的資料，不會覆蓋已存在的事項與打勾紀錄。</div><label>選擇匯入檔<input type="file" id="impFile" accept=".json,application/json"></label><div id="impInfo"></div><div class="actions start"><button class="btn primary" data-act="import" id="impBtn" hidden>確認匯入</button><button class="btn" data-act="backup">下載備份</button></div></div></section>
  <section><h2>關於</h2><div class="card"><div>版本 ${VERSION}</div><div>遇到問題時，把畫面截圖傳給協助者，並告訴他這個版本號。</div></div></section>`;
}
function render() {
  shownDay = today(); $('date').textContent = rocDate(shownDay);
  $('app').dataset.view = view;
  if ($('pageName')) $('pageName').textContent = PAGES[view];
  if ($('moreBtn')) $('moreBtn').toggleAttribute('data-on', MORE_VIEWS.includes(view));
  $('tally').hidden = view !== 'today';
  document.querySelectorAll('.tab').forEach(b => b.dataset.view === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  document.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.who === who));
  document.querySelector('.people').hidden = view === 'set' || view === 'help' || view === 'kpi';
  $('searchWrap').hidden = view !== 'all';
  $('add').hidden = view === 'help';
  if (!ready.tasks || !ready.records || !ready.quick) return;
  const a = renderToday();
  if (view === 'set' && $('impFile')) return;   // 設定頁正在選檔時不重畫
  $('view').innerHTML = view === 'today' ? a : view === 'all' ? renderAll() : view === 'cal' ? renderCal() : view === 'kpi' ? renderKpi() : view === 'log' ? renderLog() : view === 'help' ? renderHelp(helpTopic, helpStep) : renderSet();
  if (view === 'all') applySearch();
  lineInfo();
  staleWarning();
}
const hm = iso => { try { return iso ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : ''; } catch (_) { return ''; } };
// 今天的 LINE 提醒狀態。沒有事就不發，所以要讓人分得出「沒事」和「沒發出去」。
function lineInfo() {
  const e = $('lineInfo'), now = today(), w = dow(now), work = w > 0 && w < 6;
  let m = '', bad = false;
  if (meta && meta.failDate === now && meta.date !== now) { m = `今天的 LINE 提醒沒有發出去（${esc(meta.fail)}）。請先看這一頁，並告訴協助者。`; bad = true; }
  else if (meta && meta.date === now) m = meta.sentAt && hm(meta.sentAt) && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(meta.sentAt)) === now ? `LINE 提醒：今天 ${hm(meta.sentAt)} 已發送` : `LINE 提醒：今天 ${hm(meta.at)} 檢查過，沒有要提醒的事`;
  else if (meta && work) { if (hm(new Date().toISOString()) >= '11:30') { m = '今天的 LINE 提醒到現在還沒有發出來。請先看這一頁，並告訴協助者。'; bad = true; } else m = 'LINE 提醒：今天約 8 點、10 點發送'; }
  e.innerHTML = m; e.hidden = !m || view !== 'today'; e.classList.toggle('bad', bad);
}
// 全部事項的搜尋：只把不符合的列藏起來，不動資料。
function applySearch() {
  const q = $('allSearch').value.trim().toLowerCase(); let any = false;
  document.querySelectorAll('#view section').forEach(s => {
    let n = 0;
    s.querySelectorAll('.row').forEach(r => { const hit = !q || r.textContent.toLowerCase().includes(q); r.hidden = !hit; if (hit) n++; });
    const c = s.querySelector('h2 small'); if (c && /件$/.test(c.textContent)) c.textContent = n + ' 件';
    s.hidden = !n; if (n) any = true;
  });
  document.querySelectorAll('#view .actions.start').forEach(a => a.hidden = !!q);
  let none = $('allNone');
  if (q && !any) { if (!none) { none = document.createElement('div'); none.id = 'allNone'; none.className = 'empty'; $('view').prepend(none); } none.textContent = `找不到「${q}」。可以換個詞，或按「＋ 新增事項」新增。`; }
  else if (none) none.remove();
}
function staleWarning() {
  if (!meta) return;
  let d = today(), n = 0;
  while (d > meta.date && n < 4) { const w = dow(d); if (w > 0 && w < 6) n++; d = addDays(d, -1); }
  if (n >= 3) setStatus(`LINE 每日提醒已有幾個上班日沒有執行（最後一次 ${meta.date}），請通知協助設定的人檢查。`);
}
function setView(v, push) { setMore(false); view = VIEWS.includes(v) ? v : 'today'; if (view === 'help') { helpTopic = ''; helpStep = 0; } if ($('view').querySelector('#impFile')) $('view').innerHTML = ''; if (push) location.hash = view; render(); if (push) scrollTo(0, 0); }
// 手機的「更多」選單。電腦版這三頁直接列在左側，用不到。
function setMore(open) {
  if (!$('tabs') || !$('moreBtn')) return;
  $('tabs').classList.toggle('open', open); $('moreBtn').setAttribute('aria-expanded', open); $('moreShade').hidden = !open;
  if (open) $('moreMenu').querySelector('button').focus({ preventScroll: true });
}

// 第一次完成時新增後續事項；已經有了就不動，以免蓋掉修改過的期限。
async function addFollowUp(t, key, r, stage, s) {
  const had = !!(r && r.doneAt), when = on => on === 'sent' ? stage === 'sent' : !had;
  const list = followUpTasks(t, key, s.date, when).filter(f => !taskOf(f.id)); if (!list.length) return '';
  const b = fb.writeBatch(db); list.forEach(f => b.set(fb.doc(db, 'tasks', f.id), f)); await wr.commit(b);
  return list.map(f => `「${f.title}」`).join('、') + `，${short(list[0].date)} 前完成`;
}
// 取消完成時，後續事項還沒動過才一起移除。
async function dropFollowUp(t, key, when) {
  const ids = followUpIds(t, key, when).filter(id => taskOf(id) && !getRec(id, 'once'));
  await Promise.all(ids.map(id => wr.deleteDoc(fb.doc(db, 'tasks', id)))); return ids.length > 0;
}
const refOf = (t, key) => fb.doc(db, collectionFor(t), recordId(t.id, key));
const stamp = () => ({ by: myName, at: new Date().toISOString(), date: today() });
async function act(a, id, key) {
  const t = taskOf(id); if (!t) return toast('這件事項已被刪除，無法更改。');
  const ref = refOf(t, key), s = stamp(), r = getRec(id, key);
  const name = titleOf(t, key), base = { taskId: id, key, title: name, who: t.who };
  try {
    if (a === 'done') { await wr.setDoc(ref, { ...base, doneAt: s.at, doneBy: s.by, doneDate: s.date }, { merge: true }); const fu = await addFollowUp(t, key, r, 'done', s); toast(fu ? `已完成，已新增${fu}` : t.review ? '已完成，請主任覆核：' + name : t.needSend ? `已完成，記得${sendLabel(t).slice(1)}：` + name : '已完成：' + name, () => act('undoDone', id, key)); }
    if (a === 'review') { await wr.setDoc(ref, { reviewAt: s.at, reviewBy: s.by, reviewDate: s.date }, { merge: true }); toast('已覆核，可以送件了：' + name, () => act('undoReview', id, key)); }
    if (a === 'undoReview') { await wr.updateDoc(ref, { reviewAt: fb.deleteField(), reviewBy: fb.deleteField(), reviewDate: fb.deleteField() }); toast('已取消覆核'); }
    if (a === 'sent') { await wr.setDoc(ref, { ...base, ...(r && r.doneAt ? {} : { doneAt: s.at, doneBy: s.by, doneDate: s.date }), sentAt: s.at, sentBy: s.by, sentDate: s.date }, { merge: true }); const fu = await addFollowUp(t, key, r, 'sent', s); toast(fu ? `${sendLabel(t)}，已新增${fu}` : `${sendLabel(t)}，結案：` + name, () => act('undoSent', id, key)); }
    if (a === 'undoSent') { await wr.updateDoc(ref, { sentAt: fb.deleteField(), sentBy: fb.deleteField(), sentDate: fb.deleteField() }); await dropFollowUp(t, key, on => on === 'sent'); toast('已取消' + sendLabel(t).slice(1)); }
    if (a === 'undoDone') { await wr.deleteDoc(ref); toast(await dropFollowUp(t, key) ? '已取消完成，自動新增的事項也移除了' : '已取消完成'); }
  } catch (e) { console.error(e); toast('沒有存到，請再按一次。'); }
}

function syncForm() {
  const f = $('fFreq').value;
  $('wDate').hidden = f !== 'once'; $('wMonths').hidden = f !== 'months'; $('wWeek').hidden = f !== 'weekly';
  $('wDay').hidden = $('wRoll').hidden = !(f === 'months' || f === 'monthly') || !!(editing && editing.dueBefore); $('fDate').required = f === 'once';
  $('wSend').hidden = f === 'daily' || f === 'adhoc';
}
function openForm(t) {
  editing = t || null; delArmed = false; $('del').textContent = '刪除'; $('del').hidden = !t; $('toPlan').hidden = !!t;
  $('dlgTitle').textContent = t ? '修改事項' : '新增事項'; $('wSendText').textContent = `要${sendLabel(t || {}).slice(1)}，${sendLabel(t || {}).slice(1)}才算結案`;
  $('fTitle').value = t ? t.title : ''; $('fWho').value = t ? t.who : (who === 'director' ? 'director' : 'admin');
  $('fFreq').value = t ? t.freq : 'once'; $('fDate').value = t && t.date || (view === 'cal' && calSel) || today();
  $('fDay').value = t ? (t.day || 31) : 31; $('fLead').value = t ? (t.lead || 0) : 7; $('fWeekday').value = String(t && t.weekday || 5);
  $('fNote').value = t ? t.note || '' : ''; $('fGov').checked = !!(t && t.gov); $('fVerify').checked = !!(t && t.verify); $('fSend').checked = !!(t && t.needSend); $('fRoll').checked = !!(t && t.rollover);
  $('wVerify').hidden = !(t && t.verify);
  document.querySelectorAll('#mgrid input').forEach(c => c.checked = !!(t && (t.months || []).includes(+c.value)));
  syncForm(); $('dlg').showModal();
}
let savingForm = false;
async function save() {
  if (savingForm) return;
  const freq = $('fFreq').value, months = [...document.querySelectorAll('#mgrid input:checked')].map(c => +c.value);
  if (freq === 'months' && !months.length) return toast('請至少選一個月份。');
  const old = editing, title = $('fTitle').value.trim(); if (!title) return;
  const group = freq === 'months' ? (old && old.freq === 'months' ? old.group : (months.length === 1 ? '每年' : '每季')) : GMAP[freq];
  const keep = Object.fromEntries(['kpi', 'followUp', 'followUps', 'either', 'sendLabel', 'plan', 'planData', 'pick', 'picks', 'review', 'vouchers', 'monthTitle', 'rollBack', 'shift', 'showFrom', 'showLast', 'showPrev', 'dueBefore', 'pickOf', 'rules1105d', 'rules1109', 'rules1111', 'rules1105', 'rules1105b', 'rules1105c'].filter(k => old && old[k] !== undefined).map(k => [k, old[k]]));
  const data = { ...keep, who: $('fWho').value, group, freq, title, months: freq === 'monthly' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : freq === 'months' ? months : [],
    day: +$('fDay').value || 31, lead: +$('fLead').value || 0, gov: $('fGov').checked, verify: $('fVerify').checked, note: $('fNote').value.trim(),
    needSend: freq !== 'daily' && freq !== 'adhoc' && $('fSend').checked, rollover: (freq === 'monthly' || freq === 'months') && $('fRoll').checked, from: old ? old.from : today(), order: old ? old.order : Date.now() };
  if (freq === 'once') data.date = $('fDate').value;
  if (freq === 'weekly') data.weekday = +$('fWeekday').value;
  const ref = old ? fb.doc(db, 'tasks', old.id) : fb.doc(fb.collection(db, 'tasks'));
  const sv = $('frm').querySelector('[type=submit]'); savingForm = true; sv.disabled = true; sv.textContent = '儲存中…';
  try { await wr.setDoc(ref, { ...data, id: ref.id }); $('dlg').close(); toast('已儲存'); } catch (e) { console.error(e); toast('沒有存到，請再按一次。'); } finally { savingForm = false; sv.disabled = false; sv.textContent = '儲存'; }
}
async function remove() {
  if (!delArmed) { delArmed = true; $('del').textContent = '確定刪除？'; return; }
  // 資料調整的標記記在事項上。這件被刪時要移到別件，不然調整會重跑，蓋掉之後的修改。
  const marks = Object.fromEntries(MARKS.filter(k => editing[k]).map(k => [k, true])), heir = tasks.find(t => t.id !== editing.id);
  const b = fb.writeBatch(db); b.delete(fb.doc(db, 'tasks', editing.id));
  if (heir && Object.keys(marks).length) b.set(fb.doc(db, 'tasks', heir.id), marks, { merge: true });
  try { await wr.commit(b); $('dlg').close(); toast('已刪除'); } catch (e) { toast('沒有刪除成功，請再試一次。'); }
}

// 自辦研習計畫：填一次產生後續事項；之後從計畫改日期或取消，還沒結案的事項會一起更新。
let planEdit = null, planDel = false;
function openPlan(t) {
  planEdit = t || null; planDel = false; const p = t ? t.planData : {};
  $('planTitle').textContent = t ? '修改自辦研習計畫' : '自辦研習計畫生成';
  $('pName').value = p.name || ''; $('pDeadline').value = p.deadline || ''; $('pStart').value = p.start || ''; $('pEnd').value = p.end && p.end !== p.start ? p.end : ''; $('pTime').value = p.time || '';
  $('planDel').hidden = !t; $('planDel').textContent = '取消這場研習'; $('planDlg').showModal();
}
const untouched = id => taskOf(id) && !getRec(id, 'once');
const planIds = p => { const [, gov] = planTasks(p, today()); return [p.id, gov.id, p.id + '-report', ...followUpIds(gov, 'once')]; };
let savingPlan = false;
async function savePlan() {
  if (savingPlan) return;
  const start = $('pStart').value, end = $('pEnd').value || start;
  if (end < start) return toast('結束日期不能早於課程日期。');
  const p = { id: planEdit ? planEdit.planData.id : 'plan-' + Date.now(), name: $('pName').value.trim(), deadline: $('pDeadline').value, start, end, time: $('pTime').value.trim() };
  const list = planTasks(p, today()), b = fb.writeBatch(db);
  for (const t of list) if (!planEdit) b.set(fb.doc(db, 'tasks', t.id), t); else if (untouched(t.id)) { const { order, from, ...d } = t; b.set(fb.doc(db, 'tasks', t.id), d, { merge: true }); }
  if (planEdit) {
    const gov = list[1], sign = followUpIds(gov, 'once')[0], [f] = gov.followUps;
    if (untouched(sign)) b.set(fb.doc(db, 'tasks', sign), { date: f.date > today() ? f.date : today(), note: f.note }, { merge: true });
  }
  savingPlan = true;
  try { await wr.commit(b); $('planDlg').close(); toast(planEdit ? '已更新，還沒結案的事項都改好了' : '已生成，核備縣府會在課程前兩週出現'); } catch (e) { console.error(e); toast('沒有存到，請再按一次。'); } finally { savingPlan = false; }
}
async function removePlan() {
  if (!planDel) { planDel = true; $('planDel').textContent = '確定取消？'; return; }
  const ids = planIds(planEdit.planData).filter(untouched), b = fb.writeBatch(db);
  ids.forEach(id => b.delete(fb.doc(db, 'tasks', id)));
  try { await wr.commit(b); $('planDlg').close(); toast('已取消，已完成的事項會留著'); } catch (e) { toast('沒有取消成功，請再試一次。'); }
}

function openPw() { $('pwForm').reset(); $('pwUser').value = user.email; $('pwMsg').textContent = ''; $('pwDlg').showModal(); }
async function changePw() {
  const m = $('pwMsg'), pw = $('pwNew').value;
  if (pw !== $('pwNew2').value) { m.textContent = '兩次輸入的新密碼不一樣。'; return; }
  m.textContent = '儲存中…'; $('pwSave').disabled = true;
  try {
    await fb.reauthenticateWithCredential(user, fb.EmailAuthProvider.credential(user.email, $('pwOld').value));
    await fb.updatePassword(user, pw);
    $('pwDlg').close(); toast('密碼已修改，下次請用新密碼登入。');
  } catch (e) {
    console.error(e);
    const c = e.code || '';
    m.textContent = c === 'auth/invalid-credential' || c === 'auth/wrong-password' ? '目前的密碼不正確。' : c === 'auth/weak-password' ? '新密碼太簡單，請換一組。' : c === 'auth/too-many-requests' ? '嘗試太多次，請稍後再試。' : '沒有改成功，請確認網路後再試一次。';
  } finally { $('pwSave').disabled = false; }
}

async function doImport() {
  const { tasks: T = [], records: R = [] } = importData;
  try {
    const all = await allData();
    const have = new Set(all.tasks.map(t => t.id)), haveR = new Set(all.records.map(r => r.id));
    const newT = T.filter(t => !have.has(t.id)), byId = new Map([...all.tasks, ...T].map(t => [t.id, t]));
    const newR = R.filter(r => !haveR.has(r.id) && byId.has(r.taskId));
    const ops = [...newT.map(t => [fb.doc(db, 'tasks', t.id), t]), ...newR.map(r => { const { id, ...d } = r; return [fb.doc(db, collectionFor(byId.get(r.taskId)), id), d]; })];
    for (let i = 0; i < ops.length; i += 400) { const b = fb.writeBatch(db); ops.slice(i, i + 400).forEach(([ref, d]) => b.set(ref, d)); await b.commit(); }
    toast(`已匯入 ${newT.length} 件事項、${newR.length} 筆紀錄`); importData = null; $('view').innerHTML = ''; render();
  } catch (e) { console.error(e); toast('匯入失敗，資料沒有全部寫入，請再試一次。'); }
}
// 畫面只載入近期紀錄，備份和匯入要看資料庫裡的全部。
async function allData() {
  const [a, b, c] = await Promise.all(['tasks', 'records', 'quick'].map(n => fb.getDocs(fb.collection(db, n))));
  const rows = s => s.docs.map(d => ({ ...d.data(), id: d.id }));
  return { tasks: rows(a), records: [...rows(b), ...rows(c)] };
}
async function backup() {
  let all;
  try { all = await allData(); } catch (e) { console.error(e); return toast('備份沒有成功，請確認網路後再試一次。'); }
  const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...all }, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `萬丹公托待辦備份-${today()}.json`; a.click(); URL.revokeObjectURL(url);
}

// 資料更新：每項只做一次，已更新過的不再動，之後刪改 KPI 不會被加回來。
const KPI = { group: '每學期', freq: 'months', months: [1, 7], day: 31, lead: 60, from: '2026-08-01' };
const SHARED = { who: 'director', either: true, lead: 31 };
const after = (name, sat) => [{ ...SHARED, title: sat }, { ...SHARED, title: name + '成果報告書', needSend: true, sendLabel: '已印出' }];
const AFTER = { 'kpi-meeting': after('親師座談會', '親師座談會活動滿意度調查'), 'kpi-family': after('親子活動', '親子活動滿意度調查') };
const NEW_KPI = [['kpi-meeting', '親師座談會', 'term', 1], ['kpi-family', '親子活動', 'term', 2], ['kpi-parenting', '親職講座', 'term', 3], ['kpi-community', '社區宣導', 'year', 5]];
const HALF = { kpi: 'half', group: '每半年', months: [6, 12], day: 31, lead: 60, from: '2026-08-01', order: 4, followUps: [{ ...SHARED, title: '滿意度成果報告書' }] };
const VOUCHER = { who: 'admin', either: true, group: '每月', freq: 'monthly', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], day: 31, lead: 0, from: '2026-11-01', note: '', gov: false, verify: false, needSend: true, sendLabel: '已送件', rollover: false, pick: true, picks: {}, review: true };
const EARLY = ['幼兒適性／總表／節氣檢查列印', '托育人員週計畫檢查列印'];
const LATE = ['候補名單統整', '製作月費收據／月費袋發回', '生長曲線發展異常單（追蹤托育人員）', '發展篩檢異常單（追蹤托育人員）', '意外事故單彙整', '生活自立能力表追蹤（如廁／刷牙／吃飯）'];
let upgrading = false;
async function upgradeData() {
  if (upgrading) return;
  const b = fb.writeBatch(db), sup = tasks.find(t => t.title === '外聘督導'), sat = tasks.find(t => t.title === '家長滿意度調查'); let n = 0;
  const put = (id, d, merge) => { b.set(fb.doc(db, 'tasks', id), d, merge ? { merge: true } : {}); n++; };
  if (sup && !sup.followUp) {
    put(sup.id, { followUp: { ...SHARED, title: '外聘督導成果報告書', needSend: true, sendLabel: '已印出' } }, true);
    for (const [id, title, kpi, order] of NEW_KPI) put(id, { ...KPI, id, title, kpi, order, ...(AFTER[id] ? { followUps: AFTER[id] } : {}), who: 'director', note: '', gov: false, verify: false, needSend: false, rollover: false });
  } else for (const id in AFTER) { const t = taskOf(id); if (t && !t.followUps) put(id, { followUps: AFTER[id] }, true); }
  if (sat && sat.kpi !== 'half') put(sat.id, HALF, true);
  // 憑證核銷製作：標記記在既有事項上，之後刪掉不會被加回來。
  if (tasks.length && !tasks.some(t => t.vouchers) && !taskOf('voucher-1') && !taskOf('voucher-2')) {
    put((sup || tasks[0]).id, { vouchers: true }, true);
    for (const i of [1, 2]) put('voucher-' + i, { ...VOUCHER, id: 'voucher-' + i, title: `憑證核銷製作（第 ${i} 次）`, order: 900 + i });
  }
  // 薪資、排班：月底做好下個月的，到期日 1 號，遇假日提前。今年 11 月那期已過，從 12 月開始。
  for (const title of ['薪資製作', '排班表']) { const t = tasks.find(x => x.title === title && !x.monthTitle); if (t) put(t.id, { monthTitle: true, rollBack: true, day: 1, from: '2026-11-02' }, true); }
  // 登革熱場域巡檢表：每週二、四，遇假日改到同週其他天。
  const den = tasks.find(t => t.title === '登革熱場域巡檢表' && t.freq === 'weekly');
  if (den) {
    put(den.id, { title: '登革熱場域巡檢表（週二）', weekday: 2, shift: [1, 3, 5] }, true);
    const id = den.id + '-thu', { order, ...d } = den;
    put(id, { ...d, id, title: '登革熱場域巡檢表（週四）', weekday: 4, shift: [5, 3, 1], from: '2026-11-02', order: (order || 0) + .5 });
  }
  // 歸檔類月底最後 7 天才提醒；量身高體重月中後才量，20 號起提醒。
  for (const t of tasks.filter(x => x.freq === 'monthly')) {
    if (t.title.includes('歸檔') && !t.showLast) put(t.id, { showLast: 7 }, true);
    if (t.title.includes('身高體重') && !t.showFrom) put(t.id, { showFrom: 20 }, true);
  }
  // 2026-11-05 調整：只做一次，標記記在既有事項上，之後再改不會被改回來。
  const keepTask = tasks.find(t => t.title !== '製作憑證');
  if (keepTask && !tasks.some(t => t.rules1105)) {
    put(keepTask.id, { rules1105: true }, true);
    for (const t of tasks) {
      if (t.title === '製作憑證') { b.delete(fb.doc(db, 'tasks', t.id)); n++; }
      else if (t.title === '消防設備檢查表') put(t.id, { freq: 'daily', group: '每日', months: [] }, true);
      else if (EARLY.includes(t.title)) put(t.id, { day: 5, showFrom: 1 }, true);
      else if (LATE.includes(t.title)) put(t.id, { showLast: 7 }, true);
    }
  }
  // 候補名單統整要在 1 號的候補名單更新之前做完，移回月底。
  if (keepTask && !tasks.some(t => t.rules1105b)) {
    put(keepTask.id, { rules1105b: true }, true);
    const c = tasks.find(t => t.title === '候補名單統整');
    if (c) put(c.id, { day: 31, showLast: 7, showFrom: fb.deleteField() }, true);
  }
  // 檢查列印兩件：10 號前檢查，檢查完還要按「已印出」才結案。
  if (keepTask && !tasks.some(t => t.rules1105c)) {
    put(keepTask.id, { rules1105c: true }, true);
    for (const t of tasks) if (EARLY.includes(t.title)) put(t.id, { day: 10, showFrom: 1, needSend: true, sendLabel: '已印出' }, true);
  }
  // 薪資、排班：前一個月 15 號起進本月待辦，最後 7 天進快到期。
  if (keepTask && !tasks.some(t => t.rules1105d)) {
    put(keepTask.id, { rules1105d: true }, true);
    for (const t of tasks) if (t.monthTitle) put(t.id, { showPrev: 15 }, true);
  }
  // 零用金代墊清單：每次憑證核銷各一件，日期跟著同一次的憑證，一樣要主管覆核、已送件。
  // 本月那次憑證已送件的話，從下個月開始，不會跑出已經交過的那一期。11 月第 1 次不補（主任 11/11 決定），從 12 月開始。
  if (keepTask && !tasks.some(t => t.rules1111)) {
    put(keepTask.id, { rules1111: true }, true);
    const ym = today().slice(0, 7), nx = +ym.slice(5) === 12 ? (+ym.slice(0, 4) + 1) + '-01' : ym.slice(0, 5) + String(+ym.slice(5) + 1).padStart(2, '0');
    for (const i of [1, 2]) {
      const v = taskOf('voucher-' + i), id = 'pettycash-' + i, r = v && getRec(v.id, ym);
      if (!taskOf(id)) put(id, { ...VOUCHER, id, title: `零用金代墊清單（第 ${i} 次）`, order: 900 + i + .5, pickOf: 'voucher-' + i, from: (i === 1 && ym < '2026-12' ? '2026-12' : r && r.sentAt ? nx : ym) + '-01', note: '跟憑證一起交' });
    }
  }
  // 排班表：前一個月 20 號前由行政做好、主任發出，按「已發出」才結案；15 號起進快到期。
  if (keepTask && !tasks.some(t => t.rules1109)) {
    put(keepTask.id, { rules1109: true }, true);
    for (const t of tasks) if (t.monthTitle && t.title === '排班表') put(t.id, { dueBefore: 20, who: 'admin', needSend: true, sendLabel: '已發出', ...(t.note ? {} : { note: '行政做好，主任發出' }) }, true);
  }
  if (!n) return;
  upgrading = true;
  try { await b.commit(); } catch (e) { console.error(e); } finally { upgrading = false; }
}
const BUSY = '現在讀不到資料，可能是網路不穩，或今天的使用量已滿（大約下午 4 點恢復）。這不代表沒有事要做，請晚點再開，並告訴協助者。';
// 連不上資料庫時，會先收到一份空的暫存結果，不能當成「沒有事項」。
const real = s => !(s.metadata && s.metadata.fromCache && s.empty);
function subscribe() {
  const unread = m => { setStatus(m); if (!ready.tasks || !ready.records || !ready.quick) $('view').innerHTML = '<div class="empty">還沒讀到事項，不代表沒有事要做。</div>'; finishBoot('app'); };
  const fail = e => { console.error(e); unread(e.code === 'permission-denied' ? '資料讀取失敗，這個帳號可能沒有使用權限，請通知協助設定的人。' : BUSY); };
  const slow = setTimeout(() => unread(BUSY), 10000);
  const ok = k => { ready[k] = true; if (ready.tasks && ready.records && ready.quick) { clearTimeout(slow); setStatus(''); finishBoot('app'); upgradeData(); } render(); };
  const apply = (s, k) => { s.docChanges().forEach(c => c.type === 'removed' ? recs.delete(c.doc.id) : recs.set(c.doc.id, { ...c.doc.data(), id: c.doc.id })); ok(k); };
  unsub = [
    fb.onSnapshot(fb.collection(db, 'tasks'), s => { if (!real(s)) return; tasks = linkPicks(s.docs.map(d => ({ ...d.data(), id: d.id }))); ok('tasks'); }, fail),
    // 只做一次的事項 key 是 once，字母排在數字後面，所以不管做完多久都讀得到，不會變回逾期。
    fb.onSnapshot(fb.query(fb.collection(db, 'records'), fb.where('key', '>=', addDays(today(), -420).slice(0, 7))), s => { if (real(s)) apply(s, 'records'); }, fail),
    fb.onSnapshot(fb.query(fb.collection(db, 'quick'), fb.where('doneDate', '>=', addDays(today(), -40))), s => { if (real(s)) apply(s, 'quick'); }, fail),
    fb.onSnapshot(fb.doc(db, 'meta', 'reminder'), s => { meta = s.exists() ? s.data() : null; render(); }, () => {})
  ];
}
// 啟動進度條：登入狀態與資料都準備好才跑到 100%，再進入畫面。
let bootTimer = null, bootPct = 0, bootEnding = false, bootStart = 0;
function setBoot(p) { bootPct = p; if ($('bootBar')) { $('bootBar').style.width = p + '%'; $('bootPct').textContent = Math.round(p) + '%'; } }
function startBoot() {
  clearInterval(bootTimer); bootEnding = false; bootStart = Date.now(); setBoot(0); screen('boot');
  bootTimer = setInterval(() => setBoot(bootPct + (90 - bootPct) * .07), 80);
}
function finishBoot(id) {
  if (bootEnding) return; bootEnding = true;
  // 至少跑 0.8 秒，進度才看得出來。
  setTimeout(() => { clearInterval(bootTimer); setBoot(100); setTimeout(() => screen(id), 300); }, Math.max(0, 800 - (Date.now() - bootStart)));
}
function screen(id) { ['boot', 'login', 'app'].forEach(x => { if ($(x)) $(x).hidden = x !== id; }); }
function enter() {
  try { if (sessionStorage.getItem('updated')) { sessionStorage.removeItem('updated'); setTimeout(() => toast('更新完成'), 1300); } } catch (_) {}
  if (!localStorageHasWho() && (myName === '主任' || myName === '行政')) who = myName === '主任' ? 'director' : 'admin';
  view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
  subscribe(); render();
}
function localStorageHasWho() { try { return !!localStorage.getItem('who'); } catch (e) { return false; } }

let tickUntil = 0;
const TICKS = ['done', 'undoDone', 'review', 'undoReview', 'sent', 'undoSent'];
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.view) return setView(b.dataset.view, true);
  if (b.dataset.who) { who = b.dataset.who; try { localStorage.setItem('who', who); } catch (_) {} return render(); }
  const a = b.dataset.act; if (!a) return;
  if (a.startsWith('help')) {
    if (a === 'helpOpen') { helpTopic = b.dataset.id; helpStep = 0; }
    if (a === 'helpHome') helpTopic = '';
    if (a === 'helpNext') helpStep++;
    if (a === 'helpPrev') helpStep--;
    render(); return scrollTo(0, 0);
  }
  if (a.startsWith('cal')) {
    if (a === 'calDay') { calSel = b.dataset.id; render(); return CAL_SIDE.matches ? undefined : $('calDay').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (a === 'calToday') { calSel = today(); calMonth = calSel.slice(0, 7); }
    if (a === 'calPrev' || a === 'calNext') { const [y, m] = calMonth.split('-').map(Number), n = new Date(Date.UTC(y, m - 1 + (a === 'calNext' ? 1 : -1), 1)).toISOString().slice(0, 7); calMonth = n; }
    return render();
  }
  if (a === 'kpiPrev' || a === 'kpiNext') { kpiTerm = shiftTerm(kpiTerm, a === 'kpiNext' ? 1 : -1); return render(); }
  if (a === 'kpiNow') { kpiTerm = termKey(today()); return render(); }
  if (a === 'planNew') return openPlan();
  if (a === 'edit') { const t = taskOf(b.dataset.id); return t && t.planData ? openPlan(t) : openForm(t); }
  if (a === 'logout') return fb.signOut(auth);
  if (a === 'changePw') return openPw();
  if (a === 'import') return doImport();
  if (a === 'backup') return backup();
  // 打勾後清單會往上補，第二下會按到下一件。0.7 秒內的第二下不算。
  if (TICKS.includes(a)) { if (e.timeStamp < tickUntil) return; tickUntil = e.timeStamp + 700; }
  act(a, b.dataset.id, b.dataset.key);
});
document.addEventListener('change', async e => {
  if (e.target.matches('select[data-pick]')) {
    const { id, key } = e.target.dataset, d = e.target.value;
    try { await wr.setDoc(fb.doc(db, 'tasks', id), { picks: { [key]: d } }, { merge: true }); toast(d ? `截止日是 ${short(pickDeadline(d))}` : '已清除日期'); } catch (err) { console.error(err); toast('沒有存到，請再選一次。'); }
    return;
  }
  if (e.target.id !== 'impFile') return;
  try {
    importData = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(importData.tasks)) throw 0;
    $('impInfo').textContent = `檔案內有 ${importData.tasks.length} 件事項、${(importData.records || []).length} 筆紀錄。`;
    $('impBtn').hidden = false;
  } catch (_) { importData = null; $('impInfo').textContent = '這個檔案無法讀取。'; $('impBtn').hidden = true; }
});
$('pwCancel').onclick = () => $('pwDlg').close();
$('pwForm').addEventListener('submit', e => { e.preventDefault(); changePw(); });
$('add').onclick = () => openForm();
if ($('moreBtn')) {
  $('moreBtn').onclick = () => setMore(!$('tabs').classList.contains('open'));
  $('moreShade').onclick = () => { setMore(false); $('moreBtn').focus(); };
  addEventListener('keydown', e => { if (e.key === 'Escape' && $('tabs').classList.contains('open')) { setMore(false); $('moreBtn').focus(); } });
}
$('allSearch').addEventListener('input', applySearch);
if (/\bLine\//i.test(navigator.userAgent) && $('lineHint')) $('lineHint').hidden = false;
$('toPlan').onclick = () => { $('dlg').close(); openPlan(); };
$('planCancel').onclick = () => $('planDlg').close(); $('planDel').onclick = removePlan;
$('planForm').addEventListener('submit', e => { e.preventDefault(); savePlan(); });
$('cancel').onclick = () => $('dlg').close();
$('del').onclick = remove; $('fFreq').onchange = syncForm;
$('frm').addEventListener('submit', e => { e.preventDefault(); save(); });
$('mgrid').innerHTML = MZ.slice(1).map((z, i) => `<label><input type="checkbox" value="${i + 1}">${i + 1}月</label>`).join('');
addEventListener('hashchange', () => { const v = location.hash.slice(1) || 'today'; if (v !== view) setView(v); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && user && !$('app').hidden) render(); });
// 電腦常常整晚開著，過了午夜要自己換到新的一天。
setInterval(() => { if (user && !$('app').hidden && shownDay && shownDay !== today()) render(); }, 60000);

// 新版本提示：比對網站上的檔案，有變動就顯示提示。只由使用者自己按，編輯中不打擾。
const SITE_FILES = ['index.html', 'app.js', 'logic.js', 'help.js', 'style.css', 'vendor/firebase.js'];
let siteBase = null, siteNew = false, siteChecked = 0;
const readSite = async () => (await Promise.all(SITE_FILES.map(async f => { const r = await fetch(f, { cache: 'no-store' }); if (!r.ok) throw 0; return r.text(); }))).join('\n');
const showUpdate = () => { if (!$('updateBar')) return; $('updateBar').hidden = !siteNew || !!document.querySelector('dialog[open]'); };
async function checkSite(force) {
  if (siteNew || (!force && Date.now() - siteChecked < 60000)) return;
  siteChecked = Date.now();
  try { const t = await readSite(); if (siteBase === null) siteBase = t; else if (t !== siteBase) { siteNew = true; showUpdate(); } } catch (_) {}
}
const updateBar = $('updateBar');
if (updateBar && $('updDlg')) {
  updateBar.onclick = () => $('updDlg').showModal();
  $('updLater').onclick = () => $('updDlg').close();
  $('updForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await Promise.all(SITE_FILES.map(f => fetch(f, { cache: 'reload' }))); sessionStorage.setItem('updated', '1'); } catch (_) {}
    location.reload();
  });
}
document.querySelectorAll('dialog').forEach(d => d.addEventListener('close', showUpdate));
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSite(); });
setInterval(() => { if (!document.hidden) checkSite(true); }, 600000);
checkSite(true);

if (firebaseConfig.apiKey.startsWith('PASTE')) {
  document.body.innerHTML = '<div class="wrap"><h1>萬丹公托待辦</h1><div class="empty">系統還沒完成設定。</div></div>';
} else {
  startBoot();
  const app = fb.initializeApp(firebaseConfig);
  auth = fb.getAuth(app); db = fb.getFirestore(app);
  auth.languageCode = 'zh-TW';   // 重設密碼信與頁面用繁體中文
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('lMsg').textContent = '登入中…';
    try { await fb.signInWithEmailAndPassword(auth, $('lEmail').value.trim(), $('lPw').value); $('lMsg').textContent = ''; }
    catch (_) { $('lMsg').textContent = '電子郵件或密碼不正確。'; }
  });
  $('forgot').onclick = async () => {
    const m = $('lEmail').value.trim(); if (!m) { $('lMsg').textContent = '請先填電子郵件，再按一次。'; return; }
    try { await fb.sendPasswordResetEmail(auth, m); } catch (_) {}
    $('lMsg').textContent = '如果這個信箱有帳號，重設密碼信已寄出，也請看垃圾信件匣。';
  };
  fb.onAuthStateChanged(auth, async u => {
    unsub.forEach(f => f()); unsub = []; recs = new Map(); tasks = []; ready = { tasks: false, records: false, quick: false };
    user = u;
    if (!u) return finishBoot('login');
    startBoot();
    myName = await nameOf(u.email);
    enter();
  });
}
