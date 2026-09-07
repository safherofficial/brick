import type { VoxelVolume } from "@/lib/voxelEngine";
import {
  assertExportable,
  greedyQuads,
  hexRgb,
  pivotOrigin,
  quadCorners,
  quadNormal,
  resolveExport,
  transformNormal,
  transformPoint,
  type MeshExportOptions
} from "@/lib/voxelMesh";

function pad4(n: number) {
  return (4 - (n % 4)) % 4;
}

function encodeChunk(type: number, bytes: Uint8Array) {
  const padding = pad4(bytes.length);
  const out = new Uint8Array(8 + bytes.length + padding);
  const view = new DataView(out.buffer);
  view.setUint32(0, bytes.length, true);
  view.setUint32(4, type, true);
  out.set(bytes, 8);
  if (padding && type === 0x4e4f534a) out.fill(0x20, 8 + bytes.length);
  return out;
}

function writeGlb(json: object, bin: Uint8Array) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonChunk = encodeChunk(0x4e4f534a, jsonBytes);
  const binChunk = encodeChunk(0x004e4942, bin);
  const total = 12 + jsonChunk.length + binChunk.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  out.set(jsonChunk, 12);
  out.set(binChunk, 12 + jsonChunk.length);
  return out.buffer;
}

export async function exportGlb(
  volume: VoxelVolume,
  palette: string[],
  options?: MeshExportOptions
) {
  if (volume.count > 80_000) throw new Error("Model too large for GLB");
  const bounds = assertExportable(volume);
  const resolved = resolveExport(options);
  const origin = pivotOrigin(bounds, resolved.pivot);
  const quads = greedyQuads(volume);
  if (!quads.length) throw new Error("Empty volume");

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  let minPx = Infinity;
  let minPy = Infinity;
  let minPz = Infinity;
  let maxPx = -Infinity;
  let maxPy = -Infinity;
  let maxPz = -Infinity;

  for (const face of quads) {
    const base = positions.length / 3;
    const n = transformNormal(...quadNormal(face), resolved.upAxis);
    const [r, g, b] = hexRgb(palette[face.c] ?? "#ffffff");
    for (const corner of quadCorners(face)) {
      const p = transformPoint(
        corner[0],
        corner[1],
        corner[2],
        origin,
        resolved.unitMeters,
        resolved.upAxis
      );
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
      colors.push(r / 255, g / 255, b / 255);
      minPx = Math.min(minPx, p[0]);
      minPy = Math.min(minPy, p[1]);
      minPz = Math.min(minPz, p[2]);
      maxPx = Math.max(maxPx, p[0]);
      maxPy = Math.max(maxPy, p[1]);
      maxPz = Math.max(maxPz, p[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const pos = new Float32Array(positions);
  const nor = new Float32Array(normals);
  const col = new Float32Array(colors);
  const idx =
    indices.length <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices);

  const posBytes = new Uint8Array(pos.buffer);
  const norBytes = new Uint8Array(nor.buffer);
  const colBytes = new Uint8Array(col.buffer);
  const idxPad = new Uint8Array(idx.byteLength + pad4(idx.byteLength));
  idxPad.set(new Uint8Array(idx.buffer));

  const offsets = [0];
  offsets.push(offsets[0] + posBytes.length);
  offsets.push(offsets[1] + norBytes.length);
  offsets.push(offsets[2] + colBytes.length);
  const bin = new Uint8Array(offsets[3] + idxPad.length);
  bin.set(posBytes, offsets[0]);
  bin.set(norBytes, offsets[1]);
  bin.set(colBytes, offsets[2]);
  bin.set(idxPad, offsets[3]);

  const json = {
    asset: { version: "2.0", generator: "Brick Builder" },
    scene: 0,
    scenes: [{ nodes: [0], name: resolved.name }],
    nodes: [{ mesh: 0, name: resolved.name }],
    meshes: [
      {
        name: resolved.name,
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
            indices: 3,
            material: 0
          }
        ]
      }
    ],
    materials: [
      {
        name: "voxel",
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0.02,
          roughnessFactor: 0.45
        }
      }
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: pos.length / 3,
        type: "VEC3",
        min: [minPx, minPy, minPz],
        max: [maxPx, maxPy, maxPz]
      },
      { bufferView: 1, componentType: 5126, count: nor.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: col.length / 3, type: "VEC3" },
      {
        bufferView: 3,
        componentType: idx instanceof Uint16Array ? 5123 : 5125,
        count: indices.length,
        type: "SCALAR"
      }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: offsets[1], byteLength: norBytes.length, target: 34962 },
      { buffer: 0, byteOffset: offsets[2], byteLength: colBytes.length, target: 34962 },
      { buffer: 0, byteOffset: offsets[3], byteLength: idx.byteLength, target: 34963 }
    ],
    buffers: [{ byteLength: bin.length }]
  };

  await new Promise((resolve) => window.setTimeout(resolve, 0));
  return writeGlb(json, bin);
}
