/**
 * P11 Unity GLB primary export — executes the real exporter.
 *
 * Builds a synthetic voxel volume, calls the real exportGlbTextured() from
 * lib/voxelGlb.ts, parses the GLB it actually produces, and asserts on that
 * real output. Previous version of this script read lib/voxelGlb.ts as text
 * and grepped for substrings — it could not detect a broken export, only a
 * renamed literal.
 *
 * Run: node --experimental-strip-types --import ./scripts/_register-aliases.mjs scripts/regression-unity-glb.mjs
 */
import { exportGlbTextured } from "@/lib/voxelGlb.ts";
import { VoxelVolume, DEFAULT_PALETTE } from "@/lib/voxelEngine.ts";
import { ENGINE_PROFILES } from "@/lib/ai/gameReady.ts";
import { parseGlbJson, buildBox } from "./_test-utils.mjs";

let failed = 0;
function assert(name, ok) {
  if (!ok) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

const volume = new VoxelVolume(64);
buildBox(volume, { x0: 0, x1: 2, y0: 0, y1: 5, z0: 0, z1: 1 }, 1);

const glb = await exportGlbTextured(volume, DEFAULT_PALETTE, {
  name: "Test Prop",
  shape: "prop"
});
const json = parseGlbJson(glb);

assert("GLB parses as valid glTF 2.0", json.asset?.version === "2.0");
assert("extensionsUsed includes KHR_materials_unlit", json.extensionsUsed?.includes("KHR_materials_unlit"));
assert("material extension is unlit", !!json.materials?.[0]?.extensions?.KHR_materials_unlit);
assert("material name is voxel-atlas", json.materials?.[0]?.name === "voxel-atlas");
assert("Unity material is single sided", json.materials?.[0]?.doubleSided === false);
assert("scene has a single root node", json.scenes?.[0]?.nodes?.length === 1);
const rootIndex = json.scenes[0].nodes[0];
const root = json.nodes[rootIndex];
assert("root node owns mesh + collider + sockets as children", Array.isArray(root.children) && root.children.length >= 3);
const meshNode = json.nodes[root.children[0]];
assert("first root child is the mesh node", meshNode.mesh === 0 && meshNode.name.endsWith("_Mesh"));
const colliderNode = root.children
  .map((i) => json.nodes[i])
  .find((n) => n.name === "Collider_Box");
assert("a Collider_Box node exists among root children", !!colliderNode);
assert("Collider_Box node is not itself rendered (no mesh)", colliderNode && colliderNode.mesh === undefined);
assert("nearest-neighbor atlas sampler (magFilter 9728)", json.samplers?.[0]?.magFilter === 9728);
assert("extras report the unity engine id", json.asset?.extras?.brick?.engine === "unity");
assert("extras report the voxel-atlas material contract", json.asset?.extras?.brick?.material === "voxel-atlas");
assert("extras report nearest texture filtering", json.asset?.extras?.brick?.textureFilter === "nearest");
assert("extras carry a box collider", json.asset?.extras?.brick?.collider?.type === "box");

// Cross-check against the live engine profiles (not a hardcoded regex) —
// Unity stays single-sided while Godot intentionally stays double-sided.
assert("Unity profile is single sided", ENGINE_PROFILES.unity.doubleSided === false);
assert("Godot profile stayed double sided", ENGINE_PROFILES.godot.doubleSided === true);

if (failed) {
  console.error(`\n${failed} P11 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P11 Unity GLB regression checks passed.");
