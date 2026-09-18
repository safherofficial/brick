/**
 * Game-ready export regression checks.
 * These are contract checks only: they do not change the runtime exporter.
 * Run: node scripts/regression-game-ready.mjs
 */
import { readFile } from "node:fs/promises";

const glb = await readFile(new URL("../lib/voxelGlb.ts", import.meta.url), "utf8");
const obj = await readFile(new URL("../lib/voxelExport.ts", import.meta.url), "utf8");
const ready = await readFile(new URL("../lib/ai/gameReady.ts", import.meta.url), "utf8");

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

assert("GLB caches reusable vertices", glb.includes("const vertexCache = new Map<string, number>()"));
assert("GLB cache key protects position + normal + color", glb.includes("|${n[0]}:${n[1]}:${n[2]}|${color[0]}:${color[1]}:${color[2]}:${color[3]}"));
assert("Textured GLB cache key protects position + normal + UV", glb.includes("|${n[0]}:${n[1]}:${n[2]}|${uv[0]}:${uv[1]}"));
assert("GLB selects index width from vertex count", glb.includes("vertexCount <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices)"));
assert("OBJ caches positions", obj.includes("const vertexCache = new Map<string, number>()"));
assert("OBJ caches normals", obj.includes("const normalCache = new Map<string, number>()"));
assert("GLB reports mesh telemetry", glb.includes("triangles: indices.length / 3"));
assert("Game-ready extras expose mesh telemetry", ready.includes("indexFormat: input.mesh.indexComponentType === 5123 ? \"UNSIGNED_SHORT\" : \"UNSIGNED_INT\""));

if (failed) {
  console.error(`\n${failed} game-ready regression assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll game-ready regression checks passed.");
