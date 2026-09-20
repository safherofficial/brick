/**
 * P15 + P16 AI precision regression.
 * Locks category-aware segmentation/depth refinement and conservative
 * FRONT/SIDE confidence fusion.
 */
import { refineSegmentAlpha, normalizeDepthToForeground } from "../lib/ai/enhance.ts";
import { bestSideYShiftBins, fuseSideMaskConfidence } from "../lib/ai/viewAlign.ts";

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

const makeMask = (w, h) => Array.from({ length: h }, () => Array<boolean>(w).fill(false));
const front = makeMask(20, 20);
const side = makeMask(20, 20);
for (let y = 4; y < 16; y += 1) {
  for (let x = 5; x < 15; x += 1) {
    front[y][x] = true;
    side[y][x] = true;
  }
}

// Single-pixel capture/alignment hole: P16 should recover it.
side[9][9] = false;
const recovered = fuseSideMaskConfidence(
  front,
  { minX: 5, minY: 4, maxX: 14, maxY: 15, width: 10, height: 12 },
  side,
  { minX: 5, minY: 4, maxX: 14, maxY: 15, width: 10, height: 12 },
  0,
  64
);
assert("P16 recovers a high-confidence single-pixel SIDE hole", side[9][9] === true && recovered.recovered >= 1);

// A broad missing region must remain missing: do not inflate the silhouette.
side[9][9] = false;
side[9][10] = false;
side[9][11] = false;
side[9][12] = false;
side[9][13] = false;
const broad = fuseSideMaskConfidence(
  front,
  { minX: 5, minY: 4, maxX: 14, maxY: 15, width: 10, height: 12 },
  side,
  { minX: 5, minY: 4, maxX: 14, maxY: 15, width: 10, height: 12 },
  0,
  64
);
assert("P16 does not bridge a broad missing SIDE region", side[9][10] === false && side[9][11] === false && broad.recovered < 4);


// FRONT remains the hard occupancy anchor: no SIDE recovery when the aligned
// FRONT row has no subject support.
const frontGap = makeMask(20, 20);
const sideGap = makeMask(20, 20);
for (let y = 4; y < 16; y += 1) {
  for (let x = 5; x < 15; x += 1) sideGap[y][x] = true;
}
sideGap[9][9] = false;
const gated = fuseSideMaskConfidence(
  frontGap,
  { minX: 5, minY: 4, maxX: 14, maxY: 15, width: 10, height: 12 },
  sideGap,
  { minX: 5, minY: 4, maxX: 14, maxY: 15, width: 10, height: 12 },
  0,
  64
);
assert("P16 keeps FRONT as the hard occupancy gate", sideGap[9][9] === false && gated.recovered === 0);

// The alignment helper must still return a stable shift and run the fusion pass.
const alignedFront = makeMask(20, 20);
const alignedSide = makeMask(20, 20);
for (let y = 6; y < 14; y += 1) {
  for (let x = 6; x < 14; x += 1) {
    alignedFront[y][x] = true;
    alignedSide[y][x] = true;
  }
}
alignedSide[8][9] = false;
const align = bestSideYShiftBins(
  alignedFront,
  { minX: 6, minY: 6, maxX: 13, maxY: 13, width: 8, height: 8 },
  alignedSide,
  { minX: 6, minY: 6, maxX: 13, maxY: 13, width: 8, height: 8 },
  64
);
assert("P16 keeps FRONT/SIDE alignment deterministic", Number.isInteger(align.shiftBins) && align.shiftBins >= -5 && align.shiftBins <= 5);
assert("P16 fusion is active inside the established alignment path", alignedSide[8][9] === true);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P15/P16 AI precision regressions passed.");
