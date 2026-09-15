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

function pad4(n: number) {
  return (4 - (n % 4)) % 4;
}

function encodeChunk(type: number, bytes: Uint8Array) {
  const padding = pad4(bytes.length);
  const out = new Uint8Array(8 + bytes.length + padding);
  const view = new DataView(out.buffer);
  // Il campo chunkLength dell'header deve dichiarare la lunghezza REALE del
  // chunk (padding incluso) — non quella del contenuto grezzo. Con solo
  // bytes.length, un parser GLB conforme allo spec che naviga i chunk
  // seguendo la lunghezza dichiarata finisce a leggere byte di padding
  // come se fossero l'header del chunk successivo (verificato: succede
  // ogni volta che il JSON non è già un multiplo di 4 byte).
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

// Variante vertex-color (leggera, nessuna texture incorporata). Funziona
// "out of the box" solo se il motore/importer di destinazione applica
// COLOR_0 al colore base senza configurazione — vedi exportGlbTextured per
// la variante pensata per funzionare ovunque senza setup manuale.
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

  let minPx = Infinity;
  let minPy = Infinity;
  let minPz = Infinity;
  let maxPx = -Infinity;
  let maxPy = -Infinity;
  let maxPz = -Infinity;

  for (const face of quads) {
    const base = positions.length / 3;
    const n = transformNormal(...quadNormal(face), resolved.upAxis);
    const [r, g, b] = hexRgb(palette[face.c] ?? "#e6e6e6");
    const cr = r / 255;
    const cg = g / 255;
    const cb = b / 255;
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
      colors.push(cr, cg, cb, 1);
      minPx = Math.min(minPx, p[0]);
      minPy = Math.min(minPy, p[1]);
      minPz = Math.min(minPz, p[2]);
      maxPx = Math.max(maxPx, p[0]);
      maxPy = Math.max(maxPy, p[1]);
      maxPz = Math.max(maxPz, p[2]);
    }
    if (face.dir === 1) {
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
    }
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
    asset: { version: "2.0", generator: GENERATOR_NAME },
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

// Variante con texture-atlas: un materiale PBR standard con
// baseColorTexture, nessun vertex color, nessuna estensione richiesta.
// Si apre correttamente con l'importer di default di qualunque motore
// (Unity/glTFast, Unreal, Godot, Blender...) senza che chi la importa
// debba configurare shader o materiali — è la variante raccomandata per
// distribuire asset che "devono funzionare e basta".
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

  // Texture-atlas: un texel per colore della palette, disposto in una
  // griglia quadrata. La UV di ogni faccia punta al CENTRO del proprio
  // texel; con filtro NEAREST e wrap CLAMP_TO_EDGE (impostati sotto nel
  // sampler) i colori non si mescolano mai tra loro, nemmeno a distanza o
  // con i mipmap.
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

  let minPx = Infinity;
  let minPy = Infinity;
  let minPz = Infinity;
  let maxPx = -Infinity;
  let maxPy = -Infinity;
  let maxPz = -Infinity;

  for (const face of quads) {
    const base = positions.length / 3;
    const n = transformNormal(...quadNormal(face), resolved.upAxis);
    const [u, v] = uvFor(face.c);
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
      uvs.push(u, v);
      minPx = Math.min(minPx, p[0]);
      minPy = Math.min(minPy, p[1]);
      minPz = Math.min(minPz, p[2]);
      maxPx = Math.max(maxPx, p[0]);
      maxPy = Math.max(maxPy, p[1]);
      maxPz = Math.max(maxPz, p[2]);
    }
    if (face.dir === 1) {
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
    }
  }

  const pos = new Float32Array(positions);
  const nor = new Float32Array(normals);
  const uv = new Float32Array(uvs);
  const idx =
    indices.length <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices);

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
    asset: { version: "2.0", generator: GENERATOR_NAME },
    scene: 0,
    scenes: [{ nodes: [0, 1], name: resolved.name }],
    nodes: [
      { mesh: 0, name: resolved.name },
      // Punto di aggancio di default per armi/scudi: siede all'origine
      // locale del modello (che con pivot "bottom-center" corrisponde alla
      // base dell'oggetto). È un riferimento di comodo, non una vera
      // individuazione geometrica dell'impugnatura — chi importa l'asset
      // può comunque spostare questo nodo dove preferisce nel motore.
      { name: "Socket_Grip", translation: [0, 0, 0] }
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
        magFilter: 9728, // NEAREST
        minFilter: 9728, // NEAREST
        wrapS: 33071, // CLAMP_TO_EDGE
        wrapT: 33071 // CLAMP_TO_EDGE
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
