/* ===== onboarding: account, floor, connect robots, alerts, team, then the live product. Demo only, nothing is saved or sent. ===== */
var ONB={step:0,acct:{name:'Alex Morgan',email:'alex@demo-plant.example',co:'Demo Plant'},role:'Owner',conn:0,rows:[],tok:0,cfg:{first:'You',backup:'Dana, maintenance lead',escalate:true,delay:5,managers:'Owner and Dana'}};
var ONB_STEPS=['Create account','Your floor','Connect robots','Alerts','Your team'];
function onbOpen(){
 ONB.step=0;ONB.conn=0;ONB.rows=[];ONB.tok++;
 var o=$('onb');o.hidden=false;document.body.classList.add('onbopen');$('onbmark').src=LOGO;$('onbmark2').src=LOGO;renderOnb();
}
function onbClose(){var o=$('onb');o.hidden=true;document.body.classList.remove('onbopen');ONB.tok++}
function onbGo(n){ONB.step=n;ONB.tok++;if(n!==2){ONB.conn=0;ONB.rows=[]}renderOnb();var m=$('onbmain');m.scrollTop=0;var h=m.querySelector('h1');if(h){h.setAttribute('tabindex','-1');h.focus({preventScroll:true})}}
function seg(name,opts,cur){return '<div class="oseg" role="group">'+opts.map(function(o){return '<button type="button" data-onb="set" data-k="'+name+'" data-v="'+o[0]+'" aria-pressed="'+(String(cur)===String(o[0]))+'">'+o[1]+'</button>'}).join('')+'</div>'}
function onbSteps(){
 var h='';
 ONB_STEPS.forEach(function(s,i){h+='<li class="'+(i===ONB.step?'on':i<ONB.step?'done':'')+'"><i>'+(i<ONB.step?'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>':(i+1))+'</i><span>'+s+'</span></li>'});
 return h;
}
function onbBody(){
 var s=ONB.step,a=ONB.acct,c=ONB.cfg,h='';
 if(s===0){
  h+='<h1>Create your account</h1><p class="osub">Demo account. Nothing is saved or sent.</p>';
  h+='<label class="ofld"><span>Your name</span><input id="onbName" type="text" value="'+esc(a.name)+'" autocomplete="off"></label>';
  h+='<label class="ofld"><span>Work email</span><input id="onbEmail" type="email" value="'+esc(a.email)+'" autocomplete="off"></label>';
  h+='<label class="ofld"><span>Company</span><input id="onbCo" type="text" value="'+esc(a.co)+'" autocomplete="off"></label>';
  h+='<div class="oact"><button type="button" class="obtn pri" data-onb="acct">Create account</button></div><p class="onote">No password in the demo. A real account would use an emailed sign in link.</p>';
 }else if(s===1){
  h+='<div class="otick"><i><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg></i>Account created for '+esc(a.email)+'</div>';
  h+='<h1>Your floor</h1><p class="osub">Two quick questions.</p>';
  h+='<div class="olbl">What robots do you run?</div><div class="ocards"><button type="button" class="ocard on" aria-pressed="true"><b>Universal Robots</b><small>Available</small></button><button type="button" class="ocard" disabled><b>Fanuc, ABB, KUKA</b><small>Later</small></button><button type="button" class="ocard" disabled><b>Other</b><small>Later</small></button></div>';
  h+='<div class="olbl">Your role</div>'+seg('role',[['Owner','Owner or manager'],['Technician','Technician']],ONB.role)+'<p class="onote">Owners and managers see dollars. Technicians see times and causes only.</p>';
  h+='<div class="oact"><button type="button" class="obtn" data-onb="back">Back</button><button type="button" class="obtn pri" data-onb="next">Continue</button></div>';
 }else if(s===2){
  h+='<h1>Connect your robots</h1><p class="osub">Read only. Botlien never sends a command to a robot.</p>';
  if(ONB.conn===0){
   h+='<div class="ocode"><small>Your connection code</small><b>BL-7Q4-K2M</b></div><ol class="oinst"><li>Open the cloud settings on your robots.</li><li>Enter this code.</li><li>Press Connect here.</li></ol>';
   h+='<div class="oact"><button type="button" class="obtn" data-onb="back">Back</button><button type="button" class="obtn pri" data-onb="connect">Connect</button></div>';
  }else{
   h+='<div id="onbconn" class="oconn" aria-live="polite"></div>';
   h+='<p class="onote">Simulated connection for the demo. Your real robots would be read over a read only cloud link.</p>';
   h+='<div class="oact"><button type="button" class="obtn" data-onb="back">Back</button><button type="button" class="obtn pri" data-onb="next" id="onbNextConn"'+(ONB.conn===2?'':' disabled')+'>Continue</button></div>';
  }
 }else if(s===3){
  h+='<h1>Who hears about stops?</h1><p class="osub">Defaults are set. Change anything, or continue.</p>';
  h+='<div class="olbl">Tell first</div>'+seg('first',[['You','Me, the owner'],['Dana, maintenance lead','Dana, maintenance lead']],c.first);
  h+='<div class="olbl">If no answer in 10 minutes</div>'+seg('escalate',[['true','Tell the backup'],['false','No backup']],String(c.escalate));
  h+='<div class="olbl">Alert after a stop lasts</div>'+seg('delay',[['2','2 minutes'],['5','5 minutes'],['10','10 minutes']],c.delay);
  h+='<div class="olbl">Who sees dollar figures</div>'+seg('managers',[['Owner and Dana','Owner and Dana'],['Only the owner','Only the owner'],['Everyone who gets alerts','Everyone']],c.managers);
  h+='<div class="oact"><button type="button" class="obtn" data-onb="back">Back</button><button type="button" class="obtn pri" data-onb="next">Continue</button></div>';
 }else{
  h+='<h1>Your team is ready</h1><p class="osub">Mara is the lead. You talk to her, and she hands work to the watchers.</p><ul class="oteam" id="onbteam">';
  [['Mara','mara','Lead. Answers your questions.'],['Loader 1 Watcher','l1','Watches Loader 1'],['Loader 2 Watcher','l2','Watches Loader 2'],['Deburr Watcher','db','Watches Deburr'],['Inspection Watcher','qc','Watches Inspection'],['Stop Watcher','stop','Tells the right person when a robot stops'],['Logbook Keeper','log','Keeps the record and what fixed each stop']].forEach(function(t,i){h+='<li style="animation-delay:'+(i*90)+'ms">'+avatar(t[1],'#3A3A3F','sm')+'<b>'+t[0]+'</b><small>'+t[2]+'</small></li>'});
  h+='</ul><p class="onote">Read only. Nothing here can control a robot.</p><div class="oact"><button type="button" class="obtn" data-onb="back">Back</button><button type="button" class="obtn pri" data-onb="finish">Open Botlien</button></div>';
 }
 return h;
}
function renderOnb(){
 $('onbsteps').innerHTML=onbSteps();
 $('onbproglabel').textContent='Step '+(ONB.step+1)+' of '+ONB_STEPS.length+': '+ONB_STEPS[ONB.step];
 $('onbmain').innerHTML=onbBody();
 if(ONB.step===2&&ONB.conn>0)renderConnRows();
}
function renderConnRows(){
 var el=$('onbconn');if(!el)return;
 el.innerHTML=ONB.rows.map(function(r){return '<div class="ocr '+(r.k||'')+'"><span class="ocd '+(r.c||'')+'"></span><span><b>'+r.t+'</b>'+(r.s?'<small>'+r.s+'</small>':'')+'</span></div>'}).join('');
}
function onbConnect(){
 ONB.conn=1;ONB.rows=[];var tok=++ONB.tok;renderOnb();
 var seq=[
  [450,{t:'Reaching the Botlien cloud link',c:'green'}],
  [800,{t:'Read only access confirmed',s:'No write access. No commands can be sent.',c:'green'}],
  [800,{t:'Looking for robots on this connection',c:'amber'}]
 ];
 R.forEach(function(r){seq.push([480,{t:r.name,s:r.model+', found',c:'green',k:'rob'}])});
 seq.push([520,{t:'CNC mill A and B',s:'Machines, not robots. Seen only by how the robots around them wait.',c:'gray'}]);
 seq.push([700,{t:'First readings received',s:'The demo reads a recorded sample, Aug 4 to Sep 3, 2026.',c:'green'}]);
 var i=0,t=0;
 function step(){
  if(tok!==ONB.tok||ONB.step!==2)return;
  if(i>=seq.length){ONB.conn=2;var b=$('onbNextConn');if(b)b.disabled=false;return}
  var it=seq[i++];ONB.rows.push(it[1]);renderConnRows();setTimeout(step,it[0]);
 }
 setTimeout(step,300);
}
function onbFinish(){
 var cfg=ONB.cfg,role=ONB.role;
 onbClose();
 resetAll();
 S.cfg.first=cfg.first;S.cfg.escalate=cfg.escalate;S.cfg.delay=+cfg.delay;S.cfg.managers=cfg.managers;
 S.cfg.backup=cfg.first==='You'?'Dana, maintenance lead':'You';
 S.role=role;setRole(role,true);
 initRoutines();S.setup.on=false;S.hired=true;seed();renderAll();
 say('mara','Hi, I am Mara. Your team is ready. I only read data, I never control a robot.',{wait:450}).then(function(){whenFeed(firstHour)});
}
function onbClick(e){
 var b=e.target.closest&&e.target.closest('[data-onb]');if(!b||b.disabled)return;
 var k=b.getAttribute('data-onb');
 if(k==='acct'){
  var n=$('onbName').value.trim(),m=$('onbEmail').value.trim(),c=$('onbCo').value.trim();
  if(!n||!/^\S+@\S+\.\S+$/.test(m)||!c){var f=!n?$('onbName'):!/^\S+@\S+\.\S+$/.test(m)?$('onbEmail'):$('onbCo');f.focus();f.setAttribute('aria-invalid','true');return}
  ONB.acct={name:n,email:m,co:c};onbGo(1);return;
 }
 if(k==='next'){onbGo(ONB.step+1);return}
 if(k==='back'){onbGo(Math.max(0,ONB.step-1));return}
 if(k==='connect'){onbConnect();return}
 if(k==='finish'){onbFinish();return}
 if(k==='set'){
  var key=b.getAttribute('data-k'),v=b.getAttribute('data-v');
  if(key==='role')ONB.role=v;else if(key==='escalate')ONB.cfg.escalate=v==='true';else if(key==='delay')ONB.cfg.delay=+v;else ONB.cfg[key]=v;
  var ps=b.parentNode.querySelectorAll('button');for(var i=0;i<ps.length;i++)ps[i].setAttribute('aria-pressed',ps[i]===b?'true':'false');
 }
}
