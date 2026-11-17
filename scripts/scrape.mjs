import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const SNAPSHOTS = path.join(DATA, 'snapshots');

const API = 'https://pcbuilders.lk/wp-json/wc/store/v1/products';
const PER_PAGE = 100;

function ensureDirs() {
  fs.mkdirSync(SNAPSHOTS, { recursive: true });
}

function todayKey(d = new Date()) {
  // Asia/Colombo date
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&nbsp;/g, ' ');
}

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchAllProducts() {
  const firstUrl = `${API}?per_page=${PER_PAGE}&page=1`;
  const first = await fetch(firstUrl, { headers: FETCH_HEADERS });
  if (!first.ok) throw new Error(`API ${first.status} ${first.statusText}`);
  const totalPages = Number(first.headers.get('X-WP-TotalPages') || 1);
  const total = Number(first.headers.get('X-WP-Total') || 0);
  let items = await first.json();
  console.log(`Total products: ${total} | Pages: ${totalPages}`);

  for (let page = 2; page <= totalPages; page++) {
    console.log(`Fetching page ${page}/${totalPages}...`);
    const res = await fetch(`${API}?per_page=${PER_PAGE}&page=${page}`, { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`API page ${page}: ${res.status}`);
    items = items.concat(await res.json());
    await new Promise((r) => setTimeout(r, 120));
  }
  return items;
}

function normalize(p) {
  const stockText = p.stock_availability?.text ? String(p.stock_availability.text) : '';
  let qty = null;
  let qtyKnown = false;
  const m = stockText.match(/^\s*(\d+)\s+in stock\s*$/i);
  if (m) {
    qty = Number(m[1]);
    qtyKnown = true;
  }

  let status = 'unknown';
  if (!p.is_in_stock) status = 'out_of_stock';
  else if (p.is_on_backorder || /backorder/i.test(stockText)) status = 'backorder';
  else if (qtyKnown) status = 'in_stock_qty';
  else if (p.is_in_stock) status = 'in_stock_hidden';

  const minor = Number(p.prices?.currency_minor_unit ?? 2);
  const raw = p.prices?.price != null ? Number(p.prices.price) : null;
  const price = raw == null || Number.isNaN(raw) ? null : raw / 10 ** minor;

  return {
    id: p.id,
    name: decodeHtml(p.name),
    sku: p.sku || '',
    permalink: p.permalink || '',
    price_lkr: price,
    is_in_stock: !!p.is_in_stock,
    stock_text: stockText,
    qty,
    qty_known: qtyKnown,
    status,
    on_backorder: !!p.is_on_backorder,
    image: p.images?.[0]?.thumbnail || p.images?.[0]?.src || '',
    categories: (p.categories || []).map((c) => c.name).join(', '),
  };
}

function listSnapshotDates() {
  return fs
    .readdirSync(SNAPSHOTS)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function loadSnapshot(date) {
  const file = path.join(SNAPSHOTS, `${date}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function byId(products) {
  const map = new Map();
  for (const p of products) map.set(p.id, p);
  return map;
}

function diffSnapshots(prev, curr, date, comparedTo) {
  const a = byId(prev.products || []);
  const b = byId(curr.products || []);
  const decreases = [];
  const increases = [];

  const ids = new Set([...a.keys(), ...b.keys()]);
  for (const id of ids) {
    const oldP = a.get(id);
    const newP = b.get(id);
    if (!oldP || !newP) continue;
    if (!oldP.qty_known || !newP.qty_known) continue;
    const from = Number(oldP.qty);
    const to = Number(newP.qty);
    if (Number.isNaN(from) || Number.isNaN(to) || from === to) continue;

    const price = newP.price_lkr ?? oldP.price_lkr ?? 0;
    const delta = to - from;
    const row = {
      id,
      name: newP.name || oldP.name,
      sku: newP.sku || oldP.sku,
      from,
      to,
      delta,
      price_lkr: price,
      value: Math.abs(delta) * (Number(price) || 0),
      permalink: newP.permalink || oldP.permalink,
      categories: newP.categories || oldP.categories,
      image: newP.image || oldP.image,
    };
    if (delta < 0) decreases.push(row);
    else increases.push(row);
  }

  decreases.sort((x, y) => y.value - x.value);
  increases.sort((x, y) => y.value - x.value);

  const decrease_units = decreases.reduce((s, r) => s + Math.abs(r.delta), 0);
  const increase_units = increases.reduce((s, r) => s + r.delta, 0);
  const decrease_value = decreases.reduce((s, r) => s + r.value, 0);
  const increase_value = increases.reduce((s, r) => s + r.value, 0);

  return {
    date,
    compared_to: comparedTo,
    generated_at: new Date().toISOString(),
    decreases,
    increases,
    totals: {
      decrease_items: decreases.length,
      increase_items: increases.length,
      decrease_units,
      increase_units,
      decrease_value,
      increase_value,
      net_units: increase_units - decrease_units,
      net_value: increase_value - decrease_value,
    },
  };
}

function writeAppData(latest, history) {
  const js = `window.STOCK_LATEST = ${JSON.stringify(latest)};\nwindow.STOCK_HISTORY = ${JSON.stringify(history)};\n`;
  fs.writeFileSync(path.join(DATA, 'app-data.js'), js, 'utf8');
  fs.writeFileSync(path.join(DATA, 'latest.json'), JSON.stringify(latest, null, 2), 'utf8');
  fs.writeFileSync(path.join(DATA, 'history.json'), JSON.stringify(history, null, 2), 'utf8');
}

async function main() {
  ensureDirs();
  const date = process.env.SNAPSHOT_DATE || todayKey();
  console.log(`Snapshot date (Asia/Colombo): ${date}`);

  const raw = await fetchAllProducts();
  const products = raw.map(normalize);

  const known = products.filter((p) => p.qty_known);
  const totalValue = known.reduce((s, p) => s + (p.qty || 0) * (p.price_lkr || 0), 0);
  const totalQty = known.reduce((s, p) => s + (p.qty || 0), 0);

  const snapshot = {
    date,
    scraped_at: new Date().toISOString(),
    source: 'https://pcbuilders.lk/wp-json/wc/store/v1/products',
    counts: {
      products: products.length,
      qty_known: known.length,
      qty_hidden: products.filter((p) => p.status === 'in_stock_hidden').length,
      backorder: products.filter((p) => p.status === 'backorder').length,
      out_of_stock: products.filter((p) => p.status === 'out_of_stock').length,
      sum_qty: totalQty,
      total_value: totalValue,
    },
    products,
  };

  const snapPath = path.join(SNAPSHOTS, `${date}.json`);
  fs.writeFileSync(snapPath, JSON.stringify(snapshot), 'utf8');
  console.log(`Saved snapshot: ${snapPath}`);

  const dates = listSnapshotDates();
  const prevDate = [...dates].reverse().find((d) => d < date) || null;

  let history = [];
  const historyPath = path.join(DATA, 'history.json');
  if (fs.existsSync(historyPath)) {
    try {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }
  }

  if (prevDate) {
    const prev = loadSnapshot(prevDate);
    const day = diffSnapshots(prev, snapshot, date, prevDate);
    history = history.filter((h) => h.date !== date);
    history.push(day);
    history.sort((a, b) => a.date.localeCompare(b.date));
    console.log(
      `Diff vs ${prevDate}: ↓${day.totals.decrease_units} units (LKR ${day.totals.decrease_value}) | ↑${day.totals.increase_units} units (LKR ${day.totals.increase_value})`
    );
  } else {
    console.log('Baseline day — no previous snapshot to compare. Changes start from next scrape.');
  }

  const latest = {
    date,
    scraped_at: snapshot.scraped_at,
    counts: snapshot.counts,
    products: snapshot.products,
    baseline: !prevDate,
    previous_date: prevDate,
  };

  writeAppData(latest, history);
  console.log(`Products: ${products.length} | Exact qty: ${known.length} | Value: LKR ${totalValue.toLocaleString('en-LK')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
