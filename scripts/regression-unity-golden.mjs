/**
 * P16 Unity Golden — numeric regression against the REAL exporter.
 *
 * The previous version of this script fabricated its own GLB JSON by hand
 * and asserted it against its own assumptions — it never called the real
 * exportGlbTextured(), so it could not catch a real bug. It also modeled
 * `asset.extras` as a flat object; the real exporter nests everything under
 * `asset.extras.brick` (see lib/ai/gameReady.ts buildGlbExtras()). That
 * mismatch would have gone unnoticed forever under the old approach.
 *
 * Run: node --experimental-strip-types --import ./scripts/_register-aliases.mjs scripts/regression-unity-golden.mjs
 */
import { readFile } from "node:fs/promises";
import { exportGlbTextured } from "@/lib/voxelGlb.ts";
import { VoxelVolume, DEFAULT_PALETTE } from "@/lib/voxelEngine.ts";
import { parseGlbJson, buildBox, buildColumn, approx, assertFactory } from "./_test-utils.mjs";

const { assert, failed } = assertFactory();

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

// Keep the existing Unity regression chain wired into `npm test` — cheap
// guard against a script silently being dropped from CI.
for (const name of [
  "regression-unity-glb.mjs",
  "regression-unity-scale.mjs",
  "regression-unity-collider.mjs",
  "regression-unity-sprite-meta.mjs",
  "regression-unity-pack.mjs"
]) {
  assert(`npm test includes ${name}`, String(pkg.scripts?.test || "").includes(name));
}

// --- Golden #1: a roughly cubic prop, unitMeters should equal collider size on X/Z. ---
const prop = new VoxelVolume(64);
buildBox(prop, { x0: 0, x1: 9, y0: 0, y1: 9, z0: 0, z1: 9 }, 5);
const propGlb = parseGlbJson(
  await exportGlbTextured(prop, DEFAULT_PALETTE, { name: "golden-prop", shape: "prop" })
);
const propRoot = propGlb.nodes[propGlb.scenes[0].nodes[0]];
const propCollider = propRoot.children.map((i) => propGlb.nodes[i]).find((n) => n.name === "Collider_Box");
assert("prop root has at least one child", propRoot.children.length >= 1);
assert("prop min Y = 0 (bottom-center pivot)", approx(propGlb.accessors[0].min[1], 0));
assert("prop collider size.x = size.z (square footprint preserved)", approx(propCollider.extras.collider.size[0], propCollider.extras.collider.size[2], 1e-6));
assert("prop collider is a box", propCollider.extras.collider.type === "box");
assert("KHR_materials_unlit present", propGlb.extensionsUsed.includes("KHR_materials_unlit") && !!propGlb.materials[0].extensions.KHR_materials_unlit);
assert("doubleSided = false", propGlb.materials[0].doubleSided === false);
assert("magFilter = 9728", propGlb.samplers[0].magFilter === 9728);
assert("extras.brick.engine = unity", propGlb.asset.extras.brick.engine === "unity");

// --- Golden #2: an 80-voxel sword column, numeric world-space Y span. ---
const sword = new VoxelVolume(128);
buildColumn(sword, 80, 5);
const swordGlb = parseGlbJson(
  await exportGlbTextured(sword, DEFAULT_PALETTE, { name: "golden-sword", shape: "sword" })
);
assert("sword unitMeters ≈ 1.10 / 80 = 0.01375", approx(swordGlb.asset.extras.brick.unitMeters, 1.1 / 80, 1e-12));
assert("sword AABB Y ≈ 1.10 m", approx(swordGlb.accessors[0].max[1] - swordGlb.accessors[0].min[1], 1.1, 1e-9));
assert("sword collider Y size ≈ 1.10 m", approx(
  swordGlb.nodes.find((n) => n.name === "Collider_Box").extras.collider.size[1],
  1.1,
  1e-9
));
assert("P16 is in npm test", String(pkg.scripts?.test || "").includes("regression-unity-golden.mjs"));

if (failed) {
  console.error(`\n${failed} P16 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P16 Unity Golden regression checks passed.");
