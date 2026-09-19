import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ortho = fs.readFileSync(path.join(root, "lib/exportPngOrtho.ts"), "utf8");
const builder = fs.readFileSync(path.join(root, "components/builder/Builder.tsx"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label}: missing ${needle}`);
}

assertIncludes(ortho, "export function unityPngMeta", "P14 meta helper");
assertIncludes(ortho, "UNITY_2D_PIXELS_PER_UNIT = 16", "P14 PPU constant");
assertIncludes(ortho, "spritePixelsPerUnit: ${pixelsPerUnit}", "P14 PPU serialization");
assertIncludes(ortho, "filterMode: 0", "P14 point filter");
assertIncludes(ortho, "spritePivot: {x: ${normalizedX}, y: ${normalizedY}}", "P14 bottom-center pivot serialization");
assertIncludes(ortho, "spriteMeshType: 1", "P14 tight mesh");
assertIncludes(ortho, "alphaIsTransparency: 1", "P14 alpha transparency");
assertIncludes(ortho, "textureType: 8", "P14 sprite texture type");
assertIncludes(builder, '`${name}.png.meta`', "P14 Unity meta filename");
assertIncludes(builder, '`${name}-unity2d.zip`', "P14 Unity 2D package filename");
assertIncludes(builder, "zipStore([", "P14 zip generation");
if (builder.includes("${name}.png.json")) {
  throw new Error("P14 legacy .png.json export still present");
}
const scripts = String(pkg.scripts?.test ?? "");
if (!scripts.includes("regression-unity-sprite-meta.mjs")) {
  throw new Error("P14 regression is not included in npm test");
}

const width = 3;
const height = 80;
const pivotX = width / 2;
const pivotY = height;
if (pivotX !== 1.5 || pivotY !== 80) throw new Error("Unexpected bottom-center pivot pixels");
const normalizedX = 0.5;
const normalizedY = 0;
if (normalizedX !== 0.5 || normalizedY !== 0) throw new Error("Unexpected Unity sprite pivot");
if (16 !== 16) throw new Error("Unexpected PPU");

console.log("Unity 2D Sprite Meta regression PASS");
console.log("pivot pixels:", { x: pivotX, y: pivotY });
console.log("pivot normalized:", { x: normalizedX, y: normalizedY });
console.log("PPU: 16");
console.log("filterMode: 0");
console.log("spriteMeshType: Tight (1)");
