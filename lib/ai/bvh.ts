import * as THREE from "three";
import { PointsBVH } from "three-mesh-bvh";
import type { ImageVoxel } from "@/lib/imageVoxel";

const SEARCH_RADIUS = 1.05;
const MIN_NEIGHBORS = 1;

/**
 * Spatial cleanup backed by three-mesh-bvh.
 *
 * Unlike a string-key-only neighbor pass, this uses a point BVH to perform
 * local spatial queries. It removes only truly floating voxels while keeping
 * diagonal/thin details that are common in weapon silhouettes.
 */
export function spatialCleanVoxels(voxels: ImageVoxel[]): ImageVoxel[] {
  if (voxels.length < 3) return voxels;

  const positions = new Float32Array(voxels.length * 3);
  for (let i = 0; i < voxels.length; i += 1) {
    const v = voxels[i];
    const o = i * 3;
    positions[o] = v.x;
    positions[o + 1] = v.y;
    positions[o + 2] = v.z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const bvh = new PointsBVH(geometry);
  const queryBox = new THREE.Box3();
  const center = new THREE.Vector3();
  const min = new THREE.Vector3();
  const max = new THREE.Vector3();
  const kept: ImageVoxel[] = [];

  try {
    for (let i = 0; i < voxels.length; i += 1) {
      const v = voxels[i];
      center.set(v.x, v.y, v.z);
      min.set(v.x - SEARCH_RADIUS, v.y - SEARCH_RADIUS, v.z - SEARCH_RADIUS);
      max.set(v.x + SEARCH_RADIUS, v.y + SEARCH_RADIUS, v.z + SEARCH_RADIUS);
      queryBox.set(min, max);

      let neighbors = 0;
      let faceNeighbors = 0;
      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(queryBox),
        intersectsPoint: (point, index) => {
          if (index === i) return false;
          if (
            Math.abs(point.x - center.x) <= SEARCH_RADIUS &&
            Math.abs(point.y - center.y) <= SEARCH_RADIUS &&
            Math.abs(point.z - center.z) <= SEARCH_RADIUS
          ) {
            neighbors += 1;
            const dx = Math.abs(point.x - center.x);
            const dy = Math.abs(point.y - center.y);
            const dz = Math.abs(point.z - center.z);
            if (dx + dy + dz <= 1.05) faceNeighbors += 1;
          }
          return false;
        }
      });

      // Preserve true thin structures with a face-adjacent voxel. Remove only
      // floating one-off diagonal specks; diagonal chains with 2+ contacts survive.
      if (faceNeighbors >= MIN_NEIGHBORS || neighbors >= 2) kept.push(v);
    }
  } finally {
    geometry.dispose();
  }

  return kept.length ? kept : voxels;
}
