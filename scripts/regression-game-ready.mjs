/**
 * Game-ready export regression checks.
 * Executes the real exporters and validates their real outputs.
 * Run: node --experimental-strip-types --import ./scripts/_register-aliases.mjs scripts/regression-game-ready.mjs
 */
import { exportGlbTextured } from "@/lib/voxelGlb.ts";
import { exportObj, exportObjArchive, exportVox } from "@/lib/voxelExport.ts";
import { VoxelVolume } from "@/lib/voxelEngine.ts";
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

function parseGlb(glb) {
  const bytes = new Uint8Array(glb);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not GLB");
  const jsonLength = view.getUint32(12, true);
  const jsonStart = 20;
  const jsonText = new TextDecoder().decode(bytes.subarray(jsonStart, jsonStart + jsonLength));
  const json = JSON.parse(jsonText);
  const binHeader = jsonStart + jsonLength;
  const binLength = view.getUint32(binHeader, true);
  const binStart = binHeader + 8;
  return { json, bytes, bin: bytes.subarray(binStart, binStart + binLength) };
}

function readFloat4Accessor(parsed, accessorIndex) {
  const accessor = parsed.json.accessors[accessorIndex];
  const bufferView = parsed.json.bufferViews[accessor.bufferView];
  const componentType = accessor.componentType;
  if (componentType !== 5126 || accessor.type !== "VEC4") throw new Error("Expected float VEC4");
  const stride = bufferView.byteStride ?? 16;
  const start = (accessor.byteOffset ?? 0) + (bufferView.byteOffset ?? 0);
  const out = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const offset = start + i * stride;
    const dv = new DataView(parsed.bin.buffer, parsed.bin.byteOffset, parsed.bin.byteLength);
    out.push([dv.getFloat32(offset, true), dv.getFloat32(offset + 4, true), dv.getFloat32(offset + 8, true), dv.getFloat32(offset + 12, true)]);
  }
  return out;
}

const palette = ["#aeb9c7", "#c99427", "#4a2e22"];
const volume = new VoxelVolume(32);
buildBox(volume, { x0: 2, x1: 5, y0: 1, y1: 6, z0: 1, z1: 4 }, 0);
buildBox(volume, { x0: 2, x1: 3, y0: 1, y1: 3, z0: 4, z1: 7 }, 1);
buildBox(volume, { x0: 5, x1: 7, y0: 0, y1: 2, z0: 2, z1: 3 }, 2);

const glb = await exportGlbTextured(volume, palette, {
  name: "Material Test",
  shape: "sword"
});
const { json, bin } = parseGlb(glb);
const parsed = { json, bin };

assert("real GLB parses as glTF 2.0", json.asset?.version === "2.0");
assert("real GLB keeps Unity profile", json.asset?.extras?.brick?.engine === ENGINE_PROFILES.unity.id);
assert("real GLB keeps nearest sampling", json.samplers?.[0]?.magFilter === 9728 && json.samplers?.[0]?.minFilter === 9728);
assert("3D GLB is PBR-lit, not KHR unlit", !json.extensionsUsed?.includes("KHR_materials_unlit"));
assert("3D GLB has multiple material primitives", json.meshes?.[0]?.primitives?.length >= 2);
assert("3D GLB has multiple PBR materials", json.materials?.length >= 2);
const metallicValues = json.materials.map((m) => m.pbrMetallicRoughness?.metallicFactor);
const roughnessValues = json.materials.map((m) => m.pbrMetallicRoughness?.roughnessFactor);
assert("metal preset is present", metallicValues.includes(0.75) && roughnessValues.includes(0.3));
assert("warm metal preset is present", metallicValues.includes(0.85) && roughnessValues.includes(0.25));
assert("organic preset is present", metallicValues.includes(0) && roughnessValues.includes(0.85));
const pbrPrimitive = json.meshes?.[0]?.primitives?.[0];
assert("PBR primitive carries baked AO vertex colors", pbrPrimitive?.attributes?.COLOR_0 !== undefined);
const aoAccessor = pbrPrimitive?.attributes?.COLOR_0;
const aoValues = readFloat4Accessor(parsed, aoAccessor);
const aoScalars = aoValues.map((v) => v[0]);
assert("baked AO produces non-flat vertex factors", Math.min(...aoScalars) < 0.99 && Math.max(...aoScalars) === 1);
assert("real GLB carries game-ready extras", json.asset?.extras?.brick?.gameReady === true);
assert("real GLB exposes mesh telemetry", Number(json.asset?.extras?.brick?.mesh?.triangles) > 0);
assert("real GLB keeps material contract family", json.asset?.extras?.brick?.material === "voxel-atlas");

const volume2d = new VoxelVolume(16);
buildBox(volume2d, { x0: 1, x1: 3, y0: 1, y1: 4, z0: 1, z1: 2 }, 0);
const glb2d = await exportGlbTextured(volume2d, palette, { name: "2D Test", shape: "prop", output: "2d" });
const json2d = parseGlbJson(glb2d);
assert("2D export retains unlit extension", !!json2d.extensionsUsed?.includes("KHR_materials_unlit"));
assert("2D export remains single material", json2d.materials?.length === 1);

const obj = exportObj(volume, palette, { name: "Material Test" });
assert("real OBJ contains vertex data", /^v /m.test(obj.obj));
assert("real OBJ contains face data", /^f /m.test(obj.obj));
assert("real MTL contains voxel material", obj.mtl.includes("newmtl voxel_"));
const archive = exportObjArchive(volume, palette, { name: "Material Test" });
const archiveFiles = readZipStore(archive);
assert("real OBJ archive contains OBJ", archiveFiles.some((file) => file.name === "material-test.obj"));
assert("real OBJ archive contains MTL", archiveFiles.some((file) => file.name === "material-test.mtl"));
const vox = exportVox(volume, palette);
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
