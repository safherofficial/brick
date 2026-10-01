/**
 * P16.6 reconstruction-confidence regression.
 */
import fs from "node:fs";
import { buildReconstructionConfidenceMap } from "../lib/ai/reconstructionConfidence.ts";
let failed = 0;
function assert(name, condition) { if (!condition) { console.error("FAIL", name); failed += 1; } else console.log("OK  ", name); }
const w = 32, h = 32;
const mask = Array.from({ length: h }, () => Array(w).fill(false));
for (let y = 5; y < 27; y += 1) { const half = y >= 11 && y < 21 ? 9 : 3; for (let x = 16 - half; x <= 16 + half; x += 1) mask[y][x] = true; }
const confidence = buildReconstructionConfidenceMap(mask, w, h);
const interior = confidence.values[16 * w + 16], contour = confidence.values[5 * w + 16];
assert("P16.6 interior confidence exceeds contour confidence", interior > contour);
assert("P16.6 confidence values stay bounded", confidence.values.every((v) => v >= 0 && v <= 1));
assert("P16.6 low-confidence ratio stays bounded", confidence.summary.lowConfidenceRatio >= 0 && confidence.summary.lowConfidenceRatio <= 1);
assert("P16.6 confidence map is deterministic", JSON.stringify(buildReconstructionConfidenceMap(mask, w, h)) === JSON.stringify(confidence));
const engine = fs.readFileSync(new URL("../lib/image/engine.ts", import.meta.url), "utf8");
assert("P16.6 reads low-confidence ratio", engine.includes("confidence.summary.lowConfidenceRatio"));
assert("P16.6 uses graduated repair threshold", engine.includes("lowConfidenceRatio >= 0.35 ? 5 : lowConfidenceRatio >= 0.18 ? 4 : 3"));
assert("P16.6 requires measured repair improvement", engine.includes("repairedQuality.score >= initialQuality.score + repairDelta"));
assert("P16.6 keeps quality-control entry point intact", engine.includes("async function attachQualityControl("));
if (failed) process.exit(1);
console.log("\nAll P16.6 reconstruction-confidence regressions passed.");
