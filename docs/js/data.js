/* Data access layer for World Cup Watch Dash.
 *
 * Works in two modes, detected once at startup:
 *  - server: the bundled Node server is present -> use its /api/* routes.
 *  - static: plain static hosting (GitHub Pages, `npx serve docs`, ...)
 *    -> fetch ESPN's CORS-enabled public feeds straight from the browser,
 *    falling back to the bundled sample data when unreachable.
 */
const Api = (() => {
  const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
  const ESPN_STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings';

  let modePromise = null;

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  }

  function getMode() {
    if (!modePromise) {
      modePromise = (async () => {
        try {
          const res = await fetch('/api/health');
          if (res.ok && (await res.json()).ok) return 'server';
        } catch {
          /* no server — static hosting */
        }
        document.body.classList.add('mode-static');
        return 'static';
      })();
    }
    return modePromise;
  }

  // Relative paths so the sample data resolves under subpath hosting
  // (e.g. username.github.io/WorldCupWatchDash/).
  async function loadSample(name) {
    const json = await fetchJson(`data/sample-${name}.json`);
    json.source = 'sample';
    return json;
  }

  async function scoreboard(dateYmd, days) {
    if ((await getMode()) === 'server') {
      return fetchJson(`/api/scoreboard?date=${dateYmd}&days=${days}`);
    }
    const span = Math.min(Math.max(days || 1, 1), 14);
    try {
      const dates = span > 1 ? `${dateYmd}-${WCData.addDaysYmd(dateYmd, span - 1)}` : dateYmd;
      const board = WCData.normalizeScoreboard(
        await fetchJson(`${ESPN_BASE}/scoreboard?dates=${dates}`)
      );
      board.date = dateYmd;
      board.matches.sort((a, b) => new Date(a.date) - new Date(b.date));
      return board;
    } catch (err) {
      console.warn('[scoreboard] falling back to sample data:', err.message);
      return WCData.filterScoreboardWindow(await loadSample('scoreboard'), dateYmd, span);
    }
  }

  async function standings() {
    if ((await getMode()) === 'server') return fetchJson('/api/standings');
    try {
      return WCData.normalizeStandings(await fetchJson(ESPN_STANDINGS));
    } catch (err) {
      console.warn('[standings] falling back to sample data:', err.message);
      return loadSample('standings');
    }
  }

  // Odds come from the ESPN BET lines embedded in the scoreboard — no key
  // needed. A week-wide window gives lines for upcoming fixtures too.
  async function odds(todayYmd) {
    if ((await getMode()) === 'server') return fetchJson('/api/odds');
    return WCData.oddsFromScoreboard(await scoreboard(todayYmd, 8));
  }

  return { getMode, scoreboard, standings, odds };
})();
