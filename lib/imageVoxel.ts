// lib/imageVoxel.ts
import { spatialCleanVoxels, outlineVoxels, thickenMinFeature } from "@/lib/ai/bvh";
import { lintVoxels } from "@/lib/ai/lint";
import { refineMask } from "@/lib/ai/opencv";
import {
  inferStyle,
  profileById,
  type StyleId,
  type StyleProfile
} from "@/lib/ai/styleProfiles";

export type ImageVoxel = {
  x: number;
  y: number;
  z: number;
  c: number;
};

export type ImageImport = {
  width: number;
  height: number;
  voxels: ImageVoxel[];
  palette: string[];
  count: number;
};

export type ImageVoxelOptions = {
  volumeSize?: number;
  heightMax?: number;
  maxVoxels?: number;
  symmetrize?: boolean;
  useLocalAi?: boolean;
  style?: StyleId;
  outline?: boolean;
};

export type ImageViews = {
  front: File;
  side?: File;
};

type Raster = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

type Rgb = [number, number, number];

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

type Span = {
  min: number;
  max: number;
};

type NormalizedOptions = Required<Omit<ImageVoxelOptions, "style" | "outline">> & {
  style: StyleId;
  outline: boolean;
  profile: StyleProfile;
};

const GAME_PALETTE = [
  "#c91f2d",
  "#e35b19",
  "#f6b800",
  "#f2d64b",
  "#168b4b",
  "#53b84a",
  "#0877b9",
  "#2e58b8",
  "#6b42a8",
  "#d84c9b",
  "#7ec8e8",
  "#f4a04a",
  "#8b5a2b",
  "#4b5563",
  "#9ca3af",
  "#f2f0e8"
];

const DEFAULT_PALETTE = [...GAME_PALETTE, "#ffffff"];
const MAX_RASTER_EDGE = 640;
const MIN_ALPHA = 12;
const OUTLINE_HEX = "#111827";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function hexOf(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function dist2(a: Rgb, b: Rgb) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function luma(rgb: Rgb) {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

function sat(rgb: Rgb) {
  return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);
}

function shade(rgb: Rgb, k: number): Rgb {
  return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
}

function loadImage(file: File): Promise<Raster> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_RASTER_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve({ width, height, rgba: ctx.getImageData(0, 0, width, height).data });
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read image"));
    };
    img.src = url;
  });
}

function pixel(raster: Raster, x: number, y: number) {
  const xx = clamp(Math.round(x), 0, raster.width - 1);
  const yy = clamp(Math.round(y), 0, raster.height - 1);
  const i = (yy * raster.width + xx) * 4;
  return {
    rgb: [raster.rgba[i], raster.rgba[i + 1], raster.rgba[i + 2]] as Rgb,
    a: raster.rgba[i + 3]
  };
}

function alphaCoverage(raster: Raster) {
  let hits = 0;
  for (let i = 3; i < raster.rgba.length; i += 4) {
    if (raster.rgba[i] < 128) hits += 1;
  }
  return hits / (raster.width * raster.height);
}

function cornerBackground(raster: Raster): Rgb {
  const pts: [number, number][] = [
    [2, 2],
    [raster.width - 3, 2],
    [2, raster.height - 3],
    [raster.width - 3, raster.height - 3],
    [Math.floor(raster.width / 2), 2],
    [Math.floor(raster.width / 2), raster.height - 3],
    [2, Math.floor(raster.height / 2)],
    [raster.width - 3, Math.floor(raster.height / 2)]
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const [x, y] of pts) {
    const p = pixel(raster, x, y);
    if (p.a < MIN_ALPHA) continue;
    r += p.rgb[0];
    g += p.rgb[1];
    b += p.rgb[2];
    n += 1;
  }
  if (!n) return [255, 255, 255];
  return [r / n, g / n, b / n];
}

