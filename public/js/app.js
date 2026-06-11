/* World Cup Watch Dash — frontend logic.
 * Polls the local server for scores/standings/odds and launches the
 * FOX One player (popup) for whichever match is featured.
 */
(() => {
  const FOX_ONE_URL = 'https://www.foxone.com/live';

  const POLL = { scoreboard: 30000, standings: 300000, odds: 120000 };

  const state = {
    tab: 'matches',
    date: new Date(), // date being browsed in the Matches tab
    featuredId: null,
    scoreboard: null,
    standings: null,
    odds: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const panels = {
    matches: $('#panel-matches'),
    standings: $('#panel-standings'),
    odds: $('#panel-odds'),
  };

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  const fmtDateParam = (d) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  const isToday = (d) => fmtDateParam(d) === fmtDateParam(new Date());

  const fmtML = (v) => (v == null ? '—' : v > 0 ? `+${v}` : `${v}`);

  const mlClass = (v) => (v == null ? '' : v < 0 ? 'ml fav' : 'ml dog');

  const fmtKickoff = (iso) =>
    new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  async function getJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  async function loadScoreboard() {
    try {
      state.scoreboard = await getJson(`/api/scoreboard?date=${fmtDateParam(state.date)}`);
      renderMatches();
      renderWatchPanel();
      renderHeader();
    } catch (err) {
      console.error(err);
      panels.matches.innerHTML = '<p class="empty-state">Could not load scores. Retrying shortly…</p>';
    }
  }

  async function loadStandings() {
    try {
      state.standings = await getJson('/api/standings');
      renderStandings();
    } catch (err) {
      console.error(err);
      panels.standings.innerHTML = '<p class="empty-state">Could not load standings.</p>';
    }
  }

  async function loadOdds() {
    try {
      state.odds = await getJson('/api/odds');
      renderOdds();
    } catch (err) {
      console.error(err);
      panels.odds.innerHTML = '<p class="empty-state">Could not load odds.</p>';
    }
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function renderHeader() {
    const sb = state.scoreboard;
    const liveCount = sb ? sb.matches.filter((m) => m.status.state === 'in').length : 0;
    $('#live-indicator').classList.toggle('hidden', liveCount === 0);
    $('#live-count').textContent = liveCount;
    $('#updated-at').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
    const demo = [state.scoreboard, state.standings, state.odds].some((d) => d && d.source === 'sample');
    $('#demo-banner').classList.toggle('hidden', !demo);
    $('#date-label').textContent = state.date.toLocaleDateString([], {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  }

  function statusBadge(m) {
    if (m.status.state === 'in')
      return `<span class="badge badge-live">● LIVE ${esc(m.status.clock || m.status.detail)}</span>`;
    if (m.status.state === 'post') return `<span class="badge badge-post">${esc(m.status.detail || 'FT')}</span>`;
    return `<span class="badge badge-pre">${esc(fmtKickoff(m.date))}</span>`;
  }

  function teamRow(side, m) {
    const winner = m.status.state === 'post' && side.winner ? ' winner' : '';
    const logo = side.logo ? `<img src="${esc(side.logo)}" alt="" loading="lazy">` : '';
    const score = side.score != null ? side.score : '';
    return `<div class="team-row${winner}">
      <span class="name">${logo}${esc(side.name)}</span>
      <span class="score">${score}</span>
    </div>`;
  }

  function renderMatches() {
    const sb = state.scoreboard;
    if (!sb) return;
    if (!sb.matches.length) {
      panels.matches.innerHTML = '<p class="empty-state">No matches scheduled for this day.</p>';
      return;
    }
    panels.matches.innerHTML = `<div class="match-grid">${sb.matches
      .map((m) => {
        const onFox = m.broadcasts.some((b) => /fox/i.test(b));
        const oddsLine = m.odds && m.odds.details ? esc(m.odds.details) : '';
        return `<article class="match-card${m.id === state.featuredId ? ' featured' : ''}" data-id="${esc(m.id)}">
          <div class="card-top">
            <span class="stage">${esc(m.stage || 'World Cup 2026')}</span>
            ${statusBadge(m)}
          </div>
          ${teamRow(m.home, m)}
          ${teamRow(m.away, m)}
          <div class="card-bottom">
            <span>${esc([m.venue, m.city].filter(Boolean).join(' · '))}</span>
            <span>${oddsLine ? oddsLine + ' · ' : ''}${onFox ? '<span class="fox-tag">FOX ONE</span>' : ''}</span>
          </div>
        </article>`;
      })
      .join('')}</div>`;

    panels.matches.querySelectorAll('.match-card').forEach((card) => {
      card.addEventListener('click', () => {
        state.featuredId = card.dataset.id;
        renderMatches();
        renderWatchPanel();
      });
    });
  }

  function pickFeatured() {
    const sb = state.scoreboard;
    if (!sb || !sb.matches.length) return null;
    const byId = sb.matches.find((m) => m.id === state.featuredId);
    if (byId) return byId;
    // Default: first live match, else next upcoming, else the first one.
    return (
      sb.matches.find((m) => m.status.state === 'in') ||
      sb.matches.find((m) => m.status.state === 'pre') ||
      sb.matches[0]
    );
  }

  function renderWatchPanel() {
    const m = pickFeatured();
    const box = $('#watch-match');
    if (!m) {
      box.innerHTML = '<p class="watch-empty">Select a match below to feature it here.</p>';
      return;
    }
    state.featuredId = m.id;
    const live = m.status.state === 'in';
    $('#watch-label').textContent = live ? 'LIVE NOW' : m.status.state === 'post' ? 'FULL TIME' : 'UP NEXT';
    const score =
      m.home.score != null
        ? `<span class="team-score">${m.home.score}</span> – <span class="team-score">${m.away.score}</span>`
        : '<span style="color:var(--text-dim)">vs</span>';
    box.innerHTML = `
      <div class="teams"><span>${esc(m.home.name)}</span>${score}<span>${esc(m.away.name)}</span></div>
      <p class="meta">
        ${live ? `<span class="status-live">● ${esc(m.status.clock || m.status.detail)}</span> · ` : `${esc(m.status.detail)} · `}
        ${esc([m.stage, m.venue, m.city].filter(Boolean).join(' · '))}
      </p>`;
  }

  function renderStandings() {
    const st = state.standings;
    if (!st) return;
    if (!st.groups.length) {
      panels.standings.innerHTML = '<p class="empty-state">Standings are not available yet.</p>';
      return;
    }
    panels.standings.innerHTML = `<div class="groups-grid">${st.groups
      .map(
        (g) => `<div class="group-card">
          <h3>${esc(g.name)}</h3>
          <table>
            <thead><tr><th style="text-align:left">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
            <tbody>${g.rows
              .map(
                (r, i) => `<tr class="${i < 2 ? 'qualifies' : ''}">
                  <td class="team-cell">${r.logo ? `<img src="${esc(r.logo)}" alt="">` : ''}${esc(r.team)}</td>
                  <td>${r.played}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td>
                  <td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.points}</td>
                </tr>`
              )
              .join('')}</tbody>
          </table>
        </div>`
      )
      .join('')}</div>`;
  }

  function renderOdds() {
    const od = state.odds;
    if (!od) return;
    if (!od.matches.length) {
      panels.odds.innerHTML = '<p class="empty-state">No betting lines available right now.</p>';
      return;
    }
    panels.odds.innerHTML = `<div class="odds-table-wrap">
      <table class="odds-table">
        <thead><tr><th style="text-align:left">MATCH</th><th>HOME</th><th>DRAW</th><th>AWAY</th><th>O/U</th><th>BOOK</th></tr></thead>
        <tbody>${od.matches
          .map(
            (m) => `<tr>
              <td class="matchup">${esc(m.home)} vs ${esc(m.away)}
                <span class="when">${esc(fmtKickoff(m.commence))}</span></td>
              <td class="${mlClass(m.homeML)}">${fmtML(m.homeML)}</td>
              <td class="${mlClass(m.drawML)}">${fmtML(m.drawML)}</td>
              <td class="${mlClass(m.awayML)}">${fmtML(m.awayML)}</td>
              <td>${m.overUnder ?? '—'}</td>
              <td style="color:var(--text-dim);font-size:12px">${esc(m.bookmaker || '—')}</td>
            </tr>`
          )
          .join('')}</tbody>
      </table>
      <p class="odds-note">Moneyline (American). Negative = favorite. Informational only — gamble responsibly.</p>
    </div>`;
  }

  // ------------------------------------------------------------------
  // Interactions
  // ------------------------------------------------------------------
  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    Object.entries(panels).forEach(([name, el]) => el.classList.toggle('hidden', name !== tab));
    if (tab === 'standings' && !state.standings) loadStandings();
    if (tab === 'odds' && !state.odds) loadOdds();
  }

  function shiftDate(days) {
    state.date.setDate(state.date.getDate() + days);
    state.scoreboard = null;
    panels.matches.innerHTML = '<p class="empty-state">Loading…</p>';
    loadScoreboard();
  }

  $('#date-prev').addEventListener('click', () => shiftDate(-1));
  $('#date-next').addEventListener('click', () => shiftDate(1));
  $('#date-today').addEventListener('click', () => {
    state.date = new Date();
    state.scoreboard = null;
    loadScoreboard();
  });
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // FOX One won't allow itself to be iframed (DRM + frame-ancestors), so we
  // open its player in a dedicated popup sized like a video window.
  $('#btn-foxone').addEventListener('click', () => {
    window.open(FOX_ONE_URL, 'foxone-player', 'width=1280,height=760,menubar=no,toolbar=no,location=yes');
  });

  // ------------------------------------------------------------------
  // Polling — pause while the tab is hidden.
  // ------------------------------------------------------------------
  let timers = [];
  function startPolling() {
    stopPolling();
    timers = [
      setInterval(() => isToday(state.date) && loadScoreboard(), POLL.scoreboard),
      setInterval(() => state.standings && loadStandings(), POLL.standings),
      setInterval(() => state.odds && loadOdds(), POLL.odds),
    ];
  }
  function stopPolling() {
    timers.forEach(clearInterval);
    timers = [];
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else {
      loadScoreboard();
      startPolling();
    }
  });

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  loadScoreboard();
  loadStandings();
  loadOdds();
  startPolling();
})();
