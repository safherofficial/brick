import { encodePng } from "@/lib/png";
import type { ImageVoxel } from "@/lib/imageVoxel";
import type { VoxelVolume } from "@/lib/voxelEngine";
import { zipStore } from "@/lib/voxelExport";

export const UNITY_2D_PIXELS_PER_UNIT = 16;

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

function fnv1a(bytes: Uint8Array, seed: number) {
  let hash = seed >>> 0;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hex32(value: number) {
  return value.toString(16).padStart(8, "0");
}

function unityGuid(png: Uint8Array) {
  return [
    fnv1a(png, 0x811c9dc5),
    fnv1a(png, 0x9e3779b1),
    fnv1a(png, 0x85ebca6b),
    fnv1a(png, 0xc2b2ae35)
  ].map(hex32).join("");
}

/** Unity TextureImporter meta for a single point-filtered sprite with a bottom-center pivot. */
export function unityPngMeta(pivot: OrthoPivot, png: Uint8Array): string {
  const pixelsPerUnit = UNITY_2D_PIXELS_PER_UNIT;
  const normalizedX = 0.5;
  const normalizedY = 0;
  return [
    "fileFormatVersion: 2",
    `guid: ${unityGuid(png)}`,
    "TextureImporter:",
    "  serializedVersion: 12",
    "  mipmaps:",
    "    mipMapMode: 0",
    "    enableMipMap: 0",
    "    sRGBTexture: 1",
    "    linearTexture: 0",
    "    fadeOut: 0",
    "    borderMipMap: 0",
    "    mipMapsPreserveCoverage: 0",
    "    alphaTestReferenceValue: 0.5",
    "    mipMapFadeDistanceStart: 1",
    "    mipMapFadeDistanceEnd: 3",
    "  bumpmap:",
    "    convertToNormalMap: 0",
    "    externalNormalMap: 0",
    "    heightScale: 0.25",
    "    normalMapFilter: 0",
    "    flipGreenChannel: 0",
    "  isReadable: 0",
    "  streamingMipmaps: 0",
    "  streamingMipmapsPriority: 0",
    "  vTOnly: 0",
    "  ignoreMipmapLimit: 0",
    "  grayScaleToAlpha: 0",
    "  generateCubemap: 6",
    "  seamlessCubemap: 0",
    "  textureFormat: 1",
    "  maxTextureSize: 2048",
    "  textureSettings:",
    "    serializedVersion: 3",
    "    filterMode: 0",
    "    aniso: 1",
    "    mipBias: 0",
    "    wrapU: 1",
    "    wrapV: 1",
    "    wrapW: 1",
    "  nPOTScale: 0",
    "  lightmap: 0",
    "  compressionQuality: 50",
    "  spriteMode: 1",
    "  spriteExtrude: 1",
    "  spriteMeshType: 1",
    "  alignment: 9",
    `  spritePivot: {x: ${normalizedX}, y: ${normalizedY}}`,
    `  spritePixelsPerUnit: ${pixelsPerUnit}`,
    "  spriteBorder: {x: 0, y: 0, z: 0, w: 0}",
    "  spriteGenerateFallbackPhysicsShape: 0",
    "  alphaUsage: 1",
    "  alphaIsTransparency: 1",
    "  spriteTessellationDetail: -1",
    "  textureType: 8",
    "  textureShape: 1",
    "  singleChannelComponent: 0",
    "  flipGreenChannel: 0",
    "  swizzle: 50462976",
    "  cookieLightType: 0",
    "  mipmapFilter: 0",
    "  platformSettings: []",
    ""
  ].join("\n");
}

/** Front-ortho PNG: 1 pixel = 1 voxel, transparent ground, pivot bottom-center of content. */
export function exportPngOrtho(
  voxels: ImageVoxel[],
  palette: string[],
  pixelsPerUnit = UNITY_2D_PIXELS_PER_UNIT
): { png: Uint8Array; pivot: OrthoPivot; unityMeta: string; unity2dZip: Uint8Array } {
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
  const png = encodePng(width, height, rgba);
  const pivot = {
    x: width / 2,
    y: height,
    pixelsPerUnit,
    width,
    height
  };
  const unityMeta = unityPngMeta(pivot, png);
  const unity2dZip = zipStore([
    { name: "sprite.png", data: png },
    { name: "sprite.png.meta", data: new TextEncoder().encode(unityMeta) }
  ]);
  return { png, pivot, unityMeta, unity2dZip };
}

export function exportVolumePngOrtho(
  volume: VoxelVolume,
  palette: string[],
  pixelsPerUnit = UNITY_2D_PIXELS_PER_UNIT
) {
  return exportPngOrtho(volume.voxels(), palette, pixelsPerUnit);
}
