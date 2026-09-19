/**
 * P12 Unity meters-per-voxel — executes the real scale function and the
 * real exporter end-to-end, instead of grepping source text.
 *
 * Run: node --experimental-strip-types --import ./scripts/_register-aliases.mjs scripts/regression-unity-scale.mjs
 */
import { unityUnitMeters, UNITY_MIN_UNIT_METERS } from "@/lib/ai/gameReady.ts";
import { exportGlbTextured } from "@/lib/voxelGlb.ts";
import { VoxelVolume, DEFAULT_PALETTE } from "@/lib/voxelEngine.ts";
import { parseGlbJson, buildColumn, approx, assertFactory } from "./_test-utils.mjs";

const { assert, failed } = assertFactory();

// Real unityUnitMeters() calls — no fabricated numbers.
assert("sword: 1.10m / 80 voxels", approx(unityUnitMeters("sword", 80), 1.1 / 80, 1e-12));
assert("rifle: 1.00m / 100 voxels", approx(unityUnitMeters("rifle", 100), 1.0 / 100, 1e-12));
assert("gun: 0.35m / 35 voxels", approx(unityUnitMeters("gun", 35), 0.35 / 35, 1e-12));
assert("2d output forces 1 voxel = 1 unit", unityUnitMeters("prop", 40, "2d") === 1);
assert("tile shape forces 1 voxel = 1 unit", unityUnitMeters("tile", 40) === 1);
assert("scale never drops below the 0.01 m/voxel floor", unityUnitMeters("prop", 100_000) >= UNITY_MIN_UNIT_METERS);

// End-to-end: a real 80-voxel-tall column, exported as a "sword", should
// land at ~1.10 m tall in the actual produced GLB geometry (not a hand-built one).
const sword = new VoxelVolume(128);
buildColumn(sword, 80, 1);
const glb = await exportGlbTextured(sword, DEFAULT_PALETTE, { name: "sword-e2e", shape: "sword" });
const json = parseGlbJson(glb);
const posAccessor = json.accessors[0];
const worldHeight = posAccessor.max[1] - posAccessor.min[1];
assert("real 80-voxel sword export measures ~1.10 m tall", approx(worldHeight, 1.1, 1e-9));
assert("real sword unitMeters extra matches 1.10/80", approx(json.asset.extras.brick.unitMeters, 1.1 / 80, 1e-12));
assert("real sword export bottom sits at Y = 0 (bottom-center pivot)", approx(posAccessor.min[1], 0, 1e-9));

if (failed) {
  console.error(`\n${failed} P12 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P12 Unity scale regression checks passed.");
