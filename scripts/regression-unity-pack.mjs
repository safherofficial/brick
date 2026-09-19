/**
 * P15 Unity handoff pack — builds a real ZIP with buildUnityPack() and
 * actually reads it back with a real (store-only) ZIP parser, instead of
 * grepping unityPack.ts as text.
 *
 * Run: node --experimental-strip-types --import ./scripts/_register-aliases.mjs scripts/regression-unity-pack.mjs
 */
import { buildUnityPack, UNITY_IMPORT_TXT } from "@/lib/ai/unityPack.ts";
import { readZipStore, assertFactory } from "./_test-utils.mjs";

const { assert, failed } = assertFactory();

const fakeGlb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]); // not a real GLB, just distinct bytes to track
const fakeSpritePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
const fakeMeta = "fileFormatVersion: 2\nspritePixelsPerUnit: 16\n";

const zipBytes = buildUnityPack({
  name: "My Sword! v2",
  glb: fakeGlb,
  sprite: { png: fakeSpritePng, meta: fakeMeta }
});

const files = readZipStore(zipBytes);
const byName = Object.fromEntries(files.map((f) => [f.name, f.data]));

assert("pack name is slugified (lowercase, spaces/punctuation -> dashes)", "my-sword-v2.glb" in byName);
assert("GLB bytes round-trip unchanged through the ZIP", bytesEqual(byName["my-sword-v2.glb"], fakeGlb));
assert("sprite PNG is included and unchanged", "my-sword-v2.png" in byName && bytesEqual(byName["my-sword-v2.png"], fakeSpritePng));
assert("sprite .meta is included with the real meta text", new TextDecoder().decode(byName["my-sword-v2.png.meta"]) === fakeMeta);
assert("IMPORT.txt is included", "IMPORT.txt" in byName);
const importText = new TextDecoder().decode(byName["IMPORT.txt"]);
assert("IMPORT.txt content matches the real exported constant", importText === UNITY_IMPORT_TXT);
assert("IMPORT.txt documents Unity URP", importText.includes("Engine: Unity URP"));
assert("IMPORT.txt documents mesh colliders are off (custom AABB collider used instead)", importText.includes("Mesh Collider: Off"));
assert("IMPORT.txt documents meters as the GLB unit", importText.includes("GLB Unit: meters"));

// No sprite/atlas supplied: pack should still be valid and just omit those files.
const bareZip = buildUnityPack({ name: "bare", glb: fakeGlb });
const bareFiles = readZipStore(bareZip);
assert("pack without a sprite only contains glb + IMPORT.txt", bareFiles.length === 2);

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

if (failed) {
  console.error(`\n${failed} P15 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll P15 Unity pack regression checks passed.");
