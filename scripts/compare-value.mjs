import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const SNAP = path.join(DATA, 'snapshots');

function read(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const snaps = fs.readdirSync(SNAP).filter((f) => f.endsWith('.json')).sort();
console.log('Snapshots:', snaps.join(', '));

const open17 = path.join(SNAP, '2026-11-17.open.json');
const day17 = path.join(SNAP, '2026-11-17.json');
const day18 = path.join(SNAP, '2026-11-18.json');
const day18open = path.join(SNAP, '2026-11-18.open.json');
const latest = read(path.join(DATA, 'latest.json'));
const history = read(path.join(DATA, 'history.json'));
const events = read(path.join(DATA, 'events.json'));

function show(label, s) {
  if (!s) return console.log(label, 'MISSING');
  const c = s.counts || {};
  console.log(
    `${label}: value=LKR ${(c.total_value || 0).toLocaleString('en-LK')} | qty=${c.sum_qty} | known=${c.qty_known} | products=${c.products} | at=${s.scraped_at || s.date}`
  );
}

if (fs.existsSync(open17)) show('17 open (first)', read(open17));
if (fs.existsSync(day17)) show('17 latest', read(day17));
if (fs.existsSync(day18open)) show('18 open', read(day18open));
if (fs.existsSync(day18)) show('18 latest', read(day18));
show('LATEST file', latest);

if (fs.existsSync(open17)) {
  const a = read(open17).counts.total_value || 0;
  const b = latest.counts?.total_value || 0;
  console.log('Delta vs 17-open total_value:', (b - a).toLocaleString('en-LK'), `(${b} - ${a})`);
}

console.log('History days:', history.map((h) => `${h.date}: down=${h.totals?.decrease_value} up=${h.totals?.increase_value}`).join(' | ') || '(none)');
console.log('Live events:', events.length);
if (events.length) {
  const down = events.filter((e) => e.direction === 'decrease').reduce((s, e) => s + (e.value || 0), 0);
  const up = events.filter((e) => e.direction === 'increase').reduce((s, e) => s + (e.value || 0), 0);
  console.log('Events decrease value sum:', down.toLocaleString('en-LK'));
  console.log('Events increase value sum:', up.toLocaleString('en-LK'));
  console.log('Events net (up-down):', (up - down).toLocaleString('en-LK'));
  console.log('Last 5 events:');
  events.slice(-5).forEach((e) => {
    console.log(`  ${e.at} ${e.direction} ${e.name} ${e.from}->${e.to} value=${e.value}`);
  });
}
