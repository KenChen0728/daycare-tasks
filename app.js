import { firebaseConfig, APP_URL } from './firebase-config.js';
import * as fb from './vendor/firebase.js';
import { WHO, nextOcc, bucket, dow, diff, addDays, taipeiToday, collectionFor, recordId, stageOf, monthOccs, sendLabel, pendingLabel, eitherLabel, followUpTasks, followUpIds, termOf, termKey, shiftTerm, keyEnd } from './logic.js';
import { renderHelp } from './help.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MZ = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'], WZ = '日一二三四五六';
const GROUPS = ['交辦', '每日', '每週', '每月', '每季', '每半年', '每學期', '每年', '不定期'];
const GMAP = { once: '交辦', daily: '每日', weekly: '每週', monthly: '每月', adhoc: '不定期' };
const rocDate = s => { const [y, m, d] = s.split('-').map(Number); return `民國 ${y - 1911} 年 ${m} 月 ${d} 日（${WZ[dow(s)]}）`; };
const short = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
const today = () => taipeiToday();
function ruleText(t) {
  if (t.freq === 'daily') return '每個上班日';
  if (t.freq === 'weekly') return '每週' + WZ[t.weekday || 5] + '前';
  if (t.freq === 'adhoc') return '有需要時';
  if (t.freq === 'once') return '只做一次';
  const end = (t.day || 31) >= 31 ? '月底' : t.day + ' 號';
  const roll = t.rollover ? '，遇假日順延' : '';
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
const CAL_BARS = 3;   // 日曆每格最多顯示幾件，其餘寫「還有 N 件」
let helpTopic = '', helpStep = 0, calMonth = '', calSel = '', kpiTerm = '';
let view = 'today', who = 'all', editing = null, delArmed = false, unsub = [], importData = null;
try { who = localStorage.getItem('who') || 'all'; } catch (e) {}

function toast(m) { const e = $('toast'); e.textContent = m; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 2600); }
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
  if (d === 0) return '<span class="when-bad">今天到期</span>';
  if (d <= 7) return `<span class="when-warn">剩 ${d} 天（${short(o.due)}）</span>`;
  return `<span>${short(o.due)} 到期，剩 ${d} 天</span>`;
}
function ticks(t, key) {
  const r = getRec(t.id, key), a = `data-id="${esc(t.id)}" data-key="${esc(key)}"`;
  const done = !!(r && r.doneAt), sent = !!(r && r.sentAt);
  let h = `<button class="tick" role="checkbox" aria-checked="${done}" aria-label="完成：${esc(t.title)}" data-act="${done ? 'undoDone' : 'done'}" ${a} ${sent ? 'disabled' : ''}><i>✓</i>完成</button>`;
  if (t.needSend) h += `<button class="tick" role="checkbox" aria-checked="${sent}" aria-label="${sendLabel(t)}：${esc(t.title)}" data-act="${sent ? 'undoSent' : 'sent'}" ${a}><i>✓</i>${sendLabel(t)}</button>`;
  return `<div class="ticks">${h}</div>`;
}
const row = (t, o, b, now) => `<div class="row${b === 'over' ? ' over' : ''}">${ticks(t, o.key)}<div class="main"><div class="title">${esc(t.title)}</div><div class="meta">${pills(t)}${whenText(t, o, b, now)}${t.note ? `<span>${esc(t.note)}</span>` : ''}</div></div></div>`;
const section = (title, sub, rows, cls) => rows.length ? `<section><h2 class="${cls || ''}">${title}<small>${sub || rows.length + ' 件'}</small></h2><div class="list">${rows.join('')}</div></section>` : '';

