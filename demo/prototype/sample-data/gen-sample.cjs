// One day of Harbor Grill telemetry in the exact shape src/importer.mjs reads.
// Deterministic: no Math.random, so the file is reproducible.
const fs = require('fs');
const ROBOTS = [
  { id:'BR-SERVI-0417', cat:'delivery', open:11, close:23, duty:0.43, name:'Servi 1 (front)' },
  { id:'BR-SERVI-0418', cat:'delivery', open:11, close:23, duty:0.11, name:'Servi 2 (patio)' },
  { id:'PD-P3-2291',    cat:'delivery', open:11, close:23, duty:0.46, name:'P3 runner' },
  { id:'BR-SERVI-0419', cat:'delivery', open:16, close:23, duty:0.40, name:'Servi 3 (banquet)' },
  { id:'GS-S50-8830',   cat:'cleaning', open:23, close:31, duty:0.50, name:'Scrubber 50' },
  { id:'GS-S75-8831',   cat:'cleaning', open:23, close:31, duty:0.26, name:'Scrubber 75 (nights)' },
];
const STEP = 1;                        // minutes between snapshots, matching a real export
const DAY = '2026-08-12';
const pad = n => String(n).padStart(2,'0');
const rows = [['robot_id','timestamp','connection_state','battery_pct','mission_state','mission_id','stuck','charging','errors']];

let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

for (const r of ROBOTS) {
  let battery = 92, mission = 0, stuckRun = 0;
  for (let m = 0; m < 24*60; m += STEP) {
    const hour = m / 60;
    const inShift = r.open < 24
      ? (hour >= r.open && hour < r.close)
      : (hour >= r.open - 24 || hour < r.close - 24);
    const shifted = r.open >= 23 ? (hour >= 23 || hour < r.close - 24) : inShift;
    const working = shifted && rnd() < r.duty;
    const charging = !shifted && battery < 90;
    let state = 'idle';
    if (working) { state = 'active'; if (rnd() < 0.28) mission++; }
    // Scrubber 75 jams in the same spot; this is what the stuck tip reads.
    const stuck = r.id === 'GS-S75-8831' && working && rnd() < 0.22;
    if (stuck) stuckRun++;
    if (charging) state = 'charging';
    battery += charging ? 3 : (working ? -1.4 : -0.2);
    battery = Math.max(12, Math.min(100, battery));
    const offline = !shifted && !charging && rnd() < 0.05;
    const errors = (r.id === 'PD-P3-2291' && working && rnd() < 0.04) ? 'E210' : '';
    rows.push([
      r.id,
      DAY + 'T' + pad(Math.floor(m/60)) + ':' + pad(m%60) + ':00Z',
      offline ? 'offline' : 'online',
      battery.toFixed(0),
      offline ? '' : state,
      state === 'active' ? r.id.split('-').pop() + '-m' + String(mission).padStart(4,'0') : '',
      stuck ? 'true' : 'false',
      charging ? 'true' : 'false',
      errors,
    ]);
  }
}
const csv = rows.map(r => r.join(',')).join('\n');
fs.writeFileSync('harbor-grill-usage-sample.csv', csv);
const active = rows.slice(1).filter(r => r[4] === 'active').length;
const missions = new Set(rows.slice(1).map(r => r[5]).filter(Boolean)).size;
console.log('rows:', rows.length - 1, '| bytes:', csv.length, '| KB:', (csv.length/1024).toFixed(0));
console.log('active snapshots:', active, '| distinct missions:', missions);
console.log('stuck rows (S75):', rows.slice(1).filter(r => r[6] === 'true').length);