function isBackground(rgb: Rgb, a: number, bg: Rgb, tol: number) {
  if (a < MIN_ALPHA) return true;
  const d = Math.sqrt(dist2(rgb, bg));
  const dl = Math.abs(luma(rgb) - luma(bg));
  if (sat(rgb) >= 40 && d > 28) return false;
  return d <= tol && dl <= tol * 0.9;
}

function floodSubject(raster: Raster, tol: number, useAlpha: boolean) {
  const w = raster.width;
  const h = raster.height;
  const bg = cornerBackground(raster);
  const candidate = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = pixel(raster, x, y);
      candidate[y][x] = useAlpha
        ? p.a < MIN_ALPHA || isBackground(p.rgb, p.a, bg, tol)
        : isBackground(p.rgb, p.a, bg, tol);
    }
  }
  const seen = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  const stack: [number, number][] = [];
  const seed = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    if (!candidate[y][x] || seen[y][x]) return;
    seen[y][x] = true;
    stack.push([x, y]);
  };
  for (let x = 0; x < w; x += 1) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    seed(0, y);
    seed(w - 1, y);
  }
  while (stack.length) {
    const [x, y] = stack.pop()!;
    seed(x + 1, y);
    seed(x - 1, y);
    seed(x, y + 1);
    seed(x, y - 1);
  }
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => !seen[y][x] && pixel(raster, x, y).a >= MIN_ALPHA)
  );
}

function measureMask(mask: boolean[][]) {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  let hits = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      hits += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (hits < 24) return { hits, fill: 0, frame: true, full: false };
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const fill = hits / (bw * bh);
  const full = bw >= w * 0.92 && bh >= h * 0.92;
  return { hits, fill, frame: full && fill < 0.12, full };
}

function dropIslands(mask: boolean[][], ratio: number) {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  const seen = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  const parts: [number, number][][] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x] || seen[y][x]) continue;
      const cells: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];
      seen[y][x] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        cells.push([cx, cy]);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (!mask[ny][nx] || seen[ny][nx]) continue;
          seen[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      parts.push(cells);
    }
  }
  if (!parts.length) return mask;
  const largest = Math.max(...parts.map((part) => part.length));
  const min = Math.max(16, Math.round(largest * ratio));
  const out = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  for (const cells of parts) {
    if (cells.length < min) continue;
    for (const [x, y] of cells) out[y][x] = true;
  }
  return out;
}

function fillInteriorHoles(mask: boolean[][], ratio: number) {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  const outside = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  const stack: [number, number][] = [];
  const seed = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    if (mask[y][x] || outside[y][x]) return;
    outside[y][x] = true;
    stack.push([x, y]);
  };
  for (let x = 0; x < w; x += 1) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    seed(0, y);
    seed(w - 1, y);
  }
  while (stack.length) {
    const [x, y] = stack.pop()!;
    seed(x + 1, y);
    seed(x - 1, y);
    seed(x, y + 1);
    seed(x, y - 1);
  }
  const holes: [number, number][] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x] && !outside[y][x]) holes.push([x, y]);
    }
  }
  if (!holes.length) return mask;
  if (holes.length > Math.max(24, Math.round(w * h * ratio))) return mask;
  const out = mask.map((row) => row.slice());
  for (const [x, y] of holes) out[y][x] = true;
  return out;
}

function buildSubjectMask(raster: Raster, profile: StyleProfile) {
  const useAlpha = alphaCoverage(raster) >= 0.02;
  let best: boolean[][] | null = null;
  let bestScore = -1;
  for (const tol of [24, 32, 40, 52, 64, 80]) {
    const raw = fillInteriorHoles(
      dropIslands(floodSubject(raster, tol, useAlpha), profile.islandRatio),
      profile.fillHoleRatio
    );
    const stats = measureMask(raw);
    if (stats.hits < 24 || stats.frame) continue;
    if (stats.full && stats.fill > 0.94) continue;
    const score = stats.hits * (stats.fill < 0.2 ? 0.35 : 1);
    if (score > bestScore) {
      best = raw;
      bestScore = score;
    }
  }
  if (!best) throw new Error("No visible subject found");
  return refineMask(fillInteriorHoles(best, profile.fillHoleRatio));
}

