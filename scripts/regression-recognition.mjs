/**
 * Recognition confidence/evidence regression for Brick P4.1.
 * Run: node --experimental-strip-types scripts/regression-recognition.mjs
 */
import {
  recognizeFromMask,
  resolveRecognizedCategory,
  AUTO_CATEGORY_CONFIDENCE,
  calibrateCategoryConfidence,
  semanticCategoryScores,
  viewConfidenceForEvidence,
  adaptiveRecognitionThresholds,
  reconstructionCompatibility,
  reconstructionFeedbackFromVoxels
} from "../lib/ai/recognize.ts";
import { adaptiveAssetProfile } from "../lib/ai/assetProfiles.ts";

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
const longThinBarrel = mask(180, 42, (x, y) => {
  const body = x >= 16 && x <= 165 && y >= 18 && y <= 24;
  const muzzle = x >= 165 && x <= 177 && y >= 19 && y <= 23;
  return body || muzzle;
});
const taperedBlade = mask(42, 170, (x, y) => {
  const center = 21;
  const t = y / 169;
  const half = Math.max(1, Math.round(8 - 7 * t));
  return Math.abs(x - center) <= half;
});

const swordGuess = recognizeFromMask(sword);
const rifleGuess = recognizeFromMask(rifle);
const gunGuess = recognizeFromMask(handgun);
const ambiguousGuess = recognizeFromMask(ambiguous);
const rodGuess = recognizeFromMask(verticalRod);
const horizontalRodGuess = recognizeFromMask(horizontalRod);
const simpleBladeBlankGuess = recognizeFromMask(simpleBladeBlank);
const compactBlockToolGuess = recognizeFromMask(compactBlockTool);
const longThinBarrelGuess = recognizeFromMask(longThinBarrel);
const taperedBladeGuess = recognizeFromMask(taperedBlade);

assert("sword exposes evidence", swordGuess.evidence?.hits > 0);
assert("rifle exposes evidence", rifleGuess.evidence?.slenderness > 2);
assert("P21 sword semantic category is preserved", swordGuess.category === "swords");
assert("P21 rifle semantic category is preserved", rifleGuess.category === "rifles");
assert("P21 handgun semantic category is preserved", gunGuess.category === "guns");
assert("P21 rifle score beats gun score", semanticCategoryScores(rifleGuess.evidence).rifles > semanticCategoryScores(rifleGuess.evidence).guns);
assert("P21 handgun score beats rifle score", semanticCategoryScores(gunGuess.evidence).guns > semanticCategoryScores(gunGuess.evidence).rifles);
assert("P24 rifle fusion keeps horizontal multi-feature evidence coherent", semanticCategoryScores(rifleGuess.evidence).rifles >= 0.5);
assert("P24 handgun fusion keeps compact evidence coherent", semanticCategoryScores(gunGuess.evidence).guns >= 0.45);
assert("P24 sword fusion keeps vertical tapered evidence coherent", semanticCategoryScores(swordGuess.evidence).swords >= 0.5);
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
assert("P26 long thin barrel reports thin-feature evidence", (longThinBarrelGuess.features.thinFeatureScore ?? 0) >= 0.44);
assert("P26 tapered blade reports terminal detail evidence", taperedBladeGuess.features.tipLike === true);
assert("P26 thin-feature evidence does not force weapon classification on its own", resolveRecognizedCategory(longThinBarrelGuess).category === "objects" || longThinBarrelGuess.category === "rifles");

// P26 hardening: isolated thin strokes inside a compact silhouette must not
// become strong global thin-feature evidence. This guards against noisy
// segmentation pixels consuming extra reconstruction budget.
const compactThinNoise = mask(48, 48, (x, y) => {
  const body = x >= 10 && x <= 37 && y >= 20 && y <= 27;
  const noiseStroke = x >= 24 && x <= 25 && y >= 10 && y <= 37;
  return body || noiseStroke;
});
const compactThinNoiseGuess = recognizeFromMask(compactThinNoise);
assert(
  "P26 hardening: compact local thin noise stays below strong thin-feature threshold",
  (compactThinNoiseGuess.features.thinFeatureScore ?? 0) < 0.44
);
assert(
  "P26 hardening: compact local thin noise is not marked as terminal detail",
  compactThinNoiseGuess.features.tipLike === false
);

