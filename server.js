/**
 * World Cup Watch Dash — zero-dependency Node server (optional).
 *
 * The site in docs/ is fully static-capable; this server adds a proxy layer
 * so the browser never talks to upstream APIs directly and any Odds API key
 * stays server-side. It serves docs/ and exposes:
 *
 *   GET /api/scoreboard?date=YYYYMMDD&days=N   live scores (ESPN public API);
 *                                       days>1 returns a date-range window
 *   GET /api/standings                  group standings (ESPN public API)
 *   GET /api/odds                       betting odds (ESPN BET lines embedded
 *                                       in the scoreboard — no key needed)
 *
 * Append ?demo=1 to any API route to force the bundled sample data.
 * When an upstream call fails, sample data is served with source:"sample"
 * so the UI can show a demo banner instead of breaking.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WCData = require('./docs/js/normalize.js');

const PORT = process.env.PORT || 3000;
// Day boundaries for "today" and demo-data filtering. ESPN's scoreboard
// groups match days in US Eastern, so we match it.
const DAY_TZ = process.env.DAY_TZ || WCData.DEFAULT_TZ;

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const ESPN_STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings';

const PUBLIC_DIR = path.join(__dirname, 'docs');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Tiny TTL cache so polling clients don't hammer the upstream APIs.
// ---------------------------------------------------------------------------
const cache = new Map();

async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'WorldCupWatchDash/1.0', ...headers },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
  return res.json();
}

function sample(name) {
  const raw = fs.readFileSync(path.join(DATA_DIR, `sample-${name}.json`), 'utf8');
  const json = JSON.parse(raw);
  json.source = 'sample';
  return json;
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------
async function getScoreboard(date, days, demo) {
  const start = date || WCData.ymdInZone(new Date(), DAY_TZ);
  const span = Math.min(Math.max(days || 1, 1), 14);
  if (demo) return WCData.filterScoreboardWindow(sample('scoreboard'), start, span, DAY_TZ);
  try {
    // ESPN accepts a single day (dates=YYYYMMDD) or a range (dates=A-B, inclusive).
    const dates = span > 1 ? `${start}-${WCData.addDaysYmd(start, span - 1)}` : start;
    const espn = await cached(`sb:${dates}`, 30000, () =>
      fetchJson(`${ESPN_BASE}/scoreboard?dates=${dates}`)
    );
    const board = WCData.normalizeScoreboard(espn);
    board.date = start;
    board.matches.sort((a, b) => new Date(a.date) - new Date(b.date));
    return board;
  } catch (err) {
    console.error('[scoreboard]', err.message);
    return WCData.filterScoreboardWindow(sample('scoreboard'), start, span, DAY_TZ);
  }
}

async function getStandings(demo) {
  if (demo) return sample('standings');
  try {
    const espn = await cached('standings', 300000, () => fetchJson(ESPN_STANDINGS));
    return WCData.normalizeStandings(espn);
  } catch (err) {
    console.error('[standings]', err.message);
    return sample('standings');
  }
}

async function getOdds(demo) {
  if (demo) return sample('odds');
  // ESPN embeds ESPN BET lines in its scoreboard; a week-wide window gives
  // lines for upcoming fixtures too.
  const board = await getScoreboard(null, 8, false);
  return WCData.oddsFromScoreboard(board);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const demo = url.searchParams.get('demo') === '1';

  try {
    if (url.pathname === '/api/scoreboard') {
      const date = (url.searchParams.get('date') || '').replace(/[^0-9]/g, '') || null;
      const days = parseInt(url.searchParams.get('days') || '1', 10) || 1;
      return sendJson(res, 200, await getScoreboard(date, days, demo));
    }
    if (url.pathname === '/api/standings') {
      return sendJson(res, 200, await getStandings(demo));
    }
    if (url.pathname === '/api/odds') {
      return sendJson(res, 200, await getOdds(demo));
    }
    if (url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true });
    }
  } catch (err) {
    console.error('[server]', err);
    return sendJson(res, 500, { error: 'internal error' });
  }

  // Static files — resolve inside docs/ only.
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  sendFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`World Cup Watch Dash running at http://localhost:${PORT}`);
});
