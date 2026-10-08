/* ===== live stops: our own dashboard and chat, no Slack needed =====
   Turns on only when an API base is given (window.__BOTLIEN_API, or ?api=https://host/path in the page URL).
   Without it the page behaves exactly as the scripted demo. Contract: LIVE_STOPS_API_CONTRACT.md */
var LIVE={api:null,cursor:0,seen:{},t:0,fails:0,on:false,epoch:undefined};
function liveInit(){
 var q=(location.search.match(/[?&]api=([^&]+)/)||[])[1];
 LIVE.api=window.__BOTLIEN_API||(q?decodeURIComponent(q):null);
 if(!LIVE.api)return;
 LIVE.api=LIVE.api.replace(/\/+$/,'');LIVE.on=true;S.liveOpen={};
 clearInterval(LIVE.t);LIVE.t=setInterval(function(){if(!document.hidden)liveTick()},1500);liveTick();
}
function liveRobot(st){
 var n=String(st.robot==null?'':st.robot).toLowerCase(),i;
 if(/^\d+$/.test(n)&&R[+n])return +n;
 for(i=0;i<R.length;i++)if(n&&(R[i].name.toLowerCase()===n||n.indexOf(R[i].name.toLowerCase())>=0||R[i].id===n))return i;
 return 0;
}
function liveMins(st){
 if(st.minutes!=null)return Math.max(0,Math.round(st.minutes));
 var a=Date.parse(st.startedAt),b=st.endedAt?Date.parse(st.endedAt):Date.now();
 return isFinite(a)?Math.max(0,Math.round((b-a)/60000)):0;
}
function liveTag(st){return st.source==='replay'?'Replay, live feed':'Live'}
function liveCause(st){
 var c=st.errorCode?'Error '+esc(st.errorCode)+(st.description?', '+esc(st.description):''):(st.description?esc(st.description):'No error code reported.');
 if(st.type==='offline')c='The robot stopped reporting. '+(st.description?esc(st.description):'');
 var rep=st.repeatCount>1?' It has stopped '+st.repeatCount+' times this week.':'';
 if(!/[.!?]$/.test(c))c+='.';
 return c+rep;
}
function liveAlert(st,mins,i){
 var name=R[i].name,left=(st.leftWaiting||[]).filter(Boolean),m=money();
 var cost=st.robotTimeCost!=null?st.robotTimeCost:R[i].cph*mins/60;
 var parts=st.partsLost!=null?' and about '+Math.round(st.partsLost)+' parts not made':'';
 var leftTxt=left.length?' It left '+left.map(esc).join(' and ')+' waiting.':'';
 var head='<b>'+esc(name)+' has been stopped '+mins+' minute'+(mins===1?'':'s')+'.</b> '+liveCause(st);
 return{m:head+(m?' That is about <b>'+usd(cost)+'</b> of robot time'+parts+' so far.':(st.partsLost!=null?' About '+Math.round(st.partsLost)+' parts not made so far.':''))+leftTxt,
        p:head+(st.partsLost!=null?' About '+Math.round(st.partsLost)+' parts not made so far.':'')+leftTxt};
}
/* Botlien's API (app.botlien.com/api/v1) sends richer shapes than this page's contract:
   robot as {id,name,model}, type "stop" for a protective stop, leftWaiting as [{name,minutes}],
   robotTimeCost as {cents,basis,math}, fix as {text,by,at}, times in milliseconds. One place
   turns them into the contract's, so the rest of the page is unchanged. */
