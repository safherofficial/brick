/**
 * P10 production-hardening functional checks.
 * Executes the actual timeout, input guard, raster sanitize, recovery and browser
 * capability helpers instead of checking source strings.
 * Run: node --experimental-strip-types --import ./scripts/_register-aliases.mjs scripts/regression-hardening.mjs
 */
import { withTimeout, TimeoutError, IMPORT_TIMEOUT_MS } from "@/lib/prod/timeout.ts";
import { assertImportableFile, MAX_IMPORT_BYTES } from "@/lib/prod/inputGuard.ts";
import { sanitizeRaster } from "@/lib/prod/rasterSanitize.ts";
import { recoverImport } from "@/lib/prod/recover.ts";
import { localAiSupported, probeBrowserCompat } from "@/lib/prod/compat.ts";

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

const resolved = await withTimeout(Promise.resolve("ok"), 50, "resolve-test");
assert("withTimeout resolves normal promises", resolved === "ok");

let timeoutCaught = false;
try {
  await withTimeout(new Promise(() => {}), 10, "timeout-test");
} catch (error) {
  timeoutCaught = error instanceof TimeoutError;
}
assert("withTimeout rejects with TimeoutError", timeoutCaught);
assert("production import timeout remains 45 seconds", IMPORT_TIMEOUT_MS === 45_000);

const valid = new File([new Uint8Array(64)], "asset.png", { type: "image/png" });
assert("valid image file passes input guard", assertImportableFile(valid) === undefined);
let badTypeRejected = false;
try {
  assertImportableFile(new File([new Uint8Array(64)], "asset.exe", { type: "application/octet-stream" }));
} catch {
  badTypeRejected = true;
}
assert("unsupported file type is rejected", badTypeRejected);

let bigFileRejected = false;
try {
  assertImportableFile({ size: MAX_IMPORT_BYTES + 1, type: "image/png", name: "large.png" });
} catch {
  bigFileRejected = true;
}
assert("oversized file is rejected", bigFileRejected);

const sanitized = sanitizeRaster({
  width: 2,
  height: 1,
  rgba: new Uint8ClampedArray([
    255, 255, 255, 20,
    20, 30, 40, 255
  ])
});
assert("near-invisible fringe is removed", sanitized.rgba[3] === 0);
assert("opaque source pixel remains untouched", sanitized.rgba[4] === 20 && sanitized.rgba[7] === 255);

let fallbackOptions;
let runCount = 0;
const recovered = await recoverImport(
  async (options) => {
    runCount += 1;
    if (runCount === 1) return { voxels: [], count: 0, palette: [] };
    fallbackOptions = options;
    return { voxels: [{ x: 0, y: 0, z: 0, c: 0 }], count: 1, palette: ["#ffffff"] };
  },
  { mode: "model", output: "25d", useLocalAi: true }
);
assert("recoverImport runs the real fallback path", runCount === 2);
assert("fallback disables local AI", fallbackOptions?.useLocalAi === false);
assert("fallback switches to 2d", fallbackOptions?.output === "2d");
assert("fallback uses flat mode", fallbackOptions?.mode === "flat");
assert("fallback result is returned", recovered.count === 1 && recovered.aiStatus === "recovered-2d");

const compat = probeBrowserCompat();
assert("browser capability probe reports WebAssembly in Node", compat.wasm === true);
assert("localAiSupported follows the wasm probe", localAiSupported(compat) === true);

if (failed) {
  console.error(`\n${failed} hardening functional assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll hardening functional regression checks passed.");
