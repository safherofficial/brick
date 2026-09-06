import { keyOf, type VoxelVolume } from "@/lib/voxelEngine";

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
    const hex = palette[i] ?? "#000000";
    const n = parseInt(hex.slice(1), 16);
    const o = i * 4;
    rgba[o] = (n >> 16) & 255;
    rgba[o + 1] = (n >> 8) & 255;
    rgba[o + 2] = n & 255;
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

type Face = { d: 0 | 1 | 2; s: 1 | -1; x: number; y: number; z: number; c: number };

function hexToFaceColor(hex: string) {
  return hex.replace("#", "").toLowerCase();
}

export function exportObj(volume: VoxelVolume, palette: string[]) {
  const faces: Face[] = [];
  const map = volume.raw();
  const has = (x: number, y: number, z: number) => map.has(keyOf(x, y, z));

  for (const [key, c] of map) {
    const [x, y, z] = key.split(":").map(Number);
    if (!has(x - 1, y, z)) faces.push({ d: 0, s: -1, x, y, z, c });
    if (!has(x + 1, y, z)) faces.push({ d: 0, s: 1, x, y, z, c });
    if (!has(x, y - 1, z)) faces.push({ d: 1, s: -1, x, y, z, c });
    if (!has(x, y + 1, z)) faces.push({ d: 1, s: 1, x, y, z, c });
    if (!has(x, y, z - 1)) faces.push({ d: 2, s: -1, x, y, z, c });
    if (!has(x, y, z + 1)) faces.push({ d: 2, s: 1, x, y, z, c });
  }

  const verts: string[] = [];
  const fcs: string[] = [];
  let vi = 1;

  const pushQuad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number]
  ) => {
    for (const p of [a, b, c, d]) verts.push(`v ${p[0]} ${p[1]} ${p[2]}`);
    fcs.push(`f ${vi} ${vi + 1} ${vi + 2} ${vi + 3}`);
    vi += 4;
  };

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
      pushQuad(q[0], q[1], q[2], q[3]);
    } else if (d === 1) {
      const py = y + (s === 1 ? 1 : 0);
      const q: [number, number, number][] = [
        [x, py, z],
        [x, py, z + 1],
        [x + 1, py, z + 1],
        [x + 1, py, z]
      ];
      if (s === -1) q.reverse();
      pushQuad(q[0], q[1], q[2], q[3]);
    } else {
      const pz = z + (s === 1 ? 1 : 0);
      const q: [number, number, number][] = [
        [x, y, pz],
        [x + 1, y, pz],
        [x + 1, y + 1, pz],
        [x, y + 1, pz]
      ];
      if (s === -1) q.reverse();
      pushQuad(q[0], q[1], q[2], q[3]);
    }
    fcs.push(`usemtl c${face.c}`);
  }

  const mtls = palette
    .map((hex, i) => {
      const n = parseInt(hex.slice(1), 16);
      const r = ((n >> 16) & 255) / 255;
      const g = ((n >> 8) & 255) / 255;
      const b = (n & 255) / 255;
      return `newmtl c${i}\nKd ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}\n`;
    })
    .join("");

  const obj = `# voxel editor\nmtllib model.mtl\n${verts.join("\n")}\n${fcs.join("\n")}\n`;
  return { obj, mtl: mtls, paletteHint: hexToFaceColor(palette[0] ?? "#000") };
}

export function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const blob = new Blob([bytes], { type });
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
