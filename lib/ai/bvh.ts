import type { ImageVoxel } from "@/lib/imageVoxel";

function key(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function xy(x: number, y: number) {
  return `${x}:${y}`;
}

export function spatialCleanVoxels(voxels: ImageVoxel[]): ImageVoxel[] {
  if (voxels.length < 3) return voxels;
  const occupied = new Set(voxels.map((v) => key(v.x, v.y, v.z)));
  const kept: ImageVoxel[] = [];
  for (const v of voxels) {
    let neighbors = 0;
    let faceNeighbors = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          if (!occupied.has(key(v.x + dx, v.y + dy, v.z + dz))) continue;
          neighbors += 1;
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1) faceNeighbors += 1;
        }
      }
    }
    if (faceNeighbors >= 1 || neighbors >= 2) kept.push(v);
  }
  return kept.length ? kept : voxels;
}

export function thickenMinFeature(voxels: ImageVoxel[], minFeature: number): ImageVoxel[] {
  if (minFeature <= 1 || voxels.length < 2) return voxels;
  const map = new Map(voxels.map((v) => [key(v.x, v.y, v.z), v]));
  const extra: ImageVoxel[] = [];
  for (const v of voxels) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const id = key(v.x + dx, v.y + dy, v.z);
      if (map.has(id)) continue;
      const beyond = map.has(key(v.x + dx * 2, v.y + dy * 2, v.z));
      if (!beyond) continue;
      extra.push({ x: v.x + dx, y: v.y + dy, z: v.z, c: v.c });
    }
  }
  for (const v of extra) map.set(key(v.x, v.y, v.z), v);
  return [...map.values()];
}

export function outlineVoxels(voxels: ImageVoxel[], colorIndex: number): ImageVoxel[] {
  if (!voxels.length) return voxels;
  const cols = new Set(voxels.map((v) => xy(v.x, v.y)));
  const silhouette = (x: number, y: number) =>
    !cols.has(xy(x - 1, y)) ||
    !cols.has(xy(x + 1, y)) ||
    !cols.has(xy(x, y - 1)) ||
    !cols.has(xy(x, y + 1));

  const supported = (x: number, y: number) => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1]
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!cols.has(xy(nx, ny))) continue;
      if (!silhouette(nx, ny)) return true;
    }
    return false;
  };

  return voxels.map((v) => {
    if (!silhouette(v.x, v.y) || !supported(v.x, v.y)) return v;
    return { ...v, c: colorIndex };
  });
}
