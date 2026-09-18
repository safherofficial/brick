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
import { encodePng } from "@/lib/png";
import { GENERATOR_NAME, MAX_VOXELS } from "@/lib/limits";
import { buildGlbExtras } from "@/lib/ai/gameReady";

function pad4(n: number) {
  return (4 - (n % 4)) % 4;
}

function voxelMassCentroid(
  volume: VoxelVolume,
  pred: (x: number, y: number, z: number) => boolean
): [number, number, number] | null {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const key of volume.raw().keys()) {
    const [x, y, z] = key.split(":").map(Number);
    if (!pred(x, y, z)) continue;
    sx += x + 0.5; sy += y + 0.5; sz += z + 0.5; n += 1;
  }
  if (!n) return null;
  return [sx / n, sy / n, sz / n];
}

function socketNodes(
  volume: VoxelVolume,
  origin: [number, number, number],
  unitMeters: number,
  upAxis: "y" | "z",
  shape?: string
) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const key of volume.raw().keys()) {
    const [x, y, z] = key.split(":").map(Number);
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  const world = (x: number, y: number, z: number): [number, number, number] =>
    transformPoint(x, y, z, origin, unitMeters, upAxis);

  const spanY = Math.max(1, maxY - minY);
  const spanX = Math.max(1, maxX - minX);
  const spanZ = Math.max(1, maxZ - minZ);
  const ground = voxelMassCentroid(volume, (_x, y) => y <= minY + Math.max(0, spanY * 0.08));
  const center = voxelMassCentroid(volume, () => true);
  const grip = voxelMassCentroid(volume, (_x, y) => y <= minY + spanY * 0.2);
  const tipY = voxelMassCentroid(volume, (_x, y) => y >= maxY - spanY * 0.12);
  const muzzle = spanX >= spanZ
    ? voxelMassCentroid(volume, (x) => x >= maxX - spanX * 0.12)
    : voxelMassCentroid(volume, (_x, _y, z) => z >= maxZ - spanZ * 0.12);

  const fallback = (a: [number, number, number] | null, b: [number, number, number]) => a ?? b;
  const g = fallback(ground, [(minX + maxX) / 2, minY, (minZ + maxZ) / 2]);
  const c = fallback(center, [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]);
  const gr = fallback(grip, [(minX + maxX) / 2, minY + spanY * 0.12, (minZ + maxZ) / 2]);
  const tp = fallback(tipY, [(minX + maxX) / 2, maxY + 1, (minZ + maxZ) / 2]);
  const mz = fallback(muzzle, spanX >= spanZ ? [maxX + 1, (minY + maxY) / 2, (minZ + maxZ) / 2] : [(minX + maxX) / 2, (minY + maxY) / 2, maxZ + 1]);

  const nodes: { name: string; translation: [number, number, number] }[] = [
    { name: "Socket_Ground", translation: world(g[0], g[1], g[2]) },
    { name: "Socket_Center", translation: world(c[0], c[1], c[2]) }
  ];
  if (shape === "sword" || shape === "axe" || shape === "capsule") {
    nodes.push({ name: "Socket_Grip", translation: world(gr[0], gr[1], gr[2]) });
    nodes.push({ name: "Socket_Tip", translation: world(tp[0], tp[1], tp[2]) });
  } else {
    nodes.push({ name: "Socket_Grip", translation: world(gr[0], gr[1], gr[2]) });
    nodes.push({ name: "Socket_Muzzle", translation: world(mz[0], mz[1], mz[2]) });
  }
  return nodes;
}

