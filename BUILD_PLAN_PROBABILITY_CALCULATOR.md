# Build Plan — World Cup Win-Probability Calculator

Status: **built** (see `wc-probability/`). This document is the plan of record; the
"Review notes" section at the end tracks corrections made during review.

## Goal

Add a self-contained probability toolkit to the World Cup Watch Dash that turns
the data the dashboard already has — betting moneylines and group standings —
into two things:

1. **Match probabilities** — fair win / draw / loss probabilities for a single
   match, derived from the bookmaker's moneylines with the bookmaker margin
   ("vig") removed.
2. **Advancement probabilities** — each team's chance of winning its group and
   of advancing (top 2), via Monte Carlo simulation of the remaining group
   fixtures.

It is informational only — consistent with the app's responsible-gambling stance,
it computes probabilities, it does not place or advise bets.

## Constraints (match the existing project)

- **Zero dependencies**, vanilla JS, no build step.
- **UMD module** (`module.exports` for Node + `window.WCProbability` for the
  browser), mirroring `docs/js/normalize.js`.
- **Deterministic tests** runnable with plain `node` (seeded RNG, no test
  framework).
- Works in both the static and server deployment modes.

## Design

### 1. Odds → fair probabilities (closed-form, exact)

- `americanToImplied(ml)` — American moneyline → implied probability.
  - `ml < 0`: `(-ml) / (-ml + 100)`
  - `ml > 0`: `100 / (ml + 100)`
- `devig({home, draw, away})` — implied probabilities sum to > 1 because they
  include the margin. Normalize by dividing each by the total (the standard
  *multiplicative / proportional* method) so they sum to 1. Supports 2-way
  markets (no draw) by passing `draw: null`.
- `matchProbabilities(match)` — pull `homeML/drawML/awayML` off a normalized
  scoreboard match and return `{home, draw, away}` (or `null` if no odds).

### 2. Goal model (Poisson) — used by the simulation

Group tiebreakers need goal difference, so we model **goals**, not just
outcomes:

- Each team scores goals ~ independent `Poisson(λ)`.
- `ratingsToLambdas(ratingHome, ratingAway, opts)` — convert two team strength
  ratings into `{lambdaHome, lambdaAway}` using goal supremacy from the rating
  difference plus a home-advantage term.
- `matchOutcomeProbs(λHome, λAway, maxGoals)` — sum the Poisson pmf grid to get
  exact `{home, draw, away}` outcome probabilities (used for validation and as
  an odds-free fallback).

### 3. Monte Carlo group simulation

- `simulateGroups(groups, remainingFixtures, opts)`:
  - Seed from current standings (`played, points, gf, ga`).
  - For each iteration, sample every remaining fixture's scoreline via Poisson
    (λ from odds-calibrated values if the fixture carries probabilities, else
    from ratings), update points/GF/GA.
  - Rank each group by **points → goal difference → goals for** (documented
    simplification of the full FIFA tiebreakers, which also include
    head-to-head).
  - Tally `winGroup` (rank 1) and `advance` (rank ≤ 2).
- Deterministic given a seeded RNG (`mulberry32`).

## Deliverables

- `wc-probability/probability.js` — the module.
- `wc-probability/test.js` — assertions runnable with `node`.
- `wc-probability/README.md` — model description, API, and limitations.
- `BUILD_PLAN_PROBABILITY_CALCULATOR.md` — this file.

## Validation checklist

- [x] `americanToImplied(-140)` ≈ 0.5833; `(+380)` ≈ 0.2083.
- [x] `devig` output sums to 1; 2-way market handled.
- [x] `matchOutcomeProbs` sums to 1; equal λ ⇒ `home == away`; higher λHome ⇒
      `home > away`.
- [x] Poisson pmf sums to ~1 over 0..N; mean ≈ λ.
- [x] Simulation: stronger team advances more often; probabilities per team in
      [0,1]; `advance ≥ winGroup`; already-clinched team ⇒ advance ≈ 1.
- [x] Deterministic under a fixed seed.

## Review notes (corrections made after first build)

See the commit history; issues found while reviewing the first pass and their
fixes are listed in `wc-probability/README.md` under "Review notes".