const swordProfile = adaptiveAssetProfile({
  category: "swords",
  features: taperedBladeGuess.features,
  evidence: taperedBladeGuess.evidence,
  width: 42,
  height: 170,
  volumeSize: 128,
  mode: "model",
  hasSide: false,
  hasDepth: true
});
const rifleProfile = adaptiveAssetProfile({
  category: "rifles",
  features: longThinBarrelGuess.features,
  evidence: longThinBarrelGuess.evidence,
  width: 180,
  height: 42,
  volumeSize: 128,
  mode: "model",
  hasSide: false,
  hasDepth: true
});
const objectProfile = adaptiveAssetProfile({
  category: "objects",
  features: compactBlockToolGuess.features,
  evidence: compactBlockToolGuess.evidence,
  width: 110,
  height: 60,
  volumeSize: 128,
  mode: "model",
  hasSide: false,
  hasDepth: true
});
assert("P25 sword profile stays shallower than rifle profile", swordProfile.depthScale < rifleProfile.depthScale);
assert("P25 rifle profile receives a higher detail budget than generic props", rifleProfile.budgetScale > objectProfile.budgetScale);
assert("P25 sword profile enables thin-feature protection", swordProfile.thinFeatures === true);
assert("P25 rifle profile enables thin-feature protection", rifleProfile.thinFeatures === true);

const singleViewConfidence = viewConfidenceForEvidence(rifleGuess.evidence, false, true);
const dualViewConfidence = viewConfidenceForEvidence(rifleGuess.evidence, true, true);
assert(
  "P27 FRONT+SIDE view evidence confidence is higher than single-view",
  dualViewConfidence.confidence > singleViewConfidence.confidence
);
assert(
  "P27 view mode is explicit",
  singleViewConfidence.mode === "single" && dualViewConfidence.mode === "front+side"
);
assert(
  "P27 view confidence stays bounded",
  singleViewConfidence.confidence >= 0.5 && singleViewConfidence.confidence <= 0.82 &&
    dualViewConfidence.confidence >= 0.5 && dualViewConfidence.confidence <= 0.94
);