function findBounds(mask: boolean[][]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < mask.length; y += 1) {
    for (let x = 0; x < mask[y].length; x += 1) {
      if (!mask[y][x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function resampleMask(mask: boolean[][], bounds: Bounds, width: number, height: number) {
  const out = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
  for (let y = 0; y < height; y += 1) {
    const srcY = Math.round(bounds.minY + (y / Math.max(1, height - 1)) * (bounds.height - 1));
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.round(bounds.minX + (x / Math.max(1, width - 1)) * (bounds.width - 1));
      out[y][x] = !!mask[srcY]?.[srcX];
    }
  }
  return out;
}

function centerMaskX(mask: boolean[][]) {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  let minX = w;
  let maxX = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  if (maxX < 0) return mask;
  const shift = Math.round((w - 1) / 2 - (minX + maxX) / 2);
  if (!shift) return mask;
  const out = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      const nx = x + shift;
      if (nx < 0 || nx >= w) continue;
      out[y][nx] = true;
    }
  }
  return out;
}

function rowSpan(mask: boolean[][], y: number): Span | null {
  const w = mask[0]?.length ?? 0;
  let min = w;
  let max = -1;
  for (let x = 0; x < w; x += 1) {
    if (!mask[y]?.[x]) continue;
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  if (max < 0) return null;
  return { min, max };
}

function sideProfile(mask: boolean[][]) {
  return mask.map((_, y) => rowSpan(mask, y));
}

function profileCoverage(front: boolean[][], profile: Array<Span | null>) {
  let need = 0;
  let hit = 0;
  for (let y = 0; y < front.length; y += 1) {
    if (!front[y].some(Boolean)) continue;
    need += 1;
    if (profile[y]) hit += 1;
  }
  return need ? hit / need : 0;
}

function resampleColor(
  raster: Raster,
  mask: boolean[][],
  bounds: Bounds,
  width: number,
  height: number
) {
  const colors: (Rgb | null)[][] = Array.from({ length: height }, () => Array(width).fill(null));
  for (let y = 0; y < height; y += 1) {
    const srcY = bounds.minY + (y / Math.max(1, height - 1)) * (bounds.height - 1);
    for (let x = 0; x < width; x += 1) {
      const srcX = bounds.minX + (x / Math.max(1, width - 1)) * (bounds.width - 1);
      if (!mask[Math.round(srcY)]?.[Math.round(srcX)]) continue;
      colors[y][x] = pixel(raster, srcX, srcY).rgb;
    }
  }
  return colors;
}

function resampleDepth(
  depth: Float32Array | null | undefined,
  srcW: number,
  srcH: number,
  bounds: Bounds,
  width: number,
  height: number
) {
  if (!depth || depth.length < srcW * srcH) return null;
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const srcY = bounds.minY + (y / Math.max(1, height - 1)) * (bounds.height - 1);
    for (let x = 0; x < width; x += 1) {
      const srcX = bounds.minX + (x / Math.max(1, width - 1)) * (bounds.width - 1);
      const sx = clamp(Math.round(srcX), 0, srcW - 1);
      const sy = clamp(Math.round(srcY), 0, srcH - 1);
      out[y * width + x] = depth[sy * srcW + sx] ?? 0;
    }
  }
  return out;
}

function nearestPaint(colors: (Rgb | null)[][], mask: boolean[][], x: number, y: number): Rgb {
  const h = colors.length;
  const w = colors[0]?.length ?? 0;
  const ox = clamp(Math.round(x), 0, Math.max(0, w - 1));
  const oy = clamp(Math.round(y), 0, Math.max(0, h - 1));
  const direct = colors[oy]?.[ox];
  if (direct) return direct;
  for (let radius = 1; radius <= 14; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const hit = colors[oy + dy]?.[ox + dx];
        if (hit && mask[oy + dy]?.[ox + dx]) return hit;
      }
    }
  }
  return [214, 214, 214];
}

