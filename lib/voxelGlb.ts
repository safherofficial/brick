import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { VoxelVolume } from "@/lib/voxelEngine";
import {
  assertExportable,
  greedyQuads,
  hexRgb,
  pivotOrigin,
  quadCorners,
  quadNormal,
  resolveExport,
  transformNormal,
  transformPoint,
  type MeshExportOptions
} from "@/lib/voxelMesh";

export async function exportGlb(
  volume: VoxelVolume,
  palette: string[],
  options?: MeshExportOptions
) {
  const bounds = assertExportable(volume);
  const resolved = resolveExport(options);
  const origin = pivotOrigin(bounds, resolved.pivot);
  const quads = greedyQuads(volume);
  if (!quads.length) throw new Error("Empty volume");

  const byColor = new Map<number, typeof quads>();
  for (const quad of quads) {
    const list = byColor.get(quad.c) ?? [];
    list.push(quad);
    byColor.set(quad.c, list);
  }

  const root = new THREE.Group();
  root.name = resolved.name;
  root.userData = {
    generator: "Brick Builder",
    unitMeters: resolved.unitMeters,
    pivot: resolved.pivot,
    upAxis: resolved.upAxis,
    voxelCount: volume.count
  };

  const disposables: { geometry: THREE.BufferGeometry; material: THREE.Material }[] =
    [];

  for (const [colorIndex, faces] of [...byColor.entries()].sort(
    (a, b) => a[0] - b[0]
  )) {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    for (const face of faces) {
      const base = positions.length / 3;
      const n = transformNormal(...quadNormal(face), resolved.upAxis);
      for (const corner of quadCorners(face)) {
        const p = transformPoint(
          corner[0],
          corner[1],
          corner[2],
          origin,
          resolved.unitMeters,
          resolved.upAxis
        );
        positions.push(p[0], p[1], p[2]);
        normals.push(n[0], n[1], n[2]);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const [r, g, b] = hexRgb(palette[colorIndex] ?? "#ffffff");
    const material = new THREE.MeshStandardMaterial({
      name: `voxel_${colorIndex}`,
      color: new THREE.Color(r / 255, g / 255, b / 255),
      roughness: 0.45,
      metalness: 0.02,
      side: THREE.FrontSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${resolved.name}_voxel_${colorIndex}`;
    mesh.userData = { paletteIndex: colorIndex };
    root.add(mesh);
    disposables.push({ geometry, material });
  }

  const scene = new THREE.Scene();
  scene.name = resolved.name;
  scene.add(root);

  try {
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(scene, {
      binary: true,
      onlyVisible: true
    });
    if (!(result instanceof ArrayBuffer)) throw new Error("GLB export failed");
    return result;
  } finally {
    for (const item of disposables) {
      item.geometry.dispose();
      item.material.dispose();
    }
  }
}
