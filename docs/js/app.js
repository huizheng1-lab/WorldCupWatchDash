/* World Cup Watch Dash — frontend logic.
 * Polls the local server for scores/standings/odds, launches the FOX One
 * player for the featured match, and raises an alarm when a favorite team
 * (or a starred match) kicks off within the next 3 days.
 */
(() => {
  const FOX_ONE_URL = 'https://www.foxone.com/live';

  const POLL = { scoreboard: 30000, standings: 300000, odds: 120000, alarm: 60000 };
  const ALARM_DAYS = 3;

  const store = {
    get(key, fallback) {
      try {
        const v = JSON.parse(localStorage.getItem(key));
        return v == null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
  };

  const state = {
    tab: 'matches',
    date: new Date(), // start date being browsed in the Matches tab
    days: 1, // 1 = today, 2 = +1 day, 8 = +7 days
    featuredId: null,
    scoreboard: null,
    standings: null,
    odds: null,
    alarmMatches: [],
    favTeams: new Set(store.get('wc-fav-teams', [])),
    starred: new Set(store.get('wc-starred', [])),
    alerted: new Set(store.get('wc-alerted', [])),
    theme: store.get('wc-theme', 'auto'), // auto | light | dark
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

  const fmtDayHeading = (iso) =>
    new Date(iso).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  const fmtCountdown = (iso) => {
    const ms = new Date(iso) - Date.now();
    if (ms <= 0) return 'now';
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `in ${Math.max(1, Math.floor(ms / 60000))}m`;
    if (h < 24) return `in ${h}h`;
    return `in ${Math.floor(h / 24)}d ${h % 24}h`;
  };

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  // ------------------------------------------------------------------
  // Theme — auto follows the clock: light 7am–7pm, dark otherwise.
  // ------------------------------------------------------------------
  const THEME_ICONS = { auto: '\u{1F313} Auto', light: '☀️ Light', dark: '\u{1F319} Dark' };

  function applyTheme() {
    let mode = state.theme;
    if (mode === 'auto') {
      const hour = new Date().getHours();
      mode = hour >= 7 && hour < 19 ? 'light' : 'dark';
    }
    document.body.classList.toggle('theme-light', mode === 'light');
    $('#btn-theme').innerHTML = THEME_ICONS[state.theme];
  }

  $('#btn-theme').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
    store.set('wc-theme', state.theme);
    applyTheme();
  });

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  async function loadScoreboard() {
    try {
      state.scoreboard = await Api.scoreboard(fmtDateParam(state.date), state.days);
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
      state.standings = await Api.standings();
      renderStandings();
      renderFavPanel();
    } catch (err) {
      console.error(err);
      panels.standings.innerHTML = '<p class="empty-state">Could not load standings.</p>';
    }
  }

  async function loadOdds() {
    try {
      state.odds = await Api.odds(fmtDateParam(new Date()));
      renderOdds();
    } catch (err) {
      console.error(err);
      panels.odds.innerHTML = '<p class="empty-state">Could not load odds.</p>';
    }
  }

  // Always looks at today + next ALARM_DAYS regardless of what's being browsed.
  async function loadAlarm() {
    if (state.favTeams.size === 0 && state.starred.size === 0) {
      state.alarmMatches = [];
      renderAlarm();
      return;
    }
    try {
      const board = await Api.scoreboard(fmtDateParam(new Date()), ALARM_DAYS);
      state.alarmMatches = board.matches.filter(
        (m) =>
          m.status.state === 'pre' &&
          (state.starred.has(m.id) ||
            state.favTeams.has(m.home.name) ||
            state.favTeams.has(m.away.name))
      );
      renderAlarm();
      notifyNewAlarms();
    } catch (err) {
      console.error('[alarm]', err);
    }
  }

  // ------------------------------------------------------------------
  // Alarm rendering + notifications
  // ------------------------------------------------------------------
  function renderAlarm() {
    const el = $('#alarm-banner');
    if (!state.alarmMatches.length) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML =
      '<span class="alarm-bell">&#9200;</span>' +
      state.alarmMatches
        .map(
          (m) =>
            `<span class="alarm-item"><strong>${esc(m.home.name)} vs ${esc(m.away.name)}</strong>
             ${esc(fmtKickoff(m.date))} (${esc(fmtCountdown(m.date))}) on FOX One</span>`
        )
        .join('<span class="alarm-sep">·</span>');
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      /* audio may be blocked before user interaction */
    }
  }

  function notifyNewAlarms() {
    const fresh = state.alarmMatches.filter((m) => !state.alerted.has(m.id));
    if (!fresh.length) return;
    fresh.forEach((m) => state.alerted.add(m.id));
    store.set('wc-alerted', [...state.alerted]);
    beep();
    if ('Notification' in window && Notification.permission === 'granted') {
      for (const m of fresh) {
        new Notification('⚽ Upcoming World Cup match', {
          body: `${m.home.name} vs ${m.away.name} — ${fmtKickoff(m.date)} (${fmtCountdown(m.date)}) on FOX One`,
        });
      }
    }
  }

  function requestNotifyPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // ------------------------------------------------------------------
  // Favorites panel
  // ------------------------------------------------------------------
  function allKnownTeams() {
    const teams = new Set();
    if (state.standings) {
      for (const g of state.standings.groups) for (const r of g.rows) teams.add(r.team);
    }
    if (state.scoreboard) {
      for (const m of state.scoreboard.matches) {
        teams.add(m.home.name);
        teams.add(m.away.name);
      }
    }
    teams.delete('TBD');
    return [...teams].sort();
  }

  function renderFavPanel() {
    const list = $('#fav-list');
    const teams = allKnownTeams();
    if (!teams.length) {
      list.innerHTML = '<p class="fav-note">Teams will appear once data loads.</p>';
      return;
    }
    list.innerHTML = teams
      .map(
        (t) => `<label class="fav-item">
          <input type="checkbox" data-team="${esc(t)}" ${state.favTeams.has(t) ? 'checked' : ''}>
          <span>${esc(t)}</span>
        </label>`
      )
      .join('');
    list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) state.favTeams.add(cb.dataset.team);
        else state.favTeams.delete(cb.dataset.team);
        store.set('wc-fav-teams', [...state.favTeams]);
        requestNotifyPermission();
        loadAlarm();
      });
    });
  }

  $('#btn-favs').addEventListener('click', () => $('#fav-panel').classList.toggle('hidden'));
  $('#fav-close').addEventListener('click', () => $('#fav-panel').classList.add('hidden'));

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
    const start = state.date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    $('#date-label').textContent =
      state.days > 1 ? `${start} + ${state.days - 1} day${state.days > 2 ? 's' : ''}` : start;
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
    const fav = state.favTeams.has(side.name) ? '<span class="fav-mark">★</span>' : '';
    const score = side.score != null ? side.score : '';
    return `<div class="team-row${winner}">
      <span class="name">${logo}${esc(side.name)}${fav}</span>
      <span class="score">${score}</span>
    </div>`;
  }

  function matchCard(m) {
    const onFox = m.broadcasts.some((b) => /fox/i.test(b));
    const oddsLine = m.odds && m.odds.details ? esc(m.odds.details) : '';
    const starred = state.starred.has(m.id);
    return `<article class="match-card${m.id === state.featuredId ? ' featured' : ''}" data-id="${esc(m.id)}">
      <div class="card-top">
        <span class="stage">${esc(m.stage || 'World Cup 2026')}</span>
        <span class="card-top-right">
          ${statusBadge(m)}
          <button class="star-btn${starred ? ' on' : ''}" data-star="${esc(m.id)}"
            title="Star this match to get an alarm before kickoff">${starred ? '★' : '☆'}</button>
        </span>
      </div>
      ${teamRow(m.home, m)}
      ${teamRow(m.away, m)}
      <div class="card-bottom">
        <span>${esc([m.venue, m.city].filter(Boolean).join(' · '))}</span>
        <span>${oddsLine ? oddsLine + ' · ' : ''}${onFox ? '<span class="fox-tag">FOX ONE</span>' : ''}</span>
      </div>
    </article>`;
  }

  function renderMatches() {
    const sb = state.scoreboard;
    if (!sb) return;
    if (!sb.matches.length) {
      panels.matches.innerHTML = '<p class="empty-state">No matches scheduled for this period.</p>';
      return;
    }

    let html = '';
    if (state.days > 1) {
      // Group by local calendar day with headings.
      const byDay = new Map();
      for (const m of sb.matches) {
        const key = new Date(m.date).toDateString();
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(m);
      }
      for (const [key, matches] of byDay) {
        html += `<h2 class="day-heading">${esc(fmtDayHeading(matches[0].date))}</h2>
          <div class="match-grid">${matches.map(matchCard).join('')}</div>`;
      }
    } else {
      html = `<div class="match-grid">${sb.matches.map(matchCard).join('')}</div>`;
    }
    panels.matches.innerHTML = html;

    panels.matches.querySelectorAll('.star-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.star;
        if (state.starred.has(id)) state.starred.delete(id);
        else {
          state.starred.add(id);
          requestNotifyPermission();
        }
        store.set('wc-starred', [...state.starred]);
        renderMatches();
        loadAlarm();
      });
    });

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
        : '<span class="vs-dim">vs</span>';
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
                  <td class="team-cell">${r.logo ? `<img src="${esc(r.logo)}" alt="">` : ''}${esc(r.team)}${state.favTeams.has(r.team) ? '<span class="fav-mark">★</span>' : ''}</td>
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
              <td class="book-cell">${esc(m.bookmaker || '—')}</td>
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

  function reloadMatches() {
    state.scoreboard = null;
    panels.matches.innerHTML = '<p class="empty-state">Loading…</p>';
    loadScoreboard();
  }

  $('#date-prev').addEventListener('click', () => {
    state.date.setDate(state.date.getDate() - 1);
    reloadMatches();
  });
  $('#date-next').addEventListener('click', () => {
    state.date.setDate(state.date.getDate() + 1);
    reloadMatches();
  });
  $('#date-today').addEventListener('click', () => {
    state.date = new Date();
    reloadMatches();
  });
  document.querySelectorAll('.range-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.days = parseInt(btn.dataset.days, 10);
      document.querySelectorAll('.range-btn').forEach((b) => b.classList.toggle('active', b === btn));
      reloadMatches();
    })
  );
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
      setInterval(loadAlarm, POLL.alarm),
      setInterval(applyTheme, 60000), // auto theme follows the clock
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
      loadAlarm();
      applyTheme();
      startPolling();
    }
  });

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  applyTheme();
  loadScoreboard();
  loadStandings();
  loadOdds();
  loadAlarm();
  startPolling();
})();