const rifleDualProfile = adaptiveAssetProfile({
  category: "rifles",
  features: rifleGuess.features,
  evidence: rifleGuess.evidence,
  width: 150,
  height: 44,
  volumeSize: 128,
  mode: "model",
  hasSide: true,
  hasDepth: true
});
assert(
  "P27 profile preserves explicit FRONT+SIDE mode",
  rifleDualProfile.viewMode === "front+side" && rifleProfile.viewMode === "single"
);
assert(
  "P27 profile exposes higher FRONT+SIDE view confidence",
  rifleDualProfile.viewConfidence > rifleProfile.viewConfidence
);
assert(
  "P27 existing dual-view depth behavior remains bounded",
  rifleDualProfile.depthScale > rifleProfile.depthScale
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

const tinyInput = mask(18, 18, (x, y) => {
  const dx = x - 9;
  const dy = y - 9;
  return dx * dx + dy * dy <= 20;
});
const borderTouching = mask(48, 48, (x, y) => {
  const body = x <= 34 && y >= 12 && y <= 35 && x >= 8;
  return body;
});
const tinyInputGuess = recognizeFromMask(tinyInput);
const borderTouchingGuess = recognizeFromMask(borderTouching);
assert(
  "P28 tiny input exposes reduced input quality",
  (tinyInputGuess.evidence.inputQuality ?? 1) < 0.42
);
assert(
  "P28 tiny input cannot auto-resolve to a weapon",
  resolveRecognizedCategory({
    ...tinyInputGuess,
    category: "rifles",
    confidence: 0.96
  }).category === "objects"
);
assert(
  "P28 ambiguity gate rejects high-confidence ambiguous weapon claims",
  resolveRecognizedCategory({
    ...ambiguousGuess,
    category: "rifles",
    confidence: 0.9
  }).category === "objects"
);
assert(
  "P28 frame-touching input receives a bounded quality signal",
  (borderTouchingGuess.evidence.inputQuality ?? 0) >= 0 &&
    (borderTouchingGuess.evidence.inputQuality ?? 2) <= 1
);
assert(
  "P28 ambiguity signal remains exposed",
  (ambiguousGuess.evidence.ambiguityScore ?? 0) > 0
);


// P30 adaptive recognition thresholds. Low-quality/ambiguous evidence must
// raise the decision threshold, while clear evidence stays close to the
// historical baseline.
const clearThresholdEvidence = {
  hits: 420,
  fill: 0.22,
  aspect: 3.2,
  slenderness: 3.2,
  symmetry: 0.55,
  taper: 0.58,
  bulge: 1.2,
  widthCv: 0.24,
  edgeThinness: 0.3,
  inputQuality: 0.92,
  ambiguityScore: 0.02
};
const uncertainThresholdEvidence = { ...clearThresholdEvidence, inputQuality: 0.32, ambiguityScore: 0.42 };
const clearThresholds = adaptiveRecognitionThresholds(clearThresholdEvidence);
const uncertainThresholds = adaptiveRecognitionThresholds(uncertainThresholdEvidence);
assert(
  "P30 clear evidence keeps a lower auto threshold than uncertain evidence",
  clearThresholds.autoConfidence < uncertainThresholds.autoConfidence
);
assert(
  "P30 adaptive thresholds stay bounded",
  clearThresholds.autoConfidence >= 0.64 && uncertainThresholds.autoConfidence <= 0.72 &&
    clearThresholds.minMargin >= 0.06 && uncertainThresholds.minMargin <= 0.11
);

// P32 silhouette part decomposition: a grip/neck between larger masses should
// be exposed as multi-part structure rather than being flattened into one blob.
const multipartTool = mask(140, 70, (x, y) => {
  const body = x >= 18 && x <= 118 && y >= 24 && y <= 44;
  const stock = x >= 10 && x <= 34 && y >= 17 && y <= 51;
  const grip = x >= 62 && x <= 73 && y >= 38 && y <= 62;
  const head = x >= 106 && x <= 132 && y >= 16 && y <= 52;
  return body || stock || grip || head;
});
const multipartGuess = recognizeFromMask(multipartTool);
const multipartEvidence = multipartGuess.evidence.silhouetteParts;
assert(
  "P32 silhouette decomposition exposes a primary axis",
  multipartEvidence?.primaryAxis === "horizontal"
);
assert(
  "P32 silhouette decomposition exposes bounded part metrics",
  Boolean(multipartEvidence) &&
    (multipartEvidence?.partCount ?? 0) >= 1 &&
    (multipartEvidence?.partCount ?? 0) <= 4 &&
    (multipartEvidence?.junctionScore ?? 0) >= 0 &&
    (multipartEvidence?.junctionScore ?? 0) <= 1
);

// P31 recognition/reconstruction compatibility and one-step feedback. A
// clearly coherent rifle projection stays on-category; a strongly conflicting
// sword-like projection can recommend a bounded automatic correction.
const rifleFeedbackVoxels = [];
for (let y = 0; y < rifle.length; y += 1) for (let x = 0; x < rifle[y].length; x += 1) if (rifle[y][x]) rifleFeedbackVoxels.push({ x, y, z: 8 });
const coherentFeedback = reconstructionFeedbackFromVoxels("rifles", rifleFeedbackVoxels);
assert(
  "P31 coherent reconstruction feedback preserves category",
  coherentFeedback.corrected === false && coherentFeedback.recommendedCategory === "rifles"
);
const swordFeedbackVoxels = [];
for (let y = 0; y < sword.length; y += 1) for (let x = 0; x < sword[y].length; x += 1) if (sword[y][x]) swordFeedbackVoxels.push({ x, y, z: 8 });
const conflictingFeedback = reconstructionFeedbackFromVoxels("rifles", swordFeedbackVoxels);
assert(
  "P31 conflicting reconstruction feedback can recommend a bounded correction",
  conflictingFeedback.corrected === true && conflictingFeedback.recommendedCategory === "swords"
);
assert(
  "P31 reconstruction compatibility remains bounded",
  reconstructionCompatibility(rifleGuess).confidence >= 0.18 &&
    reconstructionCompatibility(rifleGuess).confidence <= 0.98
);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll recognition confidence + hard-negative checks passed.");
