/**
 * Minimal ESM loader hook: resolves the "@/..." path alias (declared in
 * tsconfig.json as "@/*": ["./*"]) to real files under the repo root.
 *
 * Node's --experimental-strip-types only strips TypeScript types; it does
 * not know about tsconfig "paths". Without this, any regression script that
 * tries to `import` real source files fails immediately with
 * ERR_MODULE_NOT_FOUND on the first "@/lib/..." import — which is exactly
 * why the previous Unity regression scripts fell back to reading source
 * files as plain text and grepping for substrings instead of executing them.
 *
 * Usage: node --experimental-strip-types --experimental-loader ./scripts/_alias-loader.mjs <script>
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const CANDIDATE_EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    for (const ext of CANDIDATE_EXTS) {
      const candidate = new URL(rel + ext, ROOT);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    // No match on disk — let the default resolver produce a clear error.
  }
  return nextResolve(specifier, context);
}
