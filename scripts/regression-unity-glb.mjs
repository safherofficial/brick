/**
 * P11 Unity GLB primary export — contract checks.
 * Run: node scripts/regression-unity-glb.mjs
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

assert("Builder imports textured GLB", builder.includes("import { exportGlbTextured } from \"@/lib/voxelGlb\""));
assert("Builder does not download COLOR_0 GLB", !builder.includes("await exportGlb("));
assert("Builder passes asset name", builder.includes("name: title"));
assert("Builder passes recognized shape", builder.includes("shape: lastShape"));
assert("Textured GLB is unlit", textured.includes("KHR_materials_unlit"));
assert("Textured GLB is single sided", textured.includes("doubleSided: false"));
assert("Scene has a single root node", textured.includes("scenes: [{ nodes: [0], name: resolved.name }]"));
assert("Root owns mesh + sockets", textured.includes("{ name: resolved.name, children: rootChildren }"));
assert("Mesh is a child node", textured.includes("{ mesh: 0, name: `${resolved.name}_Mesh` }"));
assert("Extras engine is unity", textured.includes('engine: "unity"'));
assert("Nearest atlas sampler remains", textured.includes("magFilter: 9728"));
assert("Unity profile is single sided", ready.includes("id: \"unity\"") && ready.includes("Unlit + atlas NEAREST · single root"));
assert("Material contract is single sided", ready.includes("name: \"voxel-atlas\"") && /doubleSided: false/.test(ready.slice(ready.indexOf("VOXEL_MATERIAL_CONTRACT"))));
assert("Godot profile stayed double sided", /id: \"godot\"[\s\S]*?doubleSided: true/.test(ready));
assert("test script includes P11", String(pkg.scripts?.test || "").includes("regression-unity-glb.mjs"));

if (failed) {
  console.error(`\n${failed} P11 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P11 Unity GLB regression checks passed.");
