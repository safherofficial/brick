/**
 * Game-ready export regression checks.
 * Executes the real exporters and validates their real outputs.
 * Run: node --experimental-strip-types --import ./scripts/_register-aliases.mjs scripts/regression-game-ready.mjs
 */
import { exportGlbTextured } from "@/lib/voxelGlb.ts";
import { exportObj, exportObjArchive, exportVox } from "@/lib/voxelExport.ts";
import { VoxelVolume, DEFAULT_PALETTE } from "@/lib/voxelEngine.ts";
import {
  ENGINE_PROFILES,
  gameReadyChecklist,
  unityTargetHeightMeters,
  unityUnitMeters
} from "@/lib/ai/gameReady.ts";
import { buildBox, parseGlbJson, readZipStore } from "./_test-utils.mjs";

let failed = 0;
function assert(name, condition) {
  if (!condition) {
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
assert("real GLB parses as glTF 2.0", json.asset?.version === "2.0");
assert("real GLB includes unlit material extension", !!json.materials?.[0]?.extensions?.KHR_materials_unlit);
assert("real GLB carries game-ready extras", json.asset?.extras?.brick?.gameReady === true);
assert("real GLB exposes mesh telemetry", Number(json.asset?.extras?.brick?.mesh?.triangles) > 0);
assert("real GLB uses voxel-atlas material contract", json.asset?.extras?.brick?.material === "voxel-atlas");
assert("real GLB keeps Unity profile", json.asset?.extras?.brick?.engine === ENGINE_PROFILES.unity.id);

const obj = exportObj(volume, DEFAULT_PALETTE, { name: "Test Prop" });
assert("real OBJ contains vertex data", /^v /m.test(obj.obj));
assert("real OBJ contains face data", /^f /m.test(obj.obj));
assert("real OBJ emits MTL reference", obj.obj.includes("mtllib test-prop.mtl"));
assert("real MTL contains voxel material", obj.mtl.includes("newmtl voxel_"));

const archive = exportObjArchive(volume, DEFAULT_PALETTE, { name: "Test Prop" });
const archiveFiles = readZipStore(archive);
assert("real OBJ archive contains OBJ", archiveFiles.some((file) => file.name === "test-prop.obj"));
assert("real OBJ archive contains MTL", archiveFiles.some((file) => file.name === "test-prop.mtl"));

const vox = exportVox(volume, DEFAULT_PALETTE);
assert("real VOX has MagicaVoxel magic", new TextDecoder().decode(vox.subarray(0, 4)) === "VOX ");
assert("real VOX declares version 150", new DataView(vox.buffer, vox.byteOffset, vox.byteLength).getUint32(4, true) === 150);

assert("Unity sword target remains 1.10 m", unityTargetHeightMeters("sword") === 1.1);
assert("Unity prop unit conversion is positive", unityUnitMeters("prop", 10) > 0);
assert("game-ready checklist remains populated", gameReadyChecklist().length >= 5);
assert("Unity remains single-sided", ENGINE_PROFILES.unity.doubleSided === false);
assert("Godot remains double-sided", ENGINE_PROFILES.godot.doubleSided === true);

if (failed) {
  console.error(`\n${failed} game-ready functional assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll game-ready functional regression checks passed.");
