// fake stops server for testing the live feed. Opens a stop, then closes it 25 seconds later.
const http=require('http');let t0=null,acks=[],fixes=[];
const srv=http.createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin',req.headers.origin||'null');res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
 if(req.method==='OPTIONS'){res.end();return}
 let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  if(req.url.startsWith('/stops/')&&req.method==='POST'){(req.url.endsWith('/ack')?acks:fixes).push(body);res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return}
  if(req.url.startsWith('/stops')){
   if(!t0)t0=Date.now();const el=(Date.now()-t0)/1000;
   const open=el<25;
   const stop={id:'stop-1',robot:'Loader 2',state:open?'open':'closed',source:'replay',startedAt:new Date(t0-6*60000).toISOString(),endedAt:open?null:new Date(t0+25000).toISOString(),minutes:open?6:31,type:'fault',errorCode:'C153',description:'Protective stop',repeatCount:3,leftWaiting:['Deburr'],robotTimeCost:open?0.44:2.28,partsLost:open?14:71,acks:acks.length?[{by:'Dana',kind:'on',at:new Date().toISOString()}]:[]};
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({cursor:Math.floor(el),stops:[stop]}));return}
  if(req.url==='/_log'){res.end(JSON.stringify({acks,fixes}));return}
  res.statusCode=404;res.end('{}');
 });
});
srv.listen(8781,()=>console.log('mock on 8781'));
