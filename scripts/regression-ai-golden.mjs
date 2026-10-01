/**
 * AI golden + single-view game-ready regression.
 *
 * This locks the public PNG/JPEG -> model contract without changing the
 * established export stack. It verifies deterministic recognition/profile
 * resolution and the source-level routing for FRONT-only MODEL reconstruction.
 *
 * Run: node --experimental-strip-types scripts/regression-ai-golden.mjs
 */
import fs from "node:fs";
import { recognizeFromMask, resolveRecognizedCategory, semanticCategoryScores } from "../lib/ai/recognize.ts";
import { adaptiveAssetProfile } from "../lib/ai/assetProfiles.ts";

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

function mask(w, h, predicate) {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => Boolean(predicate(x, y)))
  );
}

const swordMask = mask(42, 170, (x, y) => {
  const p = y / 169;
  const half = Math.max(1, Math.round(8 - 7 * p));
  return Math.abs(x - 21) <= half;
});

const rifleMask = mask(128, 36, (x, y) => {
  const body = x >= 14 && x <= 104 && y >= 13 && y <= 22;
  const stock = x >= 4 && x <= 28 && y >= 8 && y <= 26;
  const barrel = x >= 104 && x <= 123 && y >= 16 && y <= 19;
  const grip = x >= 56 && x <= 66 && y >= 21 && y <= 31;
  return body || stock || barrel || grip;
});

const objectMask = mask(64, 64, (x, y) => {
  const dx = x - 31.5;
  const dy = y - 31.5;
  return (dx * dx) / (24 * 24) + (dy * dy) / (27 * 27) <= 1;
});

for (const [name, input, expected] of [
  ["sword", swordMask, "swords"],
  ["rifle", rifleMask, "rifles"],
  ["object", objectMask, "objects"]
]) {
  const guess = recognizeFromMask(input);
  const resolved = resolveRecognizedCategory(guess);
  const scores = semanticCategoryScores(guess.evidence);
  const scoreValues = Object.values(scores);

  assert(`${name}: resolved category is ${expected}`, resolved.category === expected);
  assert(`${name}: confidence stays bounded`, guess.confidence >= 0 && guess.confidence <= 1);
  assert(`${name}: category scores stay bounded`, scoreValues.every((value) => value >= 0 && value <= 1));
  assert(`${name}: score map is deterministic`, JSON.stringify(semanticCategoryScores(guess.evidence)) === JSON.stringify(scores));
}

const rifleGuess = recognizeFromMask(rifleMask);
const rifleProfileSingle = adaptiveAssetProfile({
  category: "rifles",
  features: rifleGuess.features,
  evidence: rifleGuess.evidence,
  width: 128,
  height: 36,
  volumeSize: 128,
  mode: "model",
  hasSide: false,
  hasDepth: true
});
const rifleProfileDual = adaptiveAssetProfile({
  category: "rifles",
  features: rifleGuess.features,
  evidence: rifleGuess.evidence,
  width: 128,
  height: 36,
  volumeSize: 128,
  mode: "model",
  hasSide: true,
  hasDepth: true
});

assert("rifle single-view profile is marked single", rifleProfileSingle.viewMode === "single");
assert("rifle dual-view profile is marked front+side", rifleProfileDual.viewMode === "front+side");
assert("rifle single-view profile stays bounded", rifleProfileSingle.depthScale >= 0.72 && rifleProfileSingle.depthScale <= 1.08);
assert("rifle single-view detail budget stays bounded", rifleProfileSingle.budgetScale >= 0.96 && rifleProfileSingle.budgetScale <= 1.10);
assert("rifle dual-view does not reduce budget", rifleProfileDual.budgetScale >= rifleProfileSingle.budgetScale);

const engine = fs.readFileSync(new URL("../lib/image/engine.ts", import.meta.url), "utf8");

assert(
  "FRONT-only MODEL routes through buildSingleViewModel",
  /const singleView = buildSingleViewModel\(\s*frontRaster,\s*frontMask,\s*frontBounds,\s*normalized,/.test(engine)
);
const builder = fs.readFileSync(new URL("../components/builder/Builder.tsx", import.meta.url), "utf8");
assert(
  "PNG/JPEG Builder default is MODEL",
  builder.includes('const [imageMode, setImageMode] = useState<LocalImageMode>("model")')
);
assert(
  "single-view MODEL keeps volumetric fallback for non-revolved assets",
  engine.includes("function buildSingleViewModel(") &&
    engine.includes('mode: "solid"')
);
assert(
  "FRONT remains the hard silhouette anchor",
  engine.includes("if (!sourceMask[y]?.[x]) continue;")
);

assert(
  "2D uses premium 96-color source palette",
  engine.includes('normalized.output === "2d" ? 96')
);
assert(
  "2.5D uses premium 80-color source palette",
  engine.includes('normalized.output === "25d" ? 80')
);
assert(
  "2.5D supports eight stable depth planes",
  engine.includes("Math.min(8, Math.round(options.heightMax))")
);
assert(
  "2D defaults to no synthetic outline",
  engine.includes('normalized.outline === undefined) normalized.outline = false')
);
assert(
  "2D/2.5D build at 256 working resolution",
  fs.readFileSync(new URL("../lib/ai/buildOptions.ts", import.meta.url), "utf8")
    .includes('output === "2d" || output === "25d"')
);

if (failed) {
  console.error(`\\n${failed} AI golden assertion(s) failed`);
  process.exit(1);
}

console.log("\nAI golden + single-view game-ready regression checks passed.");