function regionColors(mask: boolean[][], paints: (Rgb | null)[][], merge: number) {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  const out: (Rgb | null)[][] = Array.from({ length: h }, () => Array(w).fill(null));
  const seen = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x] || seen[y][x]) continue;
      const seed = nearestPaint(paints, mask, x, y);
      const cells: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];
      seen[y][x] = true;
      let r = 0;
      let g = 0;
      let b = 0;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        const rgb = nearestPaint(paints, mask, cx, cy);
        if (dist2(rgb, seed) > merge) {
          seen[cy][cx] = false;
          continue;
        }
        cells.push([cx, cy]);
        r += rgb[0];
        g += rgb[1];
        b += rgb[2];
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (!mask[ny][nx] || seen[ny][nx]) continue;
          seen[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      const n = Math.max(1, cells.length);
      const mean: Rgb = [r / n, g / n, b / n];
      for (const [cx, cy] of cells) out[cy][cx] = mean;
    }
  }
  return out;
}

function distanceField(mask: boolean[][]) {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  const inf = w + h;
  const dist = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (mask[y][x] ? inf : 0))
  );
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      let best = dist[y][x];
      if (x > 0) best = Math.min(best, dist[y][x - 1] + 1);
      if (y > 0) best = Math.min(best, dist[y - 1][x] + 1);
      if (x > 0 && y > 0) best = Math.min(best, dist[y - 1][x - 1] + 1.414);
      if (x + 1 < w && y > 0) best = Math.min(best, dist[y - 1][x + 1] + 1.414);
      dist[y][x] = best;
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      if (!mask[y][x]) continue;
      let best = dist[y][x];
      if (x + 1 < w) best = Math.min(best, dist[y][x + 1] + 1);
      if (y + 1 < h) best = Math.min(best, dist[y + 1][x] + 1);
      if (x + 1 < w && y + 1 < h) best = Math.min(best, dist[y + 1][x + 1] + 1.414);
      if (x > 0 && y + 1 < h) best = Math.min(best, dist[y + 1][x - 1] + 1.414);
      dist[y][x] = best;
    }
  }
  return dist;
}

