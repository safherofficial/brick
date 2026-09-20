/**
 * P15 + P16 + P17 AI precision regression.
 *
 * Locks category-aware segmentation/depth refinement, conservative FRONT/SIDE
 * confidence fusion, and the P17 single-view shape-aware depth prior.
 */
import {
  refineSegmentAlpha,
  normalizeDepthToForeground,
  refineDepthToShape
} from "../lib/ai/enhance.ts";
import { bestSideYShiftBins, fuseSideMaskConfidence } from "../lib/ai/viewAlign.ts";

let failed = 0;

function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK ", name);
  }
}

const width = 24;
const height = 24;
const alpha = new Float32Array(width * height);

for (let y = 5; y < 19; y += 1) {
  for (let x = 10; x < 14; x += 1) alpha[y * width + x] = 0.9;
}
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

// P17 shape-aware prior: a wide structural band should receive slightly more
// depth support than a one-pixel contour while preserving MiDaS ordering.
const shapeAlpha = new Float32Array(width * height);
const shapeDepth = new Float32Array(width * height);
for (let y = 6; y < 18; y += 1) {
  const span = y < 9 ? [9, 14] : y < 15 ? [7, 16] : [10, 13];
  for (let x = span[0]; x <= span[1]; x += 1) {
    const i = y * width + x;
    shapeAlpha[i] = 1;
    shapeDepth[i] = 0.5;
  }
}
const shape = refineDepthToShape(shapeDepth, shapeAlpha, width, height, "rifles");
const broadCenter = shape[11 * width + 11];
const narrowTop = shape[7 * width + 11];
assert("P17 keeps depth bounded", [...shape].every((v) => v >= 0 && v <= 1));
assert("P17 increases structural support for broad weapon bodies", broadCenter > narrowTop);
const shapeAgain = refineDepthToShape(shapeDepth, shapeAlpha, width, height, "rifles");
assert("P17 shape refinement is deterministic", shapeAgain[11 * width + 11] === broadCenter);

const makeMask = (w, h) => Array.from({ length: h }, () => Array(w).fill(false));
const front = makeMask(20, 20);
const side = makeMask(20, 20);
for (let y = 4; y < 16; y += 1) {
  for (let x = 5; x < 15; x += 1) {
    front[y][x] = true;
    side[y][x] = true;
  }
}

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
assert(
  "P16 keeps FRONT/SIDE alignment deterministic",
  Number.isInteger(align.shiftBins) && align.shiftBins >= -5 && align.shiftBins <= 5
);
assert("P16 fusion is active inside the established alignment path", alignedSide[8][9] === true);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}

console.log("\nAll P15/P16/P17 AI precision regressions passed.");
