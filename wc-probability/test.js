/* Deterministic tests for the win-probability toolkit.
 * Run: node wc-probability/test.js   (no framework, exits non-zero on failure)
 */
const P = require('./probability.js');

let passed = 0;
let failed = 0;

function ok(name, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  ✗ ' + name);
  }
}
function approx(name, got, want, tol) {
  ok(name + ` (got ${round(got)}, want ~${want})`, Math.abs(got - want) <= (tol || 1e-3));
}
const round = (x) => Math.round(x * 10000) / 10000;

// --- Odds math -------------------------------------------------------------
approx('americanToImplied(-140)', P.americanToImplied(-140), 0.5833, 1e-3);
approx('americanToImplied(+380)', P.americanToImplied(380), 0.2083, 1e-3);
approx('americanToImplied(+100)', P.americanToImplied(100), 0.5, 1e-9);
ok('americanToImplied(0) is null', P.americanToImplied(0) === null);

const dv = P.devig({ home: -140, draw: 260, away: 380 });
approx('devig sums to 1', dv.home + dv.draw + dv.away, 1, 1e-9);
ok('devig home is favorite', dv.home > dv.away && dv.home > dv.draw);
ok('devig overround > 0', dv.overround > 0);

const dv2 = P.devig({ home: -150, draw: null, away: 130 });
approx('2-way devig sums to 1', dv2.home + dv2.away, 1, 1e-9);
ok('2-way devig draw is 0', dv2.draw === 0);

ok('matchProbabilities null when no odds', P.matchProbabilities({ odds: null }) === null);
const mp = P.matchProbabilities({ odds: { homeML: -140, drawML: 260, awayML: 380 } });
approx('matchProbabilities sums to 1', mp.home + mp.draw + mp.away, 1, 1e-9);

// impliedToAmerican round-trips
approx('impliedToAmerican(0.5833)->-140', P.impliedToAmerican(0.5833), -140, 1);
approx('impliedToAmerican(0.2083)->+380', P.impliedToAmerican(0.2083), 380, 2);

// --- Poisson ---------------------------------------------------------------
let pmfSum = 0;
let mean = 0;
for (let k = 0; k <= 30; k++) {
  const p = P.poissonPmf(k, 1.5);
  pmfSum += p;
  mean += k * p;
}
approx('poisson pmf sums to 1', pmfSum, 1, 1e-6);
approx('poisson mean == lambda', mean, 1.5, 1e-4);

// --- Outcome probabilities -------------------------------------------------
const even = P.matchOutcomeProbs(1.3, 1.3, 10);
approx('equal lambdas sum to 1', even.home + even.draw + even.away, 1, 1e-9);
approx('equal lambdas symmetric', even.home, even.away, 1e-9);

const tilt = P.matchOutcomeProbs(2.2, 0.8, 10);
ok('higher home lambda -> home favored', tilt.home > tilt.away);
approx('tilt sums to 1', tilt.home + tilt.draw + tilt.away, 1, 1e-9);

// ratings -> lambdas: stronger team gets more goals; equal+home adv favors home
const rl = P.ratingsToLambdas(1900, 1600, {});
ok('stronger rating -> higher lambda', rl.lambdaHome > rl.lambdaAway);
const rlEven = P.ratingsToLambdas(1700, 1700, { homeAdvantage: 0.25 });
ok('home advantage tilts lambdas', rlEven.lambdaHome > rlEven.lambdaAway);

// lambdasFromProbs recovers something close to the target outcome probs
const target = P.matchOutcomeProbs(1.8, 1.0, 10);
const fit = P.lambdasFromProbs(target, {});
const back = P.matchOutcomeProbs(fit.lambdaHome, fit.lambdaAway, 10);
approx('fit recovers home prob', back.home, target.home, 0.03);
approx('fit recovers away prob', back.away, target.away, 0.03);

// --- Determinism -----------------------------------------------------------
const g1 = P.mulberry32(42);
const g2 = P.mulberry32(42);
ok('seeded RNG deterministic', g1() === g2() && g1() === g2());

// --- Monte Carlo group simulation ------------------------------------------
// A fresh group (0 games played), one strong team by rating.
const groups = [
  {
    name: 'Group X',
    rows: [
      { team: 'Strong', played: 0, points: 0, gf: 0, ga: 0 },
      { team: 'Mid1', played: 0, points: 0, gf: 0, ga: 0 },
      { team: 'Mid2', played: 0, points: 0, gf: 0, ga: 0 },
      { team: 'Weak', played: 0, points: 0, gf: 0, ga: 0 },
    ],
  },
];
const fixtures = [
  { home: 'Strong', away: 'Mid1' }, { home: 'Mid2', away: 'Weak' },
  { home: 'Strong', away: 'Mid2' }, { home: 'Weak', away: 'Mid1' },
  { home: 'Strong', away: 'Weak' }, { home: 'Mid1', away: 'Mid2' },
];
const ratings = { Strong: 2000, Mid1: 1650, Mid2: 1600, Weak: 1400 };
const res = P.simulateGroups(groups, fixtures, { iterations: 4000, seed: 7, ratings });
const teams = {};
res[0].teams.forEach((t) => (teams[t.team] = t));

let sumWin = 0;
let sumAdvance = 0;
let allValid = true;
res[0].teams.forEach((t) => {
  sumWin += t.winGroupProb;
  sumAdvance += t.advanceProb;
  if (t.advanceProb < 0 || t.advanceProb > 1 || t.advanceProb < t.winGroupProb) allValid = false;
});
ok('probabilities in [0,1] and advance>=winGroup', allValid);
approx('winGroup probs sum to 1', sumWin, 1, 1e-9);
approx('advance probs sum to advanceCount', sumAdvance, 2, 1e-9);
ok('strong team most likely to win group', teams.Strong.winGroupProb > teams.Weak.winGroupProb);
ok('strong team advances more than weak', teams.Strong.advanceProb > teams.Weak.advanceProb);
ok('strong team high advance prob', teams.Strong.advanceProb > 0.7);

// Determinism of the whole simulation under a fixed seed.
const resB = P.simulateGroups(groups, fixtures, { iterations: 4000, seed: 7, ratings });
ok(
  'simulation deterministic under seed',
  resB[0].teams.every((t) => teams[t.team].advanceProb === t.advanceProb)
);

// Already-clinched: a team on 6 pts with no games left always advances.
const clinched = [
  {
    name: 'Group Y',
    rows: [
      { team: 'Done', played: 3, points: 9, gf: 7, ga: 1 },
      { team: 'A', played: 2, points: 3, gf: 2, ga: 3 },
      { team: 'B', played: 2, points: 3, gf: 2, ga: 3 },
      { team: 'C', played: 2, points: 0, gf: 1, ga: 5 },
    ],
  },
];
const clRes = P.simulateGroups(clinched, [{ home: 'A', away: 'B' }, { home: 'C', away: 'A' }, { home: 'B', away: 'C' }], {
  iterations: 2000,
  seed: 3,
  ratings: { Done: 1800, A: 1600, B: 1600, C: 1500 },
});
const done = clRes[0].teams.find((t) => t.team === 'Done');
approx('clinched team advances ~always', done.advanceProb, 1, 1e-9);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