function nearestColor(rgb: Rgb, palette: Rgb[]) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const d = dist2(rgb, palette[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function createPalette(rasters: Raster[], masks: boolean[][][], size = 16) {
  const buckets = new Map<string, { rgb: Rgb; n: number }>();
  for (let v = 0; v < rasters.length; v += 1) {
    const raster = rasters[v];
    const mask = masks[v];
    for (let y = 0; y < raster.height; y += 2) {
      for (let x = 0; x < raster.width; x += 2) {
        if (!mask[y]?.[x]) continue;
        const p = pixel(raster, x, y);
        if (p.a < MIN_ALPHA) continue;
        const rgb: Rgb = [
          Math.round(p.rgb[0] / 16) * 16,
          Math.round(p.rgb[1] / 16) * 16,
          Math.round(p.rgb[2] / 16) * 16
        ];
        const id = rgb.join(":");
        const hit = buckets.get(id);
        if (hit) hit.n += 1;
        else buckets.set(id, { rgb, n: 1 });
      }
    }
  }
  const chosen: Rgb[] = [];
  for (const item of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    if (chosen.every((c) => dist2(c, item.rgb) > 1400)) chosen.push(item.rgb);
    if (chosen.length >= size) break;
  }
  for (const hex of GAME_PALETTE) {
    if (chosen.length >= size) break;
    const h = hex.replace("#", "");
    const rgb: Rgb = [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16)
    ];
    if (chosen.every((c) => dist2(c, rgb) > 900)) chosen.push(rgb);
  }
  if (!chosen.length) chosen.push([242, 240, 232]);
  return chosen.map((c) => hexOf(c[0], c[1], c[2]));
}

function paletteRgb(palette: string[]): Rgb[] {
  return palette.map((hex) => {
    const h = hex.replace("#", "");
    return [
      Number.parseInt(h.slice(0, 2), 16) || 0,
      Number.parseInt(h.slice(2, 4), 16) || 0,
      Number.parseInt(h.slice(4, 6), 16) || 0
    ];
  });
}

function voxelKey(v: ImageVoxel) {
  return `${v.x}:${v.y}:${v.z}`;
}

function keepLargest(voxels: ImageVoxel[], ratio: number) {
  if (voxels.length < 2) return voxels;
  const map = new Map(voxels.map((v) => [voxelKey(v), v]));
  const seen = new Set<string>();
  const parts: ImageVoxel[][] = [];
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ] as const;
  for (const start of voxels) {
    const startKey = voxelKey(start);
    if (seen.has(startKey)) continue;
    const part: ImageVoxel[] = [];
    const stack = [start];
    seen.add(startKey);
    while (stack.length) {
      const cur = stack.pop()!;
      part.push(cur);
      for (const [dx, dy, dz] of dirs) {
        const id = `${cur.x + dx}:${cur.y + dy}:${cur.z + dz}`;
        if (seen.has(id)) continue;
        const next = map.get(id);
        if (!next) continue;
        seen.add(id);
        stack.push(next);
      }
    }
    parts.push(part);
  }
  const largest = Math.max(...parts.map((part) => part.length));
  const min = Math.max(8, Math.round(largest * ratio));
  return parts.filter((part) => part.length >= min).flat();
}

function symmetrizeVoxels(voxels: ImageVoxel[], volumeSize: number) {
  if (!voxels.length) return;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const v of voxels) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
  }
  const center = (minX + maxX) / 2;
  const existing = new Set(voxels.map(voxelKey));
  for (const voxel of [...voxels]) {
    const mx = Math.round(center * 2 - voxel.x);
    if (mx < 0 || mx >= volumeSize) continue;
    const id = `${mx}:${voxel.y}:${voxel.z}`;
    if (existing.has(id)) continue;
    existing.add(id);
    voxels.push({ x: mx, y: voxel.y, z: voxel.z, c: voxel.c });
  }
}

function placeOnGround(voxels: ImageVoxel[], volumeSize: number) {
  if (!voxels.length) return voxels;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of voxels) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    minZ = Math.min(minZ, v.z);
    maxZ = Math.max(maxZ, v.z);
  }
  const xOffset = Math.floor((volumeSize - (maxX - minX + 1)) / 2) - minX;
  const zOffset = Math.floor((volumeSize - (maxZ - minZ + 1)) / 2) - minZ;
  return voxels.map((v) => ({
    x: clamp(v.x + xOffset, 0, volumeSize - 1),
    y: clamp(v.y - minY, 0, volumeSize - 1),
    z: clamp(v.z + zOffset, 0, volumeSize - 1),
    c: v.c
  }));
}

function modelSize(bounds: Bounds, volumeSize: number, heightMax: number, maxVoxels: number) {
  const maxAxis = Math.max(8, volumeSize - 6);
  const scale = Math.min(1, maxAxis / Math.max(bounds.width, bounds.height));
  let width = Math.max(4, Math.round(bounds.width * scale));
  let height = Math.max(4, Math.round(bounds.height * scale));
  const depth = Math.max(1, Math.min(maxAxis, Math.round(heightMax)));
  while (width * height * depth > maxVoxels && width > 16 && height > 16) {
    width = Math.max(16, Math.floor(width * 0.88));
    height = Math.max(16, Math.floor(height * 0.88));
  }
  return { width, height, depth };
}

