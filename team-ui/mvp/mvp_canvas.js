
/* ===== Mara's canvas: build any view by asking (numbers come from the dashboard's own sample data) ===== */
var CV={live:null,hist:[],hi:-1,pins:[],hOpen:false};
var MET={
 working:{label:'Working time',short:'working',unit:'%',get:function(i){return R[i].work},fmt:function(v){return Math.round(v)+'%'},avg:true,
  calc:'The share of its scheduled time the arm was working, sample period (from the dashboard). The sample is not a promise.'},
 cph:{label:'Cost to own and run',short:'cost per hour',unit:'$/hr',get:function(i){return R[i].cph},fmt:function(v){return '$'+v.toFixed(2)},money:true,
  calc:'What the robot costs to own and run per hour, estimated from list prices. Never what a part is worth.'},
 idle:{label:'Idle cost a year, at most',short:'idle cost a year',unit:'$',get:function(i){return R[i].idleYr},fmt:usd0,money:true,
  calc:'The most you could win back by using the arm more, not a promise. Some waiting is built into the line.'},
 down:{label:'Minutes down',short:'minutes down',unit:'min',get:function(i){return INC.filter(function(x){return x.r===i}).reduce(function(a,x){return a+x.min},0)},fmt:function(v){return Math.round(v)+' min'},
  calc:'Total minutes down in the dashboard incident list, Aug 4 to Sep 3.'},
 parts:{label:'Parts lost (estimate)',short:'parts lost',unit:'parts',get:function(i){return INC.filter(function(x){return x.r===i&&x.parts!=null}).reduce(function(a,x){return a+x.parts},0)},fmt:function(v){return 'about '+Math.round(v)},
  calc:'Estimate: minutes down x 275 parts an hour / 60, halved for the two loaders because they share the work (sample, Aug 4 to Sep 3).'},
 inc:{label:'Incidents',short:'incidents',unit:'',get:function(i){return INC.filter(function(x){return x.r===i}).length},fmt:function(v){return String(Math.round(v))},
  calc:'Count of robot errors and waits in the dashboard incident list, Aug 4 to Sep 3.'}
};
var MKEYS=['working','cph','idle','down','parts','inc'];
function metricOf(t){
 if(/(parts|output|throughput|production).*(per hour|an hour|\/hr)|per hour.*(parts|output)/.test(t))return null;
 if(/cost per hour|cost to run|cost to own|per hour|\/hr|hourly/.test(t))return 'cph';
 if(/idle (cost|money|\$|dollar)|win back|waste (cost|money)/.test(t))return 'idle';
 if(/\bidle\b|\bwaste\b/.test(t))return 'working';
 if(/\bparts\b|\blost\b/.test(t))return 'parts';
 if(/minutes|downtime|down time|down\b/.test(t))return 'down';
 if(/incident|stops?\b/.test(t)&&!/stopped/.test(t))return 'inc';
 if(/\bwork(ing)?|\bbusy|utili[sz]ation|\buse\b/.test(t))return 'working';
 if(/cost|spend|money|dollar/.test(t))return 'cph';
 return null;
}
function robotsOf(t){
 var r=[];
 if(/loader ?(1|one)\b/.test(t)||/loaders? 1 (and|&|,) ?2/.test(t))r.push(0);
 if(/loader ?(2|two)\b/.test(t)||/loaders? 1 (and|&|,) ?2/.test(t))r.push(1);
 if(/\b(both )?loaders\b/.test(t)&&!r.length)r=[0,1];
 if(/deburr|ur5e/.test(t))r.push(2);
 if(/inspect|ur3e/.test(t))r.push(3);
 if(/\b(except|but|without|excluding|not|other than)\b/.test(t)&&r.length)r=[0,1,2,3].filter(function(i){return r.indexOf(i)<0});
 return r.length?r.filter(function(x,i,a){return a.indexOf(x)===i}).sort():[0,1,2,3];
}
function scopeLabel(rs){return rs.length===4?'All four arms':rs.map(function(i){return R[i].name}).join(' and ')}
function specTitle(sp){return MET[sp.metric].label+', '+scopeLabel(sp.robots).toLowerCase()}
function cTip(html){window.__tips=window.__tips||[];window.__tips.push(html);return window.__tips.length-1}
function tipFor(metric,i,val){
 var m=MET[metric],rows='';
 if(i==null)rows=row('Measure',m.label);else rows=row(R[i].name,m.fmt(val));
 return '<b>How is this calculated</b>'+m.calc+'<hr>'+rows+'<hr><span class="mut">Sample data from the dashboard</span>';
}
function row(a,b){return '<div class="trow"><span>'+a+'</span><span>'+b+'</span></div>'}
function gated(metric){return MET[metric].money&&!money()}
function valuesOf(sp){var o=sp.robots.map(function(i){return{i:i,v:MET[sp.metric].get(i)}});if(sp.sort)o.sort(function(a,b){return sp.sort==='asc'?a.v-b.v:b.v-a.v});return o}
var DRAWN={};
function barSvg(sp){
 var dkey=JSON.stringify(sp)+S.role,anim=!DRAWN[dkey];DRAWN[dkey]=1;
 var vals=valuesOf(sp),m=MET[sp.metric],W=560,H=230,L=52,B=34,T=14,Rg=10,pw=W-L-Rg,ph=H-T-B,max=0;
 vals.forEach(function(o){if(o.v>max)max=o.v});
 function nice(v){if(v<=0)return 1;var p=Math.pow(10,Math.floor(Math.log10(v))),n=v/p;return(n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p}
 var step=nice(max*1.05/4),nt=Math.max(1,Math.ceil(max*1.05/step)),top=step*nt,svg='<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="'+esc(m.label)+'">';
 for(var i=0;i<=nt;i++){var y=T+ph-ph*i/nt,v=step*i;svg+='<line x1="'+L+'" x2="'+(W-Rg)+'" y1="'+y+'" y2="'+y+'" stroke="#EDEDF0"/><text x="'+(L-8)+'" y="'+(y+4)+'" font-size="11" fill="#6B6B73" text-anchor="end">'+m.fmt(v).replace('about ','')+'</text>'}
 var gw=pw/vals.length,bw=Math.min(58,gw*0.6);
 vals.forEach(function(o,gi){
  var h=top?o.v/top*ph:0,x=L+gi*gw+gw/2-bw/2,y=T+ph-h,id=cTip(tipFor(sp.metric,o.i,o.v));
  svg+='<rect'+(anim?' class="cvbar" style="animation-delay:'+(gi*45)+'ms"':'')+' x="'+x+'" y="'+y+'" width="'+bw+'" height="'+Math.max(h,1)+'" rx="3" fill="'+(sp.metric==='working'&&o.v<=10?'#D99A00':'#16204A')+'" data-tip="'+id+'" tabindex="0"/>';
  svg+='<text x="'+(x+bw/2)+'" y="'+(y-6)+'" font-size="11.5" fill="#111" text-anchor="middle" data-tip="'+id+'">'+m.fmt(o.v)+'</text>';
  svg+='<text x="'+(L+gi*gw+gw/2)+'" y="'+(H-12)+'" font-size="12" fill="#111" text-anchor="middle">'+R[o.i].name+'</text>';
 });
 return svg+'</svg>';
}
function canvasHtml(sp){
 var m=MET[sp.metric];
 if(gated(sp.metric))return '<div class="empty"><b>This view has dollar figures</b>Dollars are for owners and managers. Switch to the owner view, or ask for working time, minutes down or parts lost.</div>';
 var vals=valuesOf(sp),tot=vals.reduce(function(a,o){return a+o.v},0),avg=tot/vals.length,id0=cTip(tipFor(sp.metric,null));
 var w='<div class="cgrid">';
 var headV=m.avg?m.fmt(avg):(m.unit==='$/hr'?usd(tot)+'/hr':m.fmt(tot));
 w+='<section class="w kpi"><h3>'+(m.avg?'Average ':'Total ')+esc(m.short)+'</h3><div class="v"><span class="hov" tabindex="0" data-tip="'+id0+'">'+headV+'</span></div><div class="s">'+esc(scopeLabel(sp.robots))+', sample period Aug 4 to Sep 3</div></section>';
 var worst=vals.slice().sort(function(a,b){return sp.metric==='working'?a.v-b.v:b.v-a.v})[0];
 w+='<section class="w kpi"><h3>'+(sp.metric==='working'?'Works the least':'Highest')+'</h3><div class="v">'+esc(R[worst.i].name)+'</div><div class="s">'+m.fmt(worst.v)+'</div></section>';
 w+='<section class="w wide"><h3>'+esc(m.label)+' by arm</h3>'+barSvg(sp)+'</section>';
 if(sp.table){
  w+='<section class="w wide"><h3>Table</h3><table><tr><th>Arm</th><th class="r">Working</th>'+(money()?'<th class="r">Cost/hr</th><th class="r">Idle a year</th>':'')+'<th class="r">Min down</th><th class="r">Incidents</th></tr>';
  vals.forEach(function(o){var i=o.i;w+='<tr><td>'+R[i].name+' <span class="mut">'+R[i].model+'</span></td><td class="r">'+MET.working.fmt(MET.working.get(i))+'</td>'+(money()?'<td class="r">'+MET.cph.fmt(MET.cph.get(i))+'</td><td class="r">'+usd0(MET.idle.get(i))+'</td>':'')+'<td class="r">'+MET.down.get(i)+'</td><td class="r">'+MET.inc.get(i)+'</td></tr>'});
  w+='</table></section>';
 }
 if(sp.timeline){
  var ev=INC.filter(function(x){return sp.robots.indexOf(x.r)>=0});
  w+='<section class="w wide"><h3>Incidents, in order</h3><ul class="tl">';
  ev.forEach(function(x){w+='<li><b>'+R[x.r].name+'</b>: '+esc(x.cause)+'<div class="mut">'+x.d+', '+x.t+', '+x.min+' min, '+esc(x.err)+(x.parts!=null?', about '+x.parts+' parts':'')+'</div></li>'});
  w+='</ul></section>';
 }
 return w+'</div>';
}
function cvPush(sp,label){CV.hist=CV.hist.slice(0,CV.hi+1);CV.hist.push({spec:clone(sp),label:label,time:FAST?'now':'just now'});CV.hi=CV.hist.length-1;CV.live=clone(sp)}
function cvTabs(){return CV.pins.map(function(p){return[p.id,'Pinned: '+p.title]})}
function renderBuilt(){
 window.__tips=[];var tp0=$('tip');if(tp0)tp0.style.display='none';
 var box=$('builtpanel'),h='';
 var cur=CV.tabSpec||CV.live;
 var isPin=S.tab.indexOf('pin_')===0;
 if(!cur){box.innerHTML='<div class="empty"><b>Nothing built yet</b>Ask Mara for a view, or tap one.<span class="eg"><button type="button" class="btn">Show me working time by arm</button><button type="button" class="btn">Chart parts lost for the loaders</button><button type="button" class="btn">Which robot works the least?</button></span></div>';[].forEach.call(box.querySelectorAll('.eg .btn'),function(b){b.addEventListener('click',function(){submit(b.textContent)})});return}
 if(!isPin){
  h+='<div class="vbar"><button class="btn primary" type="button" id="cvSave">Pin this view</button><button class="btn" type="button" id="cvKeep">Keep editing</button><button class="btn ghost" type="button" id="cvUndo"'+(CV.hi>0?'':' disabled')+'>Undo</button><button class="btn ghost" type="button" id="cvHist">History ('+CV.hist.length+')</button><span class="sp"></span><span class="note">'+esc(specTitle(cur))+'</span></div>';
  if(CV.hOpen)h+='<div class="hist">'+CV.hist.map(function(v,i){return '<button type="button" data-h="'+i+'" class="'+(i===CV.hi?'cur':'')+'"><span class="t">'+esc(v.time)+'</span><span>'+(i===CV.hi?'Current: ':'')+esc(v.label)+'</span></button>'}).join('')+'</div>';
 }else{h+='<div class="vbar"><span class="note">Pinned view. It reads the same numbers every time you open it, so everyone sees the same totals.</span><span class="sp"></span><button class="btn ghost" type="button" id="cvUnpin">Unpin</button></div>'}
 h+=canvasHtml(cur);box.innerHTML=h;
 var g=function(i){return $(i)};
 if(g('cvSave'))g('cvSave').addEventListener('click',function(){cvSave('mara')});
 if(g('cvKeep'))g('cvKeep').addEventListener('click',function(){$('input').focus();setChips(S.cur,cvChips())});
 if(g('cvUndo'))g('cvUndo').addEventListener('click',function(){cvUndo(S.cur)});
 if(g('cvHist'))g('cvHist').addEventListener('click',function(){CV.hOpen=!CV.hOpen;renderBuilt()});
 if(g('cvUnpin'))g('cvUnpin').addEventListener('click',function(){CV.pins=CV.pins.filter(function(p){return p.id!==S.tab});S.tab='built';CV.tabSpec=null;renderRight()});
 [].forEach.call(box.querySelectorAll('.hist button'),function(b){b.addEventListener('click',function(){CV.hi=+b.getAttribute('data-h');CV.live=clone(CV.hist[CV.hi].spec);renderBuilt()})});
}
function cvSave(id){
 if(!CV.live)return;var base=specTitle(CV.live),n=2,t=base;
 while(CV.pins.some(function(p){return p.title===t}))t=base+' ('+n++ +')';
 var pid='pin_'+Date.now();CV.pins.push({id:pid,title:t,spec:clone(CV.live)});S.tab=pid;CV.tabSpec=clone(CV.live);renderRight();
 say(id,'Pinned as <b>"'+esc(t)+'"</b>. It is kept in this demo and reads the same numbers each time. Your live view on my screen is still there to keep editing.',{wait:350});
}
function cvUndo(id){
 if(CV.hi>0){CV.hi--;CV.live=clone(CV.hist[CV.hi].spec);S.tab='built';CV.tabSpec=null;renderRight();say(id,'Undone. Back to: '+esc(CV.hist[CV.hi].label)+'.',{wait:250})}
 else say(id,'Nothing to undo yet.',{wait:250});
}
function cvChips(){
 if(!CV.live)return[];var l=[],sp=CV.live;
 if(!sp.table)l.push({label:'Add a table',fn:function(){submit('add a table')}});
 if(!sp.timeline)l.push({label:'Add the incidents timeline',fn:function(){submit('add the timeline')}});
 if(sp.robots.length>1)l.push({label:'Sort high to low',fn:function(){submit('sort high to low')}});
 l.push({label:'Now show parts lost',fn:function(){submit('now show parts lost')}});
 l.push({label:'Only the loaders',fn:function(){submit('only the loaders')}});
 return l;
}
function cvBuild(t,id){
 var met=metricOf(t)||'working';
 if(gated(met))return say(id,'Dollar views are for owners and managers. I can chart working time, minutes down, parts lost or incidents.',{wait:300});
 var shape=(t.match(/\b(pie|donut|line chart|scatter|area|stacked|heat ?map|gauge)\b/)||[])[0],sp={metric:met,robots:robotsOf(t),sort:/high to low|biggest|most|descending/.test(t)?'desc':(/low to high|least|ascending/.test(t)?'asc':null),table:/table/.test(t),timeline:/timeline|incidents in order|(incidents?|stops?).*(table|list|log)|(table|list|log).*(incidents?|stops?)/.test(t)};
 cvPush(sp,'Built: '+specTitle(sp));S.tab='built';CV.tabSpec=null;renderRight();
 say(id,sampleNote(t)+(shape?'I only draw bar charts, so here is a bar chart. ':'')+'Done. I built <b>"'+esc(specTitle(sp))+'"</b> on my screen. Hover any number for how it is calculated.'+(gated(met)?' Dollar figures are hidden in this view.':''),{wait:450,choices:{title:'Keep this view?',sub:'Save it as permanent, or keep changing it by asking.',options:[{label:'Pin this view',fn:function(){cvSave(id)}},{label:'Keep editing',fn:function(){$('input').focus();setChips(id,cvChips())}}]}}).then(function(){setChips(id,cvChips())});
}
function cvFollow(t,id){
 if(!CV.live)return false;var sp=clone(CV.live),label=null,m=metricOf(t),asks=/\b(show|build|make|create|give|chart|graph|plot|draw)\b/.test(t);
 if(/^(can you |please )?(undo|go back|revert|take that back)\b/.test(t)){cvUndo(id);return true}
 if(asks&&m&&m!==CV.live.metric&&!/\b(now|instead|switch|change)\b/.test(t))return false;
 if(/\b(remove|hide|drop) the (table|timeline)\b/.test(t)){if(/table/.test(t))sp.table=false;else sp.timeline=false;label=/table/.test(t)?'Removed the table':'Removed the timeline'}
 else if(/\badd\b.*\btable\b|\bwith a table\b|\bshow\b.*\btable\b/.test(t)&&!m){sp.table=true;label='Added a table'}
 else if(/\btimeline\b|incidents in order/.test(t)){sp.timeline=true;label='Added the incidents timeline'}
 else if(/^(sort|rank|order)\b|order by|high to low|low to high/.test(t)){if(m)sp.metric=m;if(/loader|deburr|inspect/.test(t))sp.robots=robotsOf(t);sp.sort=/low to high|least/.test(t)?'asc':'desc';label='Sorted '+(sp.sort==='asc'?'low to high':'high to low')}
 else if((/^(only|just|filter)\b/.test(t)||/\b(only|just) (the )?(loader|deburr|inspect)/.test(t))&&/loader|deburr|inspect|\barms?\b/.test(t)){sp.robots=robotsOf(t);label='Showing '+scopeLabel(sp.robots).toLowerCase()}
 else if(/\b(now|instead|switch|change)\b/.test(t)&&m){sp.metric=m;label='Switched to '+MET[sp.metric].short}
 if(!label)return false;
 cvPush(sp,label);S.tab='built';CV.tabSpec=null;renderRight();
 say(id,label+'. My screen is updated. You can undo it or open History.',{wait:350}).then(function(){setChips(id,cvChips())});return true;
}
function cvIntent(t,id){
 if(/\b(save|pin|bookmark)\b.*\b(it|this|that|chart|view|dashboard|permanent)\b|\bkeep (it|this|that)\b|make (it|this) permanent/.test(t)&&!/\b(show|build|make|create|chart|graph|plot)\b.*\b(and|then)\b/.test(t)){if(CV.live)cvSave(id);else say(id,'There is nothing on my screen to save yet.',{wait:250});return true}
 if(/^(can you |please )?(undo|go back|revert|take that back)\b/.test(t)){cvUndo(id);return true}
 if(cvFollow(t,id))return true;
 var m=metricOf(t),asks=/\b(show|build|make|create|give|chart|graph|plot|draw|compare|versus|vs|visuali[sz]e|display)\b/.test(t)&&!/make sure/.test(t)&&!/\b(stops?|incidents?)\b.*\b(cost|\$)|\b(cost|\$)\b.*\b(stops?|incidents?)\b/.test(t),thing=/\b(dashboard|chart|graph|view|table|plot)\b/.test(t);
 if(/(parts|output|throughput|production).*(per hour|an hour|\/hr)|per hour.*(parts|output)/.test(t)&&(asks||thing)){say(id,'I do not have a parts per hour chart. I can chart parts lost in incidents, working time, minutes down or incidents.',{wait:300});return true}
 var nav=/\b(the line|the fleet|the incidents|the stops|incident page)\b/.test(t)&&!thing;
 if(nav)return false;
 if(/\b(open|show( me)?|go to|see|take me to)\b[^.]*\b(the|my) (dashboard|overview)\b/.test(t)&&!m&&!/\b(build|make|create|chart|graph|plot)\b/.test(t))return false;
 if((asks&&(thing||m))||/^dashboard of/.test(t)){cvBuild(t,id);return true}
 return false;
}

/* ===== routines (each employee has a few, like Grok Bot) ===== */
var RT={};
function initRoutines(){
 var d=S.cfg.delay;
 function r(n,w,on,ins){return{n:n,w:w,w0:w,on:on!==false,ins:ins,hist:[]}}
 RT={
  mara:[r('Morning brief','Example schedule, not running in this demo',true,'Read the line and the incident list. Tell me what changed overnight: which arm stopped, which waited, and what is holding the line up. One short message. Never control a robot.'),
        r('Weekly cost summary','Example schedule, paused',false,'Build the weekly summary of working time, minutes down and parts lost, and pin it.')],
  stop:[r('Watch for stops','Always on, alert after '+d+' minutes',true,'When a cell stays stopped past '+d+' minutes, tell the first person. If nobody answers in about 10 minutes, tell the backup. Say what the stop is holding up. Never show dollars to people who should not see them.'),
        r('Contact check','Example schedule, not running in this demo',true,'If the feed goes quiet, say so right away. Never show a number as live when it is old.')],
  log:[r('Log stops','Always on',true,'Write each stop the feed reports into the record: when it started, which arm, how long, what the robot reported, and what fixed it if someone says.')]
 };
 ['l1','l2','db','qc'].forEach(function(id,i){RT[id]=[r('Watch '+R[i].name,'Always on',true,'Watch '+R[i].name+' ('+R[i].model+'). Report running, waiting and stopped. Tell the Stop Watcher when it stops. Read only.'),r('Working time check','Example schedule, not running in this demo',true,'Compare '+R[i].name+'’s working time over the last 10 minutes with its normal, and say if it changed.')]});
}
function renderRoutines(){
 var th=TH[S.cur],l=RT[th.id]||[],open=!!S.rtOpen,h='<button type="button" class="rhead rtog" aria-expanded="'+open+'"><span>Routines</span><span class="rcount">'+l.length+(open?'':' active')+'</span><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate('+(open?180:0)+'deg)"><path d="m4 6 4 4 4-4"/></svg></button>';
 if(open)l.forEach(function(r,i){h+='<button type="button" class="rt'+(r.on?'':' off')+'" data-i="'+i+'"><svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/></svg><span><b>'+esc(r.n)+'</b><small>'+esc(r.on?r.w0:r.w)+'</small></span></button>'});
 var el=$('routines');el.className=open?'open':'';el.innerHTML=h;el.querySelector('.rtog').addEventListener('click',function(){S.rtOpen=!S.rtOpen;renderRoutines()});
 [].forEach.call(el.querySelectorAll('.rt'),function(b){b.addEventListener('click',function(){openRoutine(+b.getAttribute('data-i'))})});
}
function openRoutine(i){
 var th=TH[S.cur],r=RT[th.id][i],d=$('rdrawer');
 $('rbody').scrollTop=0;d.className='open';
 d.innerHTML='<div class="rdh"><button class="iconbtn" id="rdBack" type="button" aria-label="Back"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg></button><span class="ttl">Routine</span></div>'+
 '<div class="rdrow"><button class="tog'+(r.on?'':' off')+'" id="rdTog" type="button" role="switch" aria-checked="'+r.on+'" aria-label="Active"><i></i></button><span>'+(r.on?'Active':'Paused')+'</span><span class="sp"></span><button class="btn primary" id="rdTest" type="button">Test run</button></div>'+
 '<div class="lab">Name</div><div class="fld">'+esc(r.n)+'</div><div class="lab">Instruction</div><div class="fld">'+esc(r.ins)+'</div><div class="lab">When to run</div><div class="fld">'+esc(r.w0)+'</div><div class="lab">Run history</div>'+'<div class="mut" style="padding:6px 0">No runs yet in this demo.</div>'+'<p class="mut" style="margin-top:12px">Routines are read only. Change one by asking '+(th.id==='mara'?'Mara':esc(th.name)+' or Mara')+'.</p>';
 $('rdBack').addEventListener('click',function(){d.className='';d.innerHTML=''});
 $('rdTog').addEventListener('click',function(){r.on=!r.on;r.w=r.on?r.w0:'Paused, '+r.w0.charAt(0).toLowerCase()+r.w0.slice(1);openRoutine(i);renderRoutines()});
 $('rdTest').addEventListener('click',function(){
  d.className='';d.innerHTML='';
  if(th.id==='mara'&&/brief/i.test(r.n))say('mara','<b>Test run, Morning brief.</b> On Sep 3, the last day of the sample, Loader 2 stopped 4 minutes and Deburr waited 3 minutes. The line was making about 264 parts an hour against about 293 normally. Nothing needs you right now.',{wait:350,tag:'Test'});
  else say(th.id,'<b>Test run, '+esc(r.n)+'.</b> Test only. In this demo a routine does not run on a schedule and sends nothing.',{wait:350,tag:'Test'});
 });
}
