# ⚽ World Cup Watch Dash

A second-screen dashboard for the **FIFA World Cup 2026**: launch live matches in
your **FOX One** subscription, and track **live scores**, **group standings**, and
**betting odds** — all in one place, auto-refreshing.

## Features

- **▶️ Watch on FOX One** — every match card shows its broadcast, and the featured
  match panel opens the FOX One player in a video-sized popup. FOX One streams are
  DRM-protected, so they play in FOX's own player; sign in once with your FOX One
  subscription and keep the dashboard as your second screen.
- **Live scores** — match cards with live clock, score, venue and stage, refreshed
  every 30 seconds. Browse any day of the tournament with the date navigation.
- **Standings** — all group tables (P/W/D/L/GD/Pts) with qualification positions
  highlighted, refreshed every 5 minutes.
- **Betting odds** — moneyline (home/draw/away) and over/under per match,
  refreshed every 2 minutes. Informational only.

## Quick start

No dependencies to install — just Node 18+.

```bash
node server.js
# open http://localhost:3000
```

## Data sources

| Data | Source | Notes |
| --- | --- | --- |
| Scores & schedule | ESPN public scoreboard feed (`fifa.world`) | no key needed |
| Standings | ESPN public standings feed | no key needed |
| Betting odds | [The Odds API](https://the-odds-api.com) *(optional)* | falls back to the ESPN BET lines embedded in the scoreboard |
| Streaming | [FOX One](https://www.foxone.com) | requires your FOX One subscription |

### Optional: richer betting odds

Grab a free API key from [the-odds-api.com](https://the-odds-api.com) and run:

```bash
ODDS_API_KEY=your_key node server.js
```

The server then pulls h2h + totals markets from US bookmakers (American odds).
You can override the sport key with `ODDS_SPORT_KEY` (default
`soccer_fifa_world_cup`).

### Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `ODDS_API_KEY` | *(unset)* | The Odds API key for richer betting markets |
| `ODDS_SPORT_KEY` | `soccer_fifa_world_cup` | The Odds API sport identifier |

## Offline / demo mode

If the upstream feeds are unreachable (or you append `?demo=1` to the API
routes), the server serves bundled sample data and the UI shows a
**“Showing demo data”** banner so you always get a working dashboard.

## Architecture

```
server.js          zero-dependency Node server
  /api/scoreboard  → ESPN scoreboard, normalized + 30s cache
  /api/standings   → ESPN standings, normalized + 5min cache
  /api/odds        → The Odds API (if key) or ESPN lines + 2min cache
  /*               → static files from public/
public/            vanilla HTML/CSS/JS frontend (no build step)
data/              sample data for offline/demo fallback
```

The server proxies and normalizes all upstream data, so the browser never
deals with CORS or API keys.

## Notes

- Streaming video is **not** embedded directly: FOX One uses DRM and blocks
  framing, so the dashboard deep-links into the official player instead.
- Odds are informational only; this app does not place bets. Please gamble
  responsibly.
