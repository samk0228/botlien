const fs = require('fs');
const q = v => /[",]/.test(String(v)) ? '"' + String(v).replace(/"/g,'""') + '"' : String(v);
const rows = []; const push = r => { rows.push(r); return rows.length; }; // 1-indexed row no.

push(['Botlien coverage model','','','','','','']);
push(['Harbor Grill, Pier 4','Aug 4 to Sep 3, 2026','30 days','','','','']);
push(['Every figure below is a formula. Change an input and the whole sheet moves.','','','','','','']);
push([]);

push(['INPUTS','value','unit','where it comes from','','','']);
const rWage   = push(['Loaded wage per hour, tray work', 22, '$ / hr', 'BLS 35-3031 food serving + ~28% payroll load. Replace with yours.']);
const rThru   = push(['Runs a person does per hour', 30, 'runs / hr', 'The one input nobody can measure. This is the assumption.']);
const rClean  = push(['Cleaning benchmark wage', 25, '$ / hr', 'Botlien benchmark until you set your own.']);
push([]);

push(['DERIVED RATES','value','unit','the division, shown','','','']);
const rTray   = push(['Tray delivery', `=ROUND(B${rWage}/B${rThru},2)`, '$ / run', `="$"&TEXT(B${rWage},"0.00")&" / hr ÷ "&B${rThru}&" runs per hour"`]);
const rCleanR = push(['Floor cleaning', `=B${rClean}`, '$ / active hour', 'One robot hour valued at one human hour. No productivity multiplier.']);
push([]);

push(['FLEET','kind of work','volume','rate','work serviced','lease invoiced','coverage']);
const fleet = [
  ['Servi 1 (front)','tray delivery',3780,`=$B$${rTray}`,999],
  ['Servi 2 (patio)','tray delivery',900,`=$B$${rTray}`,999],
  ['P3 runner','tray delivery',3900,`=$B$${rTray}`,999],
  ['Servi 3 (banquet)','tray delivery',3480,`=$B$${rTray}`,999],
  ['Scrubber 50','floor cleaning',120,`=$B$${rCleanR}`,800],
  ['Scrubber 75 (nights)','floor cleaning',61.2,`=$B$${rCleanR}`,800],
];
const first = rows.length + 1;
for (const [name,kind,vol,rate,inv] of fleet){
  const n = rows.length + 1;
  push([name,kind,vol,rate,`=C${n}*D${n}`,inv,`=E${n}/F${n}`]);
}
const last = rows.length;
const rTotal = push(['TOTAL','6 robots','',`= work / invoice`,`=SUM(E${first}:E${last})`,`=SUM(F${first}:F${last})`,`=E${rows.length+1}/F${rows.length+1}`]);
rows[rTotal-1][6] = `=E${rTotal}/F${rTotal}`;
rows[rTotal-1][3] = '';
push([]);

push(['CHECKS','value','','what it means','','','']);
push(['Cost per run (delivery only)', `=ROUND(SUMIF(B${first}:B${last},"tray delivery",F${first}:F${last})/SUMIF(B${first}:B${last},"tray delivery",C${first}:C${last}),2)`, '$ / run', 'Pure fact: invoices divided by runs. No assumption in it.']);
push(['A person would cost, per run', `=B${rTray}`, '$ / run', 'The gap between these two rows is the business case.']);
push(['Break-even runs per hour', `=ROUND(B${rWage}/((F${rTotal}-SUMIF(B${first}:B${last},"floor cleaning",E${first}:E${last}))/SUMIF(B${first}:B${last},"tray delivery",C${first}:C${last})),0)`, 'runs / hr', 'Coverage hits 1.00x here. The statement rounds the rate to the cent before multiplying, which puts its figure at 258. Either convention, no person does it.']);
push([]);
push(['Counts are mission starts reported by the robot, so they read as runs started, not runs completed.','','','','','','']);
push(['Work serviced is replacement cost. Not revenue, not profit, not labour saved.','','','','','','']);

const csv = rows.map(r => (r.length ? r : ['']).map(q).join(',')).join('\n');
fs.writeFileSync('botlien-coverage-model.csv', csv);
console.log('rows:', rows.length, '| bytes:', csv.length);
