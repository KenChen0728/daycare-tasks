import test from 'node:test'; import assert from 'node:assert/strict';
import { nextOcc, bucket, buildReminder, formatReminder, shouldSend, splitText, addDays, monthOccs, addMonth, followUpTasks, followUpIds, planTasks, keyEnd, termKey, termOf, shiftTerm, pendingLabel, stageOf, needsPick, pickDays } from '../logic.js';
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
test('日曆：每期到期日與結案狀態', () => {
  assert.deepEqual(monthOccs(W,2026,11,none).map(o=>o.due),['2026-11-03','2026-11-10','2026-11-17','2026-11-24']);
  assert.equal(monthOccs(W,2026,11,none)[1].key,nextOcc(W,'2026-11-10',(i,k)=>k==='2026-11-02'?{doneAt:1,sentAt:1}:undefined).key);
  assert.deepEqual(monthOccs(M,2026,10,none),[]);
  const roll={...M,day:1,rollover:true,from:'2026-10-01'};
  assert.deepEqual(monthOccs(roll,2026,11,none).map(o=>o.due),['2026-11-02']);
  assert.equal(monthOccs(S,2026,11,()=>({doneAt:1})) [0].stage,'send');
  assert.equal(monthOccs(S,2026,11,()=>({doneAt:1,sentAt:1}))[0].closed,true);
  assert.deepEqual(monthOccs({...M,freq:'daily'},2026,11,none),[]);
  // 週六的月底順延到下個月
  assert.deepEqual(monthOccs({...M,day:31,rollover:true,from:'2026-01-01'},2026,11,none).map(o=>o.due),['2026-11-02','2026-11-30']);
});

