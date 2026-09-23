/**
 * P11 Unity GLB primary export + dynamic output hardening.
 *
 * Executes the real exporter, parses the GLB it actually produces, and checks
 * both STATIC and DYNAMIC contracts without changing runtime export logic.
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

const staticGlb = await exportGlbTextured(volume, DEFAULT_PALETTE, {
  name: "Test Prop",
  shape: "prop"
});
const staticJson = parseGlbJson(staticGlb);
assert("STATIC GLB parses as valid glTF 2.0", staticJson.asset?.version === "2.0");
assert("STATIC extensionsUsed omits KHR_materials_unlit (real PBR lighting)", !staticJson.extensionsUsed?.includes("KHR_materials_unlit"));
assert("STATIC material uses real PBR metallic-roughness (no unlit extension)", !staticJson.materials?.[0]?.extensions?.KHR_materials_unlit && typeof staticJson.materials?.[0]?.pbrMetallicRoughness?.metallicFactor === "number");
assert("STATIC material name matches its palette bucket (voxel-metal)", staticJson.materials?.[0]?.name === "voxel-metal");
assert("STATIC Unity material is single sided", staticJson.materials?.[0]?.doubleSided === false);
assert("STATIC scene has a single root node", staticJson.scenes?.[0]?.nodes?.length === 1);
const staticRootIndex = staticJson.scenes[0].nodes[0];
const staticRoot = staticJson.nodes[staticRootIndex];
assert("STATIC root owns mesh + collider + sockets as children", Array.isArray(staticRoot.children) && staticRoot.children.length >= 3);
const staticMeshNode = staticJson.nodes[staticRoot.children[0]];
assert("STATIC first root child is the mesh node", staticMeshNode.mesh === 0 && staticMeshNode.name.endsWith("_Mesh"));
const staticColliderNode = staticRoot.children
  .map((i) => staticJson.nodes[i])
  .find((n) => n.name === "Collider_Box");
assert("STATIC Collider_Box node exists among root children", !!staticColliderNode);
assert("STATIC Collider_Box is not rendered (no mesh)", staticColliderNode && staticColliderNode.mesh === undefined);
assert("STATIC nearest-neighbor atlas sampler (magFilter 9728)", staticJson.samplers?.[0]?.magFilter === 9728);
assert("STATIC extras report the unity engine id", staticJson.asset?.extras?.brick?.engine === "unity");
assert("STATIC extras report the voxel-atlas material contract", staticJson.asset?.extras?.brick?.material === "voxel-atlas");
assert("STATIC extras report nearest texture filtering", staticJson.asset?.extras?.brick?.textureFilter === "nearest");
assert("STATIC extras carry a box collider", staticJson.asset?.extras?.brick?.collider?.type === "box");
assert("STATIC GLB contains no animation clips", !staticJson.animations || staticJson.animations.length === 0);

const dynamicGlb = await exportGlbTextured(volume, DEFAULT_PALETTE, {
  name: "Dynamic Prop",
  shape: "prop",
  animated: true
});
const dynamicJson = parseGlbJson(dynamicGlb);
const dynamicRootIndex = dynamicJson.scenes?.[0]?.nodes?.[0];
const dynamicRoot = dynamicRootIndex === undefined ? null : dynamicJson.nodes?.[dynamicRootIndex];
const dynamicMeshIndex = dynamicRoot?.children?.[0];
const dynamicAnimations = dynamicJson.animations ?? [];
const dynamicNames = dynamicAnimations.map((clip) => clip.name);
const expectedDynamicNames = ["Pickup_Idle", "Showcase_Idle", "Equipped_Idle", "Equipped_Swing"];
assert("DYNAMIC GLB contains animation clips", dynamicAnimations.length === expectedDynamicNames.length);
assert(
  "DYNAMIC clip set is complete for rigid props",
  expectedDynamicNames.every((name) => dynamicNames.includes(name))
);
assert(
  "DYNAMIC every animation carries loop metadata",
  dynamicAnimations.every((clip) => typeof clip.extras?.loop === "boolean")
);
assert(
  "DYNAMIC every animation targets the exported mesh",
  dynamicAnimations.every((clip) =>
    clip.channels?.every((channel) => channel.target?.node === dynamicMeshIndex)
  )
);
assert(
  "DYNAMIC root keeps mesh + collider + sockets",
  Array.isArray(dynamicRoot?.children) && dynamicRoot.children.length >= 3
);
assert(
  "DYNAMIC mesh node keeps the *_Mesh contract",
  typeof dynamicMeshIndex === "number" && dynamicJson.nodes?.[dynamicMeshIndex]?.name?.endsWith("_Mesh")
);

// Cross-check against the live engine profiles — Unity stays single-sided
// while Godot intentionally stays double-sided.
assert("Unity profile is single sided", ENGINE_PROFILES.unity.doubleSided === false);
assert("Godot profile stayed double sided", ENGINE_PROFILES.godot.doubleSided === true);

if (failed) {
  console.error(`\n${failed} Unity GLB assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll Unity GLB static + dynamic regression checks passed.");