function sampleDepth(
  depthMap: Float32Array | null | undefined,
  x: number,
  y: number,
  width: number
) {
  if (!depthMap) return null;
  return clamp(depthMap[y * width + x] ?? 0, 0, 1);
}

function sdfRadius(
  t: number,
  maxRadius: number,
  profile: StyleProfile,
  depthHint: number | null
) {
  const shaped = Math.pow(clamp(t, 0, 1), profile.sdfPower);
  let mixed = shaped;
  if (profile.useDepthHint && depthHint !== null) mixed = 0.8 * shaped + 0.2 * depthHint;
  const span = Math.max(0, maxRadius - profile.edgeRadius);
  return Math.max(profile.minRadius, Math.round(profile.edgeRadius + mixed * span));
}

function buildModel(
  frontRaster: Raster,
  frontMask: boolean[][],
  frontBounds: Bounds,
  options: NormalizedOptions,
  palette: string[],
  side?: { raster: Raster; mask: boolean[][]; bounds: Bounds },
  depthMap?: Float32Array | null
): ImageImport {
  const dims = modelSize(frontBounds, options.volumeSize, options.heightMax, options.maxVoxels);
  const front = resampleMask(frontMask, frontBounds, dims.width, dims.height);
  const frontColors = resampleColor(frontRaster, frontMask, frontBounds, dims.width, dims.height);
  const regions = regionColors(front, frontColors, options.profile.regionMerge);
  const mappedDepth = options.profile.useDepthHint
    ? resampleDepth(
        depthMap,
        frontRaster.width,
        frontRaster.height,
        frontBounds,
        dims.width,
        dims.height
      )
    : null;
  const dist = distanceField(front);
  let maxDist = 1;
  for (const row of dist) for (const value of row) maxDist = Math.max(maxDist, value);

  let sideMask: boolean[][] | null = null;
  let hull: Array<Span | null> | null = null;
  if (side && options.profile.useSideHull) {
    sideMask = centerMaskX(resampleMask(side.mask, side.bounds, dims.depth, dims.height));
    const raw = sideProfile(sideMask);
    hull = profileCoverage(front, raw) >= 0.35 ? raw : null;
  }

  const colors = paletteRgb(palette);
  const voxels: ImageVoxel[] = [];
  const centerZ = (dims.depth - 1) / 2;
  const maxRadius = Math.max(0, Math.floor((dims.depth - 1) / 2));

  for (let y = 0; y < dims.height; y += 1) {
    const span = hull?.[y] ?? null;
    for (let x = 0; x < dims.width; x += 1) {
      if (!front[y][x]) continue;
      const radius = sdfRadius(
        dist[y][x] / maxDist,
        maxRadius,
        options.profile,
        sampleDepth(mappedDepth, x, y, dims.width)
      );
      const base = regions[y][x] ?? nearestPaint(frontColors, front, x, y);
      const colorIndex = nearestColor(base, colors);
      for (let z = 0; z < dims.depth; z += 1) {
        if (Math.abs(z - centerZ) > radius) continue;
        if (span && (z < span.min || z > span.max)) continue;
        if (sideMask && !span && !sideMask[y]?.[z]) continue;
        const mid = Math.max(1, (dims.depth - 1) / 2);
        const shaded = dims.depth <= 2 ? base : shade(base, 1 - (Math.abs(z - centerZ) / mid) * 0.16);
        voxels.push({
          x,
          y,
          z,
          c: dims.depth <= 2 ? colorIndex : nearestColor(shaded, colors)
        });
      }
    }
  }

  if (!voxels.length) throw new Error("No voxels reconstructed");
  let cleaned = keepLargest(
    voxels.map((v) => ({ ...v, y: dims.height - 1 - v.y })),
    options.profile.keepRatio
  );
  cleaned = thickenMinFeature(cleaned, options.profile.minFeature);
  cleaned = spatialCleanVoxels(cleaned);
  cleaned = lintVoxels(cleaned);
  if (options.symmetrize) {
    symmetrizeVoxels(cleaned, options.volumeSize);
    cleaned = keepLargest(cleaned, options.profile.keepRatio);
    cleaned = lintVoxels(cleaned);
  }
  if (options.outline) {
    const outlineIndex = Math.max(0, palette.findIndex((hex) => hex.toLowerCase() === OUTLINE_HEX));
    cleaned = outlineVoxels(cleaned, outlineIndex >= 0 ? outlineIndex : 0);
  }
  const grounded = placeOnGround(cleaned, options.volumeSize);
  return {
    width: frontRaster.width,
    height: frontRaster.height,
    voxels: grounded,
    palette,
    count: grounded.length
  };
}

