/**
 * P5 reconstruction regression.
 * Run: node --experimental-strip-types scripts/regression-reconstruction.mjs
 *
 * Locks:
 * - high-confidence rotational masks are recognized
 * - elongated/asymmetric weapon-like masks do not meet the model revolve gate
 * - P5 single-view inference stays OBJECTS-only and high-confidence gated
 * - adaptive depth / local thickness helpers remain present in engine
 */
import fs from "node:fs";
import { guessRevolve } from "../lib/ai/revolve.ts";

function mask(w, h, predicate) {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => predicate(x, y))
  );
}

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

const engine = fs.readFileSync(new URL("../lib/image/engine.ts", import.meta.url), "utf8");

// Dense circle / sphere silhouette.
const sphere = mask(64, 64, (x, y) => {
  const dx = x - 31.5;
  const dy = y - 31.5;
  return dx * dx + dy * dy <= 28 * 28;
});
const sphereGuess = guessRevolve(sphere);
assert("sphere gets rotational inference", sphereGuess?.kind === "sphere");
assert("sphere confidence is high", (sphereGuess?.confidence ?? 0) >= 0.82);

// A dense but slightly capped vertical body should be recognized as a cylinder.
// A perfect rectangle is intentionally rejected by guessRevolve as too filled.
const cylinder = mask(32, 100, (x, y) => {
  const center = 15.5;
  const cap = Math.min(5, Math.min(y, 99 - y));
  const halfWidth = y < 5 || y >= 95 ? 5 + cap * 0.7 : 10;
  return Math.abs(x - center) <= halfWidth;
});
const cylinderGuess = guessRevolve(cylinder);
assert("cylinder gets rotational inference", cylinderGuess?.kind === "cylinder");
assert("cylinder confidence is high", (cylinderGuess?.confidence ?? 0) >= 0.82);

// Long horizontal weapon-like silhouette: x-axis capsule is below the P5.3
// acceptance threshold, so weapon-like objects do not get revolve inference.
const rifle = mask(160, 44, (x, y) => {
  const body = x >= 18 && x <= 132 && y >= 14 && y <= 29;
  const stock = x < 48 && y >= 8 && y <= 35;
  const barrel = x >= 132 && x <= 157 && y >= 18 && y <= 24;
  return body || stock || barrel;
});
const rifleGuess = guessRevolve(rifle);
assert("rifle-like silhouette does not meet revolve gate", (rifleGuess?.confidence ?? 0) < 0.82);

// Static contract: P5.3 must remain generic-OBJECT-only and high-confidence.
assert("single-view revolve gate remains objects-only", engine.includes('options.aiCategory === "objects" ? guessRevolve(sourceMask) : null'));
assert("single-view revolve gate keeps 0.82 confidence threshold", engine.includes('revolve.confidence < 0.82'));
assert("P5.1 adaptive depth is used by visual hull", engine.includes('const depthSample = adaptiveDepthAt('));
assert("P5.2 local thickness uses row-run ratios", engine.includes('const localRunRatio = rowRunRatios[y]?.[x] ?? 0;'));
assert("P5 local reconstruction has safe fallback", engine.includes('return buildNonModel('));

if (failed) {
  console.error(`\n${failed} reconstruction assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P5 reconstruction regression checks passed.");
