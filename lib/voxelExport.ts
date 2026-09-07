import {
  DEFAULT_PALETTE,
  SIZES,
  type Voxel,
  type VoxelVolume
} from "@/lib/voxelEngine";
import {
  assertExportable,
  assetSlug,
  greedyQuads,
  hexRgb,
  pivotOrigin,
  quadCorners,
  quadNormal,
  resolveExport,
  rgbHex,
  transformNormal,
  transformPoint,
  type MeshExportOptions
} from "@/lib/voxelMesh";

function u16(n: number) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n & 0xffff, true);
  return b;
}

function u32(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function concat(parts: Uint8Array[]) {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function chunk(id: string, content: Uint8Array, children: Uint8Array[] = []) {
  const child = concat(children);
  return concat([
    new TextEncoder().encode(id.padEnd(4, " ")).slice(0, 4),
    u32(content.length),
    u32(child.length),
    content,
    child
  ]);
}

function readI32(view: DataView, offset: number, end: number) {
  if (offset + 4 > end) throw new Error("Truncated VOX file");
  return view.getInt32(offset, true);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1 ? 0xedb88320 : 0) ^ (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Uint8Array }[]) {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.name.replace(/\\/g, "/"));
    const crc = crc32(file.data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data
    ]);
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const directory = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(directory.length),
    u32(offset),
    u16(0)
  ]);
  return concat([...locals, directory, end]);
}

export function exportVox(volume: VoxelVolume, palette: string[]) {
  const bounds = assertExportable(volume);
  const sizeX = bounds.maxX - bounds.minX + 1;
  const sizeY = bounds.maxY - bounds.minY + 1;
  const sizeZ = bounds.maxZ - bounds.minZ + 1;
  if (sizeX > 256 || sizeY > 256 || sizeZ > 256) {
    throw new Error("VOX is limited to 256^3");
  }

  const voxels = volume.voxels();
  const xyzi = new Uint8Array(4 + voxels.length * 4);
  new DataView(xyzi.buffer).setUint32(0, voxels.length, true);
  voxels.forEach((v, i) => {
    const o = 4 + i * 4;
    xyzi[o] = v.x - bounds.minX;
    xyzi[o + 1] = v.z - bounds.minZ;
    xyzi[o + 2] = v.y - bounds.minY;
    xyzi[o + 3] = Math.min(255, Math.max(1, (v.c | 0) + 1));
  });

  const rgba = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = hexRgb(palette[i] ?? "#000000");
    const o = i * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  }

  const size = concat([u32(sizeX), u32(sizeZ), u32(sizeY)]);
  const main = chunk("MAIN", new Uint8Array(), [
    chunk("SIZE", size),
    chunk("XYZI", xyzi),
    chunk("RGBA", rgba)
  ]);

  return concat([new TextEncoder().encode("VOX "), u32(150), main]);
}

export type VoxModel = {
  size: number;
  voxels: Voxel[];
  palette: string[];
};

export function importVox(buffer: ArrayBuffer): VoxModel {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const end = bytes.length;
  if (end < 8) throw new Error("Not a VOX file");
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== "VOX ") throw new Error("Not a VOX file");

  let sizeX = 1;
  let sizeY = 1;
  let sizeZ = 1;
  let voxels: Voxel[] = [];
  const palette = DEFAULT_PALETTE.slice(0, 256);
  while (palette.length < 256) palette.push("#000000");
  let hasPalette = false;

  const walk = (offset: number, limit: number) => {
    let o = offset;
    while (o + 12 <= limit) {
      const id = String.fromCharCode(
        bytes[o],
        bytes[o + 1],
        bytes[o + 2],
        bytes[o + 3]
      );
      const content = readI32(view, o + 4, limit);
      const children = readI32(view, o + 8, limit);
      if (content < 0 || children < 0) throw new Error("Invalid VOX chunk");
      const contentStart = o + 12;
      const contentEnd = contentStart + content;
      const childEnd = contentEnd + children;
      if (contentEnd > limit || childEnd > limit) {
        throw new Error("Truncated VOX chunk");
      }

      if (id === "SIZE" && content >= 12) {
        sizeX = readI32(view, contentStart, contentEnd);
        sizeZ = readI32(view, contentStart + 4, contentEnd);
        sizeY = readI32(view, contentStart + 8, contentEnd);
      } else if (id === "XYZI" && content >= 4) {
        const n = readI32(view, contentStart, contentEnd);
        if (n < 0 || contentStart + 4 + n * 4 > contentEnd) {
          throw new Error("Invalid VOX XYZI");
        }
        voxels = [];
        for (let i = 0; i < n; i++) {
          const p = contentStart + 4 + i * 4;
          voxels.push({
            x: bytes[p],
            z: bytes[p + 1],
            y: bytes[p + 2],
            c: Math.max(0, bytes[p + 3] - 1)
          });
        }
      } else if (id === "RGBA" && content >= 256 * 4) {
        hasPalette = true;
        for (let i = 0; i < 256; i++) {
          const p = contentStart + i * 4;
          palette[i] = rgbHex(bytes[p], bytes[p + 1], bytes[p + 2]);
        }
      }

      if (children > 0) walk(contentEnd, childEnd);
      o = childEnd;
    }
  };

  walk(8, end);

  const need = Math.max(sizeX, sizeY, sizeZ, 1);
  const size = SIZES.find((n) => n >= need) ?? 256;
  return {
    size,
    voxels: voxels.filter(
      (v) =>
        v.x >= 0 &&
        v.y >= 0 &&
        v.z >= 0 &&
        v.x < size &&
        v.y < size &&
        v.z < size
    ),
    palette: hasPalette ? palette : palette
  };
}

