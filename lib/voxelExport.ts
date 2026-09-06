import { keyOf, type Voxel, type VoxelVolume } from "@/lib/voxelEngine";

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

function hexRgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "").padStart(6, "0").slice(0, 6);
  const n = parseInt(raw, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function readI32(view: DataView, offset: number) {
  return view.getInt32(offset, true);
}

export function exportVox(volume: VoxelVolume, palette: string[]) {
  const voxels = volume.voxels();
  const xyzi = new Uint8Array(4 + voxels.length * 4);
  new DataView(xyzi.buffer).setUint32(0, voxels.length, true);
  voxels.forEach((v, i) => {
    const o = 4 + i * 4;
    xyzi[o] = v.x;
    xyzi[o + 1] = v.z;
    xyzi[o + 2] = v.y;
    xyzi[o + 3] = Math.min(255, v.c + 1);
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

  const size = concat([u32(volume.size), u32(volume.size), u32(volume.size)]);
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
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== "VOX ") throw new Error("Not a VOX file");

  let sizeX = 1;
  let sizeY = 1;
  let sizeZ = 1;
  let voxels: Voxel[] = [];
  const palette = Array.from({ length: 256 }, () => "#000000");
  let hasPalette = false;

  const walk = (offset: number, end: number) => {
    let o = offset;
    while (o + 12 <= end) {
      const id = String.fromCharCode(
        bytes[o],
        bytes[o + 1],
        bytes[o + 2],
        bytes[o + 3]
      );
      const content = readI32(view, o + 4);
      const children = readI32(view, o + 8);
      const contentStart = o + 12;
      const contentEnd = contentStart + content;
      const childEnd = contentEnd + children;

      if (id === "SIZE") {
        sizeX = readI32(view, contentStart);
        sizeZ = readI32(view, contentStart + 4);
        sizeY = readI32(view, contentStart + 8);
      } else if (id === "XYZI") {
        const n = readI32(view, contentStart);
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
      } else if (id === "RGBA") {
        hasPalette = true;
        for (let i = 0; i < 256; i++) {
          const p = contentStart + i * 4;
          palette[i] = rgbHex(bytes[p], bytes[p + 1], bytes[p + 2]);
        }
      } else if (id === "MAIN" && children > 0) {
        walk(contentEnd, childEnd);
      }

      if (children > 0 && id !== "MAIN") walk(contentEnd, childEnd);
      o = childEnd;
    }
  };

  walk(8, bytes.length);

  const need = Math.max(sizeX, sizeY, sizeZ, 1);
  const size = [32, 64, 128, 256].find((n) => n >= need) ?? Math.max(need, 32);

  return {
    size,
    voxels: voxels.filter((v) => v.x < size && v.y < size && v.z < size),
    palette: hasPalette ? palette : palette
  };
}

type Face = {
  d: 0 | 1 | 2;
  s: 1 | -1;
  x: number;
  y: number;
  z: number;
  c: number;
};

export function exportObj(volume: VoxelVolume, palette: string[]) {
  const map = volume.raw();
  const has = (x: number, y: number, z: number) => map.has(keyOf(x, y, z));
  const byColor = new Map<number, Face[]>();

  for (const [key, c] of map) {
    const [x, y, z] = key.split(":").map(Number);
    const list = byColor.get(c) ?? [];
    if (!has(x - 1, y, z)) list.push({ d: 0, s: -1, x, y, z, c });
    if (!has(x + 1, y, z)) list.push({ d: 0, s: 1, x, y, z, c });
    if (!has(x, y - 1, z)) list.push({ d: 1, s: -1, x, y, z, c });
    if (!has(x, y + 1, z)) list.push({ d: 1, s: 1, x, y, z, c });
    if (!has(x, y, z - 1)) list.push({ d: 2, s: -1, x, y, z, c });
    if (!has(x, y, z + 1)) list.push({ d: 2, s: 1, x, y, z, c });
    byColor.set(c, list);
  }

  const lines = ["# voxel editor", "mtllib model.mtl"];
  let vi = 1;

  const emit = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number]
  ) => {
    for (const p of [a, b, c, d]) lines.push(`v ${p[0]} ${p[1]} ${p[2]}`);
    lines.push(`f ${vi} ${vi + 1} ${vi + 2} ${vi + 3}`);
    vi += 4;
  };

  for (const [colorIndex, faces] of byColor) {
    lines.push(`usemtl c${colorIndex}`);
    for (const face of faces) {
      const { x, y, z, s, d } = face;
      if (d === 0) {
        const px = x + (s === 1 ? 1 : 0);
        const q: [number, number, number][] = [
          [px, y, z],
          [px, y + 1, z],
          [px, y + 1, z + 1],
          [px, y, z + 1]
        ];
        if (s === -1) q.reverse();
        emit(q[0], q[1], q[2], q[3]);
      } else if (d === 1) {
        const py = y + (s === 1 ? 1 : 0);
        const q: [number, number, number][] = [
          [x, py, z],
          [x, py, z + 1],
          [x + 1, py, z + 1],
          [x + 1, py, z]
        ];
        if (s === -1) q.reverse();
        emit(q[0], q[1], q[2], q[3]);
      } else {
        const pz = z + (s === 1 ? 1 : 0);
        const q: [number, number, number][] = [
          [x, y, pz],
          [x + 1, y, pz],
          [x + 1, y + 1, pz],
          [x, y + 1, pz]
        ];
        if (s === -1) q.reverse();
        emit(q[0], q[1], q[2], q[3]);
      }
    }
  }

  const mtl = palette
    .map((hex, i) => {
      const [r, g, b] = hexRgb(hex);
      return `newmtl c${i}\nKd ${(r / 255).toFixed(4)} ${(g / 255).toFixed(4)} ${(b / 255).toFixed(4)}\nillum 1\n`;
    })
    .join("");

  return { obj: `${lines.join("\n")}\n`, mtl };
}

export function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, name: string, type: string) {
  downloadBytes(new TextEncoder().encode(text), name, type);
}
