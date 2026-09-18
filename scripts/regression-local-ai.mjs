/**
 * Static regression checks for the production local-AI contract.
 * Run: node scripts/regression-local-ai.mjs
 */
import { readFile } from "node:fs/promises";

const runtime = await readFile(new URL("../lib/ai/runtime.ts", import.meta.url), "utf8");
const fetcher = await readFile(new URL("./fetch-onnx.mjs", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

assert("segment local candidates exist", runtime.includes('segment: ["/models/u2netp.onnx", "/models/rmbg.onnx"]'));
assert("depth local candidates exist", runtime.includes('depth: ["/models/midas-small.onnx", "/models/depth-small.onnx"]'));
assert("production returns local candidates only", runtime.includes('if (process.env.NODE_ENV === "production") return local;'));
assert("runtime retries later candidates after session failure", runtime.includes("Keep trying the next local/remote candidate"));
assert("runtime prefers local ORT wasm", runtime.includes('const ORT_WASM_LOCAL = "/ort/";'));
assert("fetch script copies ORT wasm locally", fetcher.includes('public", "ort"'));
assert("model preparation runs before build", pkg.scripts?.build === "npm run models && next build");

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll local-AI regression checks passed.");
