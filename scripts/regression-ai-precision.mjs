/**
 * P15 AI precision regression.
 * Locks category-aware segmentation hysteresis and foreground depth normalization.
 */
import { refineSegmentAlpha, normalizeDepthToForeground } from "../lib/ai/enhance.ts";

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

const width = 24;
const height = 24;
const alpha = new Float32Array(width * height);
// Strong vertical foreground body.
for (let y = 5; y < 19; y += 1) {
  for (let x = 10; x < 14; x += 1) alpha[y * width + x] = 0.9;
}
// Thin attached details. These are deliberately below the strong threshold.
for (let y = 5; y < 19; y += 1) alpha[y * width + 9] = 0.18;
for (let y = 5; y < 19; y += 1) alpha[y * width + 14] = 0.18;

const sword = refineSegmentAlpha(alpha, width, height, "swords");
const object = refineSegmentAlpha(alpha, width, height, "objects");

const swordKept = [...sword].filter((v) => v > 0).length;
const objectKept = [...object].filter((v) => v > 0).length;
assert("thin-feature category keeps attached weak contour", swordKept > objectKept);
assert("strong foreground is preserved", sword[10 * width + 11] > 0.85);

const depth = new Float32Array(width * height);
const depthAlpha = new Float32Array(width * height);
for (let i = 0; i < depth.length; i += 1) {
  depth[i] = (i % width) / Math.max(1, width - 1);
  depthAlpha[i] = 0;
}
for (let y = 6; y < 18; y += 1) {
  for (let x = 8; x < 16; x += 1) {
    const i = y * width + x;
    depthAlpha[i] = 1;
    depth[i] = 0.35 + ((x - 8) / 7) * 0.25;
  }
}
const normalized = normalizeDepthToForeground(depth, depthAlpha, "rifles");
assert("foreground depth range remains ordered", normalized[10 * width + 15] > normalized[10 * width + 8]);
assert("background depth is not forcibly collapsed", normalized[2 * width + 2] >= 0 && normalized[2 * width + 2] <= 1);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P15 AI precision regressions passed.");