function encodeChunk(type: number, bytes: Uint8Array) {
  const padding = pad4(bytes.length);
  const out = new Uint8Array(8 + bytes.length + padding);
  const view = new DataView(out.buffer);
  view.setUint32(0, bytes.length + padding, true);
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
  if (volume.count > MAX_VOXELS) {
    throw new Error(`Model too large for GLB (max ${MAX_VOXELS} voxel)`);
  }
  const bounds = assertExportable(volume);
  const resolved = resolveExport(options);
  const origin = pivotOrigin(bounds, resolved.pivot);
  const quads = greedyQuads(volume);
  if (!quads.length) throw new Error("Empty volume");

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const vertexCache = new Map<string, number>();
  const addVertex = (
    p: [number, number, number],
    n: [number, number, number],
    color: [number, number, number, number]
  ) => {
    const key = `${p[0]}:${p[1]}:${p[2]}|${n[0]}:${n[1]}:${n[2]}|${color[0]}:${color[1]}:${color[2]}:${color[3]}`;
    const existing = vertexCache.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(p[0], p[1], p[2]);
    normals.push(n[0], n[1], n[2]);
    colors.push(color[0], color[1], color[2], color[3]);
    vertexCache.set(key, index);
    return index;
  };

  let minPx = Infinity;
  let minPy = Infinity;
  let minPz = Infinity;
  let maxPx = -Infinity;
  let maxPy = -Infinity;
  let maxPz = -Infinity;

  for (const face of quads) {
    const n = transformNormal(...quadNormal(face), resolved.upAxis);
    const [r, g, b] = hexRgb(palette[face.c] ?? "#e6e6e6");
    const color: [number, number, number, number] = [r / 255, g / 255, b / 255, 1];
    const quadIndices: number[] = [];
    for (const corner of quadCorners(face)) {
      const p = transformPoint(
        corner[0],
        corner[1],
        corner[2],
        origin,
        resolved.unitMeters,
        resolved.upAxis
      );
      const index = addVertex(p, n, color);
      quadIndices.push(index);
      minPx = Math.min(minPx, p[0]);
      minPy = Math.min(minPy, p[1]);
      minPz = Math.min(minPz, p[2]);
      maxPx = Math.max(maxPx, p[0]);
      maxPy = Math.max(maxPy, p[1]);
      maxPz = Math.max(maxPz, p[2]);
    }
    if (face.dir === 1) {
      indices.push(quadIndices[0], quadIndices[1], quadIndices[2], quadIndices[0], quadIndices[2], quadIndices[3]);
    } else {
      indices.push(quadIndices[0], quadIndices[3], quadIndices[2], quadIndices[0], quadIndices[2], quadIndices[1]);
    }
  }

  const pos = new Float32Array(positions);
  const nor = new Float32Array(normals);
  const col = new Float32Array(colors);
  const vertexCount = pos.length / 3;
  const idx =
    vertexCount <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices);

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
    asset: {
      version: "2.0",
      generator: GENERATOR_NAME,
      extras: buildGlbExtras({
        name: resolved.name,
        voxelCount: volume.count,
        volumeSize: volume.size,
        shape: options?.shape as never,
        mesh: {
          quads: quads.length,
          triangles: indices.length / 3,
          vertices: vertexCount,
          indexComponentType: idx instanceof Uint16Array ? 5123 : 5125
        }
      })
    },
    extensionsUsed: ["KHR_materials_unlit"],
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
        doubleSided: true,
        extensions: { KHR_materials_unlit: {} },
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 1
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
      { bufferView: 2, componentType: 5126, count: col.length / 4, type: "VEC4" },
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