function renderToday() {
  const now = today(), b = { over: [], today: [], week: [], soon: [], send: [] };
  for (const t of tasks.filter(show)) {
    const o = nextOcc(t, now, getRec); if (!o) continue;
    const k = bucket(t, o, now);
    if (o.stage === 'send') b.send.push({ t, o, k });
    else if (b[k]) b[k].push({ t, o, k });
  }
  for (const k in b) b[k].sort((x, y) => x.o.due.localeCompare(y.o.due) || (+!!y.t.gov - +!!x.t.gov) || (x.t.order || 0) - (y.t.order || 0));
  const r = k => b[k].map(x => row(x.t, x.o, x.k, now));
  const fin = [...recs.values()].filter(d => (d.doneDate === now || d.sentDate === now) && showRec(d)).filter(d => { const t = taskOf(d.taskId); return !t || stageOf(t, d) !== 'send'; })
    .map(d => { const t = taskOf(d.taskId) || { id: d.taskId, title: d.title, who: d.who }; return `<div class="row">${ticks(t, d.key)}<div class="main"><div class="title">${esc(d.title)}</div><div class="meta"><span class="pill p-${esc(d.who)}">${WHO[d.who] || ''}</span></div></div></div>`; });
  const open = b.over.length + b.today.length + b.week.length + b.soon.length + b.send.length;
  $('tally').innerHTML = `${b.over.length ? `<span class="bad">逾期 <b>${b.over.length}</b></span>` : ''}<span>今天 <b>${b.today.length}</b></span><span>本週 <b>${b.week.length}</b></span><span class="warn">快到期 <b>${b.soon.length}</b></span><span>待送出 <b>${b.send.length}</b></span>`;
  return (open ? '' : '<div class="empty">目前沒有要處理的事項。</div>') + section('已完成、還沒結案', '送出或印出才算結案', r('send')) + section('已逾期', '', r('over'), 'bad') + section('今天要做', '', r('today')) + section('本週要做', '', r('week')) + section('快到期', '', r('soon')) + section('今天已處理', '再按一次可取消', fin);
}
function renderAll() {
  const now = today(); let h = '';
  for (const g of GROUPS) {
    const rows = tasks.filter(t => show(t) && t.group === g).sort((a, b) => (a.order || 0) - (b.order || 0)).map(t => {
      const o = nextOcc(t, now, getRec);
      const last = t.freq === 'adhoc' ? [...recs.values()].filter(d => d.taskId === t.id).sort((a, b) => b.doneDate.localeCompare(a.doneDate))[0] : null;
      const next = t.freq === 'adhoc' ? (last ? `上次 ${short(last.doneDate)}` : '') : o ? (t.freq === 'daily' || t.freq === 'weekly' ? '' : `下次 ${short(o.due)}`) : '本期已結案';
      return `<div class="row"><div class="main"><div class="title">${esc(t.title)}</div><div class="meta">${pills(t)}<span>${esc(ruleText(t))}</span>${t.needSend ? '<span>要${esc(sendLabel(t).slice(1))}</span>' : ''}${next ? `<span>${next}</span>` : ''}${t.note ? `<span>${esc(t.note)}</span>` : ''}</div></div>${t.freq === 'adhoc' ? `<button class="log" data-act="done" data-id="${esc(t.id)}" data-key="${now}">今天做了</button>` : ''}<button class="edit" data-act="edit" data-id="${esc(t.id)}">修改</button></div>`;
    });
    h += section(g, '', rows);
  }
  return h || '<div class="empty">還沒有事項。</div>';
}
function renderLog() {
  const list = [...recs.values()].filter(showRec);
  if (!list.length) return '<div class="empty">打勾的事項會記在這裡，方便日後查證。</div>';
  const by = {}; list.forEach(d => (by[d.doneDate || d.sentDate] ||= []).push(d));
  return Object.keys(by).sort().reverse().slice(0, 60).map(k => section(rocDate(k), '', by[k].map(d => {
    const t = taskOf(d.taskId) || { id: d.taskId, title: d.title, who: d.who };
    return `<div class="row">${ticks(t, d.key)}<div class="main"><div class="title">${esc(d.title)}</div><div class="meta"><span class="pill p-${esc(d.who)}">${WHO[d.who] || ''}</span>${d.doneAt ? `<span>${esc(d.doneBy)} 完成</span>` : ''}${d.sentAt ? `<span>${esc(d.sentBy)} ${short(d.sentDate)} ${esc(sendLabel(t).slice(1))}</span>` : ''}</div></div></div>`;
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
    const bars = l.slice(0, CAL_BARS).map(x => `<span class="ev ${x.state === 'open' ? 'e-' + (x.t.either ? 'either' : x.t.who) : 'e-' + x.state}">${esc(x.t.title)}</span>`).join('') + (l.length > CAL_BARS ? `<span class="evmore">還有 ${l.length - CAL_BARS} 件</span>` : '');
    const label = `${m} 月 ${d} 日，${l.length ? `${l.length} 件${over ? '，有逾期' : ''}` : '沒有事項'}`;
    cells += `<button class="cday${ds === now ? ' today' : ''}${w === 0 ? ' sun' : w === 6 ? ' sat' : ''}" data-act="calDay" data-id="${ds}" aria-label="${label}" aria-pressed="${ds === calSel}"><span class="dnum">${d}</span>${bars}</button>`;
  }
  const sel = calSel.slice(0, 7) === calMonth ? calSel : '', list = (by[sel] || []).sort((a, b) => (+!!b.t.gov - +!!a.t.gov) || (a.t.order || 0) - (b.t.order || 0));
  const rows = list.map(({ t, o, state }) => `<div class="row${state === 'over' ? ' over' : ''}">${ticks(t, o.key)}<div class="main"><div class="title">${esc(t.title)}</div><div class="meta">${pills(t)}${state === 'over' ? `<span class="when-bad">已逾期 ${diff(now, o.due)} 天</span>` : ''}${o.stage === 'send' && !o.closed ? `<span class="when-warn">${pendingLabel(t)}</span>` : ''}${t.note ? `<span>${esc(t.note)}</span>` : ''}</div></div></div>`);
  const head = `<div class="calhead"><button class="btn" data-act="calPrev" aria-label="上個月">‹</button><h2>民國 ${y - 1911} 年 ${m} 月</h2><button class="btn" data-act="calNext" aria-label="下個月">›</button><button class="btn" data-act="calToday">回到今天</button></div>`;
  const grid = `<div class="calendar"><div class="cweek" aria-hidden="true">${[...WZ].map(z => `<span>${z}</span>`).join('')}</div><div class="cgrid">${cells}</div></div>`;
  const legend = '<div class="meta legend"><span><i class="dot e-director"></i>主任</span><span><i class="dot e-admin"></i>行政</span><span><i class="dot e-either"></i>皆可</span><span><i class="dot e-over"></i>逾期</span><span><i class="dot e-done"></i>已結案</span></div>';
  const day = !sel ? '<div class="empty">點日期可以看當天的事項。</div>' : rows.length ? section(rocDate(sel), '', rows) : `<div class="empty">${rocDate(sel)}沒有到期的事項。</div>`;
  return head + grid + legend + `<div id="calDay">${day}</div>`;
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
  return head + (term.length || year.length ? a + h + b : '<div class="empty">KPI 事項設定中，請稍後再開一次。</div>');
}
function renderSet() {
  const m = meta ? `${esc(meta.date)}：${esc(meta.sent)}` : '還沒有紀錄';
  return `<section><h2>帳號</h2><div class="card"><div>${esc(user.email)}（${esc(myName)}）</div><div class="actions start"><button class="btn" data-act="changePw">修改密碼</button><button class="btn logout" data-act="logout">登出</button></div></div></section>
  <section><h2>LINE 每日提醒</h2><div class="card"><div>上次檢查：${m}</div></div></section>
  <section><h2>加到桌面與主畫面</h2><div class="card"><div>iPhone：用 Safari 開啟這一頁，點「分享」，再點「加入主畫面」。</div><div>電腦：用 Chrome 或 Edge 開啟，點網址列右側的「安裝」圖示。</div></div></section>
  <section><h2>資料</h2><div class="card"><div>目前有 ${tasks.length} 件事項。匯入只會新增還沒有的資料，不會覆蓋已存在的事項與打勾紀錄。</div><label>選擇匯入檔<input type="file" id="impFile" accept=".json,application/json"></label><div id="impInfo"></div><div class="actions start"><button class="btn primary" data-act="import" id="impBtn" hidden>確認匯入</button><button class="btn" data-act="backup">下載備份</button></div></div></section>`;
}
function render() {
  $('date').textContent = rocDate(today());
  document.querySelectorAll('.tab').forEach(b => b.dataset.view === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  document.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.who === who));
  document.querySelector('.people').hidden = view === 'set' || view === 'help' || view === 'kpi';
  $('add').hidden = view === 'help';
  if (!ready.tasks || !ready.records || !ready.quick) return;
  const a = renderToday();
  if (view === 'set' && $('impFile')) return;   // 設定頁正在選檔時不重畫
  $('view').innerHTML = view === 'today' ? a : view === 'all' ? renderAll() : view === 'cal' ? renderCal() : view === 'kpi' ? renderKpi() : view === 'log' ? renderLog() : view === 'help' ? renderHelp(helpTopic, helpStep) : renderSet();
  staleWarning();
}
function staleWarning() {
  if (!meta) return;
  let d = today(), n = 0;
  while (d > meta.date && n < 4) { const w = dow(d); if (w > 0 && w < 6) n++; d = addDays(d, -1); }
  if (n >= 3) setStatus(`LINE 每日提醒已有幾個上班日沒有執行（最後一次 ${meta.date}），請通知協助設定的人檢查。`);
}
function setView(v, push) { view = VIEWS.includes(v) ? v : 'today'; if (view === 'help') { helpTopic = ''; helpStep = 0; } if ($('view').querySelector('#impFile')) $('view').innerHTML = ''; if (push) location.hash = view; render(); }

// 第一次完成時新增後續事項；已經有了就不動，以免蓋掉修改過的期限。
async function addFollowUp(t, key, r, s) {
  if (r && r.doneAt) return '';
  const list = followUpTasks(t, key, s.date).filter(f => !taskOf(f.id)); if (!list.length) return '';
  const b = fb.writeBatch(db); list.forEach(f => b.set(fb.doc(db, 'tasks', f.id), f)); await b.commit();
  return list.map(f => `「${f.title}」`).join('、') + `，${short(list[0].date)} 前完成`;
}
// 取消完成時，後續事項還沒動過才一起移除。
async function dropFollowUp(t, key) {
  const ids = followUpIds(t, key).filter(id => taskOf(id) && !getRec(id, 'once'));
  await Promise.all(ids.map(id => fb.deleteDoc(fb.doc(db, 'tasks', id)))); return ids.length > 0;
}
const refOf = (t, key) => fb.doc(db, collectionFor(t), recordId(t.id, key));
const stamp = () => ({ by: myName, at: new Date().toISOString(), date: today() });
async function act(a, id, key) {
  const t = taskOf(id); if (!t) return toast('這件事項已被刪除，無法更改。');
  const ref = refOf(t, key), s = stamp(), r = getRec(id, key);
  const base = { taskId: id, key, title: t.title, who: t.who };
  try {
    if (a === 'done') { await fb.setDoc(ref, { ...base, doneAt: s.at, doneBy: s.by, doneDate: s.date }, { merge: true }); const fu = await addFollowUp(t, key, r, s); toast(fu ? `已完成，已新增${fu}` : t.needSend ? `已完成，記得${sendLabel(t).slice(1)}：` + t.title : '已完成：' + t.title); }
    if (a === 'sent') { await fb.setDoc(ref, { ...base, ...(r && r.doneAt ? {} : { doneAt: s.at, doneBy: s.by, doneDate: s.date }), sentAt: s.at, sentBy: s.by, sentDate: s.date }, { merge: true }); const fu = await addFollowUp(t, key, r, s); toast(fu ? `${sendLabel(t)}，已新增${fu}` : `${sendLabel(t)}，結案：` + t.title); }
    if (a === 'undoSent') { await fb.updateDoc(ref, { sentAt: fb.deleteField(), sentBy: fb.deleteField(), sentDate: fb.deleteField() }); toast('已取消' + sendLabel(t).slice(1)); }
    if (a === 'undoDone') { await fb.deleteDoc(ref); toast(await dropFollowUp(t, key) ? '已取消完成，自動新增的事項也移除了' : '已取消完成'); }
  } catch (e) { console.error(e); toast('沒有存到，請再按一次。'); }
}

function syncForm() {
  const f = $('fFreq').value;
  $('wDate').hidden = f !== 'once'; $('wMonths').hidden = f !== 'months'; $('wWeek').hidden = f !== 'weekly';
  $('wDay').hidden = $('wRoll').hidden = !(f === 'months' || f === 'monthly'); $('fDate').required = f === 'once';
  $('wSend').hidden = f === 'daily' || f === 'adhoc';
}
function openForm(t) {
  editing = t || null; delArmed = false; $('del').textContent = '刪除'; $('del').hidden = !t;
  $('dlgTitle').textContent = t ? '修改事項' : '新增事項'; $('wSendText').textContent = `要${sendLabel(t || {}).slice(1)}，${sendLabel(t || {}).slice(1)}才算結案`;
  $('fTitle').value = t ? t.title : ''; $('fWho').value = t ? t.who : (who === 'director' ? 'director' : 'admin');
  $('fFreq').value = t ? t.freq : 'once'; $('fDate').value = t && t.date || (view === 'cal' && calSel) || today();
  $('fDay').value = t ? (t.day || 31) : 31; $('fLead').value = t ? (t.lead || 0) : 7; $('fWeekday').value = String(t && t.weekday || 5);
  $('fNote').value = t ? t.note || '' : ''; $('fGov').checked = !!(t && t.gov); $('fVerify').checked = !!(t && t.verify); $('fSend').checked = !!(t && t.needSend); $('fRoll').checked = !!(t && t.rollover);
  $('wVerify').hidden = !(t && t.verify);
  document.querySelectorAll('#mgrid input').forEach(c => c.checked = !!(t && (t.months || []).includes(+c.value)));
  syncForm(); $('dlg').showModal();
}
async function save() {
  const freq = $('fFreq').value, months = [...document.querySelectorAll('#mgrid input:checked')].map(c => +c.value);
  if (freq === 'months' && !months.length) return toast('請至少選一個月份。');
  const old = editing, title = $('fTitle').value.trim(); if (!title) return;
  const group = freq === 'months' ? (old && old.freq === 'months' ? old.group : (months.length === 1 ? '每年' : '每季')) : GMAP[freq];
  const keep = Object.fromEntries(['kpi', 'followUp', 'followUps', 'either', 'sendLabel'].filter(k => old && old[k] !== undefined).map(k => [k, old[k]]));
  const data = { ...keep, who: $('fWho').value, group, freq, title, months: freq === 'monthly' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : freq === 'months' ? months : [],
    day: +$('fDay').value || 31, lead: +$('fLead').value || 0, gov: $('fGov').checked, verify: $('fVerify').checked, note: $('fNote').value.trim(),
    needSend: freq !== 'daily' && freq !== 'adhoc' && $('fSend').checked, rollover: (freq === 'monthly' || freq === 'months') && $('fRoll').checked, from: old ? old.from : today(), order: old ? old.order : Date.now() };
  if (freq === 'once') data.date = $('fDate').value;
  if (freq === 'weekly') data.weekday = +$('fWeekday').value;
  const ref = old ? fb.doc(db, 'tasks', old.id) : fb.doc(fb.collection(db, 'tasks'));
  try { await fb.setDoc(ref, { ...data, id: ref.id }); $('dlg').close(); toast('已儲存'); } catch (e) { console.error(e); toast('沒有存到，請再按一次。'); }
}
async function remove() {
  if (!delArmed) { delArmed = true; $('del').textContent = '確定刪除？'; return; }
  try { await fb.deleteDoc(fb.doc(db, 'tasks', editing.id)); $('dlg').close(); toast('已刪除'); } catch (e) { toast('沒有刪除成功，請再試一次。'); }
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
  const have = new Set(tasks.map(t => t.id));
  const newT = T.filter(t => !have.has(t.id)), byId = new Map([...tasks, ...T].map(t => [t.id, t]));
  const newR = R.filter(r => !recs.has(r.id) && byId.has(r.taskId));
  const ops = [...newT.map(t => [fb.doc(db, 'tasks', t.id), t]), ...newR.map(r => { const { id, ...d } = r; return [fb.doc(db, collectionFor(byId.get(r.taskId)), id), d]; })];
  try {
    for (let i = 0; i < ops.length; i += 400) { const b = fb.writeBatch(db); ops.slice(i, i + 400).forEach(([ref, d]) => b.set(ref, d)); await b.commit(); }
    toast(`已匯入 ${newT.length} 件事項、${newR.length} 筆紀錄`); importData = null; $('view').innerHTML = ''; render();
  } catch (e) { console.error(e); toast('匯入失敗，資料沒有全部寫入，請再試一次。'); }
}
async function backup() {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), tasks, records: [...recs.values()] }, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `托嬰中心待辦備份-${today()}.json`; a.click(); URL.revokeObjectURL(url);
}

