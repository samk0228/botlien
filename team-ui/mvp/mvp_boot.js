/* ===== boot ===== */
/* no pills: any element whose corner radius is half its short side (and bigger than a 10px dot) becomes a 6px rectangle.
   Reads first, writes second, so one sweep is one layout. */
function depill(doc){
 try{var win=doc.defaultView,els=doc.querySelectorAll('body *'),hit=[],i;
  for(i=0;i<els.length;i++){var el=els[i];if(!(el instanceof win.HTMLElement))continue;if(doc===document&&el.closest&&el.closest('#composer,#onb'))continue;
   var m=Math.min(el.offsetWidth,el.offsetHeight);if(m<=10)continue;
   var rs=win.getComputedStyle(el).borderTopLeftRadius;if(!rs||rs==='0px')continue;
   var r=parseFloat(rs);if(/%/.test(rs)?r>=45:r>=m/2-0.5)hit.push(el)}
  for(i=0;i<hit.length;i++)hit[i].style.setProperty('border-radius','6px','important');
  if(doc!==document){fixDash(doc);enhance(doc)}
 }catch(e){}
}

/* design pass 1: status colors on the Line cards, bars on Fleet and Incidents */
function enhance(doc){
 try{
  /* lean copy: the blocks explain themselves, so long sentences under them go or get one short line */
  var HIDE=[/^Sample data through Sep 3\. With the live feed/,/^\$[\d.,]+ = Loader 1/,/^Built on list prices and two shifts/,/^Dashed boxes are machines, not robots\./,/^Counts the last robot in the line/,/^Recorded from the simulated robots and played back/,/^The arm at the top is the one to speed up/];
  var SWAP=[
   [/^Idle cost is the most you could win back/,function(){return 'Idle cost is an upper bound, not a promise.'}],
   [/^Your 4 arms cost \$[\d.,]+ an hour to own and run\. They worked (\d+)% of their scheduled time, so each hour of real work cost \$([\d.,]+)\./,function(m){return '$'+m[2]+' per hour of real work. The arms worked '+m[1]+'% of their scheduled time.'}],
   [/^Every robot waits more than it works/,function(){return 'Every robot waits more than it works. The limit is most likely a CNC mill.'}]
  ];
  (function(){var all=doc.body.querySelectorAll('body>div,body>div>div,body>div>div>div'),w=doc.defaultView;for(var q=0;q<all.length;q++){var el=all[q];if(el.getAttribute('data-pg'))continue;if(w.getComputedStyle(el).backgroundColor==='rgb(244, 245, 249)'){el.setAttribute('data-pg','1');el.style.setProperty('background','#F8F8F8','important')}}})();
  [].forEach.call(doc.querySelectorAll('div,span'),function(e){if(e.getAttribute('data-lean'))return;var t=(e.textContent||'').replace(/\s+/g,' ').trim();
   if(/^Estimated\s*(Built on list prices and two shifts\.)?\s*Use your own numbers$/.test(t)){e.style.setProperty('display','none','important');e.setAttribute('data-lean','1')}
   else if(t==='to own and run'&&e.children.length===0){e.textContent='estimated, to own and run';e.setAttribute('data-lean','1')}});
  (function(){var tw=doc.createTreeWalker(doc.body,4,null),tn,list=[];while((tn=tw.nextNode())){var v=tn.nodeValue;if(v==='The line, left to right'||v==='All kinds'||v==='What it reported'||/^\s*\d+ of \d+\s*$/.test(v))list.push(tn)}
   list.forEach(function(t2){var v=t2.nodeValue.trim();if(v==='The line, left to right'){t2.nodeValue='The line'}else if(v==='All kinds'){t2.nodeValue='All'}else if(v==='What it reported'){t2.nodeValue='Reported'}else if(t2.parentNode&&!t2.parentNode.getAttribute('data-lean')){t2.nodeValue='Parts waiting '+v;t2.parentNode.setAttribute('data-lean','1')}})})();
  var cand=doc.body.querySelectorAll('p,div,span');
  for(var z=0;z<cand.length;z++){var ce=cand[z];if(ce.getAttribute('data-lean'))continue;
   var tt=(ce.textContent||'').trim();if(tt.length<20||tt.length>420)continue;
   var simple=ce.tagName==='P'||ce.children.length===0||[].every.call(ce.children,function(k){return /^(A|B|I|SPAN|STRONG)$/.test(k.tagName)});if(!simple)continue;
   var hit=false;
   for(var h=0;h<HIDE.length;h++)if(HIDE[h].test(tt)){ce.style.setProperty('display','none','important');ce.setAttribute('data-lean','1');hit=true;break}
   if(hit)continue;
   for(var s2=0;s2<SWAP.length;s2++){var mm=tt.match(SWAP[s2][0]);if(mm){ce.textContent=SWAP[s2][1](mm);ce.setAttribute('data-lean','1');break}}
  }
  var dk=doc.documentElement.classList.contains('dk'),all=doc.body.querySelectorAll('body>div,body>div>div,body>div>div>div'),w=doc.defaultView;
  for(var q=0;q<all.length;q++){var el=all[q];
   if(dk){if(w.getComputedStyle(el).backgroundColor==='rgb(244, 245, 249)'){el.setAttribute('data-pg','1');el.style.setProperty('background','#0F0F10','important')}}
   else if(el.getAttribute('data-pg')){el.style.removeProperty('background');el.removeAttribute('data-pg')}}
  [].forEach.call(doc.querySelectorAll('.ours-label'),function(l){
   var t=(l.textContent||'').trim().toLowerCase(),c=/^work/.test(t)?'s-g':/^(wait|idle)/.test(t)?'s-a':/^(stop|err|lost|down)/.test(t)?'s-r':'';
   l.classList.remove('s-g','s-a','s-r');if(c)l.classList.add(c);
   var top=l.closest('div[style*="border-radius:8px"]'),dot=top&&top.querySelector('i');
   if(dot&&dot!==l.querySelector('i')){var col={'s-g':'#17A05B','s-a':'#E2A100','s-r':'#D93A43'}[c];if(col)dot.style.setProperty('background',col,'important')}
  });
  [].forEach.call(doc.querySelectorAll('[data-rc-row]'),function(r){
   var w=r.children[3];if(!w||w.querySelector('.wbar'))return;
   var p=parseFloat((w.textContent||'').replace('%',''));if(isNaN(p))return;
   var col=p>=35?'#17A05B':p>=15?'#E2A100':'#D93A43';var tile=r.children[0]&&r.children[0].firstElementChild;if(tile&&!tile.querySelector('.sdot')){tile.innerHTML='<i class="sdot" style="background:'+col+'"></i>';tile.style.display='flex';tile.style.alignItems='center'}
   var b=doc.createElement('span');b.className='wbar';b.innerHTML='<i style="width:'+Math.max(2,Math.min(100,p))+'%;background:'+col+'"></i>';w.appendChild(b);
  });
  [].forEach.call(doc.querySelectorAll('[data-incident-row]'),function(r){
   var d=r.children[4]?r.querySelectorAll(':scope>div:not([data-incident-drop])')[3]:null;if(!d||d.querySelector('.dbar'))return;
   var m=parseFloat(d.textContent);if(isNaN(m))return;
   var b=doc.createElement('span');b.className='dbar';b.innerHTML='<i style="width:'+Math.max(6,Math.min(100,m/12*100))+'%"></i>';d.appendChild(b);
  });
 }catch(e){}
}
/* the embedded dashboard writes ranges with an en dash; our copy rule says "to" */
function fixDash(doc){
 try{var w=doc.createTreeWalker(doc.body,4,null),n,list=[];
  while((n=w.nextNode())){var p=n.parentNode;if(!p||/^(SCRIPT|STYLE|TEXTAREA)$/i.test(p.nodeName))continue;if(n.nodeValue.indexOf('–')>=0)list.push(n)}
  list.forEach(function(n){var v=n.nodeValue.replace(/\s–\s/g,' to ').replace(/^\s*–\s*$/,'none').replace(/(\d)–(\d)/g,'$1 to $2');if(v!==n.nodeValue)n.nodeValue=v});
 }catch(e){}
}
var depillT;function depillSoon(doc,ms){clearTimeout(depillT);depillT=setTimeout(function(){depill(doc)},ms||250)}
/* pages of the embedded dashboard the demo may show */
function okViews(){var v=S.role==='Owner'?{dashv2:1,line:1,robots:1,robot:1,incidents:1}:{dashv2:1,line:1,robots:1,incidents:1};if(HOSTED&&S.role==='Owner'){v.costs=1;v.payback=1;v.trends=1}return v}
function syncScreen(){var a=$('app'),n=matchMedia('(max-width:1180px)').matches;$('screenBtn').setAttribute('aria-pressed',(n?a.classList.contains('rshow'):!a.classList.contains('noscreen'))?'true':'false')}

