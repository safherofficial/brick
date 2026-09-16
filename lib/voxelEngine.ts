export type Tool =
  | "attach"
  | "erase"
  | "paint"
  | "fill"
  | "eyedrop"
  | "select"
  | "box";

export type BoxMode = "fill" | "erase" | "select";
export type ViewMode = "iso" | "top" | "front" | "side";

export type Voxel = { x: number; y: number; z: number; c: number };
export type Cell = { x: number; y: number; z: number };

export type Mirror = { x: boolean; y: boolean; z: boolean };

export type Delta = {
  key: string;
  from: number | null;
  to: number | null;
};

export const MAX_SAFE = 150_000;
export const HISTORY_LIMIT = 80;
export const SIZES = [32, 64, 128, 256] as const;
export const DRAFT_KEY = "voxel-editor-draft-v1";

export function keyOf(x: number, y: number, z: number) {
  return `${x}:${y}:${z}`;
}

export function parseKey(key: string): Cell {
  const [x, y, z] = key.split(":").map(Number);
  return { x, y, z };
}

export function cellKey(cell: Cell) {
  return keyOf(cell.x, cell.y, cell.z);
}

export const DEFAULT_PALETTE: string[] = [
  "#2b2b2b", "#ffffff", "#b0b0b0", "#7a7a7a", "#4a4a4a", "#1a1a1a",
  "#c91f2d", "#e35b19", "#f6b800", "#f2d64b", "#168b4b", "#53b84a",
  "#0877b9", "#2e58b8", "#6b42a8", "#d84c9b", "#7b3fe4", "#2fe0c0",
  "#f35e9e", "#8fe457", "#f5993d", "#2fb8e8", "#4c6fef", "#f4a0c4",
  "#7fe7ff", "#f6d0a8", "#3aa0ff", "#f3e07a", "#111827", "#f2f0e8",
  "#7f1d1d", "#9a3412", "#854d0e", "#365314", "#064e3b", "#164e63",
  "#1e3a8a", "#4c1d95", "#831843", "#881337", "#0f172a", "#44506b",
  "#94a3b8", "#e2e8f0", "#f97316", "#84cc16", "#14b8a6", "#6366f1",
  "#a855f7", "#fb7185", "#facc15", "#22c55e", "#06b6d4", "#3b82f6",
  "#8b5cf6", "#ec4899", "#78716c", "#d6d3d1", "#44403c", "#0c0a09",
  "#7c2d12", "#365314", "#1e293b", "#312e81"
];

export function clonePalette(palette = DEFAULT_PALETTE) {
  const next = palette.slice(0, 256);
  while (next.length < 256) next.push("#000000");
  return next;
}

export class VoxelVolume {
  size: number;
  private map = new Map<string, number>();

  constructor(size = 64) {
    this.size = size;
  }

  get count() {
    return this.map.size;
  }

  inBounds(x: number, y: number, z: number) {
    return (
      x >= 0 &&
      y >= 0 &&
      z >= 0 &&
      x < this.size &&
      y < this.size &&
      z < this.size
    );
  }

  has(x: number, y: number, z: number) {
    return this.map.has(keyOf(x, y, z));
  }

  get(x: number, y: number, z: number) {
    return this.map.get(keyOf(x, y, z));
  }

  raw() {
    return this.map;
  }

  clear() {
    this.map.clear();
  }

  resize(size: number) {
    this.size = size;
    for (const key of [...this.map.keys()]) {
      const { x, y, z } = parseKey(key);
      if (!this.inBounds(x, y, z)) this.map.delete(key);
    }
  }

  apply(x: number, y: number, z: number, color: number | null): Delta | null {
    if (!this.inBounds(x, y, z)) return null;
    const key = keyOf(x, y, z);
    const from = this.map.has(key) ? this.map.get(key)! : null;
    const to = color;
    if (from === to) return null;
    if (to === null) this.map.delete(key);
    else this.map.set(key, to);
    return { key, from, to };
  }

  revert(delta: Delta) {
    if (delta.from === null) this.map.delete(delta.key);
    else this.map.set(delta.key, delta.from);
  }

  commit(delta: Delta) {
    if (delta.to === null) this.map.delete(delta.key);
    else this.map.set(delta.key, delta.to);
  }

  voxels(): Voxel[] {
    const out: Voxel[] = [];
    for (const [key, c] of this.map) {
      const { x, y, z } = parseKey(key);
      out.push({ x, y, z, c });
    }
    return out;
  }

  groups(): Map<number, Cell[]> {
    const grouped = new Map<number, Cell[]>();
    for (const [key, c] of this.map) {
      const list = grouped.get(c) ?? [];
      list.push(parseKey(key));
      grouped.set(c, list);
    }
    return grouped;
  }

  serialize(): { size: number; voxels: Voxel[] } {
    return { size: this.size, voxels: this.voxels() };
  }

  load(data: { size: number; voxels: Voxel[] }) {
    this.size = data.size;
    this.map.clear();
    for (const v of data.voxels) {
      if (this.inBounds(v.x, v.y, v.z)) this.map.set(keyOf(v.x, v.y, v.z), v.c);
    }
  }
}

