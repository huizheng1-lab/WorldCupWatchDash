/* Shared data normalizers for World Cup Watch Dash.
 * Used by server.js (Node require) and by the browser in static mode
 * (script tag -> window.WCData), so live data and bundled samples look
 * identical no matter where the fetching happens.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WCData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // ESPN groups schedule days in US Eastern; day boundaries follow suit.
  const DEFAULT_TZ = 'America/New_York';

  // YYYYMMDD for a timestamp as seen in the given time zone.
  function ymdInZone(d, tz) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || DEFAULT_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(d)
      .replace(/-/g, '');
  }

  function parseYmd(s) {
    return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
  }

  // Pure calendar arithmetic on a YYYYMMDD label.
  function addDaysYmd(s, n) {
    const t = parseYmd(s);
    t.setUTCDate(t.getUTCDate() + n);
    return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`;
  }

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
        const gf = stats.pointsFor != null ? stats.pointsFor : 0;
        const ga = stats.pointsAgainst != null ? stats.pointsAgainst : 0;
        return {
          team: (entry.team && (entry.team.displayName || entry.team.name)) || '',
          abbrev: (entry.team && entry.team.abbreviation) || '',
          logo:
            (entry.team && entry.team.logos && entry.team.logos[0] && entry.team.logos[0].href) ||
            '',
          played: stats.gamesPlayed != null ? stats.gamesPlayed : 0,
          wins: stats.wins != null ? stats.wins : 0,
          draws: stats.ties != null ? stats.ties : 0,
          losses: stats.losses != null ? stats.losses : 0,
          gf,
          ga,
          gd: stats.pointDifferential != null ? stats.pointDifferential : gf - ga,
          points: stats.points != null ? stats.points : 0,
          rank: stats.rank != null ? stats.rank : null,
        };
      });
      rows.sort(
        (a, b) =>
          (a.rank != null ? a.rank : 99) - (b.rank != null ? b.rank : 99) ||
          b.points - a.points ||
          b.gd - a.gd
      );
      return { name: child.name || child.abbreviation || 'Group', rows };
    });
    return { source: 'espn', groups };
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

  // Trim a scoreboard to [startYmd, startYmd + days) as seen in tz.
  function filterScoreboardWindow(board, startYmd, days, tz) {
    const endYmd = addDaysYmd(startYmd, days); // exclusive
    board.matches = (board.matches || []).filter((m) => {
      const d = ymdInZone(new Date(m.date), tz);
      return d >= startYmd && d < endYmd;
    });
    board.date = startYmd;
    return board;
  }

  return {
    DEFAULT_TZ,
    ymdInZone,
    parseYmd,
    addDaysYmd,
    normalizeScoreboard,
    normalizeStandings,
    oddsFromScoreboard,
    filterScoreboardWindow,
  };
});
