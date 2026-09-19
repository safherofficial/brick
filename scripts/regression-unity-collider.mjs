/**
 * P13 Unity AABB box collider — extras + empty Collider_Box node.
 * Run: node scripts/regression-unity-collider.mjs
 */
import { readFile } from "node:fs/promises";

const ready = await readFile(new URL("../lib/ai/gameReady.ts", import.meta.url), "utf8");
const glb = await readFile(new URL("../lib/voxelGlb.ts", import.meta.url), "utf8");
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

assert("unityBoxCollider exported", ready.includes("export function unityBoxCollider"));
assert("collider type is box", ready.includes('type: "box"'));
assert("extras accept collider", ready.includes("collider?: UnityBoxCollider") && ready.includes("collider: input.collider ?? null"));
assert("no MeshCollider", !/MeshCollider/.test(glb) && !textured.includes("GENERATE_MESH_COLLIDER"));
assert("textured builds collider from vertex AABB", textured.includes("unityBoxCollider") && textured.includes("[minPx, minPy, minPz]") && textured.includes("[maxPx, maxPy, maxPz]"));
assert("extras embed collider", textured.includes("collider,"));
assert("Collider_Box empty node", textured.includes('name: "Collider_Box"'));
assert("Collider_Box uses same center", textured.includes("translation: collider.center"));
assert("Collider_Box extras same numbers", textured.includes("extras: { collider }"));
assert("Collider_Box has no mesh", !/name: "Collider_Box"[\s\S]{0,120}mesh:/.test(textured));
assert("root still owns children", textured.includes("{ name: resolved.name, children: rootChildren }"));
assert("mesh child unchanged", textured.includes("{ mesh: 0, name: `${resolved.name}_Mesh` }"));
assert("test script includes P13", String(pkg.scripts?.test || "").includes("regression-unity-collider.mjs"));

function unityBoxCollider(min, max) {
  return {
    type: "box",
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  };
}

const u = 1.5;
const one = unityBoxCollider([-u / 2, 0, -u / 2], [u / 2, u, u / 2]);
assert("1 voxel size [u,u,u]", one.size[0] === u && one.size[1] === u && one.size[2] === u);
assert("1 voxel center at half height", one.center[0] === 0 && one.center[1] === u / 2 && one.center[2] === 0);
assert("collider type box", one.type === "box");
assert("source uses AABB midpoint", ready.includes("(min[0] + max[0]) / 2") && ready.includes("(min[1] + max[1]) / 2"));

if (failed) {
  console.error(`\n${failed} P13 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P13 Unity collider regression checks passed.");
