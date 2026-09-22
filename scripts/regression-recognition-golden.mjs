/**
 * P29 — versioned recognition golden benchmark.
 * Run: node --experimental-strip-types scripts/regression-recognition-golden.mjs
 *
 * The manifest is deliberately data-driven so real image-derived fixtures can
 * replace/add cases without changing the test runner. This first tier is the
 * deterministic golden baseline; the real-image tier remains an additive
 * fixture directory and is intentionally not fabricated here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recognizeFromMask, resolveRecognizedCategory } from "../lib/ai/recognize.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(here, "recognition-golden.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function mask(w, h, predicate) {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => Boolean(predicate(x, y)))
  );
}

function buildMask(testCase) {
  const { width, height, shape, params = {} } = testCase;
  switch (shape) {
    case "taperedBlade":
      return mask(width, height, (x, y) => {
        const progress = y / Math.max(1, height - 1);
        const half = Math.max(
          params.endHalf,
          Math.round(params.startHalf - (params.startHalf - params.endHalf) * progress)
        );
        const blade = Math.abs(x - params.center) <= half;
        const guard =
          y >= params.guardY0 &&
          y <= params.guardY1 &&
          Math.abs(x - params.center) <= params.guardHalf;
        return blade || guard;
      });
    case "rifle":
      return mask(width, height, (x, y) => {
        const body = x >= params.bodyX0 && x <= params.bodyX1 && y >= params.bodyY0 && y <= params.bodyY1;
        const stock = x < params.stockX && y >= params.stockY0 && y <= params.stockY1;
        const barrel = x >= params.barrelX0 && x <= params.barrelX1 && y >= Math.max(params.bodyY0 + 1, 20) && y <= Math.max(params.bodyY0 + 2, 22);
        const grip = x >= params.gripX0 && x <= params.gripX1 && y >= params.gripY0 && y <= params.gripY1;
        return body || stock || barrel || grip;
      });
    case "handgun":
      return mask(width, height, (x, y) => {
        const slide = x >= params.slideX0 && x <= params.slideX1 && y >= params.slideY0 && y <= params.slideY1;
        const barrel = x >= params.barrelX0 && x <= params.barrelX1 && y >= params.slideY0 + 3 && y <= params.slideY0 + 5;
        const grip = x >= params.gripX0 && x <= params.gripX1 && y >= params.gripY0 && y <= params.gripY1;
        const trigger = x >= params.triggerX0 && x <= params.triggerX1 && y >= params.triggerY0 && y <= params.triggerY1;
        return slide || barrel || grip || trigger;
      });
    case "verticalRod":
      return mask(width, height, (x) => Math.abs(x - params.center) <= params.half);
    case "horizontalRod":
      return mask(width, height, (_, y) => Math.abs(y - params.center) <= params.half);
    case "compactTool":
      return mask(width, height, (x, y) => {
        const body = x >= params.bodyX0 && x <= params.bodyX1 && y >= params.bodyY0 && y <= params.bodyY1;
        const head = x >= params.headX0 && x <= params.headX1 && y >= params.headY0 && y <= params.headY1;
        return body || head;
      });
    case "ellipse":
      return mask(width, height, (x, y) =>
        ((x - params.cx) ** 2) / (params.rx ** 2) + ((y - params.cy) ** 2) / (params.ry ** 2) <= 1
      );
    case "rect":
      return mask(width, height, (x, y) =>
        x >= params.x0 && x <= params.x1 && y >= params.y0 && y <= params.y1
      );
    default:
      throw new Error(`Unknown golden shape: ${shape}`);
  }
}

let failed = 0;
const totals = { sword: 0, gun: 0, rifle: 0, object: 0 };
const failures = [];

function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
    failures.push(name);
  }
}

console.log(`P29 golden dataset ${manifest.version}: ${manifest.cases.length} deterministic cases`);

for (const testCase of manifest.cases) {
  const guess = recognizeFromMask(buildMask(testCase));
  const resolved = resolveRecognizedCategory(guess).category;
  const expected = testCase.expected;
  const bucket = expected === "swords" ? "sword" : expected === "guns" ? "gun" : expected === "rifles" ? "rifle" : "object";
  totals[bucket] += 1;

  assert(`${testCase.id}: resolved category ${expected}`, resolved === expected);
  assert(`${testCase.id}: raw category is bounded`, ["objects", "swords", "guns", "rifles"].includes(guess.category));
  assert(`${testCase.id}: confidence bounded`, guess.confidence >= 0.18 && guess.confidence <= 0.98);

  if (typeof testCase.minConfidence === "number") {
    assert(`${testCase.id}: minimum confidence`, guess.confidence >= testCase.minConfidence);
  }
  if (typeof testCase.maxConfidence === "number") {
    assert(`${testCase.id}: negative confidence ceiling`, guess.confidence <= testCase.maxConfidence);
  }

  console.log(
    `${testCase.id}: expected=${expected} raw=${guess.category} resolved=${resolved} confidence=${guess.confidence.toFixed(3)}`
  );
}

assert("P29 category balance: swords present", totals.sword >= 2);
assert("P29 category balance: rifles present", totals.rifle >= 2);
assert("P29 category balance: guns present", totals.gun >= 2);
assert("P29 category balance: objects/negatives present", totals.object >= 4);

const realFixtureDir = path.join(here, "fixtures", "recognition-real");
if (fs.existsSync(realFixtureDir)) {
  const realFiles = fs
    .readdirSync(realFixtureDir)
    .filter((name) => /\.(json)$/i.test(name))
    .sort();
  console.log(`P29 real-image fixture manifests discovered: ${realFiles.length}`);
  if (!realFiles.length) {
    console.log("P29 note: real fixture directory exists but contains no JSON manifests yet.");
  }
} else {
  console.log("P29 note: real-image fixture tier not present; no real images were fabricated or inferred.");
}

if (failed) {
  console.error(`\n${failed} P29 assertion(s) failed.`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("\nP29 recognition golden baseline passed.");
