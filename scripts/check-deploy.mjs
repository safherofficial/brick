/**
 * P10 deploy / Vercel contract checks.
 * Soft by default. Set VERCEL=1 or BRICK_REQUIRE_MODELS=1 to require ONNX files.
 */
import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModels = process.env.VERCEL === "1" || process.env.BRICK_REQUIRE_MODELS === "1";

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const runtime = await readFile(path.join(root, "lib/ai/runtime.ts"), "utf8");
const nextConfig = await readFile(path.join(root, "next.config.ts"), "utf8");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const checks = [];
function check(name, ok) {
  checks.push([name, ok]);
  console.log(ok ? "OK  " : "FAIL", name);
}

check("production models stay local", runtime.includes('if (process.env.NODE_ENV === "production") return local;'));
check("ONNX load timeout exists", runtime.includes("ONNX_LOAD_TIMEOUT_MS"));
check("model cache resets after failure", runtime.includes("function resetModel"));
check("next config caches /models", nextConfig.includes("/models/:path*"));
check("next config caches /ort", nextConfig.includes("/ort/:path*"));
check("build prepares models", typeof pkg.scripts?.models === "string");
check("hardening regression is in test", String(pkg.scripts?.test || "").includes("regression-hardening.mjs"));

const models = ["u2netp.onnx", "midas-small.onnx"];
let missing = 0;
for (const name of models) {
  const present = await exists(path.join(root, "public", "models", name));
  if (!present) missing += 1;
  if (requireModels) check(`public/models/${name}`, present);
  else console.log(present ? "OK  " : "WARN", `public/models/${name}`);
}

if (checks.some(([, ok]) => !ok) || (requireModels && missing)) {
  console.error("Deploy checks failed");
  process.exit(1);
}
console.log("Deploy checks passed");