export async function exportGlbTextured(
  volume: VoxelVolume,
  palette: string[],
  options?: MeshExportOptions
) {
  if (volume.count > MAX_VOXELS) {
    throw new Error(`Model too large for GLB (max ${MAX_VOXELS} voxel)`);
  }
  const bounds = assertExportable(volume);
  const resolved = resolveExport(options);
  const origin = pivotOrigin(bounds, resolved.pivot);
  const quads = greedyQuads(volume);
  if (!quads.length) throw new Error("Empty volume");

  const atlasSize = Math.max(1, Math.ceil(Math.sqrt(palette.length)));
  const atlasRgba = new Uint8Array(atlasSize * atlasSize * 4);
  for (let i = 0; i < palette.length; i++) {
    const [r, g, b] = hexRgb(palette[i] ?? "#e6e6e6");
    const o = i * 4;
    atlasRgba[o] = r;
    atlasRgba[o + 1] = g;
    atlasRgba[o + 2] = b;
    atlasRgba[o + 3] = 255;
  }
  const atlasPng = encodePng(atlasSize, atlasSize, atlasRgba);

  const uvFor = (colorIndex: number): [number, number] => {
    const i = Math.min(Math.max(colorIndex, 0), palette.length - 1);
    const cx = i % atlasSize;
    const cy = Math.floor(i / atlasSize);
    return [(cx + 0.5) / atlasSize, (cy + 0.5) / atlasSize];
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertexCache = new Map<string, number>();
  const addVertex = (
    p: [number, number, number],
    n: [number, number, number],
    uv: [number, number]
  ) => {
    const key = `${p[0]}:${p[1]}:${p[2]}|${n[0]}:${n[1]}:${n[2]}|${uv[0]}:${uv[1]}`;
    const existing = vertexCache.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(p[0], p[1], p[2]);
    normals.push(n[0], n[1], n[2]);
    uvs.push(uv[0], uv[1]);
    vertexCache.set(key, index);
    return index;
  };

  let minPx = Infinity;
  let minPy = Infinity;
  let minPz = Infinity;
  let maxPx = -Infinity;
  let maxPy = -Infinity;
  let maxPz = -Infinity;

  for (const face of quads) {
    const n = transformNormal(...quadNormal(face), resolved.upAxis);
    const uv: [number, number] = uvFor(face.c);
    const quadIndices: number[] = [];
    for (const corner of quadCorners(face)) {
      const p = transformPoint(
        corner[0],
        corner[1],
        corner[2],
        origin,
        resolved.unitMeters,
        resolved.upAxis
      );
      const index = addVertex(p, n, uv);
      quadIndices.push(index);
      minPx = Math.min(minPx, p[0]);
      minPy = Math.min(minPy, p[1]);
      minPz = Math.min(minPz, p[2]);
      maxPx = Math.max(maxPx, p[0]);
      maxPy = Math.max(maxPy, p[1]);
      maxPz = Math.max(maxPz, p[2]);
    }
    if (face.dir === 1) {
      indices.push(quadIndices[0], quadIndices[1], quadIndices[2], quadIndices[0], quadIndices[2], quadIndices[3]);
    } else {
      indices.push(quadIndices[0], quadIndices[3], quadIndices[2], quadIndices[0], quadIndices[2], quadIndices[1]);
    }
  }

  const pos = new Float32Array(positions);
  const nor = new Float32Array(normals);
  const uv = new Float32Array(uvs);
  const vertexCount = pos.length / 3;
  const idx =
    vertexCount <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices);

  const posBytes = new Uint8Array(pos.buffer);
  const norBytes = new Uint8Array(nor.buffer);
  const uvBytes = new Uint8Array(uv.buffer);
  const idxPad = new Uint8Array(idx.byteLength + pad4(idx.byteLength));
  idxPad.set(new Uint8Array(idx.buffer));
  const imgPad = new Uint8Array(atlasPng.length + pad4(atlasPng.length));
  imgPad.set(atlasPng);

  const offsets = [0];
  offsets.push(offsets[0] + posBytes.length);
  offsets.push(offsets[1] + norBytes.length);
  offsets.push(offsets[2] + uvBytes.length);
  offsets.push(offsets[3] + idxPad.length);
  const bin = new Uint8Array(offsets[4] + imgPad.length);
  bin.set(posBytes, offsets[0]);
  bin.set(norBytes, offsets[1]);
  bin.set(uvBytes, offsets[2]);
  bin.set(idxPad, offsets[3]);
  bin.set(imgPad, offsets[4]);

  const json = {
    asset: {
      version: "2.0",
      generator: GENERATOR_NAME,
      extras: buildGlbExtras({
        name: resolved.name,
        voxelCount: volume.count,
        volumeSize: volume.size,
        shape: options?.shape as never,
        mesh: {
          quads: quads.length,
          triangles: indices.length / 3,
          vertices: vertexCount,
          indexComponentType: idx instanceof Uint16Array ? 5123 : 5125
        }
      })
    },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2, 3, 4], name: resolved.name }],
    nodes: [
      { mesh: 0, name: resolved.name },
      ...socketNodes(volume, origin, resolved.unitMeters, resolved.upAxis, options?.shape)
    ],
    meshes: [
      {
        name: resolved.name,
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0
          }
        ]
      }
    ],
    materials: [
      {
        name: "voxel-atlas",
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 1
        }
      }
    ],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [
      {
        magFilter: 9728,
        minFilter: 9728,
        wrapS: 33071,
        wrapT: 33071
      }
    ],
    images: [{ mimeType: "image/png", bufferView: 4 }],
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
      { bufferView: 2, componentType: 5126, count: uv.length / 2, type: "VEC2" },
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
      { buffer: 0, byteOffset: offsets[2], byteLength: uvBytes.length, target: 34962 },
      { buffer: 0, byteOffset: offsets[3], byteLength: idx.byteLength, target: 34963 },
      { buffer: 0, byteOffset: offsets[4], byteLength: atlasPng.length }
    ],
    buffers: [{ byteLength: bin.length }]
  };

  await new Promise((resolve) => window.setTimeout(resolve, 0));
  return writeGlb(json, bin);
}
