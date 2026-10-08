(function(){
'use strict';
var FAST=/[?&]fast=1/.test(location.search);
var $=function(i){return document.getElementById(i)};
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function strip(h){var t=document.createElement('template');t.innerHTML=String(h).replace(/<\/(div|p|li|span)>/g,'</$1> ').replace(/<br\s*\/?>/g,' ');return(t.content.textContent||'').replace(/\s+/g,' ').trim()}
function mk(tag,cls){var e=document.createElement(tag);if(cls)e.className=cls;return e}
function delay(ms){return new Promise(function(r){setTimeout(r,FAST?0:ms)})}
function clone(o){return JSON.parse(JSON.stringify(o))}
function f1(x){x=+x;return isFinite(x)?x.toFixed(1):'n/a'}
function usd(v){return '$'+v.toFixed(2)}
function usd0(v){return '$'+Math.round(v).toLocaleString('en-US')}

/* ===== numbers taken from the existing Botlien dashboard (sample data, nothing invented) ===== */
var R=[
 {id:'l1',name:'Loader 1',model:'UR10e',cph:4.374,ppm:2.2917,idleYr:13471,work:23,shape:'l1',color:'#2F7CF6'},
 {id:'l2',name:'Loader 2',model:'UR10e',cph:4.374,ppm:2.2917,idleYr:16096,work:8,shape:'l2',color:'#F5A524'},
 {id:'db',name:'Deburr',model:'UR5e',cph:3.381,ppm:4.5833,idleYr:8385,work:38,shape:'db',color:'#8E8E93'},
 {id:'qc',name:'Inspection',model:'UR3e',cph:2.903,ppm:4.5833,idleYr:9174,work:21,shape:'qc',color:'#E5173F'}
];
var INC=[ /* the dashboard's Incidents page, sample period Aug 4 to Sep 3 */
 {d:'Aug 7',t:'7:30 am',r:0+1,min:12,err:'error C153',cause:'Robot stop, the mills backed up behind it',parts:28},
 {d:'Aug 12',t:'10:05 am',r:0,min:6,err:'error C153',cause:'Robot stop, the mills backed up behind it',parts:14},
 {d:'Aug 14',t:'1:40 pm',r:3,min:7,err:'error C153',cause:'Robot stop, the mills backed up behind it',parts:32},
 {d:'Aug 19',t:'9:10 am',r:1,min:8,err:'error C153',cause:'Robot stop, the mills backed up behind it',parts:18},
 {d:'Aug 21',t:'11:15 am',r:2,min:5,err:'error C207',cause:'Robot stop, the mills kept running',parts:23},
 {d:'Aug 26',t:'2:20 pm',r:0,min:5,err:'waiting for the machine',cause:'Waiting on a CNC mill',parts:11},
 {d:'Sep 3',t:'6:40 am',r:1,min:4,err:'error C153',cause:'Robot stop, the mills backed up behind it',parts:9},
 {d:'Sep 3',t:'7:10 am',r:2,min:3,err:'waiting for parts',cause:'Short of parts from the mills',parts:14}
];
INC[0].r=1; /* Aug 7 was Loader 2 */
var TOTAL_CPH=15.03, COST_PER_REAL_HOUR=69.52;

/* ===== state ===== */
var S={cur:'mara',role:'Owner',tab:'ov',setup:{step:0,on:true},
 cfg:{delay:5,first:'You',backup:'Dana, maintenance lead',managers:'Owner and Dana',escalate:true},
 hired:false,sim:null,snoozed:false,q:'',histShown:false};
var TH={},QS={},SEEDED=false,TIMERS=[];
function team(){return[
 {id:'mara',g:'Team lead',name:'Mara',role:'Line coworker',main:true,shape:'mara',color:'#F26B21',hired:true},
 {id:'l1',g:'Cells',name:'Loader 1 Watcher',role:'Watches Loader 1, UR10e',shape:'l1',color:'#2F7CF6',r:0},
 {id:'l2',g:'Cells',name:'Loader 2 Watcher',role:'Watches Loader 2, UR10e',shape:'l2',color:'#F5A524',r:1},
 {id:'db',g:'Cells',name:'Deburr Watcher',role:'Watches Deburr, UR5e',shape:'db',color:'#8E8E93',r:2},
 {id:'qc',g:'Cells',name:'Inspection Watcher',role:'Watches Inspection, UR3e',shape:'qc',color:'#E5173F',r:3},
 {id:'stop',g:'Specialists',name:'Stop Watcher',role:'Tells the right person when a cell stops',shape:'stop',color:'#1C1C1E'},
 {id:'log',g:'Specialists',name:'Logbook Keeper',role:'Keeps a record of stops',shape:'log',color:'#14B8A6'}
]}
var GEN=0,DEAD=new Promise(function(){});
/* Hosted on app.botlien.com with a signed-in account: stops come from the live feed only, so the
   sample story's test alert, sample history and sample incidents are left out. */
var HOSTED=!!window.__BOTLIEN_HOSTED;
/* Hosted, the view follows the account: someone the server sends no dollars to sees the
   technician view and cannot switch it (the server already strips the figures). */
var HOSTED_ROLE_LOCKED=false;
function hostedRole(){
 if(!HOSTED)return;
 var h=window.__BOTLIEN_HOSTED;
 if(h.dollars===false){HOSTED_ROLE_LOCKED=true;setRole('Technician',true);var b=$('roleBtn');if(b){b.textContent='Viewing as: Technician';b.setAttribute('aria-disabled','true');b.title='Your account shows times and causes only'}}
}
function whenFeed(cb){var g=GEN,n=0;(function go(){if(g!==GEN)return;if(feed().ok)cb();else if(n++>40)say('mara','I could not reach the sample feed. Please reload the page.',{wait:200});else TIMERS.push(setTimeout(go,1000))})()}
function initThreads(){GEN++;TH={};QS={};SEEDED=false;TIMERS.forEach(clearTimeout);TIMERS=[];team().forEach(function(d){TH[d.id]=Object.assign({msgs:[],unread:0,last:'',time:'',chips:[],typing:false},d)})}
function visible(){return Object.keys(TH).map(function(k){return TH[k]}).filter(function(t){return t.hired||S.hired})}

/* ===== reading the embedded dashboard ===== */
var F=null;
function sam(){try{return F&&F.contentWindow}catch(e){return null}}
var _OURS=null;function ours(){try{return _OURS||(_OURS=sam().eval('OURS'))}catch(e){return null}}
var FD=null,FDt=0;
function feed(){var nw=Date.now();if(FD&&nw-FDt<400)return FD;FD=feed0();FDt=nw;return FD}
function feed0(){
 var o=ours();
 if(!o||!o.live||!Array.isArray(o.live.robots))return{ok:false,state:'connecting',robots:null};
 var lag=(isFinite(o.lag)&&isFinite(o.lagAt))?o.lag+(Date.now()-o.lagAt)/1000:null;
 var fresh=!!(o.ok&&(o.live.live===true||(o.live.live==null&&lag!=null&&lag<=30)));
 return{ok:fresh,state:o.state||'offline',robots:o.live.robots,lag:lag,line:o.line,updated:o.live.updated};
}
function samGo(view){try{var el=sam().document.querySelector('[data-act="go"][data-view="'+view+'"]');if(el)el.click()}catch(e){}}
function tabView(t){return{ov:'dashv2',dash:'dashv2',line:'line',fleet:'robots',inc:'incidents'}[t]}

/* ===== motion helpers (the Dev motion spec: expo out, quiet, only transform and opacity) ===== */
function reduced(){return matchMedia('(prefers-reduced-motion: reduce)').matches}
function rise(el){if(reduced()||!el.animate)return;el.animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'none'}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'})}
function fadeIn(el,ms){if(reduced()||!el.animate)return;el.animate([{opacity:0},{opacity:1}],{duration:ms||160,easing:'ease-out'})}
function syncAttrs(x,y){
 var i,a;for(i=0;i<y.attributes.length;i++){a=y.attributes[i];if(x.getAttribute(a.name)!==a.value)x.setAttribute(a.name,a.value)}
 for(i=x.attributes.length-1;i>=0;i--){a=x.attributes[i];if(!y.hasAttribute(a.name))x.removeAttribute(a.name)}
}
function morph(a,b){
 var ac=a.childNodes,bc=b.childNodes,i;
 for(i=0;i<bc.length;i++){
  var x=ac[i],y=bc[i];
  if(!x){a.appendChild(y.cloneNode(true));continue}
  if(x.nodeType!==y.nodeType||x.nodeName!==y.nodeName){a.replaceChild(y.cloneNode(true),x);continue}
  if(y.nodeType===3){if(x.nodeValue!==y.nodeValue)x.nodeValue=y.nodeValue;continue}
  if(y.nodeType===1){syncAttrs(x,y);morph(x,y)}
 }
 while(a.childNodes.length>bc.length)a.removeChild(a.lastChild);
}
function patch(box,html){if(box.__h===html)return false;box.__h=html;var t=document.createElement('template');t.innerHTML=html;morph(box,t.content);return true}

/* ===== avatars ===== */
var GLYPH={
 l1:'<path d="M8 34h15"/><path d="M15.5 34v-5"/><circle cx="15.5" cy="26.3" r="2.4"/><path d="M16.9 24.3 20.6 15"/><circle cx="21.4" cy="12.8" r="2.3"/><path d="M23.4 13.9 29.5 17.6"/><path d="M29.5 17.6v4M26.8 21.8h5.4"/><rect x="26.2" y="25" width="7" height="6.2" rx="1.4"/>',
 l2:'<rect x="5" y="31.5" width="30" height="4" rx="2"/><circle cx="10" cy="27" r="2.5"/><path d="M10 24.5V18l8-7 8 4.5V21"/><rect x="22.5" y="22" width="7" height="7" rx="1.3"/>',
 db:'<path d="M20 6.5v8.5"/><rect x="13.5" y="15" width="13" height="6" rx="2"/><path d="M16.5 21v9.5M20 21v11M23.5 21v9.5"/><path d="M10.5 27.5 7.5 25.8M29.5 27.5l3-1.7M10.5 32.5 7.5 33.7M29.5 32.5l3 1.2"/>',
 qc:'<circle cx="18" cy="18" r="9"/><path d="M25 25l8 8"/><path d="M13.5 18l3.2 3.2 6-6.4"/>',
 stop:'<path d="M14 6h12l8 8v12l-8 8H14l-8-8V14z"/><path d="M20 12.5a5 5 0 0 0-5 5V21l-2 3h14l-2-3v-3.5a5 5 0 0 0-5-5z"/><path d="M18 27.5a2 2 0 0 0 4 0"/>',
 log:'<rect x="9" y="7" width="22" height="26" rx="3"/><path d="M14.5 14h11M14.5 19.5h11M14.5 25h6"/>'
};
function avatar(shape,color,cls){
 if(GLYPH[shape])return '<svg class="av '+(cls||'')+'" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#E6E6EA"/><g fill="none" stroke="#2B2B30" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" transform="translate(20 20) scale(.8) translate(-20 -20)">'+GLYPH[shape]+'</g></svg>';
 if(typeof ICONS!=='undefined'&&ICONS[shape])return '<img class="av '+(cls||'')+'" src="'+ICONS[shape]+'" alt="" draggable="false">';
 var body,ey=0;
 switch(shape){
  case 'drop':body='<path d="M20 3.5C20 3.5 7.5 17 7.5 25.3a12.5 12.5 0 0 0 25 0C32.5 17 20 3.5 20 3.5Z" fill="'+color+'"/>';ey=9;break;
  case 'cloud':body='<g fill="'+color+'"><circle cx="13" cy="23" r="9.5"/><circle cx="27" cy="23" r="9.5"/><circle cx="20" cy="15.5" r="10"/><rect x="13" y="20" width="14" height="12" rx="5"/></g>';ey=3;break;
  case 'pill':body='<rect x="2" y="9" width="36" height="22" rx="11" fill="'+color+'"/>';ey=1;break;
  case 'hex':body='<path d="M20 3 34 11.2v16.6L20 36 6 27.8V11.2Z" fill="'+color+'" stroke="'+color+'" stroke-width="3" stroke-linejoin="round"/>';break;
  case 'squircle':body='<rect x="3" y="3" width="34" height="34" rx="11" fill="'+color+'"/>';break;
  default:body='<circle cx="20" cy="20" r="18" fill="'+color+'"/>';
 }
 var eyes='<g fill="#fff" transform="translate(0 '+ey+')"><rect x="21.4" y="9" width="3.4" height="8" rx="1.7" transform="rotate(-16 23.1 13)"/><rect x="27.2" y="10.4" width="3.8" height="9.6" rx="1.9" transform="rotate(-16 29.1 15.2)"/></g>';
 return '<svg class="av '+(cls||'')+'" viewBox="0 0 40 40" aria-hidden="true">'+body+eyes+'</svg>';
}

/* ===== chat engine ===== */
function money(){return S.role==='Owner'||S.role==='Manager'}
function pick(rec){if(money())return rec.html;return rec.p!=null?rec.p:String(rec.html||'').replace(/\$\s?\d[\d,]*(?:\.\d+)?(?:\/hr)?(?:\s?[kKmMbB])?/g,'an amount')}
function pushRec(id,rec){
 var th=TH[id];th.msgs.push(rec);
 if(rec.k!=='ts'){if(rec.short)th.time=rec.short}
 if(rec.k==='you')stopSpeech();
 if(id===S.cur){appendDom(rec,true);scrollThread();if(rec.k==='ai'&&!rec.quiet)speak(strip(pick(rec)||''))}else if(rec.k==='ai'&&!rec.quiet)th.unread++;
 renderSide();return rec;
}
function say(id,html,opt){
 opt=opt||{};var g0=GEN;
 QS[id]=(QS[id]||Promise.resolve()).catch(function(){}).then(function(){
  if(g0!==GEN)return DEAD;
  var th=TH[id];th.typing=true;if(id===S.cur)showTyping(true);
  return delay(opt.wait||600).then(function(){
   if(g0!==GEN)return DEAD;
   th.typing=false;if(id===S.cur)showTyping(false);
   return pushRec(id,{k:'ai',html:html,p:opt.plain,choices:opt.choices?prepChoices(opt.choices):null,short:nowShort(),quiet:opt.quiet,tag:opt.tag});
  });
 });
 return QS[id];
}
function stamp(id,text){pushRec(id,{k:'ts',html:text})}
function userSay(id,text){pushRec(id,{k:'you',text:text,short:nowShort()})}
function nowShort(){var d=new Date();var h=d.getHours()%12||12,m=d.getMinutes();return h+':'+(m<10?'0':'')+m+(d.getHours()>=12?' PM':' AM')}
function prepChoices(c){var L='ABCDEFG';return{title:c.title,sub:c.sub||'',picked:null,dismissed:false,options:c.options.map(function(o,i){return{k:L[i],label:o.label,fn:o.fn||function(){}}})}}
function showTyping(on){var old=$('typing');if(old)old.remove();if(on){var t=mk('div','typing');t.id='typing';t.innerHTML='<i></i><i></i><i></i>';$('thread').appendChild(t);scrollThread()}}
function scrollThread(){var t=$('thread');t.scrollTop=t.scrollHeight}
var CHECK='<svg class="ck" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.5 12 13 4.5"/></svg>';
function choiceEl(c){
 var w=mk('div','choice'),head=mk('div','ch');head.innerHTML='<b>'+c.title+'</b>'+(c.sub?'<small>'+c.sub+'</small>':'');
 var x=mk('button','x');x.type='button';x.setAttribute('aria-label','Dismiss');x.textContent='×';head.appendChild(x);w.appendChild(head);
 var btns=[];
 c.options.forEach(function(o,i){
  var b=mk('button','opt');b.type='button';b.innerHTML='<span class="k">'+o.k+'</span><span class="t">'+o.label+'</span>'+CHECK;
  b.addEventListener('click',function(){if(c.picked!=null)return;c.picked=i;sync();try{o.fn()}catch(e){c.picked=null;sync()}});
  w.appendChild(b);btns.push(b);
 });
 function sync(){btns.forEach(function(b,i){var p=c.picked===i;b.classList.toggle('picked',p);b.classList.toggle('gone',c.picked!=null&&!p);b.disabled=c.picked!=null});if(c.picked!=null)head.style.display='none'}
 x.addEventListener('click',function(){c.dismissed=true;w.remove()});sync();return w;
}
function appendDom(rec,live){
 var box=$('thread');
 if(rec.k==='ts'){var d=mk('div','ts');d.textContent=rec.html;var ty0=$('typing');if(ty0)box.insertBefore(d,ty0);else box.appendChild(d);if(live)rise(d);return}
 var r=mk('div','row '+(rec.k==='you'?'you':'ai')),b=mk('div','bub '+(rec.k==='you'?'you':'ai'));
 if(rec.k==='you')b.textContent=rec.text;else b.innerHTML=pick(rec);
 if(rec.tag){var t=mk('span','tg');t.textContent=rec.tag;b.insertBefore(t,b.firstChild)}
 if(rec.choices&&!rec.choices.dismissed)b.appendChild(choiceEl(rec.choices));
 r.appendChild(b);var ty1=$('typing');if(ty1)box.insertBefore(r,ty1);else box.appendChild(r);if(live)rise(r);
}
function setChips(id,list){TH[id].chips=list||[];if(id===S.cur)renderChips()}
function renderChips(){var c=$('chips');c.innerHTML='';TH[S.cur].chips.forEach(function(x){var b=mk('button','chip'+(x.on?' on':''));b.type='button';b.textContent=x.label;b.addEventListener('click',function(){x.fn(b)});c.appendChild(b)});scrollThread()}

/* ===== sidebar + header ===== */
var PDOT={};
function dotOf(th){
 var fd=feed(),live=cellLive(th);
 if(live)return live.c;
 if(th.id==='mara')return fd.ok?'green':fd.robots?'red':'gray';
 if(th.id==='stop')return (S.sim&&!S.sim.fixed)||(S.liveOpen&&Object.keys(S.liveOpen).length)?'red':(fd.ok?'green':(fd.robots?'amber':'gray'));
 if(th.id==='log')return fd.ok?'green':'gray';
 return '';
}
function lastText(th){for(var i=th.msgs.length-1;i>=0;i--){var r=th.msgs[i];if(r.k==='ts')continue;return r.k==='you'?'You: '+r.text:strip(pick(r)||'')}return ''}
function renderSide(){
 var h='',last=null,q=S.q.toLowerCase();
 Object.keys(TH).map(function(k){return TH[k]}).forEach(function(th){
  var off=!(th.hired||S.hired);
  if(th.g!==last){h+='<div class="glabel">'+th.g+'</div>';last=th.g}
  var dot=dotOf(th),chg=(PDOT[th.id]!==undefined&&PDOT[th.id]!==dot);PDOT[th.id]=dot;
  h+='<button type="button" class="emp'+(th.id===S.cur?' on':'')+(off?' off':'')+'" data-id="'+th.id+'"'+(th.id===S.cur?' aria-current="true"':'')+' aria-label="'+esc(th.name+(dot&&!off?({green:', working',amber:', waiting',red:', stopped',gray:', no live reading'}[dot]||''):'')+(th.unread?', '+th.unread+' unread':'')+(off?', added after setup':''))+'"><span class="avw">'+avatar(th.shape,th.color)+(dot&&!off?'<i aria-hidden="true" class="sdot '+dot+(chg?' pulse':'')+'"></i>':'')+(th.unread?'<b class="ubn" aria-hidden="true">'+th.unread+'</b>':'')+'</span>'+
  '<span class="eb"><span class="en"><span>'+esc(th.name)+(th.main?'<span class="star" title="Main bot">★</span>':'')+'</span><small>'+esc(th.time||'')+'</small></span><span class="ep">'+esc(off?'Added after setup':(lastText(th)||th.role))+'</span></span></button>';
 });
 var l=$('listin');if(patch(l,h)){fitRoster();moveMark()}if($('morepop').className==='open')renderMore();
}
function moveMark(){var on=$('listin').querySelector('.emp.on'),mk2=$('railmark');if(!on||on.offsetParent===null){mk2.style.opacity=0;return}var y=on.offsetTop+(on.offsetHeight-28)/2;mk2.style.opacity=1;mk2.style.transform='translateY('+y+'px)'}
/* roster never scrolls: what does not fit moves into a More popover (with the search box) */
function fitRoster(){
 var list=$('list'),inn=$('listin'),mb=$('morebtn'),kids=[].slice.call(inn.children),i;
 kids.forEach(function(k){k.classList.remove('ovh')});
 mb.className='emp more';
 if(matchMedia('(max-width:560px)').matches){S.hid=[];openMore(false);return}
 var avail=list.clientHeight-4;
 function bottom(k){return k.offsetTop+k.offsetHeight+2}
 var last=kids[kids.length-1];
 if(!last||bottom(last)<=avail){S.hid=[];if($('morepop').className==='open')openMore(false);return}
 var cut=kids.length,lim=avail-52;
 for(i=0;i<kids.length;i++){if(bottom(kids[i])>lim){cut=i;break}}
 if(cut>0&&kids[cut-1].classList.contains('glabel'))cut--;
 S.hid=[];
 for(i=cut;i<kids.length;i++){kids[i].classList.add('ovh');if(kids[i].classList.contains('emp'))S.hid.push(kids[i].getAttribute('data-id'))}
 mb.className='emp more show'+(S.hid.indexOf(S.cur)>=0?' on':'');
 var un=0;S.hid.forEach(function(id){un+=TH[id]?TH[id].unread:0});$('moren').textContent=S.hid.length+' more'+(un?', '+un+' unread':'');
}
function renderMore(){
 var q=(S.q||'').toLowerCase(),ids=q?Object.keys(TH):(S.hid||[]),h='';
 ids.forEach(function(id){
  var th=TH[id];if(!th)return;
  if(q&&(th.name+' '+th.role).toLowerCase().indexOf(q)<0)return;
  var off=!(th.hired||S.hired);
  h+='<button type="button" class="emp mrow'+(id===S.cur?' on':'')+(off?' off':'')+'" data-id="'+id+'"><span class="avw">'+avatar(th.shape,th.color)+'</span><span class="eb"><span class="en"><span>'+esc(th.name)+'</span></span><span class="ep">'+esc(off?'Added after setup':(lastText(th)||th.role))+'</span></span>'+(th.unread?'<b class="ubn" aria-hidden="true">'+th.unread+'</b>':'')+'</button>';
 });
 if(!h)h='<div class="nomatch">No match</div>';
 patch($('morelist'),h);
}
function openMore(on){
 var p=$('morepop'),b=$('morebtn');
 if(on){var sr=document.querySelector('#sidein .search');if(sr&&sr.parentNode!==p)p.insertBefore(sr,p.firstChild);renderMore();p.className='open';b.setAttribute('aria-expanded','true');var inp=$('q');if(inp)setTimeout(function(){inp.focus()},30)}
 else{p.className='';b.setAttribute('aria-expanded','false')}
}
function moreClick(e){var r=e.target.closest&&e.target.closest('.mrow');if(r){var id=r.getAttribute('data-id');openMore(false);openThread(TH[id].hired||S.hired?id:'mara')}}
function railClick(e){var b=e.target.closest&&e.target.closest('.emp');if(!b)return;var id=b.getAttribute('data-id');openThread(TH[id].hired||S.hired?id:'mara',e.detail===0)}

function openThread(id,kb){S.cur=id;TH[id].unread=0;var dr=$('rdrawer');dr.className='';dr.innerHTML='';renderAll();if(!kb)$('input').focus()}
function renderHead(){
 var th=TH[S.cur],live=cellLive(th);
 patch($('chead'),avatar(th.shape,th.color)+'<span class="cn">'+esc(th.name)+'</span><span class="dot '+(live?live.c:(dotOf(th)||'green'))+'"></span><span class="cr">'+esc(live?live.t:th.role)+'</span>');
 $('input').placeholder='Message '+th.name;
}
function renderThread(){var box=$('thread');box.innerHTML='';TH[S.cur].msgs.forEach(function(x){appendDom(x)});if(TH[S.cur].typing)showTyping(true);scrollThread()}
function renderAll(){renderSide();renderHead();renderThread();renderChips();renderRight()}

/* ===== live state for each cell (replay feed, plus a labelled demo stop) ===== */
function cellState(i){
 if(S.liveOpen&&S.liveOpen[i])return{c:'red',t:'Stopped',s:'stopped'};
 if(S.sim&&S.sim.r===i&&!S.sim.fixed)return{c:'red',t:'Stopped (demo stop)',s:'stopped'};
 var fd=feed();if(!fd.robots)return{c:'gray',t:'Connecting',s:'none'};
 var rb=fd.robots[i];if(!rb)return{c:'gray',t:'No data',s:'none'};
 if(!fd.ok)return{c:'gray',t:'Lost contact',s:'lost'};
 if(rb.state==='stopped')return{c:'red',t:'Stopped',s:'stopped'};
 if(rb.state==='waiting')return{c:'amber',t:'Waiting',s:'waiting'};
 if(rb.state==='working')return{c:'green',t:'Working',s:'working'};
 return{c:'gray',t:'Unknown',s:'none'};
}
function cellLive(th){return th.r!=null?cellState(th.r):null}

/* ===== right panel ===== */
var TABS=[['ov','Overview'],['line','Line'],['val','Line value'],['fleet','Fleet'],['inc','Incidents'],['built','Built for you']];
function renderRight(){
var TIPS={val:'What the line earns and where it is held back',ov:'The brief, cost and working time, and every robot right now',int:'What is connected and where alerts go',built:'Views Mara builds when you ask',line:'What each station is doing',fleet:'Robots ranked by working time',inc:'Every stall and error'};
 var h='';TABS.concat(cvTabs()).forEach(function(t){h+='<button type="button" role="tab" id="tab_'+t[0]+'" tabindex="'+(S.tab===t[0]?0:-1)+'" aria-selected="'+(S.tab===t[0])+'" class="tab'+(S.tab===t[0]?' on':'')+'" data-t="'+t[0]+'"'+(TIPS[t[0]]?' title="'+TIPS[t[0]]+'"':'')+'>'+esc(t[1])+'</button>'+(t[0]==='inc'?'<span class="tabsep" aria-hidden="true"></span>':'')});
 var rt=$('rtabs'),fa=document.activeElement,fid=fa&&fa.closest&&fa.closest('#rtabs')?fa.getAttribute('data-t'):null;rt.innerHTML=h;
 [].forEach.call(rt.querySelectorAll('.tab'),function(b){b.addEventListener('click',function(){setTab(b.getAttribute('data-t'))})});
 var ind=document.createElement('i');ind.id='tabind';rt.appendChild(ind);
 var act=rt.querySelector('.tab.on');
  if(act&&act.offsetWidth>0){try{act.scrollIntoView({inline:'nearest',block:'nearest'})}catch(e){}var ox=act.offsetLeft,ow=act.offsetWidth,pv=S._ind;
  if(pv&&!reduced()){ind.style.transition='none';ind.style.transform='translateX('+pv.x+'px)';ind.style.width=pv.w+'px';void ind.offsetWidth;ind.style.transition=''}
  ind.style.transform='translateX('+ox+'px)';ind.style.width=ow+'px';S._ind={x:ox,w:ow}}
 if(fid){var nb=rt.querySelector('[data-t="'+fid+'"]');if(nb)nb.focus()}
 var isSam=['ov','line','fleet','inc'].indexOf(S.tab)>=0,isBuilt=(S.tab==='built'||S.tab.indexOf('pin_')===0);
 if(S.tab.indexOf('pin_')===0){var pp=CV.pins.filter(function(p){return p.id===S.tab})[0];CV.tabSpec=pp?clone(pp.spec):null}else if(S.tab==='built')CV.tabSpec=null;
 $('livepanel').style.display=S.tab==='ov'?'block':'none';$('rbody').classList.toggle('ov',S.tab==='ov');try{sam().document.body.classList.toggle('ov',S.tab==='ov')}catch(e){}
 $('builtpanel').style.display=isBuilt?'block':'none';$('valpanel').style.display=S.tab==='val'?'block':'none';if(S.tab==='val')renderValue();
 $('framewrap').style.display=isSam?'block':'none';
 if(isSam&&window.__samFlush)window.__samFlush();
 $('framewrap').setAttribute('data-err',S.frameErr&&!feed().robots?'1':'');
 if(S.tab==='ov')renderLive();measureOv();
 if(isBuilt)renderBuilt();

 if(S._pt!==undefined&&S._pt!==S.tab)(isSam||fadeIn($('builtpanel'),160));S._pt=S.tab;
 renderRoutines();renderChip();
}

/* ===== voice: the browser's own speech features. Nothing is recorded or stored by Botlien. ===== */
var VOICE={on:false,listening:false,rec:null,sr:window.SpeechRecognition||window.webkitSpeechRecognition,t:0};
function speak(text){if(!VOICE.on||!window.speechSynthesis||!text)return;try{speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(text);u.lang='en-US';speechSynthesis.speak(u)}catch(e){}}
function stopSpeech(){try{if(window.speechSynthesis)speechSynthesis.cancel()}catch(e){}}
function voiceNote(t){var el=$('voicestat');el.textContent=t||'';clearTimeout(VOICE.t);if(t)VOICE.t=setTimeout(function(){el.textContent=''},6000)}
function setMic(on){VOICE.listening=on;var b=$('micBtn');b.classList.toggle('on',on);b.setAttribute('aria-pressed',on?'true':'false');b.setAttribute('aria-label',on?'Stop listening':'Talk to Mara');if(on)voiceNote('Listening. Speak, then pause.')}
function micToggle(){
 if(VOICE.listening){try{VOICE.rec&&VOICE.rec.stop()}catch(e){}return}
 if(!VOICE.sr){voiceNote('Voice input is not available in this browser. Type instead.');return}
 stopSpeech();
 try{var r=new VOICE.sr(),heard='';r.lang='en-US';r.interimResults=true;r.maxAlternatives=1;
  r.onresult=function(e){var t='';for(var i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;heard=t;$('input').value=t;$('composer').classList.toggle('has',!!t.trim())};
  r.onerror=function(e){setMic(false);var c=e&&e.error;voiceNote(c==='not-allowed'||c==='service-not-allowed'?'The microphone is blocked on this page. Allow it in the browser address bar, or type instead.':c==='no-speech'?'I did not hear anything. Try again.':c==='network'?'Voice needs an internet connection.':'Voice did not work here. Type instead.')};
  r.onend=function(){setMic(false);if(heard.trim()){var t=heard;heard='';submit(t)}};
  VOICE.rec=r;setMic(true);r.start()}
 catch(e){setMic(false);voiceNote('Voice did not start. Type instead.')}
}

/* ===== integrations: minimal list, honest status ===== */
var IC={
 robot:'<path d="M4 17h8"/><path d="M8 17v-4"/><circle cx="8" cy="11.5" r="1.6"/><path d="m9.2 10.2 4.3-3.4"/><path d="M13.5 6.8v3.2M12 10h3"/>',
 bell:'<path d="M10 3.5a4 4 0 0 0-4 4V10l-1.5 2.5h11L14 10V7.5a4 4 0 0 0-4-4z"/><path d="M8.5 15a1.5 1.5 0 0 0 3 0"/>',
 voice:'<rect x="8" y="2.5" width="4" height="8" rx="2"/><path d="M5.5 9a4.5 4.5 0 0 0 9 0M10 13.5v3"/>',
 text:'<path d="M4 5.5h12v7H9l-3.5 3v-3H4z"/>',
 phone:'<path d="M5.5 3.5h2.2l1 3-1.4 1a8 8 0 0 0 4.2 4.2l1-1.4 3 1v2.2a1.5 1.5 0 0 1-1.6 1.5A10.5 10.5 0 0 1 4 5.1 1.5 1.5 0 0 1 5.5 3.5z"/>',
 mail:'<rect x="3.5" y="5" width="13" height="10" rx="1.5"/><path d="m4 6 6 4.5L16 6"/>',
 slack:'<path d="M8 3.5 6.5 16.5M13.5 3.5 12 16.5M3.5 7.5h13M3.5 12.5h13"/>',
 hook:'<circle cx="6" cy="14" r="2"/><circle cx="14" cy="14" r="2"/><circle cx="10" cy="6" r="2"/><path d="m9 7.8-2.2 4.4M11 7.8l2.2 4.4M8 14h4"/>',
 people:'<circle cx="8" cy="7.5" r="2.5"/><path d="M3.5 16c.4-2.8 2.2-4.2 4.5-4.2s4.1 1.4 4.5 4.2M13.5 6.5a2.2 2.2 0 0 1 0 4.2M15.5 15c-.2-1.6-.9-2.7-2-3.3"/>'
};
function icon(k){return '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+IC[k]+'</svg>'}
var SECS=[['who','Who sees what','people'],['view','Display','robot'],['int','Integrations','hook'],['voice','Voice','voice'],['alert','Alert order','bell'],['demo','Demo tools','robot']];
function setRows(){
 var cfg=S.cfg,out=[];
 function state(st){var t={on:'On',demo:'Demo',ready:'Ready',planned:'Planned',later:'Later',no:'Not available'}[st];return '<span class="ist '+st+'"><i></i>'+t+'</span>'}
 function row(sec,ico,name,desc,st,ctl){out.push({sec:sec,t:(name+' '+desc).toLowerCase(),h:'<div class="irow"><span class="itile">'+icon(ico)+'</span><span class="itxt"><b>'+name+'</b><small>'+desc+'</small></span>'+(st?state(st):'')+(ctl||'')+'</div>'})}
 function head(sec,t){out.push({sec:sec,t:'',h:'<h3>'+t+'</h3>'})}
 function sw(key,on,label){return '<button type="button" class="sw" role="switch" aria-checked="'+(on?'true':'false')+'" aria-label="'+label+'" data-int="'+key+'"><i></i></button>'}
 function mara(name){return '<button type="button" class="ibtn" data-ask="'+name+'">Set up with Mara</button>'}
 function go(attr,val,label){return '<button type="button" class="ibtn" '+attr+'="'+val+'">'+label+'</button>'}
 row('who','people','View','Owners and managers see dollars. Everyone else sees times and causes.','','<span class="seg" role="group" aria-label="View as"><button type="button" data-set="role-Owner" aria-pressed="'+(S.role==='Owner')+'">Owner</button><button type="button" data-set="role-Technician" aria-pressed="'+(S.role!=='Owner')+'">Technician</button></span>');
 row('view','robot','Wall view','Big status for a TV on the floor. No dollars, no scrolling, readable from across the room.','',go('data-set','tv','Open'));
 head('int','Robot data');
 row('int','robot','Universal Robots','A read only data connection. Running, waiting and stopped for each arm.','demo');
 row('int','robot','Other robots and machines','Conveyors, presses and sealers, to explain why a robot waits.','later',mara('other robots and machines'));
 head('int','Where alerts go');
 row('int','bell','This app','Alerts and answers appear in the chat. Always on.','on');
 row('int','text','Text message','A text after a stop lasts as long as you chose.','planned',mara('text messages'));
 row('int','phone','Phone call','A call for serious stops.','planned',mara('phone calls'));
 row('int','mail','Email','Shift summaries and wrap ups.','planned',mara('email'));
 row('int','slack','Slack','Alerts in a channel.','planned',mara('Slack'));
 row('int','hook','Webhook','Send alerts to your own systems.','planned',mara('a webhook'));
 row('voice','voice','Read replies aloud','Mara speaks her replies. Uses your browser\u2019s speech service. Botlien does not record audio.',VOICE.sr||window.speechSynthesis?(VOICE.on?'on':'ready'):'no',sw('voice',VOICE.on,'Read replies aloud')+go('data-int','test','Test'));
 row('voice','voice','Talk to Mara','Use the microphone button in the message box and speak. It works on a normal page, but your browser may block the microphone in a preview.',VOICE.sr?'ready':'no');
 row('alert','people','Who hears first',(cfg.first==='You'?'You first':'Dana first')+', then '+(cfg.backup==='You'?'you':'Dana')+' after about 10 minutes. Alerts start after a stop of '+cfg.delay+' minutes.','demo',go('data-set','setup','Change with Mara'));
 row('demo','bell','Simulate a stop on Loader 2','Shows the alert, the backup and the wrap up, one second for each minute.','',go('data-demo','stop','Run'));
 row('demo','voice','Ask anything','Mara answers from the dashboard numbers.','',go('data-demo','ask','Open'));
 row('demo','robot','Open the line','Which cell is holding the others up.','',go('data-demo','dash','Open'));
 row('demo','hook','Start over','Back to the team as it opens.','',go('data-set','reset','Reset'));
 return out;
}
function renderSettings(){
 var q=($('ssearch').value||'').trim().toLowerCase(),rows=setRows(),sec=S.setSec||'who',nav='',body='';
 SECS.forEach(function(s){nav+='<button type="button" class="snav'+(!q&&s[0]===sec?' on':'')+'" data-sec="'+s[0]+'">'+icon(s[2])+'<span>'+s[1]+'</span></button>'});
 patch($('snavlist'),nav);
 if(q){var m=rows.filter(function(r){return r.t&&r.t.indexOf(q)>=0});body='<h2>Search</h2>'+(m.length?m.map(function(r){return r.h}).join(''):'<p class="sintro">Nothing matches.</p>')}
 else{var nm=SECS.filter(function(s){return s[0]===sec})[0][1];body='<h2>'+nm+'</h2>'+(sec==='int'?'<p class="sintro">Everything here is meant to run itself. Ask Mara and she sets it up. You do not configure anything.</p>':'')+rows.filter(function(r){return r.sec===sec}).map(function(r){return r.h}).join('')}
 patch($('sbody'),body);
}

/* appearance: auto follows the device, light and dark are explicit */
function applyTheme(){
 var dk=false;
 document.documentElement.classList.toggle('dk',dk);
 try{var d=$('samframe').contentDocument;if(d)d.documentElement.classList.toggle('dk',dk)}catch(e){}
}
function setTheme(t){S.theme=t;try{localStorage.setItem('bl_theme',t)}catch(e){}applyTheme()}
/* wall view: a quiet TV screen, status words and big numbers, no dollars, no scrolling */
var TVT=0;
function renderTV(){
 var fd=feed(),h='';
 R.forEach(function(r,i){
  var st=cellState(i),p=fd.ok&&fd.robots&&fd.robots[i]?fd.robots[i].workingPct10:null;
  var word=st.s==='stopped'?'Stopped':st.s==='waiting'?'Waiting':st.s==='working'?'Working':st.t;
  h+='<div class="tvt '+st.c+'"><div class="tvn">'+esc(r.name)+'</div><div class="tvs"><i></i>'+esc(word)+'</div><div class="tvp">'+(p==null?'None':Math.round(p)+'%')+'</div><div class="tvl">working in the last 10 minutes</div><div class="tvb"><i style="width:'+(p==null?0:Math.max(2,Math.min(100,p)))+'%"></i></div></div>';
 });
 patch($('tvgrid'),h);
 var tot=INC.reduce(function(a,x){return a+x.min},0);
 $('tvfoot').textContent=INC.length+' incidents and '+tot+' minutes down in the sample period. Esc to close.';
}
function openTV(){var m=$('tv');m.hidden=false;renderTV();clearInterval(TVT);TVT=setInterval(renderTV,2000);setTimeout(function(){$('tvx').focus()},30);try{if(m.requestFullscreen&&!matchMedia('(pointer:coarse)').matches)m.requestFullscreen().catch(function(){})}catch(e){}}
function closeTV(){var m=$('tv');if(m.hidden)return;m.hidden=true;clearInterval(TVT);try{if(document.fullscreenElement)document.exitFullscreen()}catch(e){}}
function openSettings(sec){
 var m=$('smodal');S.setSec=sec||S.setSec||'who';$('ssearch').value='';renderSettings();
 S._sfocus=document.activeElement;m.hidden=false;requestAnimationFrame(function(){m.classList.add('open')});setTimeout(function(){$('sclose').focus()},40);
}
function closeSettings(){
 var m=$('smodal');if(m.hidden)return;m.classList.remove('open');
 setTimeout(function(){m.hidden=true},reduced()?0:180);
 var f=S._sfocus;if(f&&f.focus)try{f.focus()}catch(e){}
}
function smodalClick(e){
 var t=e.target,q=function(s){return t.closest&&t.closest(s)};
 if(t.id==='smodal'||q('#sclose')){closeSettings();return}
 var n=q('[data-sec]');if(n){S.setSec=n.getAttribute('data-sec');$('ssearch').value='';renderSettings();return}
 var a=q('[data-ask]');
 if(a){var nm=a.getAttribute('data-ask');closeSettings();openThread('mara');submit('Set up '+nm);return}
 var d=q('[data-demo]');
 if(d){var dk=d.getAttribute('data-demo');closeSettings();demo(dk);return}
 var s=q('[data-set]');
 if(s){var k=s.getAttribute('data-set');
  if(k.indexOf('role-')===0){setRole(k.slice(5));renderSettings();return}
  if(k.indexOf('theme-')===0){setTheme(k.slice(6));renderSettings();return}
  if(k==='tv'){closeSettings();openTV();return}
  if(k==='setup'){closeSettings();openThread('mara');submit('Start over');return}
  if(k==='reset'){closeSettings();demo('reset');return}
  return}
 var c=q('[data-int]');
 if(c){var ik=c.getAttribute('data-int');
  if(ik==='voice'){VOICE.on=!VOICE.on;if(!VOICE.on)stopSpeech();else speak('Voice replies are on.');syncVoice()}
  else if(ik==='test'){var was=VOICE.on;VOICE.on=true;speak('This is Mara. I read data, and I never control a robot.');VOICE.on=was;if(!window.speechSynthesis)voiceNote('Reading aloud is not available in this browser.')}
  renderSettings()}
}
function trapTab(e){
 var m=$('smodal');if(m.hidden||e.key!=='Tab')return;
 var f=[].slice.call(m.querySelectorAll('button,input,[tabindex="0"]')).filter(function(x){return !x.disabled&&x.offsetParent!==null});if(!f.length)return;
 var first=f[0],last=f[f.length-1];
 if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
}
function measureOv(){try{if(['ov','line','fleet','inc'].indexOf(S.tab)<0)return;var dd=sam().document,el=dd.querySelector(S.tab==='ov'?'[data-dash-cols]':'[data-card]');if(!el)return;var r=el.getBoundingClientRect(),h=r.bottom+(S.tab==='ov'?28:40),p=el.parentElement;while(p){h+=p.scrollTop||0;p=p.parentElement}h=Math.min(Math.ceil(h),8000);if(h>200&&Math.abs(h-(S._ovh||0))>4){S._ovh=h;$('framewrap').style.setProperty('--ovh',h+'px')}}catch(e){}}
/* switching tabs: keep the dashboard frame invisible while it renders, trims and measures, then fade it in once, so nothing jumps */
var REVT=0;
function revealFrame(){
 var fw=$('framewrap');clearTimeout(REVT);
 try{enhance(sam().document)}catch(e){}
 measureOv();
 requestAnimationFrame(function(){requestAnimationFrame(function(){fw.style.transition='opacity 150ms var(--ease-out)';fw.style.opacity='1'})});
}
function setTab(t){
 if(t==='dash'||t==='live')t='ov';
 var was=S.tab,isSamT=['ov','line','fleet','inc'].indexOf(t)>=0,fw=$('framewrap'),hide=isSamT&&was!==t&&!reduced();
 S.tab=t;S._ovh=0;
 if(hide){fw.style.transition='none';fw.style.opacity='0'}
 var v=tabView(t);if(v){samGo(v);if(window.__depillDoc)depillSoon(window.__depillDoc,900)}
 renderRight();
 if(hide){setTimeout(revealFrame,110);REVT=setTimeout(function(){fw.style.transition='';fw.style.opacity='1'},900)}
 else{fw.style.opacity='1'}
 setTimeout(measureOv,350);
}
function renderChip(){
 var fd=feed(),c=$('feedchip');
 if(S.frameErr&&!fd.robots){c.className='fchip bad';c.textContent='The dashboard did not load. Reload the page.';return}
 if(fd.robots&&!fd.ok){c.className='fchip bad';c.textContent='Not live, lost contact with the feed';return}
 c.className='fchip';c.textContent='';
}


/* message box: auto growing text, plus menu of quick questions, voice toggle state */
function growInput(){var i=$('input');i.style.height='auto';i.style.height=Math.min(i.scrollHeight,120)+'px'}
function syncVoice(){var b=$('voiceBtn');if(!b)return;b.setAttribute('aria-pressed',VOICE.on?'true':'false');b.classList.toggle('on',!!VOICE.on)}
function plusMenu(open){
 var m=$('plusMenu'),b=$('plusBtn');
 if(open){
  var qs=['What changed overnight?','Why is Loader 2 so low?','Which robot works the least?','What does the line earn?','If I made 50 more an hour','If the mills were 10% faster','What did the stops cost in output?','Show me a stop'];
  m.innerHTML='<div class="pmh">Quick questions</div>'+qs.map(function(q){return '<button type="button" role="menuitem" data-pq="'+q.replace('Show me a stop','simulate a stop')+'">'+q+'</button>'}).join('');
  m.hidden=false;b.setAttribute('aria-expanded','true');var f=m.querySelector('button');if(f)f.focus();
 }else{m.hidden=true;b.setAttribute('aria-expanded','false')}
}
/* ===== Line value: what the line earns, where it is held back, what full capacity could add ===== */
function lineValue(){
 var fd=feed(),ln=fd.line,o=ln&&ln.output;if(!ln||!o||!ln.buffers)return null;
 var now=o.perHourNow,norm=o.perHourNormal,v=S.vpp==null?10:S.vpp;
 var held=null,B=ln.buffers;
 for(var i=0;i<B.length;i++){if(B[i].level>=B[i].cap){held=B[i].target.map(function(x){return x.replace(/ \(non-UR\)/,'')});break}}
 var heldName=held?(held.length>1?held[0].replace(/ [AB]$/,'')+'s':held[0]):(ln.bottleneck||'line');
 if(held&&held.length>1&&/CNC mill/.test(held[0]))heldName='CNC mills';
 return{now:now,norm:norm,v:v,gap:Math.max(0,norm-now),pct:o.pctOfNormal,held:heldName,fromQueue:!!held,heldList:held,buffers:B,robots:ln.robots}
}
function bufWord(b){return b.level>=b.cap?'backing up':b.level===0?'empty':'normal'}
function vppOwn(){return !!S.vppOwn}
function vBasis(v){return vppOwn()?'at '+usd0(v)+' each':'at an example '+usd0(v)+' each'}
/* horizontal bars used in the Line value tab and inside Mara's answers */
function bars(rows,chat){
 return '<div class="'+(chat?'cbars':'vbars')+'">'+rows.map(function(r){
  var w=Math.max(0,Math.min(100,r.v/r.max*100)),g=r.ghost!=null?Math.max(0,Math.min(100,r.ghost/r.max*100)-w):0;
  return '<div class="br"><span class="bl">'+r.l+'</span><span class="bt"><i class="bf '+(r.c||'')+'" style="width:'+w+'%"></i>'+(g>0?'<i class="bg" style="width:'+g+'%"></i>':'')+'</span><span class="bv">'+r.t+'</span></div>'}).join('')+'</div>';
}
function qbar(b){var s='';for(var i=0;i<b.cap;i++)s+='<i class="'+(i<b.level?'on':'')+'"></i>';return '<span class="qs q-'+({'backing up':'full','empty':'zero','normal':'mid'})[bufWord(b)]+'">'+s+'</span>'}
function stageRows(lv){
 var rob=lv.robots||[],out=[],roles=['Loader 1','Loader 2','Deburr','Inspection'];
 roles.forEach(function(role,k){var r=null;for(var i=0;i<rob.length;i++)if(rob[i].role===role)r=rob[i];var p=r?Math.round(r.workingPct10):0;out.push({l:role,v:p,max:100,t:p+'%',c:p>=35?'green':p>=15?'amber':'red'})});
 return out;
}
function outRows(lv,m,extra){
 var rows=[{l:'Now',v:lv.now,max:Math.max(lv.norm,extra||0,lv.now),ghost:extra?null:lv.norm,t:lv.now+(m?' · '+usd0(lv.now*lv.v):''),c:'dark'}];
 if(extra)rows.push({l:'With change',v:extra,max:Math.max(lv.norm,extra),t:Math.round(extra)+(m?' · '+usd0(extra*lv.v):''),c:'green'});
 rows.push({l:'Normal',v:lv.norm,max:Math.max(lv.norm,extra||0,lv.now),t:lv.norm+(m?' · '+usd0(lv.norm*lv.v):''),c:'light'});
 return rows;
}
function renderValue(){
 var box=$('valpanel');
 if(!box.getAttribute('data-init')){
  box.setAttribute('data-init','1');
  box.innerHTML='<div class="vhead"><h2>Line value</h2><p class="vsub">Per hour, from the recorded sample.</p></div><label class="vin" id="vinwrap" for="vppin"><span>Value of one part</span><span class="vfield"><b>$</b><input id="vppin" type="number" inputmode="decimal" min="0" step="1" value="10"></span><small id="vnote">Example. Enter yours.</small></label><div id="vout"></div>';
  $('vppin').addEventListener('input',function(){var n=parseFloat(this.value);S.vpp=isFinite(n)&&n>=0?n:0;S.vppOwn=true;$('vnote').textContent='Your value';renderValue()});
  box.addEventListener('click',function(e){var q=e.target.closest&&e.target.closest('[data-q]');if(!q)return;$('app').classList.remove('rshow');submit(q.getAttribute('data-q'))});
 }
 $('vinwrap').style.display=money()?'':'none';
 var lv=lineValue(),h='',m=money();
 if(!lv){patch($('vout'),'<p class="vsub">Connecting to the feed.</p>');return}
 h+=m?'<div class="vhero">'+usd0(lv.now*lv.v)+'<small>/hr</small></div><p class="vline">'+lv.now+' parts an hour</p>':'<div class="vhero">'+lv.now+'<small> parts an hour</small></div><p class="vline">'+lv.pct+'% of normal</p>';
 h+=bars(outRows(lv,m));
 h+='<p class="vgap">Up to <b>+'+lv.gap+' parts an hour'+(m?', +'+usd0(lv.gap*lv.v)+'/hr':'')+'</b> at normal. An upper bound.</p>';
 h+='<div class="vsec">Working share</div>'+bars(stageRows(lv));
 var B=lv.buffers,names=['Loaders to mills','Mills to Deburr','Deburr to Inspection'];
 h+='<div class="vsec">Parts waiting</div><div class="vqs">';
 for(var i=0;i<B.length;i++)h+='<div class="vqr"><span>'+names[i]+'</span>'+qbar(B[i])+'<em>'+bufWord(B[i])+'</em></div>';
 h+='</div>';
 h+=lv.fromQueue?'<p class="vheldl"><b>Held back at the '+lv.held+'.</b> <small>Inferred from the queue.</small></p>':'<p class="vheldl"><b>No clear holdup right now.</b> <small>'+lv.held+' is busiest.</small></p>';
 if(m){var share=(TOTAL_CPH/(lv.now*lv.v)*100);h+='<p class="vfoot">Robots cost '+usd(TOTAL_CPH)+'/hr, '+(share<0.1?'under 0.1':share.toFixed(1))+'% of line output.</p>'}
 h+='<div class="vask"><small>Ask Mara</small>'+['If I made 50 more an hour','If the mills were 10% faster','What did the stops cost in output?','Where is the line held back?'].map(function(q){return '<button type="button" data-q="'+q+'">'+q+'</button>'}).join('')+'</div>';
 patch($('vout'),h);
}
function renderLive(){
 var fd=feed(),box=$('livepanel'),h='',ago=fd.lag!=null?(fd.lag<90?Math.round(fd.lag)+' s ago':Math.round(fd.lag/60)+' min ago'):'a while ago';
 var line=fd.line&&fd.line.output;
 h+='<div class="lh"><h3>Robots right now</h3><p>'+(fd.ok?'':fd.robots?'<b>I lost contact with the feed.</b> I will not show numbers as live until it is back.':'Connecting to the feed.')+'</p></div>';
 h+='<div class="cells">';
 R.forEach(function(r,i){
  var st=cellState(i),rb=fd.robots&&fd.robots[i],pct=rb?rb.workingPct10:null;
  h+='<button type="button" class="cc" data-id="'+r.id+'"><div class="ct">'+avatar(r.shape,r.color,'sm')+'<span><b>'+r.name+'</b><small>'+r.model+'</small></span><span class="pill '+st.c+'">'+st.t+'</span></div>'+
   '<div class="bar"><i style="width:'+(pct!=null&&fd.ok?Math.min(100,pct):0)+'%"></i></div><div class="cm"><span>'+(pct!=null?(fd.ok?f1(pct)+'% working, last 10 min':'Last reading '+ago+', not live'):'No reading')+'</span><span>'+(money()?usd(r.cph)+'/hr to own and run':'')+'</span></div></button>';
 });
 h+='</div>';
 h+='<div class="strip"><b>The line</b> Loader 1 and 2, then CNC mills A and B (machines, not robots), then Deburr, then Inspection.'+(line?' Making about '+Math.round(line.perHourNow)+' parts an hour against about '+Math.round(line.perHourNormal)+' normally.':' Making about 262 parts an hour against about 275 normally (sample).')+' <a href="#" data-go="line">Open the line</a></div>';
 if(S.sim&&!S.sim.fixed)h+='<div class="strip alert"><b>Demo stop on '+R[S.sim.r].name+'.</b> This stop is injected by the demo and is not in the recording, so the Line page will not show it.</div>';
 patch(box,h);
}
function liveClick(e){var c=e.target.closest&&e.target.closest('.cc');if(c){var cid=c.getAttribute('data-id');openThread(TH[cid].hired||S.hired?cid:'mara');return}var a=e.target.closest&&e.target.closest('[data-go]');if(a){e.preventDefault();setTab('line')}}


/* ===== transitions in the feed (contact loss, recovered) ===== */
var prevOk=null;
function poll(){
 var fd=feed();
 if(fd.robots){
  if(prevOk===null)prevOk=fd.ok;
  else if(fd.ok!==prevOk){S._pn=(S._pn||0)+1;if(S._pn>=2){S._pn=0;prevOk=fd.ok;
   if(S.hired){
    if(!fd.ok){S.lostSaid=1;say('stop','<b>I lost contact with the feed.</b> I will not show numbers as live until it is back. Numbers resume when the feed is back.',{wait:200,tag:'Contact'})}
    else if(S.lostSaid){S.lostSaid=0;say('stop','Contact is back. Numbers resume.',{wait:200,tag:'Contact'})}
   }}}
  else S._pn=0;
 }
 [renderChip,function(){if(S.tab==='ov')renderLive();if(S.tab==='val')renderValue();measureOv();},renderSide,renderHead,function(){
  if(window.__F&&S.hired){try{var vv=sam().eval('S.view');if(vv&&!okViews()[vv])samGo('dashv2')}catch(e){}}}].forEach(function(f){try{f()}catch(e){}});
}

/* ===== setup by conversation (Mara) ===== */
function resetAll(){
 S.setup={step:0,on:true};S.hired=false;S.sim=null;S.snoozed=false;S.cur='mara';S.tab='ov';S.role=S.role||'Owner';S.lostSaid=0;S._pn=0;prevOk=null;S.frameErr=S.frameErr||0;
 S.cfg={delay:5,first:'You',backup:'Dana, maintenance lead',managers:'Owner and Dana',escalate:true};
 CV.live=null;CV.hist=[];CV.hi=-1;CV.pins=[];CV.tabSpec=null;CV.hOpen=false;S.rtOpen=false;S.q='';S._ind=null;S._pt=undefined;PDOT={};DRAWN={};
 initThreads();setRole(S.role,true);$('q').value='';openMore(false);var dr0=$('rdrawer');dr0.className='';dr0.innerHTML='';renderAll();
}
function startReady(){
 resetAll();initRoutines();S.setup.on=false;S.hired=true;seed();renderAll();
 say('mara','Hi, I am Mara. Your team is ready. I only read data, I never control a robot.',{wait:450}).then(function(){
  if(HOSTED){say('mara','When a robot stops, the Stop Watcher shows it within seconds, with the cause, the robot time it cost and what it held up.',{wait:300});setChips('mara',askChips());return}
  whenFeed(firstHour)});
}
function startSetup(){
 resetAll();initRoutines();
 say('mara','Hi, I am Mara, your line coworker. I will watch your robots and message you when something needs you. I only read data, I never control a robot.',{wait:450});
 say('mara','In this demo I use the sample line: four arms, Loader 1 and Loader 2 (UR10e), Deburr (UR5e) and Inspection (UR3e), with two CNC mills between them. In a real setup I would read this from your connection. Is that right?',{choices:{title:'Is this your line?',options:[{label:'Yes, that is my line',fn:function(){S.setup.step=1;askFirst()}},{label:'Something is missing',fn:function(){say('mara','Tell me what to add and I will ask the shop to confirm it. In this demo I will carry on with these four.',{wait:400}).then(askFirst)}}]}});
}
function askFirst(){
 say('mara','When a cell stops, who should I tell first?',{choices:{title:'First person to alert',options:[
  {label:'Me, the owner',fn:function(){S.cfg.first='You';askBackup()}},
  {label:'Dana, the maintenance lead',fn:function(){S.cfg.first='Dana, maintenance lead';S.cfg.backup='You';askBackup()}}]}});
}
function askBackup(){
 say('mara',(S.cfg.first==='You'?'If you do not answer':'If Dana does not answer')+' in about 10 minutes, I send it to '+(S.cfg.backup==='You'?'you':'Dana')+'. Do you want that backup?',{choices:{title:'Backup',options:[
  {label:'Yes, use the backup',fn:function(){S.cfg.escalate=true;askDelay()}},
  {label:'No backup',fn:function(){S.cfg.escalate=false;askDelay()}}]}});
}
function askDelay(){
 say('mara','How long should a robot stay stopped before I tell you? The demo default is 5 minutes.',{choices:{title:'Alert after a stop lasts',options:[
  {label:'2 minutes',fn:function(){S.cfg.delay=2;askMoney()}},{label:'5 minutes (recommended)',fn:function(){S.cfg.delay=5;askMoney()}},{label:'10 minutes',fn:function(){S.cfg.delay=10;askMoney()}}]}});
}
function askMoney(){
 say('mara','Who should see dollar figures? Technicians get the same alert without the money.',{choices:{title:'Who sees money',options:[
  {label:'Owner and Dana',fn:function(){S.cfg.managers='Owner and Dana';confirmCard()}},{label:'Only the owner',fn:function(){S.cfg.managers='Only the owner';confirmCard()}},{label:'Everyone who gets alerts',fn:function(){S.cfg.managers='Everyone who gets alerts';confirmCard()}}]}});
}
function confirmCard(){
 var c=S.cfg,html='Here is what I will do.<div class="kvc"><span>Watch</span><span>Loader 1, Loader 2, Deburr, Inspection, and how they hold up the line</span>'+
 '<span>Tell first</span><span>'+(c.first==='You'?'You, the owner':c.first)+'</span><span>Backup</span><span>'+(c.escalate?(c.backup==='You'?'You':c.backup)+' after about 10 minutes':'None')+'</span>'+
 '<span>Alert after</span><span>a stop of '+c.delay+' minutes</span><span>Dollars shown to</span><span>'+c.managers+'</span><span>It is done when</span><span>the robot runs again</span><span>Access</span><span>Read only. I never control a robot.</span></div>';
 say('mara',html,{choices:{title:'Look right?',options:[{label:'Confirm',fn:finishSetup},{label:'Start over',fn:function(){startSetup()}}]}});
}
function finishSetup(){
 S.setup.on=false;S.hired=true;initRoutines();seed();renderAll();
 say('mara','Done. I hired a watcher for each of your four cells, a Stop Watcher and a Logbook Keeper. They are in your list on the left, and they are reading the replay now.',{wait:500}).then(function(){whenFeed(firstHour)});
}
function firstHour(){
 var fd=feed(),rows='';
 R.forEach(function(r,i){var st=cellState(i);rows+='<span>'+r.name+'</span><span><i class="sd '+st.c+'"></i>'+st.t+(fd.ok&&fd.robots&&fd.robots[i]?', '+f1(fd.robots[i].workingPct10)+'% working':'')+'</span>'});
 say('mara','<div class="kvc">'+rows+'</div>',{wait:700,tag:'Right now, last 10 min'});
 var tot=INC.reduce(function(a,x){return a+x.min},0);
 say('mara','<b>8 incidents</b> and <b>'+tot+' minutes down</b> in the sample period (Aug 4 to Sep 3). Most were error C153, likely the mills backed up behind the robot.',{wait:700,tag:'History'});
 say('mara','A test alert is waiting in Stop Watcher. In this demo, alerts stay in the app and are not sent to phones.',{wait:600}).then(function(){testAlert();setChips('mara',window.__ONB?[{label:'Show me a stop',fn:function(){submit('simulate a stop')}}].concat(askChips().slice(0,3)):askChips())});
}
function seed(){
 if(SEEDED)return;SEEDED=true;
 R.forEach(function(r,i){
  var id=r.id,mine=INC.filter(function(x){return x.r===i}),mins=mine.reduce(function(a,x){return a+x.min},0);
  stamp(id,'Setup');
  pushRec(id,{k:'ai',quiet:true,short:'Today',html:'Hi, I am the '+r.name+' Watcher. I watch the '+r.model+' and tell the Stop Watcher when it stops. I only read data.'});
  if(!HOSTED)pushRec(id,{k:'ai',quiet:true,short:'Today',html:mine.length?'This sample period: <b>'+mine.length+' incident'+(mine.length>1?'s':'')+', '+mins+' minutes down</b>. The most recent: '+mine[mine.length-1].d+', '+mine[mine.length-1].t+', '+mine[mine.length-1].min+' minutes, '+mine[mine.length-1].err+'.':'No incidents this sample period.'});
 });
 stamp('stop','Setup');
 pushRec('stop',{k:'ai',quiet:true,short:'Today',html:'Hi, I am the Stop Watcher. When a cell stays stopped past your limit I tell the right person, with what it is holding up. If nobody answers, I use the backup.'});
 stamp('log','Setup');
 var rows='';INC.forEach(function(x){rows+='<tr><td>'+x.d+' '+x.t+'</td><td>'+R[x.r].name+'</td><td>'+x.min+' min</td><td>'+esc(x.err)+'</td></tr>'});
 if(HOSTED){pushRec('log',{k:'ai',quiet:true,short:'Today',html:'I keep the record so nobody has to type it. Every stop that ends lands here, with what fixed it.'});return}
 pushRec('log',{k:'ai',quiet:true,short:'Today',html:'I keep the record so nobody has to type it. Logged for the sample period (Aug 4 to Sep 3):<table class="lg"><tr><th>When</th><th>Robot</th><th>Down</th><th>It reported</th></tr>'+rows+'</table>'});
}

/* ===== alerts, escalation, wrap up (demo clock: 1 second = 1 minute) ===== */
var TICK=function(){return FAST?5:1000};
function after(mins,fn){TIMERS.push(setTimeout(fn,mins*TICK()))}
function who(){return S.cfg.first==='You'?'you':'Dana'}
function stopMsgs(r,mins){
 var rb=R[r],cost=rb.cph*mins/60,parts=Math.round(rb.ppm*mins);
 return{
  m:'<b>'+rb.name+' has been stopped '+mins+' minutes.</b> No error is shown in this demo. In the sample, most incidents were error C153, and the dashboard\u2019s likely cause for that is the mills backed up behind the robot. That is about <b>'+usd(cost)+'</b> of robot time and about <b>'+parts+' parts</b> not made so far.',
  p:'<b>'+rb.name+' has been stopped '+mins+' minutes.</b> No error is shown in this demo. In the sample, most stops were error C153, the mills backed up behind the robot. About '+parts+' parts not made so far.'
 };
}
/* who did what during a stop: Mara's steps and a person's steps, in demo minutes */
function sl(who,text){if(!S.sim)return;(S.sim.log=S.sim.log||[]).push({m:Math.max(0,Math.round((Date.now()-S.sim.t0)/TICK())),who:who,text:text})}
function handledCard(sim){
 var L=sim.log||[],mara=L.filter(function(x){return x.who==='Mara'}).length,ppl=L.length-mara;
 var rows=L.map(function(x){return '<span>'+x.m+' min</span><span><b>'+esc(x.who)+'</b> '+esc(x.text.charAt(0).toLowerCase()+x.text.slice(1))+'</span>'}).join('');
 var ackT=sim.ackAt!=null?sim.ackAt+' min':'no one answered';
 return '<b>How this stop was handled</b><div class="kvc hdl">'+rows+'</div>Mara did '+mara+' steps. A person did '+ppl+'.<br>Minutes from stop to someone answering: <b>'+ackT+'</b> (demo minutes).<br><span class="mut">Simulated demo stop, not measured on a real line. Tap what fixed it above and the cause is logged.</span>';
}
function simStop(r){
 if(!S.hired){say('mara','Let me finish setup first, then I can show you a stop.',{wait:300});return}
 if(S.sim&&!S.sim.fixed){openThread('stop');say('stop','A demo stop is already running.',{wait:200});return}
 var d=S.cfg.delay;S.sim={r:r,fixed:false,acked:false,t0:Date.now(),d:d,log:[],ackAt:null};var sim=S.sim;sl('Mara','Saw '+R[r].name+' stop. Waiting '+d+' minutes before bothering anyone.');
 openThread('stop');stamp('stop','Demo stop, 1 second = 1 minute');
 say('stop','<b>'+R[r].name+' just stopped.</b> I will wait '+d+' minutes before bothering anyone, as you chose. Demo stop: this is injected and not in the recording.',{wait:300,tag:'Demo'});
 renderRight();renderSide();
 after(d,function(){
  if(!S.sim||S.sim.fixed)return;
  var m=stopMsgs(r,d);sl('Mara','Told '+who()+' what stopped, the likely cause and what it is costing');
  say('stop',m.m,{plain:m.p,tag:'Demo, to '+who(),wait:200,choices:{title:'What do you want to do?',sub:'I will not change anything on the robot.',options:[
   {label:'I am on it',fn:function(){ack('on',sim)}},{label:'Look into it',fn:function(){ack('look',sim)}},{label:'Snooze 30 minutes',fn:function(){ack('snooze',sim)}}]}});
  if(S.cfg.escalate)after(10,function(){
   if(!S.sim||S.sim.fixed||S.sim.acked)return;
   var m2=stopMsgs(r,d+10),bk=S.cfg.backup==='You'?'you':'Dana';sl('Mara','Heard nothing in 10 minutes, then told '+bk+' as the backup');
   say('stop','No answer from '+who()+' in 10 minutes, so in a real run it goes to '+bk+'.<br><br>'+m2.m,{plain:'No answer from '+who()+' in 10 minutes, so in a real run it goes to '+bk+'.<br><br>'+m2.p,tag:'Demo, backup: '+bk,wait:200});
   say('stop','Phone calls are not part of this MVP.',{quiet:true,wait:200});
  });
  after(22,function(){if(S.sim&&!S.sim.fixed)fix()});
 });
}
function ack(kind,sim){
 if(!S.sim||sim!==S.sim||sim.fixed){say('stop','That stop is already closed.',{wait:200});return}S.sim.acked=true;if(S.sim.ackAt==null)S.sim.ackAt=Math.max(0,Math.round((Date.now()-S.sim.t0)/TICK()));sl(who()==='you'?'You':'Dana',kind==='on'?'said they are on it':kind==='snooze'?'snoozed the alert':'asked Mara to look into it');
 if(kind==='on')say('stop','Thanks, noted. I will stay with it and tell you when the robot runs again.',{wait:300});
 if(kind==='snooze'){S.snoozed=true;say('stop','Snoozed for 30 minutes. I still log everything.',{wait:300})}
 if(kind==='look'){
  var r=S.sim.r;sl('Mara','Pulled this robot\u2019s history from the log');
  var mine=INC.filter(function(x){return x.r===r}),tot=mine.reduce(function(a,x){return a+x.min},0),c153=mine.filter(function(x){return /C153/.test(x.err)}).length;
  say('stop','<b>'+R[r].name+'</b>: in the sample it had '+mine.length+' incidents, '+tot+' minutes in all'+(c153?', '+c153+' of them error C153 (likely cause in the sample: the mills backed up behind the robot)':'')+'. The cause of this demo stop is not known.<br><br><span class="mut">This is a pattern from the logged history, not a diagnosis. A person decides.</span>',{wait:500,tag:'Demo, brief'});
 }
}
function fix(){
 if(!S.sim||S.sim.fixed)return;
 S.sim.fixed=true;var r=S.sim.r,rb=R[r],mins=S.sim.d+22,cost=rb.cph*mins/60,parts=Math.round(rb.ppm*mins);
 renderRight();renderSide();sl('Mara','Saw the robot running again and closed the stop');var simD=S.sim;
 say('stop','<b>'+rb.name+' is running again.</b> It was stopped '+mins+' minutes. About '+usd(cost)+' of robot time and about '+parts+' parts not made.',{plain:'<b>'+rb.name+' is running again.</b> It was stopped '+mins+' minutes, about '+parts+' parts not made.',tag:'Demo, closed',wait:200,choices:{title:'What fixed it?',sub:'Optional, one tap. It goes in the log.',options:[
  {label:'Cleared what was blocking it',fn:function(){logFix(r,mins,'Cleared what was blocking it')}},{label:'Reset the machine it waits on',fn:function(){logFix(r,mins,'Reset the machine it waits on')}},{label:'Something else',fn:function(){logFix(r,mins,'Something else')}}]}});
 logFix(r,mins,null,true);sl('Mara','Wrote the stop into the logbook');
 say('stop',handledCard(simD),{wait:700,tag:'Demo, how it was handled'});
}
function logFix(r,mins,what,auto){
 var row='<b>Logged.</b> '+R[r].name+', '+mins+' minutes down'+(what?'. What fixed it: '+what:'')+'. (Demo stop, not part of the sample history.)';
 if(auto){pushRec('log',{k:'ai',html:row,short:nowShort(),quiet:false,tag:'Demo, new entry'});return}
 pushRec('log',{k:'ai',html:'<b>Updated.</b> Added "what fixed it": '+what+'.',short:nowShort(),tag:'Demo, note added'});
 if(S.sim)sl('Technician','tapped what fixed it: '+what);
 say('stop','Thanks. I added that to the log. This stop now has a cause on record.',{wait:200});
}
function testAlert(){
 var m=stopMsgs(1,S.cfg.delay);
 pushRec('stop',{k:'ai',html:'<b>Test alert, nothing is wrong.</b> This is what an alert looks like in this demo. It stays in this app.<br><br>'+m.m,p:'<b>Test alert, nothing is wrong.</b> This is what the technician view shows.<br><br>'+m.p,short:nowShort(),tag:'Demo, test alert'});
}

/* ===== Q&A (answers come from the dashboard's own numbers) ===== */
function askChips(){return[
 {label:'What changed overnight?',fn:function(){submit('What changed overnight?')}},
 {label:'Why is Loader 2 so low?',fn:function(){submit('Why is Loader 2 so low?')}},
 {label:'Which robot works the least?',fn:function(){submit('Which robot works the least?')}},
 {label:'What does the line earn?',fn:function(){submit('What does the line earn?')}}]}
function navAns(id,tab,msg){setTab(tab);say(id,msg,{wait:350})}
var SAFE=/e-?stop|emergency|\b(danger|hurt|injur\w*|fire|smoke|sparks?|crash\w*)\b|(safe|ok|okay|fine) to (enter|approach|go in|touch|reach)|lock ?out|tag ?out/;
var CTRL=/\b(shut ?down|shut\w* off|power (off|down)|turn (it |the \w+ |loader \d |deburr |inspection )?(off|on)|switch (it |the \w+ |loader \d |deburr |inspection )?(off|on)|restart|reboot|speed( it)? up|slow( it)? down|halt|kill|change the program|(pause|resume) (the |it |loader ?\d|deburr|inspection)|(start|stop|reset|run|home|jog|move|open|close|unlock) (the |it |loader ?\d|deburr|inspection|robot|arm|gripper|cell))\b/;
var NOTIME=/\btoday\b|this (week|morning|shift)|last (week|month|night)|\byesterday\b|\bby (day|week|shift|hour)\b|over time|\btrend\b/;
function sampleNote(t){return NOTIME.test(t)?'I only have the sample period, Aug 4 to Sep 3, not today or last week. ':''}
function namedRobot(t){var k=-1;R.forEach(function(r,i){if(t.indexOf(r.name.toLowerCase())>=0)k=i});return k}
function whyRobot(i){var r=R[i],mine=INC.filter(function(x){return x.r===i}),tot=mine.reduce(function(a,x){return a+x.min},0),c=mine.filter(function(x){return /C153/.test(x.err)}).length;
 return '<b>'+r.name+'</b> worked <b>'+r.work+'%</b> of its scheduled time in the sample (Aug 4 to Sep 3). '+(mine.length?'It had '+mine.length+' incident'+(mine.length>1?'s':'')+', '+tot+' minutes in all'+(c?', '+c+' of them error C153 (likely cause in the sample: the mills backed up behind it)':'')+'. ':'It had no incidents. ')+'The rest is mostly waiting, which is built into a line like this. Idle time is the most you could win back, not a promise.'}
function statusAns(){var fd=feed();if(!fd.ok)return fd.robots?'I lost contact with the feed, so I will not tell you what is running.':'The feed is still connecting, so I do not have a reading yet.';
 return 'Right now, from the replay: '+R.map(function(r,i){return r.name+' '+cellState(i).t.toLowerCase()}).join(', ')+'.'}
function ctrlChips(id){setChips(id,[{label:'Why is Loader 2 so low?',fn:function(){submit('Why is Loader 2 so low?')}},{label:'Show me the incidents',fn:function(){submit('Show me the incidents')}}])}
/* what-if questions Mara can answer about the line, with small bar charts */
function plural(n,w){return n===1?w:(w==='box'?'boxes':w+'s')}
function lineAnswer(id,why){
 var lv=lineValue();if(!lv)return say(id,'The line numbers are still connecting. Try again in a moment.',{wait:300});
 var m=money(),v=lv.v,held=lv.fromQueue?'Held back at the '+lv.held+'.':'No clear holdup right now.';
 setTab('val');
 return say(id,(m?'<b>'+usd0(lv.now*v)+' an hour</b> '+vBasis(v)+' ('+lv.now+' parts).':'<b>'+lv.now+' parts an hour</b> ('+lv.pct+'% of normal).')+bars(outRows(lv,m),1)+'<span class="mut">'+held+(m?' Up to +'+usd0(lv.gap*v)+'/hr at normal. An upper bound.':' Dollar figures are for owners and managers.')+'</span>',{wait:450,tag:'Line value',plain:'<b>'+lv.now+' parts an hour</b> ('+lv.pct+'% of normal).'+bars(outRows(lv,false),1)+'<span class="mut">'+held+'</span>'});
}
function whatIf(t,id){
 var lv=lineValue(),m=money();
 var moreM=t.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:more|extra|additional)\s*(?:(?!parts?\b|boxes\b|box\b|units?\b|pieces?\b|items?\b|cartons?\b|packages?\b)[a-z]+\s)?(parts?|boxes|box|units?|pieces?|items?|cartons?|packages?)?/);
 var full=/\b(full capacity|at capacity|more efficient|efficiently|efficiency|max(?:imum)? (?:output|capacity)|running at (?:full|max))\b/.test(t);
 var fm=t.match(/(\d+(?:\.\d+)?)\s*%\s*(faster|slower|quicker|more efficient|less efficient)/);
 var lost=/\b(lost|missed|lose|losing|miss)\b.*\b(output|parts|sales|revenue|money|production)\b|\bstops?\b.*\bcost\b.*\b(output|production|parts)\b|\bcost in output\b/.test(t);
 var outq=/\b(how many parts|parts (an|per) hour|my output|throughput|how much (is|does) (the|my) line (make|making|produce))\b/.test(t);
 var where=/\b(where|which stage|what stage)\b.*\b(held back|holding|slowest|bottleneck|limit)/.test(t)||/\b(slowest stage|biggest bottleneck)\b/.test(t);
 if(!moreM&&!full&&!fm&&!lost&&!outq&&!where)return null;
 if(!lv)return say(id,'The line numbers are still connecting. Try again in a moment.',{wait:300});
 var pm=t.match(/\$\s?(\d+(?:\.\d+)?)/);
 if(pm){S.vpp=parseFloat(pm[1]);S.vppOwn=true;var inp=$('vppin');if(inp)inp.value=String(S.vpp);lv.v=S.vpp}
 var v=lv.v,held=lv.fromQueue?'the '+lv.held:'the busiest stage';
 if(where||outq)return lineAnswer(id);
 if(lost){
  var per={},tot=0,totMin=0;INC.forEach(function(x){var p=R[x.r].ppm*x.min;per[x.r]=(per[x.r]||0)+p;tot+=p;totMin+=x.min});
  var rows=R.map(function(r,i){return{l:r.name,v:per[i]||0,max:Math.max.apply(null,Object.keys(per).map(function(k){return per[k]})),t:Math.round(per[i]||0)+(m?' · '+usd0((per[i]||0)*v):''),c:'red'}});
  return say(id,(m?'<b>About '+Math.round(tot)+' parts not made, '+usd0(tot*v)+'</b> '+vBasis(v)+'.':'<b>About '+Math.round(tot)+' parts not made</b> in '+totMin+' minutes down.')+bars(rows,1)+'<span class="mut">Estimated from each robot\u2019s rate over the 8 stops in the sample.'+(m?' Not lost sales.':'')+'</span>',{wait:450,tag:'Lost output',plain:'<b>About '+Math.round(tot)+' parts not made</b> in '+totMin+' minutes down.'+bars(rows.map(function(r){return{l:r.l,v:r.v,max:r.max,t:Math.round(r.v)+'',c:'red'}}),1)});
 }
 if(fm){
  var p=parseFloat(fm[1])/100,faster=/fast|quick|more eff/.test(fm[2]),named=/(mill|cnc|loader|deburr|inspect|qc)/.exec(t),stage=named?named[1]:null;
  var isHeld=!stage||(lv.fromQueue&&((/mill|cnc/.test(stage)&&/CNC/.test(lv.held))||(lv.held&&stage&&lv.held.toLowerCase().indexOf(stage)>=0)));
  var est=lv.now;
  if(isHeld)est=faster?Math.min(lv.norm,lv.now*(1+p)):lv.now*(1-p);
  var changed=Math.round(est)!==lv.now,sname=stage?(/mill|cnc/.test(stage)?'CNC mills':stage==='qc'?'Inspection':stage.charAt(0).toUpperCase()+stage.slice(1)):held;
  var rowsF=outRows(lv,m,changed?est:null);
  var head=changed?(m?'<b>About '+(est>lv.now?'+':'')+Math.round(est-lv.now)+' parts an hour, '+(est>lv.now?'+':'-')+usd0(Math.abs(est-lv.now)*v)+'/hr</b> '+vBasis(v)+'.':'<b>About '+(est>lv.now?'+':'')+Math.round(est-lv.now)+' parts an hour.</b>'):'<b>No change to the line.</b>';
  var why=changed?(faster&&est>=lv.norm-0.5?'Capped at the line\u2019s normal rate, the most this sample shows.':'An estimate, not a promise.'):(lv.fromQueue?'The line is held back at the '+lv.held+', so '+sname+' is not what sets the pace.':'No stage is clearly holding the line up right now.');
  setTab('val');
  return say(id,head+bars(rowsF,1)+'<span class="mut">'+why+'</span>',{wait:450,tag:'What if',plain:head.replace(/, [-+]\$[\d,]+\/hr/,'')+bars(outRows(lv,false,changed?est:null),1)+'<span class="mut">'+why+'</span>'});
 }
 if(!moreM||!moreM[2]){
  if(!moreM){
   var gp=lv.gap;setTab('val');
   var hint=lv.fromQueue?'Faster robots will not help while they wait on the '+lv.held+'.':'';
   return say(id,(m?'<b>+'+gp+' parts an hour, up to +'+usd0(gp*v)+'/hr</b> '+vBasis(v)+' ('+usd0(gp*v*8)+' over an 8 hour shift).':'<b>+'+gp+' parts an hour</b> at normal.')+bars(outRows(lv,m),1)+'<span class="mut">An upper bound, not a promise. '+hint+'</span>',{wait:450,tag:'What if',plain:'<b>+'+gp+' parts an hour</b> at normal.'+bars(outRows(lv,false),1)+'<span class="mut">'+hint+'</span>'});
  }
 }
 var n=parseFloat(moreM[1].replace(/,/g,'')),raw=moreM[2]||'part',word=/box/.test(raw)?'box':/carton/.test(raw)?'carton':/package/.test(raw)?'package':/unit/.test(raw)?'unit':/piece/.test(raw)?'piece':/item/.test(raw)?'item':'part';
 var per2=/\b(?:a|an|per|each|every)\s*(hour|shift|day)\b|\bhourly\b/.exec(t),span=per2?(per2[1]||'hour'):'hour';
 var hrs=span==='hour'?1:span==='shift'?8:16,hourEq=n/hrs,art=span==='hour'?'an hour':'a '+span;
 var extra=lv.now+hourEq,above=extra>lv.norm+0.5;
 var nTxt='+'+n.toLocaleString('en-US')+' '+plural(n,word)+' '+art;
 var verdict=above?'Above the line\u2019s normal rate of '+lv.norm+'. Fixing '+held+' alone would not be enough.':'Inside the line\u2019s normal rate of '+lv.norm+'. It needs '+held+' to keep up.';
 setTab('val');
 var rowsN=outRows(lv,m,extra);
 return say(id,(m?'<b>'+nTxt+' = '+usd0(n*v)+' '+(span==='hour'?'an hour':'a '+span)+'</b> '+vBasis(v)+(span==='hour'?' ('+usd0(n*v*8)+' over an 8 hour shift).':' ('+usd0(n*v/hrs)+' an hour).'):'<b>'+nTxt+'</b>'+(span==='hour'&&word==='part'?'.':' is about '+(Math.round(hourEq*10)/10)+' parts an hour.'))+bars(rowsN,1)+'<span class="mut">'+verdict+(span==='day'?' Assumes two 8 hour shifts.':'')+(m?' An estimate, not a promise.':' Dollar figures are for owners and managers.')+'</span>',{wait:450,tag:'What if',plain:'<b>'+nTxt+'</b>'+(span==='hour'&&word==='part'?'.':' is about '+(Math.round(hourEq*10)/10)+' parts an hour.')+bars(outRows(lv,false,extra),1)+'<span class="mut">'+verdict+'</span>'});
}
function route(text,id){
 var t=text.toLowerCase(),th=TH[id],sn=sampleNote(t),who0=namedRobot(t);
 if(!S.hired&&S.setup.on){
  if(/^(restart|start over|setup)\b/.test(t))return startSetup();
  return say('mara','Please use the buttons above, or type "start over".',{wait:300});
 }
 if(SAFE.test(t))return say(id,'<b>I cannot stop or control any robot.</b> If someone may be in danger, use the physical emergency stop and call your supervisor now. I only read data.',{wait:200});
 if(/\b(simulate|fake|trigger|inject|run|show me)\b.*\bstop\b|\bdemo stop\b/.test(t))return simStop(who0>=0?who0:1);
 var ctrlOk=!/(alert|notif|demo|setup|message)/.test(t);
 if(ctrlOk&&CTRL.test(t))return say(id,'I never control a robot, that is a hard rule. In an emergency use the physical e-stop. I can show what has been stopping it, or tell the person on call. In this demo alerts stay in the app.',{wait:400}).then(function(){ctrlChips(id)});
 var dur=/(\d+(?:\.\d+)?)\s*[- ]?\s*(sec\w*|min\w*|h(?:ou)?rs?\b)/;
 var wi=whatIf(t,id);if(wi)return wi;
 if(/\bset ?up\b.*\b(slack|text|call|phone|email|webhook|other robots?|machines|conveyors?)/.test(t))return say(id,'That is not part of this demo yet. When it is, you tell me who should get it and when, and I set it up. There is nothing for you to configure.',{wait:300});
 if(/\b(voice|talk to you|speak to you|microphone|mic\b|read (it |replies )?aloud)\b/.test(t))return say(id,'You can talk to me with the microphone button in the message box, and I can read my replies aloud. Turn that on in Integrations. It uses your browser\u2019s speech service, and I never control a robot by voice.',{wait:300});
 if(/\b(phone|calls?|sms|whatsapp|text me|ring me)\b/.test(t)&&!dur.test(t)&&!/stops? (over|longer)/.test(t))return say(id,'In this demo alerts stay in the app. Phone calls and texts are not part of this MVP.',{wait:300});
 if(/pricing|subscription|licen[cs]e|per month|how much (is|does) (it|this|botlien)|what('| i)s the price|price of (this|botlien|the (product|app))/.test(t))return say(id,'Pricing is not part of this demo.',{wait:300});
 if(/on[- ]?prem|\bcloud\b|where.*data|data.*(safe|secure|stored)|who (made|built|created)|which model|\bllm\b|gpt|claude/.test(t))return say(id,'Botlien reads robot data through a cloud connection and never controls a robot. Where the AI runs and who built it are not part of this demo. Everything you see here is a scripted replay.',{wait:350});
 if(/^(thanks|thank you|thx|cheers|great|nice|cool|perfect)\b/.test(t))return say(id,'You are welcome.',{wait:200});
 if(/^(hi|hello|hey|good (morning|afternoon|evening))\b|what can you do|\bhelp\b|who are you/.test(t))return say(id,'I watch your four robots and tell you when one stops. You can ask what is running, why a robot is low, what a stop cost, or ask me to build a view of your numbers. I never control a robot.',{wait:350}).then(function(){setChips(id,askChips())});
 if((/\b(alert|notify|interrupt)\w*/.test(t)||/\b(text|call)\b.*\b(me|when|if)\b/.test(t))&&(dur.test(t)||/immediate|right away|any stop|every stop|only (for|when)/.test(t))){
  if(/night|weekend|quiet hours|schedule|shift/.test(t))return say(id,'Time windows are not part of this MVP. I can only change how long a stop lasts before I alert.',{wait:300});
  var mm=t.match(dur),n=mm?Math.round(parseFloat(mm[1])*(/^s/.test(mm[2])?1/60:/^h/.test(mm[2])?60:1)):(/immediate|right away|any stop|every stop/.test(t)?1:null);
  if(n==null||!isFinite(n))return say(id,'Tell me how long a stop should last before I alert you, for example "alert me after 3 minutes".',{wait:300});
  n=Math.min(240,Math.max(1,n));var ml=n+' minute'+(n===1?'':'s');
  return say(id,'I can change that. Here is what I would do.',{wait:300,choices:{title:'Alert only for stops over '+ml+'?',sub:'Currently '+S.cfg.delay+' minutes. You confirm every change.',options:[{label:'Yes, change it to '+ml,fn:function(){S.cfg.delay=n;if(RT.stop&&RT.stop[0]){RT.stop[0].w=RT.stop[0].w0='Always on, alert after '+n+' minutes';RT.stop[0].ins=RT.stop[0].ins.replace(/past \d+ minutes/,'past '+n+' minutes')}renderRoutines();say(id,'Done. I will alert after '+ml+' of stop. Still read only.',{wait:300})}},{label:'Keep '+S.cfg.delay+' minutes'}]}});
 }
 if(/how many parts|parts (did|do|have) (we|you|it)|(parts|output|production).*(today|made)/.test(t)&&!/\b(lost|chart|graph|plot|build)\b/.test(t)){var fd0=feed(),ln=fd0.line&&fd0.line.output;return say(id,'I do not have a count for today. '+(ln&&fd0.ok&&isFinite(ln.perHourNow)&&isFinite(ln.perHourNormal)?'The line is making about <b>'+Math.round(ln.perHourNow)+' parts an hour</b> right now against about '+Math.round(ln.perHourNormal)+' normally, from the replay.':'I only have parts lost in incidents, which is an estimate.'),{wait:400})}
 if((id==='mara'||id==='log'||id==='stop'||th.r!=null)&&cvIntent(t,id))return;
 if(/c153|c207/.test(t))return say(id,'In the sample, <b>C153</b> was logged on 6 of the 8 incidents, and the dashboard\u2019s likely cause for it is the mills backed up behind the robot. <b>C207</b> was logged once, with the mills still running. I do not have the vendor manual.',{wait:400});
 if(/(how|what).*(calculat|measur|defin)/.test(t)){var mk=metricOf(t);if(mk)return say(id,esc(MET[mk].calc),{wait:300})}
 if(/overnight|what changed|brief|yesterday/.test(t))return say(id,'<b>On Sep 3, the last day of the sample:</b> Loader 2 stopped 4 minutes and Deburr waited 3 minutes. Details are in the Incidents tab.',{wait:400}).then(function(){setChips(id,[{label:'Open the incidents',fn:function(){setTab('inc')}}])});
 if(who0>=0&&/\bwhy\b|\blow\b|waiting|stopp|idle|so little/.test(t))return say(id,whyRobot(who0),{wait:500});
 if(/\b(is|are|how)\b.*(\brunning|\bokay\b|\bok\b|\bfine\b|\bworking\b)|\bstatus\b|going on|anything wrong|everything (ok|okay|fine)/.test(t)&&!/\b(least|most|compare|calculated|time|why)\b/.test(t))return say(id,statusAns(),{wait:350});
 if(/(works?|worked|busy|used) the least|\bleast (work|busy|used|time)|idle.*most|most.*idle|sat idle/.test(t))return say(id,'<b>Loader 2</b> works the least: 8% of its schedule. Idle time costs about '+(money()?'<b>$16,096 a year at most</b> for Loader 2, '+'then Loader 1 $13,471, Inspection $9,174 and Deburr $8,385':'the most for Loader 2, then Loader 1, Inspection and Deburr')+'. That is an upper bound from the Aug 4 to Sep 3 working share and 4,000 scheduled hours a year, not a promise.',{wait:500,plain:'<b>Loader 2</b> works the least: 8% of its schedule, then Inspection 21%, Loader 1 23% and Deburr 38%. Dollar figures are for owners and managers.'});
 var costWord=/\bcosts?\b|\bmoney\b|\$|\bprice\b|\bdollars?\b/.test(t);
 if(costWord&&/(stops?|downtime|incidents?|a minute)/.test(t)){
  var tc=INC.reduce(function(a,x){return a+R[x.r].cph*x.min/60},0);
  if(/(a|one|per|each) (stop|incident|minute)/.test(t)){var cphv=who0>=0?R[who0].cph:null;return say(id,cphv?'A minute of '+R[who0].name+' being down is about <b>'+usd(cphv/60)+'</b> of robot time ('+usd(cphv)+' an hour divided by 60).':'An average incident in the sample is about <b>'+usd(tc/INC.length)+'</b> of robot time.',{wait:500,plain:'Cost figures are for owners and managers. I can tell you minutes down and causes instead.'})}
  return say(id,'The 8 incidents in the sample (6 robot errors and 2 waits, Aug 4 to Sep 3) add up to about <b>'+usd(tc)+'</b> of robot time: each incident\u2019s minutes down at that robot\u2019s own and run cost per hour. That is what the robots cost while stopped, not lost sales.',{wait:500,plain:'Cost figures are for owners and managers. I can tell you minutes down and causes instead.'});
 }
 if(costWord){
  if(!money())return say(id,'Cost figures are for owners and managers. I can tell you times, causes and parts instead.',{wait:300});
  if(who0>=0)return say(id,'<b>'+R[who0].name+'</b> costs <b>'+usd(R[who0].cph)+' an hour</b> to own and run (an estimate from list prices).',{wait:400,plain:'Cost figures are for owners and managers. I can tell you times, causes and parts instead.'});
  return say(id,'Your 4 arms cost <b>'+usd(TOTAL_CPH)+' an hour</b> to own and run (an estimate from list prices). Weighted by cost, they worked 21.6% of their scheduled time from Aug 4 to Sep 3, so each hour of real work cost <b>'+usd(COST_PER_REAL_HOUR)+'</b> ('+usd(TOTAL_CPH)+' divided by 0.2162). The parts are on the Overview: Loader 1 $4.374 + Loader 2 $4.374 + Deburr $3.381 + Inspection $2.903.',{wait:500,plain:'Cost figures are for owners and managers. I can tell you times, causes and parts instead.'}).then(function(){setChips(id,[{label:'Open the overview',fn:function(){setTab('ov')}}])});
 }
 if(/\b(line (earn|earns|value|worth|make|makes)|what does the line|full capacity|held back|bottleneck)\b/.test(t))return lineAnswer(id);
 if(/\b(weekly|this week|week in review|what (did|would) you (handle|have handled))\b/.test(t)){
  var dl=S.cfg.delay,al=INC.filter(function(x){return x.min>dl}),bk2=INC.filter(function(x){return x.min>dl+10});
  return say(id,'<b>Replay of the sample period against your alert rule.</b> Your rule: tell '+who()+' after a stop of '+dl+' minutes, then the backup after 10 more. Of the '+INC.length+' recorded stops, '+al.length+' lasted long enough to alert you and '+bk2.length+' would have gone to the backup. I would have logged the other '+(INC.length-al.length)+' without bothering anyone.<br><span class="mut">This replays recorded stops. It is not a measurement of real alerts. Minutes to an answer and the share of stops with a logged cause are measured once a shop runs this.</span>',{wait:500,tag:'Demo, replay'});
 }
 if(/\b(most|best|worst)\b.*\b(robot|arm)\b|\b(robot|arm)\b.*\b(most|best|worst)\b/.test(t))return navAns(id,'fleet','Here is the fleet, ranked by who works the least.');
 if(/\bthe line\b|\bline (page|view|map)\b|holding|backing|bottleneck/.test(t))return navAns(id,'line','Here is the line. The dashed boxes are machines, not robots, and the numbers between stations are parts waiting.');
 if(/\bfleet\b|\b(show|list|open|see)\b.*\brobots\b|\ball robots\b/.test(t))return navAns(id,'fleet','Here is the fleet, ranked by who works the least.');
 if(/\bincidents?\b|\bhistory\b|\bthe log\b|\b(show|list|open|see)\b.*\bstops\b/.test(t))return navAns(id,'inc',sn+'Here are all 8 incidents for the sample period, with the likely cause of each.');
 if(/\b(dashboard|overview)\b/.test(t))return navAns(id,'ov',sn+'Here is your overview.');
 say(id,'I can tell you what is running, why a robot stopped, what it cost, or build a view of your numbers. I cannot control a robot. Try one of these.',{wait:300}).then(function(){setChips(id,askChips())});
}
function submit(text){
 text=String(text==null?'':text).trim().slice(0,500);if(!text)return;var id=S.cur,t=text.toLowerCase();
 userSay(id,text);$('input').value='';$('composer').classList.remove('has');growInput();setChips(id,[]);
 if(S.hired||!S.setup.on){
  var ctrlOk=!/(alert|notif|demo|setup|message)/.test(t);
  if(SAFE.test(t)||(ctrlOk&&CTRL.test(t)))return route(text,id);
  var th=TH[id],named=namedRobot(t),chartish=/\b(chart|graph|plot|cost|show me)\b/.test(t);
  if(id==='stop'){
   if(S.sim&&!S.sim.fixed&&/(on it|got it|\back\b|snooze|looking)/.test(t)){ack(/snooze/.test(t)?'snooze':'on',S.sim);return}
   if(/stopped|running|status|anything|\bnow\b|\bdown\b/.test(t)&&!chartish)return say(id,statusAns(),{wait:350});
   if(!chartish&&!/incident|history|why/.test(t))return say(id,'I tell people about stops. To change when I alert, ask Mara, for example "alert me after 10 minutes".',{wait:300});
  }else if(id==='log'){
   if(/(log|note|add|write|save)\b.*:|\b(add|write|save) (a )?(note|entry)/.test(t))return say(id,'I cannot take typed notes in this demo. Tap an option under "What fixed it?" on a stop.',{wait:300});
   if(!chartish&&!/incident|history|count|total|minutes|how many|why|status/.test(t))return say(id,'The record is above. You can also open the Incidents page for the full table.',{wait:300}).then(function(){setChips(id,[{label:'Open the Incidents page',fn:function(){setTab('inc')}}])});
  }else if(th.r!=null&&(named<0||named===th.r)&&/\bwhy\b|\bstopp?(ed|s|ing)?\b|\bdowntime\b|\bincidents?\b|\bhistory\b/.test(t)&&!chartish){
   var r=th.r,mine=INC.filter(function(x){return x.r===r});
   return say(id,mine.length?'This sample period (Aug 4 to Sep 3): '+mine.map(function(x){return x.d+' '+x.t+', '+x.min+' min ('+esc(x.err)+')'}).join('; ')+'. Likely cause on the last one: '+esc(mine[mine.length-1].cause)+'.':'No incidents this sample period.',{wait:400});
  }
 }
 route(text,id);
}

/* ===== demo menu and roles ===== */
function setRole(r,silent){
 S.role=r;$('roleBtn').textContent='Viewing as: '+(r==='Owner'?'Owner':'Technician');
 document.body.classList.toggle('tech',r!=='Owner');try{sam().document.body.classList.toggle('tech',r!=='Owner');if(r!=='Owner'&&window.__techOn)window.__techOn()}catch(e){}
 if(!silent){renderAll();say(S.cur,'Switched to the '+(r==='Owner'?'owner':'technician')+' view. '+(r==='Owner'?'Dollar figures are shown.':'Dollar figures are hidden on the screen, times and causes stay.'),{wait:200,quiet:true})}
}
function openMenu(o){$('demoMenu').className=o?'open':'';$('demoBtn').setAttribute('aria-expanded',o?'true':'false')}
function demo(k){
 if(k==='setup')return startSetup();
 if(k==='reset')return window.__ONB?onbOpen():startReady();
 if(k==='role')return setRole(S.role==='Owner'?'Technician':'Owner');
 if(!S.hired){resetAll();initRoutines();finishSetup()}
 if(k==='stop')return simStop(1);
 if(k==='ask'){openThread('mara');say('mara','Ask me anything about your line. I answer from your dashboard numbers. Tap a question or type your own.',{wait:300}).then(function(){setChips('mara',askChips())})}
 if(k==='dash'){openThread('mara');setTab('line')}
}

