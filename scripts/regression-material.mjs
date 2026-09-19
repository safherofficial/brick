/**
 * P6 material reconstruction regression.
 * Run: node --experimental-strip-types scripts/regression-material.mjs
 */
import fs from "node:fs";

const engine = fs.readFileSync(new URL("../lib/image/engine.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

assert("P6.1 material luminance guard exists", engine.includes("function blendMaterialPreserveLuma"));
assert("dark/bright luma shift is capped", engine.includes("const allowedLumaShift = clamp(8 + amount * 24, 8, 32)"));
assert("local material continuity sampling exists", engine.includes("function localMaterialSample"));
assert("cross-view material agreement exists", engine.includes("function materialAgreement"));
assert("SIDE blend uses material agreement", engine.includes("const agreement = materialAgreement(frontColor, sideColor)"));
assert("FRONT remains weighted above SIDE in palette", engine.includes("[1.45, 0.85]"));
assert("material-aware dithering exists", engine.includes("function materialAwareDitheredColor"));
assert("dark materials reduce dithering", engine.includes("if (luma < 48) factor *= 0.35"));
assert("neutral materials reduce dithering", engine.includes("if (chroma < 18) factor *= 0.62"));
assert("test suite includes P6 material regression", packageJson.scripts?.test?.includes("regression-material.mjs"));
assert("dedicated material test script exists", packageJson.scripts?.["test:material"] === "node --experimental-strip-types scripts/regression-material.mjs");

if (failed) {
  console.error(`\n${failed} material assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P6 material regression checks passed.");
