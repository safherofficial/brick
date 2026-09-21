/**
 * P20 Unity GLB export contract checks.
 * Run: node --experimental-strip-types --import ./scripts/_register-aliases.mjs scripts/regression-unity-glb.mjs
 */
import { readFile } from "node:fs/promises";
const glb = await readFile(new URL("../lib/voxelGlb.ts", import.meta.url), "utf8");
const builder = await readFile(new URL("../components/builder/Builder.tsx", import.meta.url), "utf8");
const ready = await readFile(new URL("../lib/ai/gameReady.ts", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
let failed = 0;
function assert(name, ok) {
  if (!ok) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}
const textured = glb.slice(glb.indexOf("export async function exportGlbTextured"));
assert("Builder imports textured GLB", builder.includes('import { exportGlbTextured } from "@/lib/voxelGlb"'));
assert("Builder does not download COLOR_0 GLB", !builder.includes("await exportGlb("));
assert("Builder passes asset name", builder.includes("name: title"));
assert("Builder passes recognized shape", builder.includes("shape: lastShape"));
assert("Textured 3D GLB uses PBR material presets", textured.includes('metallicFactor: 0.75') && textured.includes('metallicFactor: 0.85') && textured.includes('roughnessFactor: 0.85'));
assert("Textured 3D GLB no longer forces KHR unlit", textured.includes('twoD ? { extensionsUsed: ["KHR_materials_unlit"] } : {}'));
assert("Textured 3D GLB carries baked AO COLOR_0", textured.includes('COLOR_0: 3'));
assert("Textured GLB remains single sided", textured.includes("doubleSided: false"));
assert("Scene has a single root node", textured.includes("scenes: [{ nodes: [0], name: resolved.name }]"));
assert("Root owns mesh + collider + sockets", textured.includes("children: rootChildren"));
assert("Mesh remains a child node", textured.includes('{ mesh: 0, name: `${resolved.name}_Mesh` }'));
assert("Extras engine is unity", textured.includes('engine: "unity"'));
assert("Nearest atlas sampler remains", textured.includes("magFilter: 9728"));
assert("Unity profile is PBR + atlas NEAREST", ready.includes("PBR palette materials + atlas NEAREST"));
assert("Material contract is no longer preferred unlit", /unlitPreferred: false/.test(ready));
assert("Godot profile stayed double sided", /id: "godot"[\s\S]*?doubleSided: true/.test(ready));
assert("test script includes Unity GLB", String(pkg.scripts?.test || "").includes("regression-unity-glb.mjs"));
if (failed) {
  console.error(`\n${failed} P20 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P20 Unity GLB regression checks passed.");
