import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pack = fs.readFileSync(path.join(root, "lib/ai/unityPack.ts"), "utf8");
const builder = fs.readFileSync(path.join(root, "components/builder/Builder.tsx"), "utf8");
const header = fs.readFileSync(path.join(root, "components/builder/BuilderHeader.tsx"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label}: missing ${needle}`);
}

assertIncludes(pack, 'export function buildUnityPack', "P15 pack helper");
assertIncludes(pack, 'name: `${name}.glb`', "GLB entry");
assertIncludes(pack, 'name: "IMPORT.txt"', "IMPORT.txt entry");
assertIncludes(pack, 'Atlas: embedded in GLB', "embedded atlas contract");
assertIncludes(pack, 'Import Scale: 1', "Unity scale contract");
assertIncludes(pack, 'Materials: Unlit', "Unity material contract");
assertIncludes(pack, 'Generate Colliders: Off', "collider import contract");
assertIncludes(pack, 'Texture Filter: Point / NEAREST', "voxel filtering contract");

const importLines = pack
  .slice(pack.indexOf('export const UNITY_IMPORT_TXT'))
  .split('].join("\\n")')[0]
  .split('"')
  .filter((line) => line.length > 0 && !line.includes("export const") && !line.includes("["));
if (importLines.length < 15) throw new Error("IMPORT.txt must contain the fixed 15-line contract");

assertIncludes(builder, 'import { buildUnityPack } from "@/lib/ai/unityPack";', "Builder pack import");
assertIncludes(builder, 'kind === "unity-pack"', "Builder pack branch");
assertIncludes(builder, 'buildUnityPack({', "Builder pack invocation");
assertIncludes(builder, '`${name}-unity.zip`', "Unity pack filename");
assertIncludes(builder, 'sprite.unityMeta', "P14 meta aggregation");

assertIncludes(header, '"unity-pack"', "BuilderHeader pack action");
assertIncludes(header, 'UNITY PACK', "BuilderHeader pack button");

const scripts = String(pkg.scripts?.test ?? "");
if (!scripts.includes("regression-unity-pack.mjs")) {
  throw new Error("P15 regression is not included in npm test");
}

console.log("Unity Pack regression PASS");
console.log("contract: GLB + IMPORT.txt + optional P14 PNG/meta; atlas embedded in GLB");
console.log("IMPORT contract: 15 lines");