var SAM_CSS=['html{color-scheme:light only}',
 'aside[data-side]{display:none!important}',
 '[data-topbar]{display:none!important}',
 '[data-card]>div[style*="margin-top:36px"]{display:none!important}',
 'body{overflow-x:hidden}',
 'body.ov [data-dash-cols]{grid-template-columns:minmax(0,1fr)!important}',
 'body.ov #dashGrid,body.ov [data-dash-cols]~*{display:none!important}',
 'body.ov{overflow:hidden}',
 '.ours-askbtn,[data-ba-toggle],[data-act="peekTab"],[data-act="toggleTabSheet"],[data-act="toggleDashEdit"],[data-act="dashCustomize"],[data-act="logOut"],a[href^="mailto:"]{display:none!important}',
 'body.tech .mv{color:transparent!important;background:#DADADD;border-radius:3px;user-select:none;-webkit-user-select:none}',
 'body.tech text.mv,body.tech tspan.mv,body.tech .mv text{fill:transparent!important}',
 '@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto!important}}',
 '@media (max-width:560px){html,body{overflow:hidden!important}}',
 '[style*="border-radius:999px"],[style*="border-radius: 999px"]{border-radius:6px!important}',
 'main,[data-main]{padding-top:8px!important}',
 '[data-grid]{min-height:0!important}',
 '[data-card]>div[style*="min-height:40px"]:has(>div:empty){display:none!important}',
 '[data-card]>div[style*="min-height:40px"]{margin-bottom:12px!important;min-height:0!important}',
 '[data-card][style*="padding:24px 24px 40px"]{padding-top:12px!important}',
 '[data-card] p[style*="color:var(--fg2);max-width:78ch;margin:0"]{display:none!important}',
 '.ours-station-row{flex-direction:column!important;align-items:stretch!important;overflow:visible!important;gap:0!important}',
 '.ours-station-row>div[style*="flex:1 1 160px"]{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));flex:none!important;min-width:0!important;max-width:none!important}',
 '.ours-station-row>div:not([style*="flex:1 1 160px"]){flex-direction:row!important;justify-content:center;gap:10px!important;padding:8px 0!important}',
 '.ours-station-row>div:not([style*="flex:1 1 160px"]) svg{transform:rotate(90deg)}',
/* ---- design pass 1: status color, quiet tiles, tidy tables ---- */
 ':root{--st-g:#17A05B;--st-a:#E2A100;--st-r:#D93A43;--st-gt:#0B7A41;--st-at:#8A5A00;--st-rt:#B3262F}',
 'body{-webkit-font-smoothing:antialiased}',
 '[data-incident-drop]{display:none!important}',
 'html[data-fit] [data-incident-head],html[data-fit] [data-incident-row],html [data-incident-head],html [data-incident-row]{grid-template-columns:92px minmax(80px,.7fr) 74px 56px minmax(140px,1.6fr)!important;gap:10px!important;padding:11px 14px!important}',
 '[data-incident-row]>div:nth-child(6){font-size:13px;line-height:1.4;color:var(--fg2)}',
 '[data-incident-head]>div{font-size:12px!important;font-weight:500!important;letter-spacing:.01em}',
 '[data-incident-row]>div:nth-child(5){font-weight:600;color:var(--fg1)!important;display:flex;flex-direction:column;gap:5px}',
 '.dbar{display:block;height:3px;border-radius:2px;background:rgba(10,10,10,.08);overflow:hidden;max-width:96px}',
 '.dbar i{display:block;height:100%;background:var(--st-r);border-radius:2px}',
 '.wbar{display:block;height:6px;border-radius:3px;background:rgba(10,10,10,.08);overflow:hidden;width:100%;max-width:140px;margin-top:6px}',
 '.wbar i{display:block;height:100%;border-radius:3px}',
 '[data-rc-row]>div:nth-child(2),[data-rc-row]>div:nth-child(3),[data-rc-row]>div:nth-child(5),[data-rc-head]>div:nth-child(2),[data-rc-head]>div:nth-child(3),[data-rc-head]>div:nth-child(5){display:none!important}',
 '[data-rc-row],[data-rc-head]{grid-template-columns:minmax(0,1.6fr) minmax(110px,1fr) minmax(88px,.7fr) 24px!important;gap:14px!important}',
 '[data-rc-row]{padding:14px 18px!important}',
 '[data-rc-row]>div:nth-child(4){font-weight:600;font-size:14px;font-variant-numeric:tabular-nums}',
 '[data-rc-row]>div:nth-child(6){font-size:16px!important;font-weight:600!important;letter-spacing:-.01em}',
 '[data-metric-tabs]{gap:0!important}',
 '[data-metric-tabs]>[data-tile]{border-radius:0!important;background:transparent!important;border:0!important;border-bottom:1px solid var(--hair)!important;margin:0!important;padding:10px 14px 11px!important}',
 '[data-metric-tabs]>[data-tile][aria-selected="true"]{border-bottom:2px solid var(--fg1)!important}',
 '[data-metric-tabs]>[data-tile][aria-selected="true"]>span{display:none!important}',
 '[data-metric-tabs] [data-tab-value]{font-size:15px!important;font-weight:600!important}',
 '[data-metric-tabs]>[data-tile]:not([aria-selected="true"]) [data-tab-value]{color:var(--fg2)!important;font-weight:500!important}',
 '.ours-label{font-weight:600!important}',
 '.ours-label.s-g{color:var(--st-gt)!important}.ours-label.s-a{color:var(--st-at)!important}.ours-label.s-r{color:var(--st-rt)!important}',
 '.ours-label.s-g i{background:var(--st-g)!important}.ours-label.s-a i{background:var(--st-a)!important}.ours-label.s-r i{background:var(--st-r)!important}',
 '.ours-label i{width:8px!important;height:8px!important}',
 'i.sd9{background:var(--st-g)!important}i.sd9.a{background:var(--st-a)!important}i.sd9.r{background:var(--st-r)!important}',
 '[data-card]{--hair:rgba(10,10,10,.12)}',
 'h2{letter-spacing:-.015em}',
 'html,body,button,input,select,textarea{font-family:Inter,-apple-system,"Segoe UI",system-ui,sans-serif!important}',
 '[style*="font-size:48px"]{font-weight:300!important;letter-spacing:-.035em!important}',

 ':root{--menu:#fff}',
 'div[style*="z-index:45"][style*="top:40px"]>div:first-child{border-bottom:0!important;padding-bottom:14px!important}',
 'div[style*="z-index:45"][style*="top:40px"]>div:nth-child(2){margin:6px 16px 16px!important;background:#fff!important;max-width:calc(100% - 32px)}',

 '@media (max-width:560px){[data-incident-row]::after{display:none}[data-incident-row]{padding-right:0!important}}',

 '.ours-seg[data-k="site"],.ours-seg[data-k="shift"],span[style*="width:1px"][style*="height:28px"]{display:none!important}',
 '[data-incident-row]{position:relative;padding-right:30px!important}',
 '[data-incident-row]::after{content:"";position:absolute;right:12px;top:50%;width:7px;height:7px;border-right:1.5px solid #6E6E73;border-top:1.5px solid #6E6E73;transform:translateY(-50%) rotate(45deg)}',
 '[data-incident-row]:hover{background:rgba(10,10,10,.035)}',

 'div[style*="position:absolute"][style*="top:40px"][style*="right:0"][style*="z-index:45"]{background:#fff;border:1px solid var(--hair);box-shadow:0 8px 24px rgba(10,10,10,.14);border-radius:8px;overflow:hidden}',

 ':root{--fg1:#0A0A0A;--fg2:#4A4A50;--fg3:#6E6E73;--acc:#0A0A0A;--dash-ink:#0A0A0A;--dash-sub:#6E6E73;--dash-page:#F8F8F8}',
 'body{background:#F8F8F8!important}',
 'a,[data-act="go"][style*="underline"]{color:#0A0A0A!important}',
 'h2{font-weight:500!important;letter-spacing:-.02em!important}',
 '[style*="font-size:48px"]{font-weight:400!important;letter-spacing:-.035em!important}',
 'svg [fill^="url("]{fill:rgba(10,10,10,.045)!important}',
 'svg path[stroke][fill="none"]{stroke-width:1.5!important}',

 '@media (max-width:560px){html[data-fit] [data-incident-row],html [data-incident-row]{grid-template-columns:minmax(0,1fr) 64px!important;grid-template-rows:auto auto auto;row-gap:4px!important}[data-incident-row]>div:nth-child(1){grid-area:1/1}[data-incident-row]>div:nth-child(3){grid-area:2/1}[data-incident-row]>div:nth-child(4){display:none!important}[data-incident-row]>div:nth-child(5){grid-area:1/2/3/3;align-self:center}[data-incident-row]>div:nth-child(6){grid-area:3/1/4/3;font-size:13px}div:has(>.ours-seg){flex-wrap:nowrap!important;overflow-x:auto;width:auto;max-width:100%;scrollbar-width:none}.ours-seg{flex:none}}',

 'html.dk{color-scheme:dark;--fg1:#F2F2F4;--fg2:#B8B8BE;--fg3:#8E8E96;--card:#1C1C1E;--ghost:rgba(255,255,255,.07);--hair:rgba(255,255,255,.14);--hair2:rgba(255,255,255,.2);--hair3:rgba(255,255,255,.3);--acc:#F2F2F4;--acc-fg:#0A0A0A;--good:#4CC38A;--warn:#E8B04A;--bad:#FF7A80;--st-gt:#4CC38A;--st-at:#E8B04A;--st-rt:#FF7A80}',
 'html.dk,html.dk body{background:#0F0F10!important;color:var(--fg1)}',
 'html.dk .ours-seg[style*="var(--acc)"]{background:#3A3A3F!important;color:#fff!important}',
 'html.dk div:has(>.ours-seg){background:rgba(255,255,255,.08)}',
 'html.dk .wbar,html.dk .dbar{background:rgba(255,255,255,.14)}',
 'h2{font-size:17px!important;font-weight:600!important}',
 '[data-card] p{font-size:15px!important;line-height:1.5!important}',
 '.sdot{display:block;width:12px;height:12px;border-radius:50%;margin:0 auto}',
 '[data-rc-row]>div:first-child>div:first-child{width:20px!important;height:34px!important;background:transparent!important}',
 '@media (pointer:coarse){[data-rc-row],[data-incident-row]{min-height:56px}[data-act],[role=button],[role=tab]{min-height:44px}}',

 'div:has(>.ours-seg){gap:2px!important;padding:3px!important;background:rgba(10,10,10,.06);border-radius:9px;width:fit-content;max-width:100%;margin-bottom:12px!important}',
 '.ours-seg{height:30px!important;border:0!important;background:transparent!important;color:var(--fg2)!important;border-radius:7px!important;font-weight:500!important}',
 '.ours-seg[style*="var(--acc)"]{background:#fff!important;color:var(--fg1)!important;font-weight:600!important;box-shadow:0 1px 2px rgba(10,10,10,.14),0 0 0 1px rgba(10,10,10,.05)}',
 '@media (pointer:coarse){.ours-seg{height:40px!important;padding:0 14px!important}}',


].join('');