export function exportObj(
  volume: VoxelVolume,
  palette: string[],
  options?: MeshExportOptions
) {
  const bounds = assertExportable(volume);
  const resolved = resolveExport(options);
  const origin = pivotOrigin(bounds, resolved.pivot);
  const quads = greedyQuads(volume);
  const used = new Set(quads.map((q) => q.c));

  const lines = [
    "# Brick Builder",
    `# unit: ${resolved.unitMeters} meters per voxel`,
    `# pivot: ${resolved.pivot}`,
    `# up: ${resolved.upAxis}`,
    `mtllib ${resolved.name}.mtl`,
    `o ${resolved.name}`
  ];

  const mtl = [
    "# Brick Builder materials",
    ...[...used]
      .sort((a, b) => a - b)
      .map((i) => {
        const [r, g, b] = hexRgb(palette[i] ?? "#ffffff");
        const kd = `${(r / 255).toFixed(6)} ${(g / 255).toFixed(6)} ${(b / 255).toFixed(6)}`;
        return [
          `newmtl voxel_${i}`,
          "Ka 0.020000 0.020000 0.020000",
          `Kd ${kd}`,
          "Ks 0.040000 0.040000 0.040000",
          "Ns 8.000000",
          "illum 2"
        ].join("\n");
      })
  ].join("\n\n");

  let vi = 1;
  let ni = 1;
  const byColor = new Map<number, typeof quads>();
  for (const quad of quads) {
    const list = byColor.get(quad.c) ?? [];
    list.push(quad);
    byColor.set(quad.c, list);
  }

  for (const [colorIndex, faces] of [...byColor.entries()].sort(
    (a, b) => a[0] - b[0]
  )) {
    lines.push(`g ${resolved.name}_voxel_${colorIndex}`);
    lines.push(`usemtl voxel_${colorIndex}`);
    for (const face of faces) {
      const corners = quadCorners(face);
      const n = transformNormal(...quadNormal(face), resolved.upAxis);
      lines.push(`vn ${n[0]} ${n[1]} ${n[2]}`);
      for (const corner of corners) {
        const p = transformPoint(
          corner[0],
          corner[1],
          corner[2],
          origin,
          resolved.unitMeters,
          resolved.upAxis
        );
        lines.push(`v ${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}`);
      }
      lines.push(
        `f ${vi}//${ni} ${vi + 1}//${ni} ${vi + 2}//${ni}`,
        `f ${vi}//${ni} ${vi + 2}//${ni} ${vi + 3}//${ni}`
      );
      vi += 4;
      ni += 1;
    }
  }

  return {
    obj: `${lines.join("\n")}\n`,
    mtl: `${mtl}\n`,
    name: resolved.name
  };
}

export function exportObjArchive(
  volume: VoxelVolume,
  palette: string[],
  options?: MeshExportOptions
) {
  const { obj, mtl, name } = exportObj(volume, palette, options);
  const enc = new TextEncoder();
  return zipStore([
    { name: `${name}.obj`, data: enc.encode(obj) },
    { name: `${name}.mtl`, data: enc.encode(mtl) }
  ]);
}

export function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, name: string, type: string) {
  downloadBytes(new TextEncoder().encode(text), name, type);
}

export function downloadAssetName(title: string) {
  return assetSlug(title);
}
