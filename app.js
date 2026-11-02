import { firebaseConfig, APP_URL } from './firebase-config.js';
import * as fb from './vendor/firebase.js';
import { WHO, nextOcc, bucket, dow, diff, addDays, taipeiToday, collectionFor, recordId, stageOf } from './logic.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MZ = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'], WZ = '日一二三四五六';
const GROUPS = ['交辦', '每日', '每週', '每月', '每季', '每學期', '每年', '不定期'];
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

let db, auth, user, tasks = [], recs = new Map(), meta = null, ready = { tasks: false, records: false, quick: false };
let view = 'today', who = 'all', editing = null, delArmed = false, unsub = [], importData = null;
try { who = localStorage.getItem('who') || 'all'; } catch (e) {}

function toast(m) { const e = $('toast'); e.textContent = m; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 2600); }
function setStatus(m) { const e = $('status'); e.textContent = m || ''; e.hidden = !m; }
const show = t => who === 'all' || t.who === who;
const getRec = (id, key) => recs.get(recordId(id, key));
const taskOf = id => tasks.find(t => t.id === id);

function pills(t) { return `<span class="pill p-${t.who}">${WHO[t.who]}</span>${t.gov ? '<span class="pill p-gov">交縣府</span>' : ''}${t.verify ? '<span class="pill p-check">日期待確認</span>' : ''}`; }
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
  if (t.needSend) h += `<button class="tick" role="checkbox" aria-checked="${sent}" aria-label="已送出：${esc(t.title)}" data-act="${sent ? 'undoSent' : 'sent'}" ${a}><i>✓</i>已送出</button>`;
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
  const fin = [...recs.values()].filter(d => (d.doneDate === now || d.sentDate === now) && (who === 'all' || d.who === who)).filter(d => { const t = taskOf(d.taskId); return !t || stageOf(t, d) !== 'send'; })
    .map(d => { const t = taskOf(d.taskId) || { id: d.taskId, title: d.title, who: d.who }; return `<div class="row">${ticks(t, d.key)}<div class="main"><div class="title">${esc(d.title)}</div><div class="meta"><span class="pill p-${esc(d.who)}">${WHO[d.who] || ''}</span></div></div></div>`; });
  const open = b.over.length + b.today.length + b.week.length + b.soon.length + b.send.length;
  $('tally').innerHTML = `${b.over.length ? `<span class="bad">逾期 <b>${b.over.length}</b></span>` : ''}<span>今天 <b>${b.today.length}</b></span><span>本週 <b>${b.week.length}</b></span><span class="warn">快到期 <b>${b.soon.length}</b></span><span>待送出 <b>${b.send.length}</b></span>`;
  return (open ? '' : '<div class="empty">目前沒有要處理的事項。</div>') + section('已完成、待送出', '送出才算結案', r('send')) + section('已逾期', '', r('over'), 'bad') + section('今天要做', '', r('today')) + section('本週要做', '', r('week')) + section('快到期', '', r('soon')) + section('今天已處理', '再按一次可取消', fin);
}
function renderAll() {
  const now = today(); let h = '';
  for (const g of GROUPS) {
    const rows = tasks.filter(t => show(t) && t.group === g).sort((a, b) => (a.order || 0) - (b.order || 0)).map(t => {
      const o = nextOcc(t, now, getRec);
      const last = t.freq === 'adhoc' ? [...recs.values()].filter(d => d.taskId === t.id).sort((a, b) => b.doneDate.localeCompare(a.doneDate))[0] : null;
      const next = t.freq === 'adhoc' ? (last ? `上次 ${short(last.doneDate)}` : '') : o ? (t.freq === 'daily' || t.freq === 'weekly' ? '' : `下次 ${short(o.due)}`) : '本期已結案';
      return `<div class="row"><div class="main"><div class="title">${esc(t.title)}</div><div class="meta">${pills(t)}<span>${esc(ruleText(t))}</span>${t.needSend ? '<span>要送出</span>' : ''}${next ? `<span>${next}</span>` : ''}${t.note ? `<span>${esc(t.note)}</span>` : ''}</div></div>${t.freq === 'adhoc' ? `<button class="log" data-act="done" data-id="${esc(t.id)}" data-key="${now}">今天做了</button>` : ''}<button class="edit" data-act="edit" data-id="${esc(t.id)}">修改</button></div>`;
    });
    h += section(g, '', rows);
  }
  return h || '<div class="empty">還沒有事項。</div>';
}
function renderLog() {
  const list = [...recs.values()].filter(d => who === 'all' || d.who === who);
  if (!list.length) return '<div class="empty">打勾的事項會記在這裡，方便日後查證。</div>';
  const by = {}; list.forEach(d => (by[d.doneDate || d.sentDate] ||= []).push(d));
  return Object.keys(by).sort().reverse().slice(0, 60).map(k => section(rocDate(k), '', by[k].map(d => {
    const t = taskOf(d.taskId) || { id: d.taskId, title: d.title, who: d.who };
    return `<div class="row">${ticks(t, d.key)}<div class="main"><div class="title">${esc(d.title)}</div><div class="meta"><span class="pill p-${esc(d.who)}">${WHO[d.who] || ''}</span>${d.doneAt ? `<span>${esc(d.doneBy)} 完成</span>` : ''}${d.sentAt ? `<span>${esc(d.sentBy)} ${short(d.sentDate)} 送出</span>` : ''}</div></div></div>`;
  }))).join('');
}
function renderSet() {
  const m = meta ? `${esc(meta.date)}：${esc(meta.sent)}` : '還沒有紀錄';
  return `<section><h2>帳號</h2><div class="card"><div>${esc(user.email)}（${esc(user.displayName || '')}）</div><div class="actions start"><button class="btn" data-act="logout">登出</button></div></div></section>
  <section><h2>LINE 每日提醒</h2><div class="card"><div>上次檢查：${m}</div></div></section>
  <section><h2>加到桌面與主畫面</h2><div class="card"><div>iPhone：用 Safari 開啟這一頁，點「分享」，再點「加入主畫面」。</div><div>電腦：用 Chrome 或 Edge 開啟，點網址列右側的「安裝」圖示。</div></div></section>
  <section><h2>資料</h2><div class="card"><div>目前有 ${tasks.length} 件事項。匯入只會新增還沒有的資料，不會覆蓋已存在的事項與打勾紀錄。</div><label>選擇匯入檔<input type="file" id="impFile" accept=".json,application/json"></label><div id="impInfo"></div><div class="actions start"><button class="btn primary" data-act="import" id="impBtn" hidden>確認匯入</button><button class="btn" data-act="backup">下載備份</button></div></div></section>`;
}
function render() {
  $('date').textContent = rocDate(today());
  document.querySelectorAll('.tab').forEach(b => b.dataset.view === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  document.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.who === who));
  document.querySelector('.people').hidden = view === 'set';
  if (!ready.tasks || !ready.records || !ready.quick) return;
  const a = renderToday();
  if (view === 'set' && $('impFile')) return;   // 設定頁正在選檔時不重畫
  $('view').innerHTML = view === 'today' ? a : view === 'all' ? renderAll() : view === 'log' ? renderLog() : renderSet();
  staleWarning();
}
function staleWarning() {
  if (!meta) return;
  let d = today(), n = 0;
  while (d > meta.date && n < 4) { const w = dow(d); if (w > 0 && w < 6) n++; d = addDays(d, -1); }
  if (n >= 3) setStatus(`LINE 每日提醒已有幾個上班日沒有執行（最後一次 ${meta.date}），請通知協助設定的人檢查。`);
}
function setView(v, push) { view = ['today', 'all', 'log', 'set'].includes(v) ? v : 'today'; if ($('view').querySelector('#impFile')) $('view').innerHTML = ''; if (push) location.hash = view; render(); }

