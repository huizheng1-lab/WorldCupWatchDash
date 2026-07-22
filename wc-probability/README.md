# wc-probability — Win-Probability Toolkit

Zero-dependency helpers that turn the data the World Cup Watch Dash already has
(betting moneylines, group standings) into **fair match probabilities** and
**Monte-Carlo advancement probabilities**.

Informational only — it computes probabilities, it does not place or advise bets.

## Usage

Node:

```js
const P = require('./wc-probability/probability.js');
```

Browser (loads as `window.WCProbability`, like `docs/js/normalize.js`):

```html
<script src="wc-probability/probability.js"></script>
```

Run the tests:

```bash
node wc-probability/test.js
```

## API

### Odds → fair probabilities

| Function | Purpose |
| --- | --- |
| `americanToImplied(ml)` | American moneyline → implied probability (incl. margin) |
| `impliedToAmerican(p)` | inverse of the above |
| `devig({home, draw, away})` | remove the bookmaker margin; returns `{home, draw, away, overround}` summing to 1. Pass `draw: null` for a 2-way market |
| `matchProbabilities(match)` | fair `{home, draw, away}` for a normalized scoreboard match (or `null`) |
| `expectedPoints(pWin, pDraw)` | expected league points from a match (3/1/0) |

```js
P.devig({ home: -140, draw: 260, away: 380 });
// { home: 0.56, draw: 0.24, away: 0.20, overround: 0.05 }  (approx)
```

### Goal model (Poisson)

| Function | Purpose |
| --- | --- |
| `poissonPmf(k, lambda)` | Poisson probability mass |
| `matchOutcomeProbs(λHome, λAway, maxGoals=10)` | exact `{home, draw, away}` from two scoring rates |
| `ratingsToLambdas(rHome, rAway, opts)` | strength ratings → `{lambdaHome, lambdaAway}` |
| `lambdasFromProbs({home,draw,away}, opts)` | fit scoring rates to target outcome probabilities |

### Monte-Carlo group simulation

```js
P.simulateGroups(groups, remainingFixtures, opts)
```

- `groups`: `[{ name, rows: [{ team, played, points, gf, ga }] }]`
- `remainingFixtures`: `[{ home, away, lambdaHome?, lambdaAway?, probs? }]`
  — per fixture, scoring rates are taken from explicit `lambda*`, else fitted
  from `probs` (e.g. de-vigged odds), else from `opts.ratings`, else an even
  matchup.
- `opts`: `{ iterations=10000, seed=1, ratings={team:rating}, advanceCount=2,
  baseGoals, scale, homeAdvantage, totalGoals, rng }`

Returns each group with per-team `{ advanceProb, winGroupProb, expPoints }`,
sorted by advancement likelihood. Deterministic for a fixed `seed`.

```js
const res = P.simulateGroups(groups, fixtures, { iterations: 10000, seed: 7, ratings });
// res[0].teams => [{ team:'Brazil', advanceProb:0.93, winGroupProb:0.71, expPoints:6.8 }, ...]
```

## Model & limitations

- **De-vig** uses the multiplicative (proportional) method — simple and
  standard; other methods (Shin, additive) exist and differ slightly for
  longshots.
- **Goals** are modelled as two **independent** Poisson variables. Real scores
  are mildly correlated (Dixon–Coles low-score adjustment) — omitted for
  simplicity; the effect on advancement probabilities is small.
- **Tiebreakers** use points → goal difference → goals for. The full FIFA order
  also includes head-to-head results and, ultimately, fair-play/draw of lots —
  not modelled.
- Ratings are an **input**. The toolkit doesn't ship a rating source; feed it
  Elo/SPI-style numbers, or rely on odds-derived `probs` per fixture for the
  most market-consistent results.

## Review notes (corrections after the first build)

1. **Simulation output ranking** — the first pass ranked the returned teams via
   a hacky proxy object (`points: advanceCount`) fed back through the standings
   ranker. Replaced with a direct sort on `advanceProb → winGroupProb →
   expPoints`.
2. **Unknown-team fixtures** — a fixture naming a team not present in any group
   previously threw on the standings lookup. Now such fixtures are filtered out
   with a warning, so a stray/typo'd fixture can't crash a simulation.
3. **Tail truncation** — `matchOutcomeProbs` renormalizes over the `0..maxGoals`
   grid so the probabilities sum to exactly 1 despite truncating the Poisson
   tail (verified by tests).
