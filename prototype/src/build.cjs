const fs=require('fs');
const {assets,icons,icons_mfg}=JSON.parse(fs.readFileSync('assets.json','utf8'));
/* Two pages are built from here.
   botlien.part.html      -> ../botlien-prototype.html  the page real accounts and the demo get today.
   botlien-mfg.part.html  -> ../botlien-mfg.html        the manufacturing dashboard: the same page with
                             Antonio's v4 merged in (Ask, Integrations, Line, the URSim replay). It shows
                             its own sample until it is wired to real data, so nothing serves it to a
                             real account yet. */
function build(part, iconSet){
  let out=fs.readFileSync(part,'utf8');
  out=out.replace('__ICONS_JSON__', JSON.stringify(iconSet));
  out=out.split('__LOGO__').join(assets.LOGO);
  out=out.replace('__INTER_EXT__', assets.INTER_EXT);
  out=out.replace('__INTER__', assets.INTER);
  // The live data adapter lives in its own file so a node test can require it.
  out=out.replace('__LIVE_ADAPTER__', () => fs.readFileSync('live-adapter.cjs','utf8').replace(/\nif \(typeof module[^\n]*\n?$/, '\n'));
  // Mara's scripted engine, likewise its own file for the node test.
  out=out.replace('__MARA__', () => fs.readFileSync('mara.cjs','utf8').replace(/\nif \(typeof module[^\n]*\n?$/, '\n'));
  if(/__[A-Z_]+__/.test(out)){ console.error('LEFTOVER PLACEHOLDER in '+part+':', out.match(/__[A-Z_]+__/g).slice(0,5)); process.exit(1); }
  return out;
}
const out=build('botlien.part.html', icons);
/* ../botlien-prototype.html is the file that actually gets opened and published.
   It used to be copied over by hand, which let it drift from the source. */
fs.writeFileSync('botlien-combined.html', out);
fs.writeFileSync('../botlien-prototype.html', out);
console.log('built', (out.length/1024).toFixed(0)+'KB', '-> src/botlien-combined.html + botlien-prototype.html');
const mfg=build('botlien-mfg.part.html', Object.assign({}, icons, icons_mfg));
fs.writeFileSync('../botlien-mfg.html', mfg);
console.log('built', (mfg.length/1024).toFixed(0)+'KB', '-> botlien-mfg.html');
/* botlien-team.part.html -> ../botlien-team.html  the team layout: Mara, the robot
   watchers, the Stop Watcher and the logbook, with the manufacturing dashboard
   beside them. Served at /app?layout=team. */
const team=build('botlien-team.part.html', {});
fs.writeFileSync('../botlien-team.html', team);
console.log('built', (team.length/1024).toFixed(0)+'KB', '-> botlien-team.html');
