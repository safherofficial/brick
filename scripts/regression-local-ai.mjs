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

assert("segment local candidates include precision tiers", runtime.includes("/models/birefnet-lite.onnx") && runtime.includes("/models/isnet-general-use-q8.onnx") && runtime.includes("/models/u2netp.onnx"));
assert("depth local candidates include Depth Anything V2", runtime.includes("/models/depth-anything-v2-small-q4f16.onnx") && runtime.includes("/models/midas-small.onnx"));
assert("runtime is local-only", !runtime.includes("REMOTE_MODELS") && !runtime.includes("cdn.jsdelivr.net"));
assert("runtime retries later local candidates after session failure", runtime.includes("Keep trying the next local model candidate"));
assert("runtime prefers local ORT wasm", runtime.includes('const ORT_WASM_LOCAL = "/ort/";'));
assert("fetch script copies ORT wasm locally", fetcher.includes('public", "ort"'));
assert("model preparation runs before build", pkg.scripts?.build === "npm run models && next build");

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll local-AI regression checks passed.");