test('加一個月', () => { assert.equal(addMonth('2026-11-03'),'2026-12-03'); assert.equal(addMonth('2027-01-31'),'2027-02-28'); assert.equal(addMonth('2026-12-15'),'2027-01-15'); });
test('外聘督導完成後產生報告書', () => {
  const [f]=followUpTasks({id:'d063',title:'外聘督導',followUp:{title:'外聘督導成果報告書',who:'director',either:true,needSend:true,sendLabel:'已印出',lead:14}},'2026-11','2026-11-20');
  assert.equal(f.id,'fu__d063__2026-11'); assert.equal(f.date,'2026-12-20'); assert.equal(f.freq,'once'); assert.equal(f.needSend,true);
  assert.equal(nextOcc(f,'2026-11-20',none).due,'2026-12-20');
  const g=()=>({doneAt:'x'}); assert.equal(nextOcc(f,'2026-11-21',g).stage,'send'); assert.equal(pendingLabel(f),'待印出');
  assert.equal(nextOcc(f,'2026-11-21',()=>({doneAt:'x',sentAt:'y'})),null);
  assert.deepEqual(followUpTasks({id:'x',title:'y'},'2026-11','2026-11-20'),[]);
  const two=followUpTasks({id:'k',title:'親子活動',followUps:[{title:'甲',who:'director',either:true},{title:'乙',who:'director',either:true,needSend:true}]},'2027-01','2026-11-20');
  assert.deepEqual(two.map(x=>x.id),['fu__k__2027-01','fu__k__2027-01__1']); assert.equal(two[0].needSend,false); assert.equal(two[1].needSend,true); assert.equal(nextOcc(two[0],'2026-11-21',()=>({doneAt:1})),null);
});
test('學期：2–7 月、8–1 月', () => {
  for (const [d,k] of [['2026-11-03','2027-01'],['2027-01-31','2027-01'],['2027-02-01','2027-07'],['2027-07-31','2027-07'],['2027-08-01','2028-01']]) assert.equal(termKey(d),k);
  assert.equal(termOf('2027-01').name,'115 學年度上學期'); assert.equal(termOf('2027-07').name,'115 學年度下學期');
  assert.deepEqual(termOf('2027-01').yearKeys,['2027-01','2027-07']); assert.deepEqual(termOf('2027-07').yearKeys,['2027-01','2027-07']);
  assert.equal(shiftTerm('2027-01',1),'2027-07'); assert.equal(shiftTerm('2027-07',1),'2028-01'); assert.equal(shiftTerm('2027-01',-1),'2026-07');
});
test('社區宣導上學期做完兩次，下學期不再提醒', () => {
  const C={id:'c',who:'director',freq:'months',months:[1,7],day:31,lead:60,from:'2026-08-01',title:'社區宣導',kpi:'year'};
  assert.equal(nextOcc(C,'2026-11-03',none).due,'2027-01-31');
  const r={'c__2027-01':{doneAt:1},'c__2027-07':{doneAt:1}}, g=(i,k)=>r[i+'__'+k];
  assert.equal(nextOcc(C,'2027-06-01',g).key,'2028-01');
  delete r['c__2027-07']; assert.equal(nextOcc(C,'2027-06-01',g).due,'2027-07-31');
});
test('滿意度調查：學期對應 6、12 月底', () => { assert.equal(termOf('2027-01').halfKey,'2026-12'); assert.equal(termOf('2027-07').halfKey,'2027-06'); assert.equal(keyEnd('2027-06'),'2027-06-30'); assert.equal(keyEnd('2026-12'),'2026-12-31'); });
test('自辦研習：事項在對的日子出現', () => {
  const p={id:'p',name:'',deadline:'2027-03-01',start:'2027-04-20',end:'2027-04-21',time:'09:00–12:00'};
  const [plan,gov,rpt]=planTasks(p,'2027-02-01');
  assert.equal(plan.date,'2027-03-01'); assert.equal(plan.either,true); assert.equal(gov.either,undefined); assert.equal(gov.who,'director'); assert.equal(gov.gov,true);
  assert.equal(gov.date,'2027-04-19');
  assert.equal(bucket(gov,nextOcc(gov,'2027-04-05',none),'2027-04-05'),'later');
  assert.equal(bucket(gov,nextOcc(gov,'2027-04-06',none),'2027-04-06'),'soon');
  assert.equal(bucket(rpt,nextOcc(rpt,'2027-04-21',none),'2027-04-21'),'later');
  assert.equal(bucket(rpt,nextOcc(rpt,'2027-04-22',none),'2027-04-22'),'soon'); assert.equal(rpt.date,'2027-05-22');
  const sent=on=>on==='sent';
  assert.deepEqual(followUpTasks(gov,'once','2027-04-08',on=>on!=='sent'),[]);
  const [s]=followUpTasks(gov,'once','2027-04-08',sent); assert.equal(s.title,'簽到表製作'); assert.equal(s.date,'2027-04-19'); assert.equal(s.either,true); assert.equal(s.plan,'p');
  assert.equal(followUpIds(gov,'once',sent)[0],s.id);
  assert.equal(pendingLabel(gov),'待發文');
});
test('自辦研習：課程很近時從今天開始', () => {
  const [,gov]=planTasks({id:'p',deadline:'2027-04-01',start:'2027-04-10',end:'2027-04-10'},'2027-04-05');
  assert.equal(bucket(gov,nextOcc(gov,'2027-04-05',none),'2027-04-05'),'soon');
  const [,g2]=planTasks({id:'p',deadline:'2027-04-01',start:'2027-04-05',end:'2027-04-05'},'2027-04-05'); assert.equal(g2.date,'2027-04-05');
});
test('到期前一個月才進快到期', () => {
  const T={id:'t',who:'director',freq:'once',date:'2026-12-31',lead:60,title:'一次'}, o={key:'once',due:T.date,stage:'todo'};
  assert.equal(bucket(T,o,'2026-11-30'),'later'); assert.equal(bucket(T,o,'2026-12-01'),'soon');
  assert.equal(bucket({...T,lead:3},o,'2026-12-01'),'soon');
  const K={...T,freq:'months',months:[1,7],day:31,from:'2026-08-01'};
  assert.equal(buildReminder([K],'2026-11-03',none).lists.director.soon.length,0);
  assert.equal(bucket(K,{key:'2027-01',due:'2027-01-31',stage:'todo'},'2026-12-31'),'soon');
});
test('自辦研習照計畫的日子出現', () => {
  const P=planTasks({id:'p',deadline:'2026-12-01',start:'2027-03-10',end:'2027-03-10',time:'',name:''},'2026-11-03'), g=P.find(t=>t.id==='p-gov'), o={key:'once',due:g.date,stage:'todo'};
  assert.equal(bucket(g,o,'2027-02-23'),'later'); assert.equal(bucket(g,o,'2027-02-24'),'soon');
});
test('憑證核銷：選日期，截止日是前一天', () => {
  const V={id:'v',who:'admin',either:true,freq:'monthly',months:[1,2,3,4,5,6,7,8,9,10,11,12],day:31,from:'2026-11-01',title:'憑證核銷製作',needSend:true,sendLabel:'已送件',review:true,pick:true,picks:{}};
  assert.equal(needsPick(V,'2026-11'),true); assert.equal(nextOcc(V,'2026-11-04',none).due,'2026-11-30');
  assert.deepEqual(monthOccs(V,2026,11,none),[]);
  const P={...V,picks:{'2026-11':'2026-11-12'}};
  assert.equal(nextOcc(P,'2026-11-04',none).due,'2026-11-11'); assert.equal(monthOccs(P,2026,11,none)[0].due,'2026-11-11');
  const F={...V,picks:{'2026-11':'2026-11-01'}};   // 截止日落在開始日之前，仍要算
  assert.equal(nextOcc(F,'2026-11-04',none).due,'2026-10-31'); assert.equal(monthOccs(F,2026,10,none)[0].key,'2026-11');
  const E={...V,picks:{'2026-12':'2026-12-01'}};
  assert.equal(monthOccs(E,2026,11,none).find(o=>o.key==='2026-12').due,'2026-11-30');
  assert.equal(pickDays('2027-02').length,28);
});
test('憑證核銷：完成、主管覆核、已送件才結案', () => {
  const V={id:'v',who:'admin',freq:'monthly',months:[11,12],day:31,from:'2026-11-01',title:'憑證',needSend:true,sendLabel:'已送件',review:true,pick:true,picks:{'2026-11':'2026-11-12'}};
  assert.equal(stageOf(V,{doneAt:1}),'review'); assert.equal(pendingLabel(V,'review'),'待主管覆核');
  assert.equal(stageOf(V,{doneAt:1,reviewAt:1}),'send'); assert.equal(pendingLabel(V,'send'),'待送件');
  assert.equal(nextOcc(V,'2026-11-05',()=>({doneAt:1})).stage,'review');
  assert.equal(nextOcc(V,'2026-11-05',(i,k)=>k==='2026-11'?{doneAt:1,reviewAt:1,sentAt:1}:undefined).key,'2026-12');
  const t=formatReminder(buildReminder([V],'2026-11-05',()=>({doneAt:1})),'u','2026-11-05'); assert.match(t,/待主管覆核/);
  const u=formatReminder(buildReminder([{...V,picks:{}}],'2026-11-05',none),'u','2026-11-05'); assert.match(u,/11 月還沒選日期/);
});
