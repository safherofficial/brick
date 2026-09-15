import type { ImageVoxel } from "@/lib/imageVoxel";

function key(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function boundsOf(voxels: ImageVoxel[]) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of voxels) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    minZ = Math.min(minZ, v.z);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    maxZ = Math.max(maxZ, v.z);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function isInterior(occupied: Set<string>, v: ImageVoxel) {
  return (
    occupied.has(key(v.x - 1, v.y, v.z)) &&
    occupied.has(key(v.x + 1, v.y, v.z)) &&
    occupied.has(key(v.x, v.y - 1, v.z)) &&
    occupied.has(key(v.x, v.y + 1, v.z)) &&
    occupied.has(key(v.x, v.y, v.z - 1)) &&
    occupied.has(key(v.x, v.y, v.z + 1))
  );
}

export function flattenColumnColors(voxels: ImageVoxel[]): ImageVoxel[] {
  if (voxels.length < 2) return voxels;
  const occupied = new Set(voxels.map((v) => key(v.x, v.y, v.z)));
  const columns = new Map<string, Map<number, number>>();
  for (const v of voxels) {
    if (!isInterior(occupied, v)) continue;
    const id = `${v.x}:${v.y}`;
    const votes = columns.get(id) ?? new Map<number, number>();
    votes.set(v.c, (votes.get(v.c) ?? 0) + 1);
    columns.set(id, votes);
  }
  const chosen = new Map<string, number>();
  for (const [id, votes] of columns) {
    let best = 0;
    let bestN = -1;
    let total = 0;
    for (const [c, n] of votes) {
      total += n;
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    }
    if (bestN / Math.max(1, total) >= 0.88) chosen.set(id, best);
  }
  return voxels.map((v) => {
    if (!isInterior(occupied, v)) return v;
    const next = chosen.get(`${v.x}:${v.y}`);
    return next === undefined ? v : { ...v, c: next };
  });
}

export function stabilizeBase(voxels: ImageVoxel[]): ImageVoxel[] {
  if (voxels.length < 4) return voxels;
  const ground = voxels.filter((v) => v.y === 0);
  if (ground.length >= 4) return voxels;
  const map = new Map(voxels.map((v) => [key(v.x, v.y, v.z), v]));
  for (const v of voxels) {
    if (v.y !== 1) continue;
    const id = key(v.x, 0, v.z);
    if (map.has(id)) continue;
    map.set(id, { x: v.x, y: 0, z: v.z, c: v.c });
  }
  return [...map.values()];
}

export function evenPack(voxels: ImageVoxel[], volumeSize: number): ImageVoxel[] {
  if (!voxels.length) return voxels;
  const b = boundsOf(voxels);
  let width = b.maxX - b.minX + 1;
  let depth = b.maxZ - b.minZ + 1;
  if (width % 2) width += 1;
  if (depth % 2) depth += 1;
  const pad = 1;
  width = Math.min(volumeSize, width + pad * 2);
  depth = Math.min(volumeSize, depth + pad * 2);
  const xOffset = Math.floor((volumeSize - width) / 2) - b.minX + pad;
  const zOffset = Math.floor((volumeSize - depth) / 2) - b.minZ + pad;
  return voxels.map((v) => ({
    x: Math.max(0, Math.min(volumeSize - 1, v.x + xOffset)),
    y: Math.max(0, Math.min(volumeSize - 1, v.y - b.minY)),
    z: Math.max(0, Math.min(volumeSize - 1, v.z + zOffset)),
    c: v.c
  }));
}

export function finishVoxels(voxels: ImageVoxel[], volumeSize: number): ImageVoxel[] {
  return evenPack(stabilizeBase(flattenColumnColors(voxels)), volumeSize);
}
