/**
 * Recognition confidence/evidence regression for Brick P4.1.
 * Run: node --experimental-strip-types scripts/regression-recognition.mjs
 */
import {
  recognizeFromMask,
  resolveRecognizedCategory,
  AUTO_CATEGORY_CONFIDENCE,
  calibrateCategoryConfidence,
  semanticCategoryScores
} from "../lib/ai/recognize.ts";

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
const sword = mask(40, 160, (x, y) => {
  const center = 20;
  const half = y < 120 ? 6 : 1;
  return Math.abs(x - center) <= half;
});
const rifle = mask(150, 44, (x, y) => {
  const body = y >= 18 && y <= 25 && x >= 20 && x <= 136;
  const stock = x < 42 && y >= 12 && y <= 32;
  const barrel = x >= 136 && y >= 20 && y <= 22;
  const grip = x >= 78 && x <= 89 && y >= 25 && y <= 34;
  return body || stock || barrel || grip;
});
const ambiguous = mask(76, 70, (x, y) =>
  ((x - 38) ** 2) / (30 ** 2) + ((y - 35) ** 2) / (26 ** 2) <= 1
);
const handgun = mask(110, 80, (x, y) => {
  const slide = x >= 18 && x <= 96 && y >= 28 && y <= 37;
  const barrel = x >= 96 && x <= 108 && y >= 31 && y <= 33;
  const grip = x >= 60 && x <= 79 && y >= 35 && y <= 66;
  const trigger = x >= 54 && x <= 63 && y >= 37 && y <= 48;
  return slide || barrel || grip || trigger;
});

// P23 hard negatives: deliberately weapon-like silhouettes with too little
// semantic structure to claim a weapon category.
const verticalRod = mask(40, 160, (x, y) => Math.abs(x - 20) <= 4);
const horizontalRod = mask(150, 44, (x, y) => Math.abs(y - 22) <= 4);
const simpleBladeBlank = mask(54, 150, (x, y) => {
  const center = 27;
  const half = y < 125 ? 5 : 4;
  return Math.abs(x - center) <= half;
});
const compactBlockTool = mask(110, 60, (x, y) => {
  const body = x >= 24 && x <= 90 && y >= 21 && y <= 39;
  const head = x >= 14 && x <= 34 && y >= 12 && y <= 48;
  return body || head;
});

const swordGuess = recognizeFromMask(sword);
const rifleGuess = recognizeFromMask(rifle);
const gunGuess = recognizeFromMask(handgun);
const ambiguousGuess = recognizeFromMask(ambiguous);
const rodGuess = recognizeFromMask(verticalRod);
const horizontalRodGuess = recognizeFromMask(horizontalRod);
const simpleBladeBlankGuess = recognizeFromMask(simpleBladeBlank);
const compactBlockToolGuess = recognizeFromMask(compactBlockTool);

assert("sword exposes evidence", swordGuess.evidence?.hits > 0);
assert("rifle exposes evidence", rifleGuess.evidence?.slenderness > 2);
assert("P21 sword semantic category is preserved", swordGuess.category === "swords");
assert("P21 rifle semantic category is preserved", rifleGuess.category === "rifles");
assert("P21 handgun semantic category is preserved", gunGuess.category === "guns");
assert("P21 rifle score beats gun score", semanticCategoryScores(rifleGuess.evidence).rifles > semanticCategoryScores(rifleGuess.evidence).guns);
assert("P21 handgun score beats rifle score", semanticCategoryScores(gunGuess.evidence).guns > semanticCategoryScores(gunGuess.evidence).rifles);
assert(
  "confidence remains bounded",
  [
    swordGuess,
    rifleGuess,
    gunGuess,
    ambiguousGuess,
    rodGuess,
    horizontalRodGuess,
    simpleBladeBlankGuess,
    compactBlockToolGuess
  ].every((g) => g.confidence >= 0.18 && g.confidence <= 0.98)
);
assert("thin asset gets thinness evidence", swordGuess.evidence.edgeThinness > 0);
assert("ambiguous object stays in safe category", ambiguousGuess.category === "objects");
assert("low-information mask does not claim high confidence", recognizeFromMask([[true]]).confidence <= 0.2);
assert(
  "low-confidence automatic recognition falls back to objects",
  resolveRecognizedCategory({ ...ambiguousGuess, confidence: AUTO_CATEGORY_CONFIDENCE - 0.01 }).category === "objects"
);
assert("manual category always wins", resolveRecognizedCategory({ ...swordGuess, category: "swords" }, "guns").category === "guns");
assert("manual mismatch is reported", resolveRecognizedCategory(swordGuess, "guns").manualOverride === true);
assert("confident automatic category is preserved", resolveRecognizedCategory(rifleGuess).category === rifleGuess.category);
assert("rifle exposes thin/long feature hints", rifleGuess.features.thin === true && rifleGuess.features.long === true);
assert("sword feature hints detect taper or thinness", swordGuess.features.thin === true || swordGuess.features.tapered === true);
assert("inconsistent automatic sword falls back safely", resolveRecognizedCategory({ ...ambiguousGuess, category: "swords", confidence: 0.92 }).category === "objects");
assert("inconsistent automatic rifle falls back safely", resolveRecognizedCategory({ ...ambiguousGuess, category: "rifles", confidence: 0.92 }).category === "objects");

assert("P23 hard negative: vertical rod is not a sword", rodGuess.category === "objects");
assert("P23 hard negative: horizontal rod is not a rifle", horizontalRodGuess.category === "objects");
assert("P23 hard negative: uniform blade blank is not a sword", simpleBladeBlankGuess.category === "objects");
assert("P23 hard negative: compact block tool is not a gun/rifle", compactBlockToolGuess.category === "objects");
assert(
  "P23 hard negatives remain safe after semantic gating",
  [rodGuess, horizontalRodGuess, simpleBladeBlankGuess, compactBlockToolGuess].every((guess) => {
    return resolveRecognizedCategory(guess).category === "objects";
  })
);
assert(
  "P23 hard negative with weapon-like score is still rejected",
  Math.max(
    ...Object.values(semanticCategoryScores(compactBlockToolGuess.evidence)).filter((_, index) => index < 3)
  ) > semanticCategoryScores(compactBlockToolGuess.evidence).objects &&
    compactBlockToolGuess.category === "objects"
);

const calibrationEvidence = {
  hits: 2600,
  fill: 0.24,
  aspect: 0.22,
  slenderness: 4.4,
  symmetry: 0.72,
  taper: 0.58,
  bulge: 2.8,
  widthCv: 0.52,
  edgeThinness: 0.48
};
const clearConfidence = calibrateCategoryConfidence(0.82, 0.9, 0.3, calibrationEvidence);
const nearTieConfidence = calibrateCategoryConfidence(0.82, 0.62, 0.6, calibrationEvidence);
assert("P22 confidence calibration rewards clear semantic margin", clearConfidence > nearTieConfidence);
assert("P22 confidence calibration stays bounded", clearConfidence >= 0.18 && clearConfidence <= 0.98 && nearTieConfidence >= 0.18 && nearTieConfidence <= 0.98);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll recognition confidence + hard-negative checks passed.");
