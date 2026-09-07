import { keyOf, type VoxelVolume } from "@/lib/voxelEngine";

export type Pivot = "bottom-center" | "center" | "origin";
export type UpAxis = "y" | "z";

export type MeshExportOptions = {
  unitMeters?: number;
  pivot?: Pivot;
  upAxis?: UpAxis;
  name?: string;
};

export type ResolvedExport = {
  unitMeters: number;
  pivot: Pivot;
  upAxis: UpAxis;
  name: string;
};

export type Bounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type GreedyQuad = {
  c: number;
  axis: 0 | 1 | 2;
  dir: 1 | -1;
  slice: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
};

export function assetSlug(title: string) {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

export function resolveExport(options?: MeshExportOptions): ResolvedExport {
  return {
    unitMeters: options?.unitMeters ?? 0.1,
    pivot: options?.pivot ?? "bottom-center",
    upAxis: options?.upAxis ?? "y",
    name: assetSlug(options?.name ?? "model")
  };
}

export function boundsOf(volume: VoxelVolume): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const key of volume.raw().keys()) {
    const [x, y, z] = key.split(":").map(Number);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function assertExportable(volume: VoxelVolume) {
  if (!volume.count) throw new Error("Empty volume");
  const bounds = boundsOf(volume);
  if (!bounds) throw new Error("Empty volume");
  return bounds;
}

function colorAt(volume: VoxelVolume, x: number, y: number, z: number) {
  if (!volume.inBounds(x, y, z)) return undefined;
  return volume.get(x, y, z);
}

export function greedyQuads(volume: VoxelVolume): GreedyQuad[] {
  const bounds = boundsOf(volume);
  if (!bounds) return [];

  const quads: GreedyQuad[] = [];
  const min = [bounds.minX, bounds.minY, bounds.minZ];
  const max = [bounds.maxX, bounds.maxY, bounds.maxZ];

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const u0 = min[u];
    const v0 = min[v];
    const u1 = max[u];
    const v1 = max[v];
    const w0 = min[axis];
    const w1 = max[axis];
    const du = u1 - u0 + 1;
    const dv = v1 - v0 + 1;

    for (let slice = w0; slice <= w1; slice++) {
      for (const dir of [1, -1] as const) {
        const mask = new Int16Array(du * dv);
        mask.fill(-1);

        for (let i = 0; i < du; i++) {
          for (let j = 0; j < dv; j++) {
            const pos = [0, 0, 0];
            pos[u] = u0 + i;
            pos[v] = v0 + j;
            pos[axis] = slice;
            const here = colorAt(volume, pos[0], pos[1], pos[2]);
            if (here === undefined) continue;
            const npos = [pos[0], pos[1], pos[2]];
            npos[axis] += dir;
            if (colorAt(volume, npos[0], npos[1], npos[2]) === undefined) {
              mask[i + j * du] = here;
            }
          }
        }

        const used = new Uint8Array(du * dv);
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du; i++) {
            const idx = i + j * du;
            const c = mask[idx];
            if (c < 0 || used[idx]) continue;
            let w = 1;
            while (i + w < du && mask[idx + w] === c && !used[idx + w]) w++;
            let h = 1;
            grow: while (j + h < dv) {
              for (let k = 0; k < w; k++) {
                const p = i + k + (j + h) * du;
                if (mask[p] !== c || used[p]) break grow;
              }
              h++;
            }
            for (let jj = 0; jj < h; jj++) {
              for (let ii = 0; ii < w; ii++) used[i + ii + (j + jj) * du] = 1;
            }
            quads.push({
              c,
              axis: axis as 0 | 1 | 2,
              dir,
              slice,
              u0: u0 + i,
              v0: v0 + j,
              u1: u0 + i + w,
              v1: v0 + j + h
            });
          }
        }
      }
    }
  }

  return quads;
}

export function pivotOrigin(bounds: Bounds, pivot: Pivot): [number, number, number] {
  if (pivot === "origin") return [0, 0, 0];
  const cx = (bounds.minX + bounds.maxX + 1) / 2;
  const cz = (bounds.minZ + bounds.maxZ + 1) / 2;
  if (pivot === "center") return [cx, (bounds.minY + bounds.maxY + 1) / 2, cz];
  return [cx, bounds.minY, cz];
}

export function transformPoint(
  x: number,
  y: number,
  z: number,
  origin: [number, number, number],
  scale: number,
  upAxis: UpAxis
): [number, number, number] {
  const px = (x - origin[0]) * scale;
  const py = (y - origin[1]) * scale;
  const pz = (z - origin[2]) * scale;
  return upAxis === "z" ? [px, pz, py] : [px, py, pz];
}

export function transformNormal(
  nx: number,
  ny: number,
  nz: number,
  upAxis: UpAxis
): [number, number, number] {
  return upAxis === "z" ? [nx, nz, ny] : [nx, ny, nz];
}

export function quadCorners(quad: GreedyQuad): [
  [number, number, number],
  [number, number, number],
  [number, number, number],
  [number, number, number]
] {
  const u = (quad.axis + 1) % 3;
  const v = (quad.axis + 2) % 3;
  const w = quad.axis;
  const plane = quad.slice + (quad.dir === 1 ? 1 : 0);
  const at = (iu: number, iv: number): [number, number, number] => {
    const p: [number, number, number] = [0, 0, 0];
    p[u] = iu;
    p[v] = iv;
    p[w] = plane;
    return p;
  };
  const a = at(quad.u0, quad.v0);
  const b = at(quad.u1, quad.v0);
  const c = at(quad.u1, quad.v1);
  const d = at(quad.u0, quad.v1);
  return quad.dir === 1 ? [a, b, c, d] : [a, d, c, b];
}

export function quadNormal(quad: GreedyQuad): [number, number, number] {
  const n: [number, number, number] = [0, 0, 0];
  n[quad.axis] = quad.dir;
  return n;
}

export function hexRgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "").padStart(6, "0").slice(0, 6);
  const n = parseInt(raw, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function occupied(volume: VoxelVolume, x: number, y: number, z: number) {
  return volume.raw().has(keyOf(x, y, z));
}
