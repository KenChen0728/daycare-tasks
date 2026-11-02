import test from 'node:test'; import assert from 'node:assert/strict';
import { nextOcc, bucket, buildReminder, formatReminder, shouldSend, splitText, addDays } from '../logic.js';
const none = () => undefined;
const M = { id:'m', who:'admin', freq:'monthly', months:[1,2,3,4,5,6,7,8,9,10,11,12], day:31, lead:7, from:'2026-11-01', title:'月', gov:false };
const S = { ...M, id:'s', needSend:true, gov:true };
const W = { id:'w', who:'director', freq:'weekly', weekday:2, lead:0, from:'2026-11-01', title:'週', needSend:true, gov:true };
test('月底與二月', () => { assert.equal(nextOcc({...M,from:'2027-02-01'},'2027-02-01',none).due,'2027-02-28'); });
test('未送出不結案，送出才結案', () => {
  const r={'s__2026-11':{doneAt:'x'}}, g=(i,k)=>r[i+'__'+k];
  assert.deepEqual(nextOcc(S,'2026-11-10',g),{key:'2026-11',due:'2026-11-30',stage:'send'});
  r['s__2026-11'].sentAt='y'; assert.equal(nextOcc(S,'2026-11-10',g).key,'2026-12');
});
test('不需送出的事項，完成即結案', () => { const g=(i,k)=>k==='2026-11'?{doneAt:'x'}:undefined; assert.equal(nextOcc(M,'2026-11-10',g).key,'2026-12'); });
test('每週要送出的事項，上週沒送出仍留著', () => { const o=nextOcc(W,'2026-11-10',none); assert.equal(o.due,'2026-11-03'); assert.equal(bucket(W,o,'2026-11-10'),'over'); });
test('每週不需送出的事項只看本週', () => { assert.equal(nextOcc({...W,needSend:false},'2026-11-10',none).due,'2026-11-10'); });
test('超過 13 個月的舊事項不誤判', () => { assert.ok(nextOcc(M,'2030-06-15',none).due>='2029-05-01'); });
test('週末沒有每日事項', () => { assert.equal(nextOcc({id:'d',freq:'daily'},'2026-11-07',none),null); });
test('提醒只在有新項目時發送', () => {
  const r=buildReminder([M],'2026-11-24',none); assert.equal(r.lists.admin.soon.length,1);
  assert.equal(shouldSend(r,[]),true); assert.equal(shouldSend(r,r.soonIds),false);
});
test('長訊息分段', () => { const p=splitText(Array(800).fill('一二三四五六七八九十').join('\n')); assert.ok(p.every(x=>x.length<=4800)); assert.ok(p.length>=2); });

test('遇假日順延', () => {
  const R={...M,day:1,rollover:true,from:'2026-11-01'};
  assert.equal(nextOcc(R,'2026-11-02',none).due,'2026-11-02');
  const g=(i,k)=>k<'2027-01'?{doneAt:'x'}:k=='2027-01'||k<'2027-05'?{doneAt:'x'}:undefined;
  assert.equal(nextOcc(R,'2027-04-20',g).due,'2027-05-03');
  assert.equal(nextOcc({...R,from:'2027-01-01'},'2027-01-01',none).due,'2027-01-04');
  assert.equal(nextOcc({...R,rollover:false,from:'2026-12-01'},'2026-12-01',none).due,'2026-12-01');
});
