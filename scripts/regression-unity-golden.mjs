/**
 * P19 AI golden benchmark.
 *
 * This is a deterministic benchmark for the AI decision layer that feeds the
 * 2D/2.5D reconstruction pipeline. It covers the four supported AI categories
 * with synthetic silhouettes that intentionally sit inside the recognizer's
 * documented category regions.
 *
 * The benchmark does not replace the runtime reconstruction tests. It creates a
 * stable golden contract for category resolution, confidence, adaptive profile
 * demand and dynamic voxel budget, including single-view vs FRONT+SIDE support.
 */
import { recognizeFromMask, resolveRecognizedCategory } from "../lib/ai/recognize.ts";
import { adaptiveAssetProfile } from "../lib/ai/assetProfiles.ts";
import { dynamicVoxelBudget } from "../lib/image/budget.ts";

const VOLUME = 64;
const DEFAULT_CAP = 100000;

function assert(name, condition) {
  if (!condition) {
    throw new Error(`FAIL ${name}`);
  }
  console.log(`OK   ${name}`);
}

function makeMask(width, height, draw) {
  const mask = Array.from({ length: height }, () => Array(width).fill(false));
  draw(mask);
  return mask;
}

function boundsOf(mask) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < mask.length; y += 1) {
    for (let x = 0; x < mask[0].length; x += 1) {
      if (!mask[y][x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function profileFor(category, guess, hasSide) {
  const bounds = boundsOf(guess.mask);
  return adaptiveAssetProfile({
    category,
    features: guess.features,
    evidence: guess.evidence,
    width: bounds.width,
    height: bounds.height,
    volumeSize: VOLUME,
    mode: "model",
    hasSide,
    hasDepth: category !== "swords"
  });
}

function budgetFor(category, guess, profile, depth) {
  const bounds = boundsOf(guess.mask);
  return dynamicVoxelBudget({
    volumeSize: VOLUME,
    mode: "model",
    defaultCap: DEFAULT_CAP,
    width: Math.min(bounds.width, VOLUME),
    height: Math.min(bounds.height, VOLUME),
    depth: Math.min(depth, VOLUME),
    projectedFill: guess.evidence.fill,
    category,
    profileScale: profile.budgetScale
  });
}

const GOLDEN = [
  {
    name: "sword",
    expectedCategory: "swords",
    minConfidence: 0.82,
    budgetRange: [70000, 79000],
    singleProfileRange: [1.06, 1.09],
    dualProfileRange: [1.06, 1.09],
    mask: makeMask(64, 96, (m) => {
      for (let y = 8; y < 84; y += 1) {
        for (let x = 30; x <= 33; x += 1) m[y][x] = true;
      }
      for (let y = 84; y < 88; y += 1) {
        for (let x = 29; x <= 34; x += 1) m[y][x] = true;
      }
      m[88][23] = true;
      m[89][40] = true;
    })
  },
  {
    name: "gun",
    expectedCategory: "guns",
    minConfidence: 0.71,
    budgetRange: [75000, 81000],
    singleProfileRange: [1.08, 1.10],
    dualProfileRange: [1.09, 1.10],
    mask: makeMask(96, 32, (m) => {
      for (let y = 12; y < 18; y += 1) {
        for (let x = 12; x < 84; x += 1) m[y][x] = true;
      }
      m[2][48] = true;
      m[29][48] = true;
    })
  },
  {
    name: "rifle",
    expectedCategory: "rifles",
    minConfidence: 0.79,
    budgetRange: [80000, 85000],
    singleProfileRange: [1.09, 1.10],
    dualProfileRange: [1.09, 1.10],
    mask: makeMask(128, 32, (m) => {
      for (let y = 14; y < 18; y += 1) {
        for (let x = 8; x < 120; x += 1) m[y][x] = true;
      }
      m[2][64] = true;
      m[29][64] = true;
    })
  },
  {
    name: "object",
    expectedCategory: "objects",
    minConfidence: 0.76,
    budgetRange: [70000, 80000],
    singleProfileRange: [0.99, 1.01],
    dualProfileRange: [1.01, 1.03],
    mask: makeMask(56, 56, (m) => {
      for (let y = 8; y < 48; y += 1) {
        for (let x = 8; x < 48; x += 1) m[y][x] = true;
      }
    })
  }
];

const results = [];

for (const golden of GOLDEN) {
  const mask = golden.mask;
  const guess = recognizeFromMask(mask);
  const resolved = resolveRecognizedCategory(guess);
  const single = profileFor(resolved.category, { ...guess, mask }, false);
  const dual = profileFor(resolved.category, { ...guess, mask }, true);
  const singleBudget = budgetFor(resolved.category, { ...guess, mask }, single, resolved.category === "swords" ? 8 : 16);
  const dualBudget = budgetFor(resolved.category, { ...guess, mask }, dual, 16);

  const within = (value, range) => value >= range[0] && value <= range[1];

  console.log(`\n[P19] ${golden.name}`);
  console.log(`  category=${resolved.category} confidence=${guess.confidence.toFixed(3)}`);
  console.log(`  single profile=${single.budgetScale.toFixed(3)} budget=${singleBudget}`);
  console.log(`  dual   profile=${dual.budgetScale.toFixed(3)} budget=${dualBudget}`);

  assert(`${golden.name} resolves to ${golden.expectedCategory}`, resolved.category === golden.expectedCategory);
  assert(`${golden.name} confidence >= ${golden.minConfidence}`, guess.confidence >= golden.minConfidence);
  assert(`${golden.name} single profile golden range`, within(single.budgetScale, golden.singleProfileRange));
  assert(`${golden.name} dual profile golden range`, within(dual.budgetScale, golden.dualProfileRange));
  assert(`${golden.name} single budget golden range`, within(singleBudget, golden.budgetRange));
  assert(`${golden.name} hard cap respected`, singleBudget <= DEFAULT_CAP && dualBudget <= DEFAULT_CAP);
  assert(`${golden.name} deterministic profile`, profileFor(resolved.category, { ...guess, mask }, false).budgetScale === single.budgetScale);

  if (resolved.category !== "swords") {
    assert(`${golden.name} FRONT+SIDE budget not lower`, dualBudget >= singleBudget);
    assert(`${golden.name} FRONT+SIDE keeps depth support`, dual.useDepthHint === true);
  } else {
    assert(`${golden.name} blade profile stays shell/depth-neutral`, dual.useDepthHint === false && dual.shell === true);
  }

  results.push({
    name: golden.name,
    category: resolved.category,
    confidence: Number(guess.confidence.toFixed(3)),
    singleProfile: Number(single.budgetScale.toFixed(3)),
    dualProfile: Number(dual.budgetScale.toFixed(3)),
    singleBudget,
    dualBudget,
    fill: Number(guess.evidence.fill.toFixed(3)),
    slenderness: Number(guess.evidence.slenderness.toFixed(3))
  });
}

const signature = results
  .map((r) => [r.category, r.confidence, r.singleProfile, r.dualProfile, r.singleBudget, r.dualBudget].join(":"))
  .join("|");

assert("P19 benchmark matrix contains all four categories", results.length === 4);
console.log(`\nP19 GOLDEN SIGNATURE ${signature}`);
console.log("\nAll P19 AI golden benchmark checks passed.");
