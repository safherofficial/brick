/**
 * P10 production-hardening contract checks.
 */
import { readFile } from "node:fs/promises";

const files = {
  timeout: await readFile(new URL("../lib/prod/timeout.ts", import.meta.url), "utf8"),
  guard: await readFile(new URL("../lib/prod/inputGuard.ts", import.meta.url), "utf8"),
  sanitize: await readFile(new URL("../lib/prod/rasterSanitize.ts", import.meta.url), "utf8"),
  recover: await readFile(new URL("../lib/prod/recover.ts", import.meta.url), "utf8"),
  compat: await readFile(new URL("../lib/prod/compat.ts", import.meta.url), "utf8"),
  runtime: await readFile(new URL("../lib/ai/runtime.ts", import.meta.url), "utf8"),
  engine: await readFile(new URL("../lib/image/engine.ts", import.meta.url), "utf8"),
  entry: await readFile(new URL("../lib/imageVoxel.ts", import.meta.url), "utf8"),
  nextConfig: await readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  vercel: await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  pkg: await readFile(new URL("../package.json", import.meta.url), "utf8")
};

let failed = 0;
function assert(name, ok) {
  if (!ok) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

assert("timeout helper exists", files.timeout.includes("export function withTimeout"));
assert("import timeout is bounded", files.timeout.includes("IMPORT_TIMEOUT_MS = 45_000"));
assert("decode timeout is bounded", files.timeout.includes("DECODE_TIMEOUT_MS = 20_000"));
assert("onnx run timeout is bounded", files.timeout.includes("ONNX_RUN_TIMEOUT_MS = 15_000"));
assert("file size cap exists", files.guard.includes("MAX_IMPORT_BYTES = 25 * 1024 * 1024"));
assert("unsupported types rejected", files.guard.includes("TYPE NOT SUPPORTED"));
assert("transparent fringe sanitize exists", files.sanitize.includes("Near-invisible near-white fringe"));
assert("opaque pixels stay untouched", files.sanitize.includes("Opaque pixels are left untouched"));
assert("empty import retries as 2d", files.recover.includes('output: "2d"'));
assert("fallback disables local AI", files.recover.includes("useLocalAi: false"));
assert("wasm probe exists", files.compat.includes("typeof WebAssembly"));
assert("runtime probes with timeout", files.runtime.includes("onnx-probe"));
assert("runtime load timeout", files.runtime.includes("onnx-load"));
assert("runtime run timeout", files.runtime.includes("onnx-run"));
assert("corrupt model cache reset", files.runtime.includes("resetModel(id)"));
assert("engine sanitizes decoded raster", files.engine.includes("sanitizeRaster(raw)"));
assert("engine decode is timed", files.engine.includes("image-decode"));
assert("engine still exports imageToVoxels", files.engine.includes("export async function imageToVoxels"));
assert("public API wraps engine with recoverImport", files.entry.includes("recoverImport"));
assert("public API still re-exports types", files.entry.includes("export type {"));
assert("next caches model assets", files.nextConfig.includes("/models/:path*"));
assert("vercel.json caches models", files.vercel.includes("/models/(.*)"));
assert("test script includes hardening", files.pkg.includes("regression-hardening.mjs"));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P10 hardening regression checks passed.");
