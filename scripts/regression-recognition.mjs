/**
 * Recognition confidence/evidence regression for Brick P4.1.
 * Run: node --experimental-strip-types scripts/regression-recognition.mjs
 */
import { recognizeFromMask, resolveRecognizedCategory, AUTO_CATEGORY_CONFIDENCE } from "../lib/ai/recognize.ts";

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
  const body = y >= 15 && y <= 28 && x >= 12 && x <= 138;
  const stock = x < 38 && y >= 8 && y <= 35;
  const barrel = x >= 135 && y >= 18 && y <= 24;
  return body || stock || barrel;
});
const ambiguous = mask(76, 70, (x, y) =>
  ((x - 38) ** 2) / (30 ** 2) + ((y - 35) ** 2) / (26 ** 2) <= 1
);

const swordGuess = recognizeFromMask(sword);
const rifleGuess = recognizeFromMask(rifle);
const ambiguousGuess = recognizeFromMask(ambiguous);

assert("sword exposes evidence", swordGuess.evidence?.hits > 0);
assert("rifle exposes evidence", rifleGuess.evidence?.slenderness > 2);
assert("confidence remains bounded", [swordGuess, rifleGuess, ambiguousGuess].every((g) => g.confidence >= 0.18 && g.confidence <= 0.98));
assert("thin asset gets thinness evidence", swordGuess.evidence.edgeThinness > 0);
assert("ambiguous object stays in safe category", ambiguousGuess.category === "objects");
assert("low-information mask does not claim high confidence", recognizeFromMask([[true]]).confidence <= 0.2);
assert("low-confidence automatic recognition falls back to objects", resolveRecognizedCategory({ ...ambiguousGuess, confidence: AUTO_CATEGORY_CONFIDENCE - 0.01 }).category === "objects");
assert("manual category always wins", resolveRecognizedCategory({ ...swordGuess, category: "swords" }, "guns").category === "guns");
assert("manual mismatch is reported", resolveRecognizedCategory(swordGuess, "guns").manualOverride === true);
assert("confident automatic category is preserved", resolveRecognizedCategory(rifleGuess).category === rifleGuess.category);
assert("rifle exposes thin/long feature hints", rifleGuess.features.thin === true && rifleGuess.features.long === true);
assert("sword feature hints detect taper or thinness", swordGuess.features.thin === true || swordGuess.features.tapered === true);
assert("inconsistent automatic sword falls back safely", resolveRecognizedCategory({ ...ambiguousGuess, category: "swords", confidence: 0.92 }).category === "objects");
assert("inconsistent automatic rifle falls back safely", resolveRecognizedCategory({ ...ambiguousGuess, category: "rifles", confidence: 0.92 }).category === "objects");

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll recognition confidence checks passed.");