function onSamLoad(){
 var F=window.__F;
 try{if(window.__techObs){window.__techObs.disconnect();window.__techObs=null}}catch(e){}
 try{var d=F.contentDocument,st=d.createElement('style');st.textContent=SAM_CSS;d.head.appendChild(st);var lk=d.createElement('link');lk.rel='stylesheet';lk.href='https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap';d.head.appendChild(lk)}catch(e){}
 applyTheme();clearInterval(window.__enhT);
 try{if(window.__enhObs)window.__enhObs.disconnect();var _d=F.contentDocument,_busy=0;
  window.__enhObs=new (F.contentWindow.MutationObserver)(function(){if(_busy)return;_busy=1;try{enhance(_d)}catch(e){}try{window.__enhObs.takeRecords()}catch(e){}_busy=0});
  window.__enhObs.observe(_d.body,{childList:true,subtree:true,characterData:true});enhance(_d)}catch(e){}
 try{var dd=F.contentDocument,dw=F.contentWindow;
  S.frameLoaded=1;
  dd.body.classList.toggle('tech',S.role!=='Owner');
  /* Sam's own assistant is replaced by the agents on the left */
  var toMara=function(){openThread('mara');setTimeout(function(){$('input').focus()},0)};
  function hookBA(){try{var BA=dw.BotlienAssistant;if(BA){BA.open=toMara;BA.toggle=toMara;BA.close=function(){};BA.ask=function(t,o){openThread('mara');if(o&&o.send===false){$('input').value=t==null?'':String(t);$('composer').classList.toggle('has',!!t);$('input').focus()}else submit(t)}}}catch(e){}}
  hookBA();setTimeout(hookBA,1500);
  dd.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='k'){e.preventDefault();e.stopImmediatePropagation();toMara()}},true);
  /* only the pages this demo shows can be opened, and nothing can log out, customize or export for a technician */
  var BLOCK={logOut:1,peekTab:1,toggleTabSheet:1,openNumbersRobot:1,rcOwn:1,dashCustomize:1,toggleDashEdit:1},OWNER_ONLY={copyBrief:1,copyCredit:1,printPage:1,downloadIncidents:1};
  function guard(e){var a=e.target.closest&&e.target.closest('[data-act]');if(!a)return;var act=a.getAttribute('data-act');
   if(act==='go'){if(okViews()[a.getAttribute('data-view')])return;e.preventDefault();e.stopImmediatePropagation();return}
   if(BLOCK[act]||(OWNER_ONLY[act]&&S.role!=='Owner')){e.preventDefault();e.stopImmediatePropagation()}}
  dd.addEventListener('click',guard,true);
  dd.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' ')guard(e)},true);
  /* money in the technician view: hidden in text, titles, labels and the clipboard */
  var MON=/\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmMbB]\b)?/g,busy=false;
  function hasMoney(s){MON.lastIndex=0;var r=MON.test(s);MON.lastIndex=0;return r}
  try{var cb=dw.navigator.clipboard,cw=cb.writeText.bind(cb);cb.writeText=function(t){return cw(S.role==='Owner'?t:String(t).replace(MON,''))}}catch(e){}
  function wrap(root){
   var w=dd.createTreeWalker(root,4,null),nodes=[],n;
   while((n=w.nextNode())){var p=n.parentNode;if(!p||/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/i.test(p.nodeName))continue;if(p.classList&&p.classList.contains('mv'))continue;if(hasMoney(n.nodeValue))nodes.push(n)}
   nodes.forEach(function(n){var p=n.parentNode;
    if(p.nodeName.toLowerCase()==='title'){n.nodeValue=n.nodeValue.replace(MON,'');return}
    if(p.namespaceURI==='http://www.w3.org/2000/svg'){p.classList.add('mv');return}
    var txt=n.nodeValue,frag=dd.createDocumentFragment(),last=0,m;MON.lastIndex=0;
    while((m=MON.exec(txt))){if(m.index>last)frag.appendChild(dd.createTextNode(txt.slice(last,m.index)));var sp=dd.createElement('span');sp.className='mv';sp.textContent=m[0];frag.appendChild(sp);last=m.index+m[0].length}
    if(last<txt.length)frag.appendChild(dd.createTextNode(txt.slice(last)));p.replaceChild(frag,n)});
   [].forEach.call(root.querySelectorAll('[title],[aria-label],[placeholder]'),function(el){['title','aria-label','placeholder'].forEach(function(a){var v=el.getAttribute(a);if(v&&hasMoney(v))el.setAttribute(a,v.replace(MON,''))})});
  }
  window.__techOn=function(){wrap(dd.body);if(!window.__techObs){var obs=new dw.MutationObserver(function(){if(S.role==='Owner'||busy)return;busy=true;try{wrap(dd.body)}finally{busy=false;obs.takeRecords()}});obs.observe(dd.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder']});window.__techObs=obs}};
  if(S.role!=='Owner')window.__techOn();
  /* the dashboard draws itself every few seconds; skip that while its tab is not showing */
  var so=dw.oursSoftRender;
  if(typeof so==='function'){dw.oursSoftRender=function(){if(['ov','line','fleet','inc'].indexOf(S.tab)<0){window.__samDirty=1;return}var r=so.apply(this,arguments);depillSoon(dd,1500);return r};
   window.__samFlush=function(){if(window.__samDirty){window.__samDirty=0;try{so()}catch(e){}}}}
  window.__depillDoc=dd;
  depillSoon(dd,3000);
 }catch(e){}
 setTimeout(function(){samGo(tabView(S.tab)||'dashv2');renderRight()},400);
}

function boot(){
 F=$('samframe');window.__F=F;
 F.addEventListener('load',onSamLoad);
 initThreads();if(window.__ONB){resetAll();onbOpen()}else startReady();liveInit();hostedRole();
 /* the dashboard is started after the chat has painted */
 var started=false;
 function start(){if(started)return;started=true;
  /* Hosted: the account's own dashboard, live, instead of the sample snapshot; none for a viewer the server
     sends no dollars to (the dashboard is all dollars). */
  if(HOSTED){$('samsrc').textContent='';if(window.__BOTLIEN_HOSTED.dollars!==false)F.src='/app?page=mfg';return}
  try{var raw=$('samsrc').textContent.replace(/<\/scr@@ipt/g,'<'+'/script').replace(/<!@@--/g,'<'+'!--');F.srcdoc=raw;$('samsrc').textContent=''}
  catch(e){S.frameErr=1;renderChip();renderRight()}}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(start,60)});else setTimeout(start,60);
 setTimeout(function(){if(HOSTED&&window.__BOTLIEN_HOSTED.dollars===false)return;if(!S.frameLoaded||(!HOSTED&&!ours())){S.frameErr=1;renderChip();renderRight()}},45000);
 setInterval(function(){if(!document.hidden)poll()},2000);
 setInterval(function(){if(!document.hidden)depill(document)},8000);setTimeout(function(){depill(document)},2500);
 $('demoBtn').addEventListener('click',function(e){e.stopPropagation();openMore(false);openMenu($('demoMenu').className!=='open')});
 document.addEventListener('click',function(e){if(!e.target.closest('.menuwrap'))openMenu(false)});
 [].forEach.call($('demoMenu').querySelectorAll('button'),function(b){b.addEventListener('click',function(){openMenu(false);var sec=b.getAttribute('data-s');if(sec){if(window.closeDrawer)closeDrawer();openSettings(sec)}else{$('demoBtn').focus();demo(b.getAttribute('data-d'))}})});
 $('roleBtn').addEventListener('click',function(){if(HOSTED_ROLE_LOCKED)return;setRole(S.role==='Owner'?'Technician':'Owner')});
 $('composer').addEventListener('submit',function(e){e.preventDefault();submit($('input').value)});