export function mirrorCells(cell: Cell, size: number, mirror: Mirror): Cell[] {
  const last = size - 1;
  const xs = mirror.x ? [cell.x, last - cell.x] : [cell.x];
  const ys = mirror.y ? [cell.y, last - cell.y] : [cell.y];
  const zs = mirror.z ? [cell.z, last - cell.z] : [cell.z];
  const seen = new Set<string>();
  const out: Cell[] = [];
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        const key = keyOf(x, y, z);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ x, y, z });
      }
    }
  }
  return out;
}

export function boxCells(a: Cell, b: Cell): Cell[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const z0 = Math.min(a.z, b.z);
  const z1 = Math.max(a.z, b.z);
  const out: Cell[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) out.push({ x, y, z });
    }
  }
  return out;
}

const NEIGHBORS: Cell[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 }
];

export function floodCells(volume: VoxelVolume, start: Cell): Cell[] {
  const color = volume.get(start.x, start.y, start.z);
  if (color === undefined) return [];
  const startKey = cellKey(start);
  const seen = new Set<string>([startKey]);
  const queue: Cell[] = [start];
  const out: Cell[] = [start];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const n of NEIGHBORS) {
      const next = { x: cur.x + n.x, y: cur.y + n.y, z: cur.z + n.z };
      if (!volume.inBounds(next.x, next.y, next.z)) continue;
      const key = cellKey(next);
      if (seen.has(key)) continue;
      if (volume.get(next.x, next.y, next.z) !== color) continue;
      seen.add(key);
      queue.push(next);
      out.push(next);
    }
  }
  return out;
}

export function hollowCells(volume: VoxelVolume): Cell[] {
  const doomed: Cell[] = [];
  for (const [key] of volume.raw()) {
    const cell = parseKey(key);
    const buried = NEIGHBORS.every((n) =>
      volume.has(cell.x + n.x, cell.y + n.y, cell.z + n.z)
    );
    if (buried) doomed.push(cell);
  }
  return doomed;
}

export function applyCells(
  volume: VoxelVolume,
  cells: Cell[],
  color: number | null,
  mirror: Mirror
): Delta[] {
  const deltas: Delta[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    for (const mirrored of mirrorCells(cell, volume.size, mirror)) {
      const key = cellKey(mirrored);
      if (seen.has(key)) continue;
      seen.add(key);
      const delta = volume.apply(mirrored.x, mirrored.y, mirrored.z, color);
      if (delta) deltas.push(delta);
    }
  }
  return deltas;
}

export class History {
  private past: Delta[][] = [];
  private future: Delta[][] = [];

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  push(stroke: Delta[]) {
    if (!stroke.length) return;
    this.past.push(stroke);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
  }

  undo(volume: VoxelVolume) {
    const stroke = this.past.pop();
    if (!stroke) return;
    for (let i = stroke.length - 1; i >= 0; i--) volume.revert(stroke[i]);
    this.future.push(stroke);
  }

  redo(volume: VoxelVolume) {
    const stroke = this.future.pop();
    if (!stroke) return;
    for (const delta of stroke) volume.commit(delta);
    this.past.push(stroke);
  }

  reset() {
    this.past.length = 0;
    this.future.length = 0;
  }
}

export type DraftV1 = {
  v: 1;
  title: string;
  size: number;
  palette: string[];
  voxels: Voxel[];
};

export function loadDraft(): DraftV1 | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DraftV1;
    if (parsed.v !== 1 || !Array.isArray(parsed.voxels)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(draft: DraftV1) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // quota
  }
}

export function dominantNormal(nx: number, ny: number, nz: number): Cell {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ax >= ay && ax >= az) return { x: Math.sign(nx) || 1, y: 0, z: 0 };
  if (ay >= ax && ay >= az) return { x: 0, y: Math.sign(ny) || 1, z: 0 };
  return { x: 0, y: 0, z: Math.sign(nz) || 1 };
}

export function volumeCenter(size: number): [number, number, number] {
  const c = (size - 1) / 2;
  return [c, c * 0.35, c];
}
export function brushCells(center: Cell, brush: number): Cell[] {
  const r = Math.max(0, brush - 1);
  const out: Cell[] = [];
  for (let x = center.x - r; x <= center.x + r; x++) {
    for (let y = center.y - r; y <= center.y + r; y++) {
      for (let z = center.z - r; z <= center.z + r; z++) {
        out.push({ x, y, z });
      }
    }
  }
  return out;
}

export type ClipboardVoxel = { dx: number; dy: number; dz: number; c: number };

export function selectionClipboard(
  volume: VoxelVolume,
  keys: Iterable<string>
): ClipboardVoxel[] {
  const cells = [...keys].map(parseKey);
  if (!cells.length) return [];
  const ox = Math.min(...cells.map((c) => c.x));
  const oy = Math.min(...cells.map((c) => c.y));
  const oz = Math.min(...cells.map((c) => c.z));
  return cells.map((cell) => ({
    dx: cell.x - ox,
    dy: cell.y - oy,
    dz: cell.z - oz,
    c: volume.get(cell.x, cell.y, cell.z) ?? 0
  }));
}

export type ProjectV2 = DraftV1 & { v: 1 | 2 };

export function projectFromVolume(
  title: string,
  volume: VoxelVolume,
  palette: string[]
): DraftV1 {
  return {
    v: 1,
    title,
    size: volume.size,
    palette,
    voxels: volume.voxels()
  };
}
