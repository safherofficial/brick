/**
 * P12 Unity meters-per-voxel — contract + numeric golden.
 * Run: node scripts/regression-unity-scale.mjs
 */
import { readFile } from "node:fs/promises";

const ready = await readFile(new URL("../lib/ai/gameReady.ts", import.meta.url), "utf8");
const unity = await readFile(new URL("../lib/ai/unity.ts", import.meta.url), "utf8");
const glb = await readFile(new URL("../lib/voxelGlb.ts", import.meta.url), "utf8");
const builder = await readFile(new URL("../components/builder/Builder.tsx", import.meta.url), "utf8");
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

function readConst(src, name) {
  const m = src.match(new RegExp(`export const ${name} = ([0-9.]+)`));
  return m ? Number(m[1]) : NaN;
}

const swordH = readConst(ready, "UNITY_SWORD_HEIGHT_METERS");
const rifleH = readConst(ready, "UNITY_RIFLE_HEIGHT_METERS");
const gunH = readConst(ready, "UNITY_GUN_HEIGHT_METERS");
const propH = readConst(ready, "UNITY_PROP_HEIGHT_METERS");
const propMin = readConst(ready, "UNITY_PROP_HEIGHT_MIN_METERS");
const propMax = readConst(ready, "UNITY_PROP_HEIGHT_MAX_METERS");
const minUnit = readConst(ready, "UNITY_MIN_UNIT_METERS");

assert("unityUnitMeters exported", ready.includes("export function unityUnitMeters"));
assert("formula targetHeight / span", /targetHeight \/ (?:span|voxelSpanY)/.test(ready));
assert("sword target 1.10", swordH === 1.1);
assert("rifle target 1.00", rifleH === 1);
assert("gun target 0.35", gunH === 0.35);
assert("prop target 1.50", propH === 1.5);
assert("prop clamp 0.4–2.5", propMin === 0.4 && propMax === 2.5);
assert("min 0.01 m/voxel", minUnit === 0.01);
assert("2d tile stays 1 voxel = 1 unit", ready.includes("if (kind === \"tile\") return UNITY_2D_PIXEL.unitMeters"));
assert("unity.ts wires unityUnitMeters", unity.includes("unityUnitMeters(input.shape, input.voxelSpanY"));
assert("UNITY_EXPORT kept as profile fallback", unity.includes("export const UNITY_EXPORT"));
assert("2d options still exported", unity.includes("export function unity2dPixelExportOptions"));
assert("Builder uses unityExportOptions", builder.includes("unityExportOptions({"));
assert("Builder passes asset name", builder.includes("name: title"));
assert("Builder passes recognized shape", builder.includes("shape: lastShape"));
assert("Builder OBJ uses unityExportOptions", builder.includes("exportObjArchive") && builder.includes("unityExportOptions"));
assert("GLB textured applies unityUnitMeters", glb.includes("unityUnitMeters(options?.shape as string | undefined, contentSpanY(volume))"));
assert("GLB extras report resolved unitMeters", glb.includes("unitMeters: resolved.unitMeters"));
assert("P11 root children untouched", glb.includes("{ name: resolved.name, children: rootChildren }"));
assert("test script includes P12", String(pkg.scripts?.test || "").includes("regression-unity-scale.mjs"));

const sword80 = Math.max(minUnit, swordH / Math.max(1, 80));
assert("sword 80 voxel Y → unitMeters ≈ 0.01375", Math.abs(sword80 - 0.01375) < 1e-12);
assert("sword 80 voxel Y → AABB Y ≈ 1.10", Math.abs(sword80 * 80 - 1.1) < 1e-12);

const rifle100 = Math.max(minUnit, rifleH / 100);
assert("rifle 100 voxel Y → 0.01", Math.abs(rifle100 - 0.01) < 1e-12);

const gun10 = Math.max(minUnit, gunH / 10);
assert("gun 10 voxel Y → 0.035", Math.abs(gun10 - 0.035) < 1e-12);

const prop15 = Math.max(minUnit, propH / 15);
assert("prop 15 voxel Y → 0.1", Math.abs(prop15 - 0.1) < 1e-12);

const sword256 = Math.max(minUnit, swordH / 256);
assert("256-grid cap 0.01 m/voxel", sword256 === 0.01);

if (failed) {
  console.error(`\n${failed} P12 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P12 Unity scale regression checks passed.");
