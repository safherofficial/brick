import type { ImageVoxel } from "@/lib/imageVoxel";

function key(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function xyKey(x: number, y: number) {
  return `${x}:${y}`;
}

export function fillColumnGaps(voxels: ImageVoxel[]): ImageVoxel[] {
  if (voxels.length < 2) return voxels;
  const map = new Map(voxels.map((v) => [key(v.x, v.y, v.z), v]));
  const columns = new Map<string, ImageVoxel[]>();
  for (const v of voxels) {
    const id = xyKey(v.x, v.y);
    const list = columns.get(id) ?? [];
    list.push(v);
    columns.set(id, list);
  }
  for (const list of columns.values()) {
    list.sort((a, b) => a.z - b.z);
    for (let i = 0; i < list.length - 1; i += 1) {
      const a = list[i];
      const b = list[i + 1];
      if (b.z - a.z !== 2) continue;
      const z = a.z + 1;
      const id = key(a.x, a.y, z);
      if (map.has(id)) continue;
      map.set(id, { x: a.x, y: a.y, z, c: a.c });
    }
  }
  return [...map.values()];
}

export function mergeTinyColorRegions(voxels: ImageVoxel[], minSize = 6): ImageVoxel[] {
  if (voxels.length < minSize) return voxels;
  const byColor = new Map<number, ImageVoxel[]>();
  for (const v of voxels) {
    const list = byColor.get(v.c) ?? [];
    list.push(v);
    byColor.set(v.c, list);
  }
  const occupied = new Map(voxels.map((v) => [key(v.x, v.y, v.z), v]));
  const out = voxels.map((v) => ({ ...v }));
  const index = new Map(out.map((v) => [key(v.x, v.y, v.z), v]));

  for (const [color, list] of byColor) {
    if (list.length >= minSize) continue;
    for (const v of list) {
      const votes = new Map<number, number>();
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1]
      ]) {
        const hit = occupied.get(key(v.x + dx, v.y + dy, v.z + dz));
        if (!hit || hit.c === color) continue;
        votes.set(hit.c, (votes.get(hit.c) ?? 0) + 1);
      }
      let best = color;
      let bestN = 0;
      for (const [c, n] of votes) {
        if (n > bestN) {
          best = c;
          bestN = n;
        }
      }
      const target = index.get(key(v.x, v.y, v.z));
      if (target) target.c = best;
    }
  }
  return out;
}

export function dropSpikes(voxels: ImageVoxel[]): ImageVoxel[] {
  if (voxels.length < 4) return voxels;
  const occupied = new Set(voxels.map((v) => key(v.x, v.y, v.z)));
  const kept = voxels.filter((v) => {
    let face = 0;
    if (occupied.has(key(v.x + 1, v.y, v.z))) face += 1;
    if (occupied.has(key(v.x - 1, v.y, v.z))) face += 1;
    if (occupied.has(key(v.x, v.y + 1, v.z))) face += 1;
    if (occupied.has(key(v.x, v.y - 1, v.z))) face += 1;
    if (occupied.has(key(v.x, v.y, v.z + 1))) face += 1;
    if (occupied.has(key(v.x, v.y, v.z - 1))) face += 1;
    return face >= 1;
  });
  return kept.length ? kept : voxels;
}

export function lintVoxels(voxels: ImageVoxel[]): ImageVoxel[] {
  return mergeTinyColorRegions(dropSpikes(fillColumnGaps(voxels)));
}
