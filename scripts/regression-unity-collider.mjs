/**
 * P13 Unity AABB box collider — verifies the real Collider_Box node against
 * the real mesh bounds of a real exported GLB (not string matching).
 *
 * Run: node --experimental-strip-types --import ./scripts/_register-aliases.mjs scripts/regression-unity-collider.mjs
 */
import { exportGlbTextured } from "@/lib/voxelGlb.ts";
import { VoxelVolume, DEFAULT_PALETTE } from "@/lib/voxelEngine.ts";
import { parseGlbJson, buildBox, approx, assertFactory } from "./_test-utils.mjs";

const { assert, failed } = assertFactory();

// Deliberately asymmetric box so a swapped axis would be caught.
const volume = new VoxelVolume(64);
buildBox(volume, { x0: 0, x1: 4, y0: 0, y1: 9, z0: 0, z1: 1 }, 2);

const glb = await exportGlbTextured(volume, DEFAULT_PALETTE, { name: "collider-check", shape: "prop" });
const json = parseGlbJson(glb);

const root = json.nodes[json.scenes[0].nodes[0]];
const collider = root.children.map((i) => json.nodes[i]).find((n) => n.name === "Collider_Box");
assert("Collider_Box node exists", !!collider);
assert("collider type is box", collider?.extras?.collider?.type === "box");

const posAccessor = json.accessors[0];
const [minX, minY, minZ] = posAccessor.min;
const [maxX, maxY, maxZ] = posAccessor.max;
const expectedSize = [maxX - minX, maxY - minY, maxZ - minZ];
const expectedCenter = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];

const size = collider.extras.collider.size;
const center = collider.extras.collider.center;
assert("collider size.x matches real mesh AABB", approx(size[0], expectedSize[0], 1e-6));
assert("collider size.y matches real mesh AABB", approx(size[1], expectedSize[1], 1e-6));
assert("collider size.z matches real mesh AABB", approx(size[2], expectedSize[2], 1e-6));
assert("collider center matches real mesh AABB", approx(center[0], expectedCenter[0], 1e-6) && approx(center[1], expectedCenter[1], 1e-6) && approx(center[2], expectedCenter[2], 1e-6));
assert("collider node translation equals its own center", approx(collider.translation[0], center[0], 1e-6) && approx(collider.translation[1], center[1], 1e-6));
assert("Collider_Box carries no mesh (bounds-only proxy)", collider.mesh === undefined);
assert("Collider_Box is a child of the single root node", root.children.includes(json.nodes.indexOf(collider)));
assert("collider is also embedded in asset extras for importers without node-walking", json.asset.extras.brick.collider.type === "box");

if (failed) {
  console.error(`\n${failed} P13 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P13 Unity collider regression checks passed.");