$('input').addEventListener('input',function(){$('composer').classList.toggle('has',!!$('input').value.trim());growInput()});
 $('input').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('composer').dispatchEvent(new Event('submit',{cancelable:true}))}});
 $('plusBtn').addEventListener('click',function(e){e.stopPropagation();plusMenu(!!$('plusMenu').hidden)});
 $('plusMenu').addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-pq]');if(!b)return;plusMenu(false);submit(b.getAttribute('data-pq'))});
 document.addEventListener('click',function(e){if(!$('plusMenu').hidden&&!e.target.closest('#plusMenu'))plusMenu(false)});
 $('plusMenu').addEventListener('keydown',function(e){if(e.key==='Escape'){plusMenu(false);$('plusBtn').focus()}});
 $('voiceBtn').addEventListener('click',function(){VOICE.on=!VOICE.on;if(!VOICE.on)stopSpeech();else speak('Voice replies are on.');syncVoice()});
 if(!window.speechSynthesis)$('voiceBtn').style.display='none';
 syncVoice();
 $('q').addEventListener('input',function(){S.q=$('q').value;renderSide()});
 $('brandmark').src=LOGO;
 var rtb=$('rtabs');rtb.addEventListener('keydown',function(e){var k=e.key,tabs=[].slice.call(rtb.querySelectorAll('[role=tab]')),i=tabs.indexOf(document.activeElement);if(i<0)return;var n=k==='ArrowRight'?(i+1)%tabs.length:k==='ArrowLeft'?(i-1+tabs.length)%tabs.length:k==='Home'?0:k==='End'?tabs.length-1:-1;if(n<0)return;e.preventDefault();tabs[n].focus();setTab(tabs[n].getAttribute('data-t'))});
  $('demoMenu').addEventListener('keydown',function(e){var it=[].slice.call(this.querySelectorAll('[role=menuitem]')),i=it.indexOf(document.activeElement);if(e.key==='Escape'){openMenu(false);$('demoBtn').focus()}else if(e.key==='ArrowDown'){e.preventDefault();it[(i+1)%it.length].focus()}else if(e.key==='ArrowUp'){e.preventDefault();it[(i-1+it.length)%it.length].focus()}else if(e.key==='Tab')openMenu(false)});
 var ptr=false;$('side').addEventListener('pointerdown',function(){ptr=true});$('side').addEventListener('keydown',function(){ptr=false});
 var lastH=0;if(window.ResizeObserver)new ResizeObserver(function(){var h=$('list').clientHeight;if(h===lastH)return;lastH=h;fitRoster();moveMark()}).observe($('list'));
 $('list').addEventListener('click',railClick);
 $('morebtn').addEventListener('click',function(e){e.stopPropagation();openMenu(false);openMore($('morepop').className!=='open')});
 $('morelist').addEventListener('click',moreClick);
 document.addEventListener('click',function(e){if(!e.target.closest('#morepop')&&!e.target.closest('#morebtn'))openMore(false)});
 var rzt;window.addEventListener('resize',function(){clearTimeout(rzt);rzt=setTimeout(function(){fitRoster();moveMark();syncScreen()},120)});$('livepanel').addEventListener('click',liveClick);$('smodal').addEventListener('click',smodalClick);$('onb').addEventListener('click',onbClick);$('onb').addEventListener('input',function(e){var t=e.target;if(t.id==='onbName')ONB.acct.name=t.value;if(t.id==='onbEmail')ONB.acct.email=t.value;if(t.id==='onbCo')ONB.acct.co=t.value;t.removeAttribute('aria-invalid')});$('tvx').addEventListener('click',closeTV);applyTheme();$('ssearch').addEventListener('input',renderSettings);document.addEventListener('keydown',trapTab);$('micBtn').addEventListener('click',micToggle);if(!VOICE.sr)$('micBtn').style.display='none';
 ['side','sidein','list'].forEach(function(id){var e=$(id);e.addEventListener('scroll',function(){if(e.scrollLeft&&!matchMedia('(max-width:560px)').matches)e.scrollLeft=0})});
 $('side').addEventListener('mouseleave',function(){openMenu(false);if(!$('morepop').contains(document.activeElement))openMore(false);if(!ptr)return;var a=document.activeElement;if(a&&a!==document.body&&$('side').contains(a)&&a.tagName!=='INPUT')a.blur()});
 syncScreen();
 function phone(){return matchMedia('(max-width:560px)').matches}
 function setDrawer(on){$('app').classList.toggle('drawer',on);$('menuBtn').setAttribute('aria-expanded',on?'true':'false')}
 window.closeDrawer=function(){setDrawer(false)};
 $('menuBtn').addEventListener('click',function(e){e.stopPropagation();setDrawer(!$('app').classList.contains('drawer'))});
 document.addEventListener('click',function(e){if($('app').classList.contains('drawer')&&!e.target.closest('#side')&&!e.target.closest('#menuBtn'))setDrawer(false)});
 $('list').addEventListener('click',function(e){if(phone()&&e.target.closest('.emp'))setTimeout(function(){setDrawer(false)},0)});
 window.addEventListener('resize',function(){if(!phone())setDrawer(false)});
 $('screenBtn').addEventListener('click',function(){var a=$('app'),n=matchMedia('(max-width:1180px)').matches;if(n)a.classList.toggle('rshow');else a.classList.toggle('noscreen');syncScreen();setTimeout(renderRight,0)});
 var tipEl=$('tip');
 document.addEventListener('keydown',function(e){if(e.key==='Escape'){plusMenu(false);closeTV();closeSettings();setDrawer(false);openMore(false);var a=$('app');if(a.classList.contains('rshow')){a.classList.remove('rshow');syncScreen();$('screenBtn').focus()}tipEl.style.display='none'}});
 $('rclose').addEventListener('click',function(){$('app').classList.remove('rshow');syncScreen()});
 var tipId=null;
 function showTip(t,x,y){var id=t.getAttribute('data-tip');if(id!==tipId){var h=(window.__tips||[])[id];if(!h)return;tipEl.innerHTML=h;tipId=id}tipEl.style.display='block';var w=tipEl.offsetWidth,hh=tipEl.offsetHeight,px=Math.min(x+14,innerWidth-w-10),py=y+16;if(py+hh>innerHeight-10)py=y-hh-12;tipEl.style.left=Math.max(8,px)+'px';tipEl.style.top=Math.max(8,py)+'px'}
 document.addEventListener('mouseover',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');if(t)showTip(t,e.clientX,e.clientY)});
 document.addEventListener('mousemove',function(e){if(tipEl.style.display==='block'){var t=e.target.closest&&e.target.closest('[data-tip]');if(t)showTip(t,e.clientX,e.clientY)}});
 document.addEventListener('mouseout',function(e){if(e.target.closest&&e.target.closest('[data-tip]')){tipEl.style.display='none';tipId=null}});
 document.addEventListener('focusin',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');if(t){var r=t.getBoundingClientRect();showTip(t,r.left,r.bottom)}});
 document.addEventListener('focusout',function(){tipEl.style.display='none';tipId=null});
 window.__mvp={S:S,submit:submit,feed:feed,simStop:simStop,demo:demo,CV:CV,setRole:setRole,openSettings:openSettings,closeSettings:closeSettings,openTV:openTV,closeTV:closeTV,setTheme:setTheme,openThread:openThread,enhance:enhance,depill:depill};
 Object.defineProperty(window.__mvp,'TH',{get:function(){return TH}});
}
boot();
})();