function liveNorm(st){
 var o={},k;for(k in st)o[k]=st[k];
 if(st.robot&&typeof st.robot==='object')o.robot=st.robot.name;
 if(o.type==='stop')o.type='protective';
 if(Array.isArray(st.leftWaiting))o.leftWaiting=st.leftWaiting.map(function(w){return w&&typeof w==='object'?w.name:w}).filter(Boolean);
 if(st.robotTimeCost&&typeof st.robotTimeCost==='object')o.robotTimeCost=st.robotTimeCost.cents==null?null:st.robotTimeCost.cents/100;
 if(st.partsLost&&typeof st.partsLost==='object')o.partsLost=st.partsLost.cents==null?null:st.partsLost.cents;
 if(st.fix&&typeof st.fix==='object')o.fix=st.fix.text;
 if(typeof st.startedAt==='number')o.startedAt=new Date(st.startedAt).toISOString();
 if(typeof st.endedAt==='number')o.endedAt=new Date(st.endedAt).toISOString();
 if(Array.isArray(st.acks))o.acks=st.acks.map(function(a){return{by:a.by&&a.by.indexOf('@')>0?(a.by===(window.__BOTLIEN_ACCOUNT||{}).email?'You':a.by.split('@')[0]):a.by,kind:a.kind,at:typeof a.at==='number'?new Date(a.at).toISOString():a.at,local:a.by===(window.__BOTLIEN_ACCOUNT||{}).email}});
 return o;
}
function liveSend(path,body){
 try{fetch(LIVE.api+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(function(){})}catch(e){}
}
function liveAck(id,kind){liveSend('/stops/'+encodeURIComponent(id)+'/ack',kind==='snooze'?{kind:kind,minutes:30}:{kind:kind});say('stop',kind==='on'?'Thanks, noted. I will stay with it and tell you when the robot runs again.':kind==='snooze'?'Snoozed. I still log everything.':'Looking into it. This is a pattern from the logged history, not a diagnosis. A person decides.',{wait:250,tag:liveTag({source:LIVE.seen[id]&&LIVE.seen[id].source})})}
function liveFix(id,i,mins,what){
 liveSend('/stops/'+encodeURIComponent(id)+'/fix',{what:what});
 pushRec('log',{k:'ai',html:'<b>Updated.</b> '+esc(R[i].name)+', '+mins+' minute'+(mins===1?'':'s')+' down. What fixed it: '+esc(what)+'.',short:nowShort(),tag:'Live, note added'});
 say('stop','Thanks. I added that to the log. This stop now has a cause on record.',{wait:200});
}
function liveSig(st){return [(st.leftWaiting||[]).filter(Boolean).join(','),st.repeatCount||'',st.errorCode||'',st.type||''].join('|')}
function liveStop(st){
 var i=liveRobot(st),mins=liveMins(st),seen=LIVE.seen[st.id],id=st.id;
 var open=st.state!=='closed';
 if(open)S.liveOpen[i]=true;else delete S.liveOpen[i];
 /* The same stop opening again (it came back within 10 minutes and stopped again): say so, and
    get ready to say it is running again a second time. */
 if(seen&&open&&seen.closedSaid){
  seen.closedSaid=false;seen.state='open';seen.alertP=null;
  say('stop','<b>'+esc(R[i].name)+' stopped again.</b> '+liveCause(st),{tag:liveTag(st),wait:150});
 }
 if(!seen){
  seen=LIVE.seen[id]={state:st.state,acks:0,source:st.source,closedSaid:false};
  if(open){
   var a=liveAlert(st,mins,i);
   seen.alertSig=liveSig(st);
   seen.alertP=say('stop',a.m,{plain:a.p,tag:liveTag(st),wait:150,choices:{title:'What do you want to do?',sub:'I will not change anything on the robot.',options:[
    {label:'I am on it',fn:function(){liveAck(id,'on')}},{label:'Look into it',fn:function(){liveAck(id,'look')}},{label:'Snooze 30 minutes',fn:function(){liveAck(id,'snooze')}}]}});
  }
 }
 /* Details that arrive after the alert was written (what it left waiting, how often it has stopped) change the alert in place. */
 if(open&&seen.alertP&&!seen.closedSaid){
  var sg=liveSig(st);
  if(sg!==seen.alertSig){seen.alertSig=sg;var a2=liveAlert(st,mins,i);seen.alertP.then(function(rec){if(!rec||rec===DEAD)return;rec.html=a2.m;rec.p=a2.p;if(S.cur==='stop')renderThread()})}
 }
 var acks=(st.acks||[]);
 if(acks.length>seen.acks){
  var last=acks[acks.length-1];seen.acks=acks.length;
  if(last&&last.by&&!last.local)say('stop','<b>'+esc(last.by)+'</b> '+(last.kind==='snooze'?'snoozed the alert.':last.kind==='look'?'is looking into it.':'said they are on it.'),{wait:150,tag:liveTag(st)});
 }
 if(!open&&!seen.closedSaid){
  seen.closedSaid=true;seen.state='closed';
  var cost=st.robotTimeCost!=null?st.robotTimeCost:R[i].cph*mins/60,m=money();
  var txt='<b>'+esc(R[i].name)+' is running again.</b> It was stopped '+mins+' minute'+(mins===1?'':'s')+'.'+(m?' About '+usd(cost)+' of robot time'+(st.partsLost!=null?' and about '+Math.round(st.partsLost)+' parts not made':'')+'.':(st.partsLost!=null?' About '+Math.round(st.partsLost)+' parts not made.':''));
  var plain='<b>'+esc(R[i].name)+' is running again.</b> It was stopped '+mins+' minute'+(mins===1?'':'s')+'.'+(st.partsLost!=null?' About '+Math.round(st.partsLost)+' parts not made.':'');
  var opts=st.fix?null:{title:'What fixed it?',sub:'Optional, one tap. It goes in the log.',options:[
   {label:'Cleared what was blocking it',fn:function(){liveFix(id,i,mins,'Cleared what was blocking it')}},
   {label:'Reset the machine it waits on',fn:function(){liveFix(id,i,mins,'Reset the machine it waits on')}},
   {label:'Something else',fn:function(){liveFix(id,i,mins,'Something else')}}]};
  say('stop',txt+(st.fix?' What fixed it: '+esc(st.fix)+'.':''),{plain:plain+(st.fix?' What fixed it: '+esc(st.fix)+'.':''),tag:liveTag(st)+', closed',wait:150,choices:opts||undefined});
  pushRec('log',{k:'ai',html:'<b>Logged.</b> '+esc(R[i].name)+', '+mins+' minute'+(mins===1?'':'s')+' down'+(st.errorCode?', error '+esc(st.errorCode):'')+(st.fix?'. What fixed it: '+esc(st.fix):'')+'.',short:nowShort(),tag:'Live, new entry'});
 }
}
function liveTick(){
 if(!LIVE.on)return;
 fetch(LIVE.api+'/stops?since='+LIVE.cursor,{credentials:'same-origin',cache:'no-store'})
  .then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})
  .then(function(j){
   LIVE.fails=0;
   /* A rewound replay starts the stop ids again from 1: forget what was seen and read from the start. */
   if(j&&j.epoch!==undefined){if(LIVE.epoch!==undefined&&j.epoch!==LIVE.epoch){LIVE.epoch=j.epoch;LIVE.seen={};LIVE.cursor=0;S.liveOpen={};return liveTick()}LIVE.epoch=j.epoch}
   var list=(j&&j.stops)||[];
   list.forEach(function(st){try{liveStop(liveNorm(st))}catch(e){}});
   if(j&&j.cursor!=null)LIVE.cursor=j.cursor;
   renderSide();renderHead();
   if(S.tab==='ov'||S.tab==='line')renderLive();
  })
  .catch(function(){if(++LIVE.fails===3){var c=$('feedchip');if(c){c.className='fchip bad';c.textContent='Live stops are not reachable'}}});
}
