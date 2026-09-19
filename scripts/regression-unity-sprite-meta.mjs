/**
 * P14 Unity 2D sprite metadata — runs the real ortho PNG exporter and
 * checks the real returned pivot/meta against the real PNG bytes.
 *
 * Run: node --experimental-strip-types --import ./scripts/_register-aliases.mjs scripts/regression-unity-sprite-meta.mjs
 */
import { exportVolumePngOrtho, UNITY_2D_PIXELS_PER_UNIT } from "@/lib/exportPngOrtho.ts";
import { VoxelVolume, DEFAULT_PALETTE } from "@/lib/voxelEngine.ts";
import { buildBox, assertFactory } from "./_test-utils.mjs";

const { assert, failed } = assertFactory();

// A 5x4 flat-ish silhouette (varying depth so the "front-most voxel wins" rule is exercised).
const volume = new VoxelVolume(32);
buildBox(volume, { x0: 0, x1: 4, y0: 0, y1: 3, z0: 0, z1: 0 }, 3);
volume.apply(2, 2, 1, 4); // a voxel one step closer to camera at a shared (x,y)

const { png, pivot, unityMeta } = exportVolumePngOrtho(volume, DEFAULT_PALETTE);

assert("output is a real PNG (magic bytes)", png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47);
assert("pivot width matches the real voxel X extent", pivot.width === 5);
assert("pivot height matches the real voxel Y extent", pivot.height === 4);
assert("pixels-per-unit constant is 16", UNITY_2D_PIXELS_PER_UNIT === 16);
assert("pivot reports the real pixels-per-unit", pivot.pixelsPerUnit === 16);
assert("pivot.x sits at horizontal center of the real width", pivot.x === pivot.width / 2);
assert("pivot.y sits at the top per bottom-center convention", pivot.y === pivot.height);

assert("meta declares Unity fileFormatVersion 2", unityMeta.includes("fileFormatVersion: 2"));
assert("meta serializes the real pixels-per-unit", unityMeta.includes(`spritePixelsPerUnit: ${pivot.pixelsPerUnit}`));
assert("meta pins point filtering (filterMode: 0)", unityMeta.includes("filterMode: 0"));
assert("meta uses sprite import mode", unityMeta.includes("spriteMode: 1"));
assert("meta pivot matches the bottom-center convention", unityMeta.includes("spritePivot: {x: 0.5, y: 0}"));
assert("meta guid is derived from the real PNG bytes (32 hex chars)", /guid: [0-9a-f]{32}/.test(unityMeta));

if (failed) {
  console.error(`\n${failed} P14 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P14 Unity sprite-meta regression checks passed.");
