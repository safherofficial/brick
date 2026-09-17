import { encodePng } from "@/lib/png";
import type { ImageVoxel } from "@/lib/imageVoxel";
import type { VoxelVolume } from "@/lib/voxelEngine";

export type OrthoPivot = {
  x: number;
  y: number;
  pixelsPerUnit: number;
  width: number;
  height: number;
};

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0
  ];
}

/** Front-ortho PNG: 1 pixel = 1 voxel, transparent ground, pivot bottom-center of content. */
export function exportPngOrtho(
  voxels: ImageVoxel[],
  palette: string[],
  pixelsPerUnit = 16
): { png: Uint8Array; pivot: OrthoPivot } {
  if (!voxels.length) throw new Error("No voxels to export");

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const front = new Map<string, number>();

  for (const v of voxels) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
    const key = `${v.x}:${v.y}`;
    const prev = front.get(key);
    if (prev === undefined || v.z < prev) front.set(key, v.z);
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const rgba = new Uint8Array(width * height * 4);
  const colorAt = new Map<string, number>();
  for (const v of voxels) {
    const key = `${v.x}:${v.y}`;
    if (front.get(key) !== v.z) continue;
    colorAt.set(key, v.c);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const vx = minX + x;
      const vy = maxY - y;
      const c = colorAt.get(`${vx}:${vy}`);
      if (c === undefined) continue;
      const [r, g, b] = hexRgb(palette[c] ?? "#111111");
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }

  return {
    png: encodePng(width, height, rgba),
    pivot: {
      x: width / 2,
      y: height,
      pixelsPerUnit,
      width,
      height
    }
  };
}

export function exportVolumePngOrtho(
  volume: VoxelVolume,
  palette: string[],
  pixelsPerUnit = 16
) {
  return exportPngOrtho(volume.voxels(), palette, pixelsPerUnit);
}
