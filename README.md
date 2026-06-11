# ⚽ World Cup Watch Dash

A second-screen dashboard for the **FIFA World Cup 2026**: launch live matches in
your **FOX One** subscription, and track **live scores**, **group standings**, and
**betting odds** — all in one place, auto-refreshing.

Runs two ways with the same code: as **pure static pages** (no server needed —
host on GitHub Pages or any static host) or behind the bundled zero-dependency
Node server.

## Features

- **▶️ Watch on FOX One** — every match card shows its broadcast, and the featured
  match panel opens the FOX One player in a video-sized popup. FOX One streams are
  DRM-protected, so they play in FOX's own player; sign in once with your FOX One
  subscription and keep the dashboard as your second screen.
- **Live scores** — match cards with live clock, score, venue and stage, refreshed
  every 30 seconds. Browse any day of the tournament with the date navigation.
- **Upcoming games** — a range toggle (Today / +1 day / +7 days) shows scheduled
  fixtures ahead of the current date, grouped by day.
- **Kickoff alarm** — pick favorite teams (★ My Teams) or star individual
  matches; when one has a game within the next 3 days you get an in-app alarm
  banner, a chime, and a browser notification (one per match).
- **Auto day/night theme** — light theme from 7am to 7pm, dark at night,
  re-checked every minute. Override anytime with the theme toggle
  (Auto → Light → Dark).
- **Standings** — all group tables (P/W/D/L/GD/Pts) with qualification positions
  highlighted, refreshed every 5 minutes.
- **Betting odds** — ESPN BET moneyline (home/draw/away) and over/under for the
  week's matches, refreshed every 2 minutes. No API key needed. Informational only.

## Quick start

### Option A — static, no server

Serve the `docs/` folder with any static file host:

```bash
npx serve docs        # or: python3 -m http.server -d docs 8000
```

Or publish it on **GitHub Pages**: repo Settings → Pages → "Deploy from a
branch" → select your branch and the `/docs` folder. Done — the dashboard
fetches ESPN's CORS-enabled public feeds straight from your browser.

> Opening `index.html` via `file://` won't work — browsers block data fetches
> from local files. Any static HTTP host is fine.

### Option B — with the bundled server

No dependencies to install — just Node 18+.

```bash
node server.js
# open http://localhost:3000
```

The frontend auto-detects which mode it's running in: if the server's `/api`
routes are present it uses them (with shared caching); otherwise it talks to
the public feeds directly.

## Data sources

| Data | Source | Notes |
| --- | --- | --- |
| Scores & schedule | ESPN public scoreboard feed (`fifa.world`) | no key needed |
| Standings | ESPN public standings feed | no key needed |
| Betting odds | ESPN BET lines embedded in the scoreboard | no key needed |
| Streaming | [FOX One](https://www.foxone.com) | requires your FOX One subscription |

### Configuration (server mode only)

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DAY_TZ` | `America/New_York` | Time zone for match-day boundaries (matches ESPN's Eastern-based schedule days) |

## Offline / demo mode

If the upstream feeds are unreachable, the dashboard falls back to bundled
sample data and shows a **“Showing demo data”** banner so you always get a
working page. In server mode you can force it by appending `?demo=1` to the
API routes.

## Architecture

```
docs/              the entire site — static-host this folder as-is
  index.html       vanilla HTML/CSS/JS frontend (no build step)
  js/app.js        UI: rendering, polling, alarm, theme
  js/data.js       data layer: auto-detects server vs static mode
  js/normalize.js  shared normalizers (browser + Node)
  data/            sample data for offline/demo fallback
server.js          optional zero-dependency Node server: serves docs/ and
                   proxies/caches the same feeds under /api/*
```

## Notes

- Streaming video is **not** embedded directly: FOX One uses DRM and blocks
  framing, so the dashboard deep-links into the official player instead.
- Odds are informational only; this app does not place bets. Please gamble
  responsibly.