const refOf = (t, key) => fb.doc(db, collectionFor(t), recordId(t.id, key));
const stamp = () => ({ by: user.displayName || user.email, at: new Date().toISOString(), date: today() });
async function act(a, id, key) {
  const t = taskOf(id); if (!t) return toast('這件事項已被刪除，無法更改。');
  const ref = refOf(t, key), s = stamp(), r = getRec(id, key);
  const base = { taskId: id, key, title: t.title, who: t.who };
  try {
    if (a === 'done') { await fb.setDoc(ref, { ...base, doneAt: s.at, doneBy: s.by, doneDate: s.date }, { merge: true }); toast(t.needSend ? '已完成，記得送出：' + t.title : '已完成：' + t.title); }
    if (a === 'sent') { await fb.setDoc(ref, { ...base, ...(r && r.doneAt ? {} : { doneAt: s.at, doneBy: s.by, doneDate: s.date }), sentAt: s.at, sentBy: s.by, sentDate: s.date }, { merge: true }); toast('已送出，結案：' + t.title); }
    if (a === 'undoSent') { await fb.updateDoc(ref, { sentAt: fb.deleteField(), sentBy: fb.deleteField(), sentDate: fb.deleteField() }); toast('已取消送出'); }
    if (a === 'undoDone') { await fb.deleteDoc(ref); toast('已取消完成'); }
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
  $('dlgTitle').textContent = t ? '修改事項' : '新增事項';
  $('fTitle').value = t ? t.title : ''; $('fWho').value = t ? t.who : (who === 'director' ? 'director' : 'admin');
  $('fFreq').value = t ? t.freq : 'once'; $('fDate').value = t && t.date || today();
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
  const data = { who: $('fWho').value, group, freq, title, months: freq === 'monthly' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : freq === 'months' ? months : [],
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

function subscribe() {
  const fail = e => { console.error(e); setStatus('資料讀取失敗。若持續發生，可能是這個帳號沒有使用權限，請通知協助設定的人。'); };
  const slow = setTimeout(() => setStatus('資料還沒載入，請確認網路。'), 10000);
  const ok = k => { ready[k] = true; if (ready.tasks && ready.records && ready.quick) { clearTimeout(slow); setStatus(''); } render(); };
  const apply = (s, k) => { s.docChanges().forEach(c => c.type === 'removed' ? recs.delete(c.doc.id) : recs.set(c.doc.id, { ...c.doc.data(), id: c.doc.id })); ok(k); };
  unsub = [
    fb.onSnapshot(fb.collection(db, 'tasks'), s => { tasks = s.docs.map(d => ({ ...d.data(), id: d.id })); ok('tasks'); }, fail),
    fb.onSnapshot(fb.query(fb.collection(db, 'records'), fb.where('doneDate', '>=', addDays(today(), -400))), s => apply(s, 'records'), fail),
    fb.onSnapshot(fb.query(fb.collection(db, 'quick'), fb.where('doneDate', '>=', addDays(today(), -40))), s => apply(s, 'quick'), fail),
    fb.onSnapshot(fb.doc(db, 'meta', 'reminder'), s => { meta = s.exists() ? s.data() : null; render(); }, () => {})
  ];
}
function screen(id) { ['login', 'pick', 'app'].forEach(x => $(x).hidden = x !== id); }
function enter() {
  screen('app');
  if (!localStorageHasWho() && (user.displayName === '主任' || user.displayName === '行政')) who = user.displayName === '主任' ? 'director' : 'admin';
  view = ['today', 'all', 'log', 'set'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
  subscribe(); render();
}
function localStorageHasWho() { try { return !!localStorage.getItem('who'); } catch (e) { return false; } }

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.view) return setView(b.dataset.view, true);
  if (b.dataset.who) { who = b.dataset.who; try { localStorage.setItem('who', who); } catch (_) {} return render(); }
  if (b.dataset.name) return fb.updateProfile(user, { displayName: b.dataset.name }).then(enter).catch(() => toast('沒有存到，請再按一次。'));
  const a = b.dataset.act; if (!a) return;
  if (a === 'edit') return openForm(taskOf(b.dataset.id));
  if (a === 'logout') return fb.signOut(auth);
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
$('add').onclick = () => openForm();
$('cancel').onclick = () => $('dlg').close();
$('del').onclick = remove; $('fFreq').onchange = syncForm;
$('frm').addEventListener('submit', e => { e.preventDefault(); save(); });
$('mgrid').innerHTML = MZ.slice(1).map((z, i) => `<label><input type="checkbox" value="${i + 1}">${i + 1}月</label>`).join('');
addEventListener('hashchange', () => { const v = location.hash.slice(1) || 'today'; if (v !== view) setView(v); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && user && !$('app').hidden) render(); });

if (firebaseConfig.apiKey.startsWith('PASTE')) {
  document.body.innerHTML = '<div class="wrap"><h1>托嬰中心待辦</h1><div class="empty">系統還沒完成設定。</div></div>';
} else {
  const app = fb.initializeApp(firebaseConfig);
  auth = fb.getAuth(app); db = fb.getFirestore(app);
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('lMsg').textContent = '登入中…';
    try { await fb.signInWithEmailAndPassword(auth, $('lEmail').value.trim(), $('lPw').value); $('lMsg').textContent = ''; }
    catch (_) { $('lMsg').textContent = '電子郵件或密碼不正確。'; }
  });
  $('forgot').onclick = async () => {
    const m = $('lEmail').value.trim(); if (!m) { $('lMsg').textContent = '請先填電子郵件。'; return; }
    try { await fb.sendPasswordResetEmail(auth, m); } catch (_) {}
    $('lMsg').textContent = '如果這個信箱有帳號，重設密碼信已寄出，也請看垃圾信件匣。';
  };
  fb.onAuthStateChanged(auth, u => {
    unsub.forEach(f => f()); unsub = []; recs = new Map(); tasks = []; ready = { tasks: false, records: false, quick: false };
    user = u;
    if (!u) return screen('login');
    if (!u.displayName) return screen('pick');
    enter();
  });
}
