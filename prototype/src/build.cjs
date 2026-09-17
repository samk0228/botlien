const fs=require('fs');
const {assets,icons}=JSON.parse(fs.readFileSync('assets.json','utf8'));
let out=fs.readFileSync('botlien.part.html','utf8');
out=out.replace('__ICONS_JSON__', JSON.stringify(icons));
out=out.split('__LOGO__').join(assets.LOGO);
out=out.replace('__INTER_EXT__', assets.INTER_EXT);
out=out.replace('__INTER__', assets.INTER);
if(/__[A-Z_]+__/.test(out)){ console.error('LEFTOVER PLACEHOLDER:', out.match(/__[A-Z_]+__/g).slice(0,5)); process.exit(1); }
/* ../botlien-prototype.html is the file that actually gets opened and published.
   It used to be copied over by hand, which let it drift from the source. */
fs.writeFileSync('botlien-combined.html', out);
fs.writeFileSync('../botlien-prototype.html', out);
console.log('built', (out.length/1024).toFixed(0)+'KB', '-> src/botlien-combined.html + botlien-prototype.html');
