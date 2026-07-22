/* World Cup Watch Dash — win-probability toolkit.
 *
 * Turns the data the dashboard already has (betting moneylines, group
 * standings) into fair match probabilities and Monte-Carlo advancement
 * probabilities. Zero dependencies; UMD so it runs in Node and the browser
 * (window.WCProbability), mirroring docs/js/normalize.js.
 *
 * Informational only — it computes probabilities, it does not place or
 * advise bets.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WCProbability = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // 1. Odds math (exact, closed-form)
  // ---------------------------------------------------------------------

  // American moneyline -> implied probability (includes the bookmaker margin).
  function americanToImplied(ml) {
    if (ml == null || !isFinite(ml) || ml === 0) return null;
    return ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100);
  }

  // Implied probability -> American moneyline (inverse of the above).
  function impliedToAmerican(p) {
    if (p == null || p <= 0 || p >= 1) return null;
    return p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
  }

  // Remove the vig from a set of moneylines by normalizing the implied
  // probabilities to sum to 1 (multiplicative / proportional method).
  // Accepts a 3-way market {home, draw, away} or a 2-way market (draw null).
  function devig(mls) {
    const raw = {
      home: americanToImplied(mls.home),
      draw: mls.draw == null ? null : americanToImplied(mls.draw),
      away: americanToImplied(mls.away),
    };
    const total = (raw.home || 0) + (raw.draw || 0) + (raw.away || 0);
    if (!total) return null;
    const out = { home: (raw.home || 0) / total, away: (raw.away || 0) / total };
    if (raw.draw != null) out.draw = raw.draw / total;
    else out.draw = 0;
    // The bookmaker margin (overround), handy for display.
    out.overround = total - 1;
    return out;
  }

  // Fair {home, draw, away} for a normalized scoreboard match, or null.
  function matchProbabilities(match) {
    if (!match || !match.odds) return null;
    const { homeML, drawML, awayML } = match.odds;
    if (homeML == null || awayML == null) return null;
    return devig({ home: homeML, draw: drawML, away: awayML });
  }

  // Expected points a team earns from a match (3/1/0 for W/D/L).
  function expectedPoints(pWin, pDraw) {
    return 3 * pWin + 1 * pDraw;
  }

  // ---------------------------------------------------------------------
  // 2. Goal model (Poisson)
  // ---------------------------------------------------------------------

  function poissonPmf(k, lambda) {
    if (k < 0 || lambda < 0) return 0;
    // exp(k*ln(lambda) - lambda - ln(k!)) — stable for the small k we use.
    let logFact = 0;
    for (let i = 2; i <= k; i++) logFact += Math.log(i);
    return Math.exp(k * Math.log(lambda) - lambda - logFact);
  }

  // Exact outcome probabilities from two scoring rates, by summing the pmf
  // grid over 0..maxGoals for each side.
  function matchOutcomeProbs(lambdaHome, lambdaAway, maxGoals) {
    const N = maxGoals || 10;
    const homePmf = [];
    const awayPmf = [];
    for (let k = 0; k <= N; k++) {
      homePmf[k] = poissonPmf(k, lambdaHome);
      awayPmf[k] = poissonPmf(k, lambdaAway);
    }
    let home = 0;
    let draw = 0;
    let away = 0;
    for (let h = 0; h <= N; h++) {
      for (let a = 0; a <= N; a++) {
        const p = homePmf[h] * awayPmf[a];
        if (h > a) home += p;
        else if (h === a) draw += p;
        else away += p;
      }
    }
    // Renormalize to absorb the tail truncated beyond maxGoals.
    const total = home + draw + away;
    return { home: home / total, draw: draw / total, away: away / total };
  }

  // Two strength ratings -> expected goals for each side.
  // supremacy = (ratingHome - ratingAway) / scale + homeAdvantage
  // lambdaHome/Away are split around a base scoring rate by that supremacy.
  function ratingsToLambdas(ratingHome, ratingAway, opts) {
    const o = opts || {};
    const base = o.baseGoals != null ? o.baseGoals : 1.35; // avg goals/team/game
    const scale = o.scale != null ? o.scale : 400; // Elo-like points per goal-ish
    const homeAdv = o.homeAdvantage != null ? o.homeAdvantage : 0.25;
    const sup = (ratingHome - ratingAway) / scale + homeAdv;
    const lambdaHome = clamp(base * Math.exp(sup / 2), 0.05, 8);
    const lambdaAway = clamp(base * Math.exp(-sup / 2), 0.05, 8);
    return { lambdaHome, lambdaAway };
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  // ---------------------------------------------------------------------
  // 3. Deterministic RNG + sampling
  // ---------------------------------------------------------------------

  // mulberry32 — small, fast, seedable PRNG for reproducible simulations.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Sample a Poisson(lambda) count via Knuth's algorithm.
  function samplePoisson(lambda, rng) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng();
    } while (p > L);
    return k - 1;
  }

  // ---------------------------------------------------------------------
  // 4. Monte Carlo group simulation
  // ---------------------------------------------------------------------

  // Resolve a fixture to {lambdaHome, lambdaAway}. Priority:
  //   1. fixture.lambdaHome/lambdaAway if provided
  //   2. calibrated from fixture.probs {home,draw,away} (e.g. de-vigged odds)
  //   3. from ratings[home]/ratings[away]
  //   4. an even matchup
  function fixtureLambdas(fx, ratings, opts) {
    if (fx.lambdaHome != null && fx.lambdaAway != null) {
      return { lambdaHome: fx.lambdaHome, lambdaAway: fx.lambdaAway };
    }
    if (fx.probs && fx.probs.home != null && fx.probs.away != null) {
      return lambdasFromProbs(fx.probs, opts);
    }
    if (ratings && ratings[fx.home] != null && ratings[fx.away] != null) {
      return ratingsToLambdas(ratings[fx.home], ratings[fx.away], opts);
    }
    const base = (opts && opts.baseGoals) || 1.35;
    return { lambdaHome: base, lambdaAway: base };
  }

  // Find lambdas whose Poisson outcome probabilities best match target
  // {home,draw,away}, by a short 1-D search over goal supremacy at a fixed
  // total. Keeps the model self-consistent with the odds.
  function lambdasFromProbs(probs, opts) {
    const o = opts || {};
    const totalGoals = o.totalGoals != null ? o.totalGoals : 2.7;
    let best = null;
    // supremacy expressed directly as a multiplicative split of totalGoals.
    for (let s = -3; s <= 3; s += 0.05) {
      const lh = clamp((totalGoals / 2) * Math.exp(s / 2), 0.05, 8);
      const la = clamp((totalGoals / 2) * Math.exp(-s / 2), 0.05, 8);
      const est = matchOutcomeProbs(lh, la, 10);
      const err =
        Math.pow(est.home - probs.home, 2) +
        Math.pow(est.away - probs.away, 2) +
        Math.pow(est.draw - (probs.draw || 0), 2);
      if (!best || err < best.err) best = { lh, la, err };
    }
    return { lambdaHome: best.lh, lambdaAway: best.la };
  }

  // Rank a group's rows by points, then goal difference, then goals for.
  function rankRows(rows) {
    return rows
      .slice()
      .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || 0);
  }

  /**
   * simulateGroups(groups, remainingFixtures, opts)
   *
   * groups: [{ name, rows: [{ team, played, points, gf, ga }] }]  (gd derived)
   * remainingFixtures: [{ group?, home, away, lambdaHome?, lambdaAway?, probs? }]
   *   - each fixture must name two teams that appear in some group's rows.
   * opts: { iterations=10000, seed=1, ratings={team:rating}, advanceCount=2,
   *         baseGoals, scale, homeAdvantage, totalGoals }
   *
   * Returns groups with per-team probabilities:
   *   [{ name, teams: [{ team, advanceProb, winGroupProb, expPoints }] }]
   */
  function simulateGroups(groups, remainingFixtures, opts) {
    const o = opts || {};
    const iterations = o.iterations || 10000;
    const advanceCount = o.advanceCount || 2;
    const rng = o.rng || mulberry32(o.seed != null ? o.seed : 1);

    // Which group each team belongs to, and fixtures grouped per group.
    const teamGroup = {};
    const tally = {}; // team -> { advance, winGroup, pointsSum }
    groups.forEach((g, gi) => {
      for (const r of g.rows) {
        teamGroup[r.team] = gi;
        tally[r.team] = { advance: 0, winGroup: 0, pointsSum: 0 };
      }
    });

    // Precompute lambdas per fixture once (they don't change across iterations).
    // Skip fixtures naming a team that isn't in any group's rows.
    const fixtures = (remainingFixtures || [])
      .filter((fx) => {
        const known = teamGroup[fx.home] != null && teamGroup[fx.away] != null;
        if (!known) console.warn(`[simulateGroups] skipping fixture with unknown team: ${fx.home} vs ${fx.away}`);
        return known;
      })
      .map((fx) => ({
        home: fx.home,
        away: fx.away,
        ...fixtureLambdas(fx, o.ratings, o),
      }));

    for (let it = 0; it < iterations; it++) {
      // Fresh mutable standings for this iteration.
      const sim = groups.map((g) =>
        g.rows.map((r) => ({
          team: r.team,
          points: r.points || 0,
          gf: r.gf || 0,
          ga: r.ga || 0,
          gd: (r.gf || 0) - (r.ga || 0),
        }))
      );
      const idx = {}; // team -> row object in sim
      sim.forEach((rows) => rows.forEach((r) => (idx[r.team] = r)));

      for (const fx of fixtures) {
        const gh = samplePoisson(fx.lambdaHome, rng);
        const ga = samplePoisson(fx.lambdaAway, rng);
        const H = idx[fx.home];
        const A = idx[fx.away];
        H.gf += gh; H.ga += ga; H.gd += gh - ga;
        A.gf += ga; A.ga += gh; A.gd += ga - gh;
        if (gh > ga) H.points += 3;
        else if (gh < ga) A.points += 3;
        else { H.points += 1; A.points += 1; }
      }

      for (const rows of sim) {
        const ranked = rankRows(rows);
        for (let pos = 0; pos < ranked.length; pos++) {
          const t = tally[ranked[pos].team];
          t.pointsSum += ranked[pos].points;
          if (pos < advanceCount) t.advance++;
          if (pos === 0) t.winGroup++;
        }
      }
    }

    return groups.map((g) => ({
      name: g.name,
      teams: g.rows
        .map((r) => ({
          team: r.team,
          advanceProb: tally[r.team].advance / iterations,
          winGroupProb: tally[r.team].winGroup / iterations,
          expPoints: tally[r.team].pointsSum / iterations,
        }))
        // Display order: most likely to advance first, then to win the group.
        .sort(
          (a, b) =>
            b.advanceProb - a.advanceProb ||
            b.winGroupProb - a.winGroupProb ||
            b.expPoints - a.expPoints
        ),
    }));
  }

  return {
    americanToImplied,
    impliedToAmerican,
    devig,
    matchProbabilities,
    expectedPoints,
    poissonPmf,
    matchOutcomeProbs,
    ratingsToLambdas,
    lambdasFromProbs,
    mulberry32,
    samplePoisson,
    simulateGroups,
  };
});