function normalizeOptions(options: ImageVoxelOptions): NormalizedOptions {
  const heightMax = options.heightMax ?? 8;
  const symmetrize = options.symmetrize ?? false;
  const style = options.style ?? inferStyle(heightMax, symmetrize);
  const profile = profileById(style);
  return {
    volumeSize: options.volumeSize ?? 128,
    heightMax,
    maxVoxels: options.maxVoxels ?? 100000,
    symmetrize,
    useLocalAi: options.useLocalAi ?? true,
    style,
    outline: options.outline ?? profile.outline,
    profile
  };
}

async function prepareRaster(raster: Raster, enabled: boolean) {
  if (!enabled) return { raster, depth: null as Float32Array | null };
  const { enhanceRaster } = await import("@/lib/ai/enhance");
  return enhanceRaster(raster, { depth: false });
}

function withOutlineColor(palette: string[]) {
  if (palette.some((hex) => hex.toLowerCase() === OUTLINE_HEX)) return palette;
  return [OUTLINE_HEX, ...palette].slice(0, 32);
}

export async function imageToVoxels(
  file: File,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  const normalized = normalizeOptions(options);
  const prepared = await prepareRaster(await loadImage(file), normalized.useLocalAi);
  const raster = prepared.raster;
  const mask = buildSubjectMask(raster, normalized.profile);
  const bounds = findBounds(mask);
  if (!bounds) throw new Error("No visible subject found");
  const palette = withOutlineColor(
    createPalette([raster], [mask], normalized.profile.paletteSize)
  );
  return buildModel(raster, mask, bounds, normalized, palette, undefined, prepared.depth);
}

export async function imagesToVoxels(
  views: ImageViews,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  if (!views.front) throw new Error("FRONT IMAGE REQUIRED");
  const normalized = normalizeOptions(options);
  const frontPrepared = await prepareRaster(await loadImage(views.front), normalized.useLocalAi);
  const frontRaster = frontPrepared.raster;
  const frontMask = buildSubjectMask(frontRaster, normalized.profile);
  const frontBounds = findBounds(frontMask);
  if (!frontBounds) throw new Error("No visible subject found in FRONT");
  if (!views.side) {
    const palette = withOutlineColor(
      createPalette([frontRaster], [frontMask], normalized.profile.paletteSize)
    );
    return buildModel(
      frontRaster,
      frontMask,
      frontBounds,
      normalized,
      palette,
      undefined,
      frontPrepared.depth
    );
  }
  const sidePrepared = await prepareRaster(await loadImage(views.side), normalized.useLocalAi);
  const sideRaster = sidePrepared.raster;
  const sideMask = buildSubjectMask(sideRaster, normalized.profile);
  const sideBounds = findBounds(sideMask);
  if (!sideBounds) throw new Error("No visible subject found in SIDE");
  const palette = withOutlineColor(
    createPalette(
      [frontRaster, sideRaster],
      [frontMask, sideMask],
      normalized.profile.paletteSize
    )
  );
  return buildModel(
    frontRaster,
    frontMask,
    frontBounds,
    normalized,
    palette,
    { raster: sideRaster, mask: sideMask, bounds: sideBounds },
    frontPrepared.depth
  );
}

export { DEFAULT_PALETTE };
