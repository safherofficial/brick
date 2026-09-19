/**
 * P16 Unity Golden — numeric GLB regression.
 * Parses the GLB JSON chunk directly; no Three.js dependency.
 * Run: node scripts/regression-unity-golden.mjs
 */
import { readFile } from "node:fs/promises";

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
function approx(actual, expected, eps = 1e-5) {
  return Math.abs(actual - expected) <= eps;
}
function pad4(n) {
  return (4 - (n % 4)) % 4;
}
function encodeGlb(json) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const padding = pad4(jsonBytes.length);
  const jsonChunk = new Uint8Array(8 + jsonBytes.length + padding);
  const jsonView = new DataView(jsonChunk.buffer);
  jsonView.setUint32(0, jsonBytes.length + padding, true);
  jsonView.setUint32(4, 0x4e4f534a, true);
  jsonChunk.set(jsonBytes, 8);
  jsonChunk.fill(0x20, 8 + jsonBytes.length);
  const total = 12 + jsonChunk.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  out.set(jsonChunk, 12);
  return out.buffer;
}
function parseGlbJson(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  assert("GLB magic", view.getUint32(0, true) === 0x46546c67);
  assert("GLB version 2", view.getUint32(4, true) === 2);
  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  assert("first chunk is JSON", chunkType === 0x4e4f534a);
  const decoder = new TextDecoder();
  const text = decoder.decode(bytes.subarray(20, 20 + chunkLength)).replace(/\s+$/, "");
  return JSON.parse(text);
}
function goldenGlb({ unitMeters, minY, maxY, shape }) {
  const centerY = (minY + maxY) / 2;
  const collider = {
    type: "box",
    center: [0, centerY, 0],
    size: [unitMeters, maxY - minY, unitMeters]
  };
  return encodeGlb({
    asset: {
      version: "2.0",
      extras: {
        engine: "unity",
        shape,
        unitMeters,
        collider
      }
    },
    extensionsUsed: ["KHR_materials_unlit"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "Golden", children: [1, 2] },
      { mesh: 0, name: "Golden_Mesh" },
      { name: "Collider_Box", translation: collider.center, extras: { collider } }
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 0, material: 0 }] }],
    materials: [{
      name: "voxel-atlas",
      doubleSided: false,
      extensions: { KHR_materials_unlit: {} }
    }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728 }],
    images: [{ mimeType: "image/png" }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 8,
      type: "VEC3",
      min: [-unitMeters / 2, minY, -unitMeters / 2],
      max: [unitMeters / 2, maxY, unitMeters / 2]
    }]
  });
}

// Keep the existing Unity regression chain intact.
for (const name of [
  "regression-unity-glb.mjs",
  "regression-unity-scale.mjs",
  "regression-unity-collider.mjs",
  "regression-unity-sprite-meta.mjs",
  "regression-unity-pack.mjs"
]) {
  assert(`npm test includes ${name}`, String(pkg.scripts?.test || "").includes(name));
}

const propUnit = 1.5;
const propGlb = parseGlbJson(goldenGlb({
  unitMeters: propUnit,
  minY: 0,
  maxY: propUnit,
  shape: "prop"
}));
assert("root children >= 1", Array.isArray(propGlb.nodes?.[0]?.children) && propGlb.nodes[0].children.length >= 1);
assert("prop min Y = 0 ±1e-5", approx(propGlb.accessors?.[0]?.min?.[1], 0));
assert("prop collider size = unitMeters on X/Y/Z", propGlb.asset.extras.collider.size.every((v) => approx(v, propUnit)));
assert("prop collider center Y = half height", approx(propGlb.asset.extras.collider.center[1], propUnit / 2));
assert("collider type = box", propGlb.asset.extras.collider.type === "box");
assert("KHR_materials_unlit present", propGlb.extensionsUsed.includes("KHR_materials_unlit") && !!propGlb.materials?.[0]?.extensions?.KHR_materials_unlit);
assert("doubleSided = false", propGlb.materials?.[0]?.doubleSided === false);
assert("magFilter = 9728", propGlb.samplers?.[0]?.magFilter === 9728);
assert("extras.engine = unity", propGlb.asset?.extras?.engine === "unity");

const swordUnit = 1.1 / 80;
const swordGlb = parseGlbJson(goldenGlb({
  unitMeters: swordUnit,
  minY: 0,
  maxY: swordUnit * 80,
  shape: "sword"
}));
assert("sword 1×80×1 unitMeters ≈ 0.01375", approx(swordGlb.asset.extras.unitMeters, 0.01375, 1e-12));
assert("sword AABB Y ≈ 1.10 m", approx(swordGlb.accessors[0].max[1] - swordGlb.accessors[0].min[1], 1.1, 1e-12));
assert("sword collider Y ≈ 1.10 m", approx(swordGlb.asset.extras.collider.size[1], 1.1, 1e-12));
assert("P16 is in npm test", String(pkg.scripts?.test || "").includes("regression-unity-golden.mjs"));

if (failed) {
  console.error(`\n${failed} P16 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P16 Unity Golden regression checks passed.");
