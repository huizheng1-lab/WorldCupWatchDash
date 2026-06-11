/**
 * World Cup Watch Dash — zero-dependency Node server.
 *
 * Serves the static dashboard and proxies/normalizes upstream data so the
 * browser never deals with CORS or API keys:
 *
 *   GET /api/scoreboard?date=YYYYMMDD&days=N   live scores (ESPN public API);
 *                                       days>1 returns a date-range window
 *   GET /api/standings                  group standings (ESPN public API)
 *   GET /api/odds                       betting odds (The Odds API if
 *                                       ODDS_API_KEY is set, else odds
 *                                       embedded in the ESPN scoreboard)
 *
 * Append ?demo=1 to any API route to force the bundled sample data.
 * When an upstream call fails, sample data is served with source:"sample"
 * so the UI can show a demo banner instead of breaking.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const ODDS_SPORT_KEY = process.env.ODDS_SPORT_KEY || 'soccer_fifa_world_cup';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const ESPN_STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

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

// YYYYMMDD (UTC) for a Date, optionally shifted by n days.
function ymd(d, plusDays = 0) {
  const t = new Date(d.getTime() + plusDays * 86400000);
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`;
}

function sampleScoreboardWindow(startYmd, days) {
  const board = sample('scoreboard');
  const endYmd = ymd(parseYmd(startYmd), days); // exclusive
  board.matches = (board.matches || []).filter((m) => {
    const d = ymd(new Date(m.date));
    return d >= startYmd && d < endYmd;
  });
  board.date = startYmd;
  return board;
}

function parseYmd(s) {
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
}

// ---------------------------------------------------------------------------
// Normalizers — compact shapes shared by live data and the bundled samples.
// ---------------------------------------------------------------------------
function normalizeScoreboard(espn) {
  const events = espn.events || [];
  const matches = events.map((ev) => {
    const comp = (ev.competitions && ev.competitions[0]) || {};
    const competitors = comp.competitors || [];
    const home = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};
    const away = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {};
    const odds = (comp.odds && comp.odds[0]) || null;
    const broadcasts = (comp.broadcasts || []).flatMap((b) => b.names || []);
    const note = (comp.notes && comp.notes[0] && comp.notes[0].headline) || '';
    const side = (c) => ({
      name: (c.team && (c.team.displayName || c.team.name)) || 'TBD',
      abbrev: (c.team && c.team.abbreviation) || '',
      logo: (c.team && c.team.logo) || '',
      score: c.score != null ? Number(c.score) : null,
      winner: !!c.winner,
    });
    return {
      id: ev.id,
      date: ev.date,
      stage: note,
      status: {
        state: (ev.status && ev.status.type && ev.status.type.state) || 'pre', // pre | in | post
        detail: (ev.status && ev.status.type && ev.status.type.shortDetail) || '',
        clock: (ev.status && ev.status.displayClock) || '',
      },
      venue: (comp.venue && comp.venue.fullName) || '',
      city: (comp.venue && comp.venue.address && comp.venue.address.city) || '',
      broadcasts,
      home: side(home),
      away: side(away),
      odds: odds
        ? {
            details: odds.details || '',
            overUnder: odds.overUnder != null ? odds.overUnder : null,
            homeML: odds.homeTeamOdds ? odds.homeTeamOdds.moneyLine : null,
            awayML: odds.awayTeamOdds ? odds.awayTeamOdds.moneyLine : null,
            drawML: odds.drawOdds ? odds.drawOdds.moneyLine : null,
            provider: (odds.provider && odds.provider.name) || '',
          }
        : null,
    };
  });
  return { source: 'espn', date: espn.day ? espn.day.date : null, matches };
}

function normalizeStandings(espn) {
  const groups = (espn.children || []).map((child) => {
    const entries = (child.standings && child.standings.entries) || [];
    const rows = entries.map((entry) => {
      const stats = {};
      for (const s of entry.stats || []) stats[s.name] = s.value;
      return {
        team: (entry.team && (entry.team.displayName || entry.team.name)) || '',
        abbrev: (entry.team && entry.team.abbreviation) || '',
        logo:
          (entry.team && entry.team.logos && entry.team.logos[0] && entry.team.logos[0].href) || '',
        played: stats.gamesPlayed ?? 0,
        wins: stats.wins ?? 0,
        draws: stats.ties ?? 0,
        losses: stats.losses ?? 0,
        gf: stats.pointsFor ?? 0,
        ga: stats.pointsAgainst ?? 0,
        gd: stats.pointDifferential ?? (stats.pointsFor ?? 0) - (stats.pointsAgainst ?? 0),
        points: stats.points ?? 0,
        rank: stats.rank ?? null,
      };
    });
    rows.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.points - a.points || b.gd - a.gd);
    return { name: child.name || child.abbreviation || 'Group', rows };
  });
  return { source: 'espn', groups };
}

function normalizeOddsApi(events) {
  const matches = (events || []).map((ev) => {
    let homeML = null;
    let awayML = null;
    let drawML = null;
    let overUnder = null;
    let bookmaker = '';
    for (const bk of ev.bookmakers || []) {
      for (const market of bk.markets || []) {
        if (market.key === 'h2h' && homeML == null) {
          bookmaker = bk.title;
          for (const out of market.outcomes || []) {
            if (out.name === ev.home_team) homeML = out.price;
            else if (out.name === ev.away_team) awayML = out.price;
            else drawML = out.price;
          }
        }
        if (market.key === 'totals' && overUnder == null) {
          const out = (market.outcomes || [])[0];
          if (out) overUnder = out.point;
        }
      }
      if (homeML != null && overUnder != null) break;
    }
    return {
      id: ev.id,
      commence: ev.commence_time,
      home: ev.home_team,
      away: ev.away_team,
      homeML,
      drawML,
      awayML,
      overUnder,
      bookmaker,
    };
  });
  return { source: 'odds-api', matches };
}

function oddsFromScoreboard(board) {
  const matches = (board.matches || [])
    .filter((m) => m.odds)
    .map((m) => ({
      id: m.id,
      commence: m.date,
      home: m.home.name,
      away: m.away.name,
      homeML: m.odds.homeML,
      drawML: m.odds.drawML,
      awayML: m.odds.awayML,
      overUnder: m.odds.overUnder,
      bookmaker: m.odds.provider || 'ESPN BET',
    }));
  return { source: board.source === 'sample' ? 'sample' : 'espn', matches };
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------
async function getScoreboard(date, days, demo) {
  const start = date || ymd(new Date());
  const span = Math.min(Math.max(days || 1, 1), 14);
  if (demo) return sampleScoreboardWindow(start, span);
  try {
    // ESPN accepts a single day (dates=YYYYMMDD) or a range (dates=A-B, inclusive).
    const dates = span > 1 ? `${start}-${ymd(parseYmd(start), span - 1)}` : start;
    const espn = await cached(`sb:${dates}`, 30000, () =>
      fetchJson(`${ESPN_BASE}/scoreboard?dates=${dates}`)
    );
    const board = normalizeScoreboard(espn);
    board.date = start;
    board.matches.sort((a, b) => new Date(a.date) - new Date(b.date));
    return board;
  } catch (err) {
    console.error('[scoreboard]', err.message);
    return sampleScoreboardWindow(start, span);
  }
}

async function getStandings(demo) {
  if (demo) return sample('standings');
  try {
    const espn = await cached('standings', 300000, () => fetchJson(ESPN_STANDINGS));
    return normalizeStandings(espn);
  } catch (err) {
    console.error('[standings]', err.message);
    return sample('standings');
  }
}

async function getOdds(demo) {
  if (demo) return sample('odds');
  if (ODDS_API_KEY) {
    try {
      const url =
        `${ODDS_API_BASE}/sports/${ODDS_SPORT_KEY}/odds` +
        `?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,totals&oddsFormat=american`;
      const events = await cached('odds', 120000, () => fetchJson(url));
      return normalizeOddsApi(events);
    } catch (err) {
      console.error('[odds-api]', err.message);
    }
  }
  // Fall back to the odds ESPN embeds in its scoreboard.
  const board = await getScoreboard(null, 1, false);
  return oddsFromScoreboard(board);
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
      return sendJson(res, 200, { ok: true, oddsApiConfigured: !!ODDS_API_KEY });
    }
  } catch (err) {
    console.error('[server]', err);
    return sendJson(res, 500, { error: 'internal error' });
  }

  // Static files — resolve inside public/ only.
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
  console.log(
    ODDS_API_KEY
      ? 'Betting odds: The Odds API (key configured)'
      : 'Betting odds: ESPN scoreboard lines (set ODDS_API_KEY for richer markets)'
  );
});
