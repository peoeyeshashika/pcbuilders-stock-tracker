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

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://127.0.0.1:8191/v1';

let sessionCookies = '';
let sessionUA = FETCH_HEADERS['User-Agent'];

async function flareSolve(url) {
  const res = await fetch(FLARESOLVERR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cmd: 'request.get',
      url,
      maxTimeout: 120000,
    }),
  });
  if (!res.ok) throw new Error(`FlareSolverr HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 'ok' || !data.solution) {
    throw new Error(`FlareSolverr failed: ${data.message || JSON.stringify(data).slice(0, 300)}`);
  }
  const cookies = (data.solution.cookies || [])
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  sessionCookies = cookies;
  sessionUA = data.solution.userAgent || sessionUA;
  return data.solution;
}

async function fetchJson(url) {
  const headers = {
    ...FETCH_HEADERS,
    'User-Agent': sessionUA,
  };
  if (sessionCookies) headers.Cookie = sessionCookies;

  let res = await fetch(url, { headers });
  if (res.status === 403) {
    console.log('403 from Cloudflare — solving via FlareSolverr...');
    const solution = await flareSolve(url);
    // Prefer body from solver when present (may be raw JSON or <pre>JSON</pre>)
    if (solution.response) {
      let body = String(solution.response).trim();
      const pre = body.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
      if (pre) body = pre[1].trim();
      // strip other simple HTML wrappers if any
      body = body.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '').trim();
      try {
        const parsed = JSON.parse(body);
        const hdrObj = solution.headers || {};
        const getH = (k) =>
          hdrObj[k] ||
          hdrObj[k.toLowerCase()] ||
          hdrObj[k.replace(/(^|-)(\w)/g, (_, a, b) => a + b.toUpperCase())];
        return {
          json: parsed,
          headers: new Headers({
            'x-wp-total': String(getH('x-wp-total') || (Array.isArray(parsed) ? parsed.length : '')),
            'x-wp-totalpages': String(getH('x-wp-totalpages') || '1'),
          }),
          fromFlareBody: true,
        };
      } catch {
        // fall through to cookie retry
      }
    }
    headers.Cookie = sessionCookies;
    headers['User-Agent'] = sessionUA;
    res = await fetch(url, { headers });
  }
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText} for ${url}`);
  return { json: await res.json(), headers: res.headers, fromFlareBody: false };
}