// 資料更新：每項只做一次，已更新過的不再動，之後刪改 KPI 不會被加回來。
const KPI = { group: '每學期', freq: 'months', months: [1, 7], day: 31, lead: 60, from: '2026-08-01' };
const SHARED = { who: 'director', either: true, lead: 31 };
const after = (name, sat) => [{ ...SHARED, title: sat }, { ...SHARED, title: name + '成果報告書', needSend: true, sendLabel: '已印出' }];
const AFTER = { 'kpi-meeting': after('親師座談會', '親師座談會活動滿意度調查'), 'kpi-family': after('親子活動', '親子活動滿意度調查') };
const NEW_KPI = [['kpi-meeting', '親師座談會', 'term', 1], ['kpi-family', '親子活動', 'term', 2], ['kpi-parenting', '親職講座', 'term', 3], ['kpi-community', '社區宣導', 'year', 5]];
const HALF = { kpi: 'half', group: '每半年', months: [6, 12], day: 31, lead: 60, from: '2026-08-01', order: 4, followUps: [{ ...SHARED, title: '滿意度成果報告書' }] };
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
  if (!n) return;
  upgrading = true;
  try { await b.commit(); } catch (e) { console.error(e); } finally { upgrading = false; }
}
function subscribe() {
  const fail = e => { console.error(e); setStatus('資料讀取失敗。若持續發生，可能是這個帳號沒有使用權限，請通知協助設定的人。'); finishBoot('app'); };
  const slow = setTimeout(() => { setStatus('資料還沒載入，請確認網路。'); finishBoot('app'); }, 10000);
  const ok = k => { ready[k] = true; if (ready.tasks && ready.records && ready.quick) { clearTimeout(slow); setStatus(''); finishBoot('app'); upgradeData(); } render(); };
  const apply = (s, k) => { s.docChanges().forEach(c => c.type === 'removed' ? recs.delete(c.doc.id) : recs.set(c.doc.id, { ...c.doc.data(), id: c.doc.id })); ok(k); };
  unsub = [
    fb.onSnapshot(fb.collection(db, 'tasks'), s => { tasks = s.docs.map(d => ({ ...d.data(), id: d.id })); ok('tasks'); }, fail),
    fb.onSnapshot(fb.query(fb.collection(db, 'records'), fb.where('doneDate', '>=', addDays(today(), -400))), s => apply(s, 'records'), fail),
    fb.onSnapshot(fb.query(fb.collection(db, 'quick'), fb.where('doneDate', '>=', addDays(today(), -40))), s => apply(s, 'quick'), fail),
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
    if (a === 'calDay') { calSel = b.dataset.id; render(); return $('calDay').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (a === 'calToday') { calSel = today(); calMonth = calSel.slice(0, 7); }
    if (a === 'calPrev' || a === 'calNext') { const [y, m] = calMonth.split('-').map(Number), n = new Date(Date.UTC(y, m - 1 + (a === 'calNext' ? 1 : -1), 1)).toISOString().slice(0, 7); calMonth = n; }
    return render();
  }
  if (a === 'kpiPrev' || a === 'kpiNext') { kpiTerm = shiftTerm(kpiTerm, a === 'kpiNext' ? 1 : -1); return render(); }
  if (a === 'kpiNow') { kpiTerm = termKey(today()); return render(); }
  if (a === 'edit') return openForm(taskOf(b.dataset.id));
  if (a === 'logout') return fb.signOut(auth);
  if (a === 'changePw') return openPw();
  if (a === 'import') return doImport();
  if (a === 'backup') return backup();
  act(a, b.dataset.id, b.dataset.key);
});
document.addEventListener('change', async e => {
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
$('cancel').onclick = () => $('dlg').close();
$('del').onclick = remove; $('fFreq').onchange = syncForm;
$('frm').addEventListener('submit', e => { e.preventDefault(); save(); });
$('mgrid').innerHTML = MZ.slice(1).map((z, i) => `<label><input type="checkbox" value="${i + 1}">${i + 1}月</label>`).join('');
addEventListener('hashchange', () => { const v = location.hash.slice(1) || 'today'; if (v !== view) setView(v); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && user && !$('app').hidden) render(); });

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
  document.body.innerHTML = '<div class="wrap"><h1>托嬰中心待辦</h1><div class="empty">系統還沒完成設定。</div></div>';
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
