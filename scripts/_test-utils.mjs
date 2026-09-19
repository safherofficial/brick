/**
 * Shared helpers for the Unity regression scripts (P11-P16). Kept dependency
 * free (no three.js) so these run fast in plain Node.
 */

/** Parse a real GLB ArrayBuffer/Uint8Array (as produced by lib/voxelGlb.ts) and return its JSON chunk. */
export function parseGlbJson(bufferOrView) {
  const buffer = bufferOrView instanceof Uint8Array ? bufferOrView.buffer : bufferOrView;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB: bad magic");
  if (view.getUint32(4, true) !== 2) throw new Error("Not a GLB: expected version 2");
  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== 0x4e4f534a) throw new Error("First GLB chunk is not JSON");
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength)).replace(/\s+$/, "");
  return JSON.parse(text);
}

/** Fill an axis-aligned box of voxels (inclusive bounds) with a single palette index. */
export function buildBox(volume, { x0, x1, y0, y1, z0, z1 }, colorIndex) {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        volume.apply(x, y, z, colorIndex);
      }
    }
  }
}

/** Build a thin 1x1 column `height` voxels tall — a minimal stand-in for a sword/prop long axis. */
export function buildColumn(volume, height, colorIndex) {
  for (let y = 0; y < height; y++) volume.apply(0, y, 0, colorIndex);
}

/** Read a store-only (uncompressed) ZIP, as produced by lib/voxelExport.ts zipStore(). */
export function readZipStore(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = [];
  let offset = 0;
  while (offset < bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break; // end of local file headers
    const method = view.getUint16(offset + 8, true);
    if (method !== 0) throw new Error(`Unexpected ZIP compression method ${method} (expected store/0)`);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
    const data = bytes.subarray(dataStart, dataStart + compSize);
    files.push({ name, data });
    offset = dataStart + compSize;
  }
  return files;
}

export function approx(actual, expected, eps = 1e-6) {
  return Math.abs(actual - expected) <= eps;
}

export function assertFactory() {
  let failed = 0;
  function assert(name, ok) {
    if (!ok) {
      console.error("FAIL", name);
      failed += 1;
    } else {
      console.log("OK  ", name);
    }
  }
  return { assert, get failed() { return failed; } };
}