async function fetchAllProducts() {
  const firstUrl = `${API}?per_page=${PER_PAGE}&page=1`;
  const first = await fetchJson(firstUrl);
  let items = first.json;
  if (!Array.isArray(items)) throw new Error('API did not return a product array');

  let totalPages = Number(first.headers.get('X-WP-TotalPages') || first.headers.get('x-wp-totalpages') || 1);
  let total = Number(first.headers.get('X-WP-Total') || first.headers.get('x-wp-total') || items.length);

  // If FlareSolverr returned only page body without WP headers, keep paging via API+cookies
  if (!totalPages || Number.isNaN(totalPages)) totalPages = 1;
  console.log(`Total products: ${total || items.length} | Pages: ${totalPages}`);

  for (let page = 2; page <= totalPages; page++) {
    console.log(`Fetching page ${page}/${totalPages}...`);
    const pageUrl = `${API}?per_page=${PER_PAGE}&page=${page}`;
    const got = await fetchJson(pageUrl);
    if (!Array.isArray(got.json)) throw new Error(`Bad page ${page}`);
    items = items.concat(got.json);
    await new Promise((r) => setTimeout(r, 150));
  }

  // If headers missing and we only got one page of 100, keep fetching until short page
  if ((totalPages === 1 || first.fromFlareBody) && items.length >= PER_PAGE) {
    let page = 2;
    for (;;) {
      console.log(`Fetching extra page ${page}...`);
      const got = await fetchJson(`${API}?per_page=${PER_PAGE}&page=${page}`);
      if (!Array.isArray(got.json) || got.json.length === 0) break;
      items = items.concat(got.json);
      if (got.json.length < PER_PAGE) break;
      page += 1;
      if (page > 50) break;
      await new Promise((r) => setTimeout(r, 150));
    }
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

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeAppData(latest, history, events) {
  const js =
    `window.STOCK_LATEST = ${JSON.stringify(latest)};\n` +
    `window.STOCK_HISTORY = ${JSON.stringify(history)};\n` +
    `window.STOCK_EVENTS = ${JSON.stringify(events)};\n`;
  fs.writeFileSync(path.join(DATA, 'app-data.js'), js, 'utf8');
  fs.writeFileSync(path.join(DATA, 'latest.json'), JSON.stringify(latest, null, 2), 'utf8');
  fs.writeFileSync(path.join(DATA, 'history.json'), JSON.stringify(history, null, 2), 'utf8');
  fs.writeFileSync(path.join(DATA, 'events.json'), JSON.stringify(events, null, 2), 'utf8');
}

function pollDiffEvents(prevSnap, currSnap) {
  if (!prevSnap?.products) return [];
  const a = byId(prevSnap.products);
  const b = byId(currSnap.products);
  const events = [];
  const at = currSnap.scraped_at;
  const date = currSnap.date;

  for (const [id, newP] of b) {
    const oldP = a.get(id);
    if (!oldP) continue;
    if (!oldP.qty_known || !newP.qty_known) continue;
    const from = Number(oldP.qty);
    const to = Number(newP.qty);
    if (Number.isNaN(from) || Number.isNaN(to) || from === to) continue;
    const delta = to - from;
    const price = newP.price_lkr ?? oldP.price_lkr ?? 0;
    events.push({
      at,
      date,
      direction: delta < 0 ? 'decrease' : 'increase',
      id,
      name: newP.name || oldP.name,
      sku: newP.sku || oldP.sku,
      from,
      to,
      delta,
      price_lkr: price,
      value: Math.abs(delta) * (Number(price) || 0),
      permalink: newP.permalink || oldP.permalink,
      image: newP.image || oldP.image,
      categories: newP.categories || oldP.categories,
    });
  }
  return events;
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

  const openPath = path.join(SNAPSHOTS, `${date}.open.json`);
  const snapPath = path.join(SNAPSHOTS, `${date}.json`);
  const lastPath = path.join(DATA, 'last.json');
  const openExists = fs.existsSync(openPath);
  const lastSnap = loadJson(lastPath, null);

  // Instant movement: compare vs previous poll (last.json)
  const newEvents = pollDiffEvents(lastSnap, snapshot);
  let events = loadJson(path.join(DATA, 'events.json'), []);
  if (!Array.isArray(events)) events = [];
  if (newEvents.length) {
    events = events.concat(newEvents);
    // keep ~30 days / 8000 events max
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    events = events
      .filter((e) => e?.at && new Date(e.at).getTime() >= cutoff)
      .slice(-8000);
  }

  if (!openExists) {
    fs.writeFileSync(openPath, JSON.stringify(snapshot), 'utf8');
    console.log(`Saved day-open baseline: ${openPath}`);
  }

  fs.writeFileSync(snapPath, JSON.stringify(snapshot), 'utf8');
  fs.writeFileSync(lastPath, JSON.stringify(snapshot), 'utf8');
  console.log(`Saved latest snapshot: ${snapPath}`);

  let history = loadJson(path.join(DATA, 'history.json'), []);
  if (!Array.isArray(history)) history = [];

  // Daily totals = day-open → now (or previous calendar day if first poll today)
  let compareLabel = null;
  let dayPrev = null;
  if (openExists) {
    dayPrev = loadJson(openPath, null);
    compareLabel = `${date} open`;
  } else {
    const dates = listSnapshotDates().filter((d) => d !== date);
    const prevDate = [...dates].reverse().find((d) => d < date) || null;
    if (prevDate) {
      dayPrev = loadSnapshot(prevDate);
      compareLabel = prevDate;
    }
  }

  let hasCompare = false;
  if (dayPrev) {
    const day = diffSnapshots(dayPrev, snapshot, date, compareLabel);
    history = history.filter((h) => h.date !== date);
    history.push(day);
    history.sort((a, b) => a.date.localeCompare(b.date));
    hasCompare = true;
    console.log(
      `Day vs ${compareLabel}: ↓${day.totals.decrease_units} u (LKR ${day.totals.decrease_value}) | ↑${day.totals.increase_units} u (LKR ${day.totals.increase_value})`
    );
  } else {
    console.log('Baseline day — waiting for next poll to detect movement.');
  }

  console.log(
    newEvents.length
      ? `LIVE changes this poll: ${newEvents.length} (↓${newEvents.filter((e) => e.direction === 'decrease').length} ↑${newEvents.filter((e) => e.direction === 'increase').length})`
      : 'LIVE changes this poll: 0'
  );

  const latest = {
    date,
    scraped_at: snapshot.scraped_at,
    counts: snapshot.counts,
    products: snapshot.products,
    baseline: !hasCompare,
    previous_date: compareLabel,
    poll_interval_minutes: 5,
    live_changes_this_poll: newEvents.length,
  };

  writeAppData(latest, history, events);

  // Signal for push script
  fs.writeFileSync(
    path.join(DATA, 'poll-meta.json'),
    JSON.stringify(
      {
        scraped_at: snapshot.scraped_at,
        changed: newEvents.length > 0,
        change_count: newEvents.length,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`Products: ${products.length} | Exact qty: ${known.length} | Value: LKR ${totalValue.toLocaleString('en-LK')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
