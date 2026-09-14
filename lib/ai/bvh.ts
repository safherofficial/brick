// lib/ai/bvh.ts
import type { ImageVoxel } from "@/lib/imageVoxel";

function key(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
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

export function outlineVoxels(voxels: ImageVoxel[], colorIndex: number): ImageVoxel[] {
  if (!voxels.length) return voxels;
  const occupied = new Set(voxels.map((v) => key(v.x, v.y, v.z)));
  const extra: ImageVoxel[] = [];

  for (const v of voxels) {
    const edge =
      !occupied.has(key(v.x - 1, v.y, v.z)) ||
      !occupied.has(key(v.x + 1, v.y, v.z)) ||
      !occupied.has(key(v.x, v.y - 1, v.z)) ||
      !occupied.has(key(v.x, v.y + 1, v.z));
    if (!edge) continue;
    extra.push({ x: v.x, y: v.y, z: v.z, c: colorIndex });
  }

  const map = new Map(voxels.map((v) => [key(v.x, v.y, v.z), v]));
  for (const v of extra) map.set(key(v.x, v.y, v.z), v);
  return [...map.values()];
}
