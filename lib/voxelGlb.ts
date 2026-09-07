import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { keyOf, type VoxelVolume } from "@/lib/voxelEngine";

const FACES: { n: [number, number, number]; u: [number, number, number]; v: [number, number, number] }[] = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, -1] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0] }
];

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").padStart(6, "0").slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export async function exportGlb(volume: VoxelVolume, palette: string[]) {
  const raw = volume.raw();
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (const [key, c] of raw) {
    const [x, y, z] = key.split(":").map(Number);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
    const rgb = hexRgb(palette[c] ?? "#ffffff");
    for (const face of FACES) {
      const nx = x + face.n[0];
      const ny = y + face.n[1];
      const nz = z + face.n[2];
      if (raw.has(keyOf(nx, ny, nz))) continue;
      const px = x + 0.5 + face.n[0] * 0.5;
      const py = y + 0.5 + face.n[1] * 0.5;
      const pz = z + 0.5 + face.n[2] * 0.5;
      const corners = [
        [
          px - face.u[0] * 0.5 - face.v[0] * 0.5,
          py - face.u[1] * 0.5 - face.v[1] * 0.5,
          pz - face.u[2] * 0.5 - face.v[2] * 0.5
        ],
        [
          px + face.u[0] * 0.5 - face.v[0] * 0.5,
          py + face.u[1] * 0.5 - face.v[1] * 0.5,
          pz + face.u[2] * 0.5 - face.v[2] * 0.5
        ],
        [
          px + face.u[0] * 0.5 + face.v[0] * 0.5,
          py + face.u[1] * 0.5 + face.v[1] * 0.5,
          pz + face.u[2] * 0.5 + face.v[2] * 0.5
        ],
        [
          px - face.u[0] * 0.5 + face.v[0] * 0.5,
          py - face.u[1] * 0.5 + face.v[1] * 0.5,
          pz - face.u[2] * 0.5 + face.v[2] * 0.5
        ]
      ];
      const idx = [0, 1, 2, 0, 2, 3];
      for (const i of idx) {
        positions.push(corners[i][0], corners[i][1], corners[i][2]);
        normals.push(face.n[0], face.n[1], face.n[2]);
        colors.push(rgb[0], rgb[1], rgb[2]);
      }
    }
  }

  if (!positions.length) throw new Error("Empty volume");

  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx;
    positions[i + 1] -= minY;
    positions[i + 2] -= cz;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.02
    })
  );
  mesh.name = "voxel";

  const scene = new THREE.Scene();
  scene.add(mesh);

  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, {
    binary: true,
    onlyVisible: true
  });
  geometry.dispose();
  if (result instanceof ArrayBuffer) return result;
  throw new Error("GLB export failed");
}
