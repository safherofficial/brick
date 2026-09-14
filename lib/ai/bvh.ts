import type { ImageVoxel } from "@/lib/imageVoxel";

const MIN_NEIGHBORS = 1;

function key(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

/**
 * Spatial cleanup on the integer voxel grid.
 * Removes only truly floating voxels while keeping
 * diagonal/thin details that are common in weapon silhouettes.
 */
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
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1) {
            faceNeighbors += 1;
          }
        }
      }
    }

    if (faceNeighbors >= MIN_NEIGHBORS || neighbors >= 2) kept.push(v);
  }

  return kept.length ? kept : voxels;
}
