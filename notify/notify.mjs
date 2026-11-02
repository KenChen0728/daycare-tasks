// 每個上班日由 GitHub Actions 執行：讀取事項、算到期、發 LINE。
import { firebaseConfig as cfg, APP_URL } from '../firebase-config.js';
import { buildReminder, formatReminder, shouldSend, splitText, recordId, collectionFor, taipeiToday, addDays } from '../logic.js';

const { BOT_EMAIL, BOT_PASSWORD, LINE_TOKEN, MODE = 'daily', SLOT = 'late' } = process.env;
if (!BOT_EMAIL || !BOT_PASSWORD || !LINE_TOKEN) throw new Error('缺少 GitHub Secrets 設定');
const base = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;

async function http(url, opt, what) {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(`${what}失敗：HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
const dec = v => {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  return null;
};
const decFields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, dec(v)]));
const enc = v => typeof v === 'number' ? { integerValue: String(v) } : Array.isArray(v)
  ? { arrayValue: { values: v.map(enc) } } : { stringValue: String(v) };

const login = await http(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.apiKey}`,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: BOT_EMAIL, password: BOT_PASSWORD, returnSecureToken: true }) }, '提醒帳號登入');
const auth = { authorization: 'Bearer ' + login.idToken };

async function list(name) {
  const out = []; let page = '';
  do {
    const j = await http(`${base}/${name}?pageSize=300${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, { headers: auth }, `讀取${name}`);
    for (const d of j.documents || []) out.push({ ...decFields(d.fields || {}), id: d.name.split('/').pop() });
    page = j.nextPageToken || '';
  } while (page);
  return out;
}
async function getMeta() {
  const r = await fetch(`${base}/meta/reminder`, { headers: auth });
  if (r.status === 404) return {};
  if (!r.ok) throw new Error(`讀取提醒狀態失敗：HTTP ${r.status}`);
  return decFields((await r.json()).fields || {});
}
const putMeta = fields => http(`${base}/meta/reminder`, {
  method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) })
}, '寫入提醒狀態');
async function broadcast(texts) {
  await http('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + LINE_TOKEN, 'content-type': 'application/json', 'X-Line-Retry-Key': crypto.randomUUID() },
    body: JSON.stringify({ messages: texts.map(text => ({ type: 'text', text })) })
  }, 'LINE 發送');
}

const today = taipeiToday();
const meta = await getMeta();
const slotKey = today + '-' + SLOT;   // 08:00、10:00 各發一次，同一時段不重複
if (MODE === 'daily' && meta.slotKey === slotKey) { console.log('這個時段已處理過，不重複發送'); process.exit(0); }

const [tasks, records, quick] = await Promise.all([list('tasks'), list('records'), list('quick')]);
if (!tasks.length) throw new Error('讀不到任何事項，請檢查資料');
const map = new Map([...records, ...quick].map(r => [r.id, r]));
const get = (id, key) => map.get(recordId(id, key));
const rem = buildReminder(tasks, today, get);
const text = formatReminder(rem, APP_URL);

if (MODE === 'test') {
  await broadcast(splitText('【測試】這是托嬰中心待辦系統的測試訊息\n\n' + text));
  console.log('已送出測試訊息');
  process.exit(0);
}
const send = shouldSend(rem, meta.soonIds || []);
if (send) await broadcast(splitText(text));
await putMeta({ date: today, slotKey, at: new Date().toISOString(), sent: send ? '已發送' : '沒有要提醒的事', soonIds: rem.soonIds });
console.log(send ? '已發送提醒' : '今天沒有要提醒的事');
