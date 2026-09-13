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

const DEFAULT_PALETTE = [
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
  "#111111",
  "#6b7280",
  "#f2f0e8",
  "#ffffff"
];

const MAX_RASTER_EDGE = 640;
const MIN_ALPHA = 12;

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

function loadImage(file: File): Promise<Raster> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(
          1,
          MAX_RASTER_EDGE / Math.max(img.naturalWidth, img.naturalHeight)
        );
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve({
          width,
          height,
          rgba: ctx.getImageData(0, 0, width, height).data
        });
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
  const xx = clamp(x, 0, raster.width - 1);
  const yy = clamp(y, 0, raster.height - 1);
  const i = (yy * raster.width + xx) * 4;
  return {
    rgb: [raster.rgba[i], raster.rgba[i + 1], raster.rgba[i + 2]] as Rgb,
    a: raster.rgba[i + 3]
  };
}

function cornerBackground(raster: Raster): Rgb {
  const pts = [
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
  return [r / n, g / n, b / b ? b / n : 255];
}

function isBg(rgb: Rgb, a: number, bg: Rgb, tol: number) {
  if (a < MIN_ALPHA) return true;
  const d = Math.sqrt(dist2(rgb, bg));
  const dl = Math.abs(luma(rgb) - luma(bg));
  const colorful = sat(rgb) >= 40;
  if (colorful && d > 28) return false;
  return d <= tol && dl <= tol * 0.85;
}

function buildSubjectMask(raster: Raster) {
  const w = raster.width;
  const h = raster.height;
  const bg = cornerBackground(raster);
  const alphaCount = (() => {
    let n = 0;
    for (let i = 3; i < raster.rgba.length; i += 4) if (raster.rgba[i] < 128) n += 1;
    return n;
  })();
  const useAlpha = alphaCount / (w * h) >= 0.02;

  const tryTol = (tol: number) => {
    const candidate = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = pixel(raster, x, y);
        candidate[y][x] = useAlpha
          ? p.a < MIN_ALPHA || isBg(p.rgb, p.a, bg, tol)
          : isBg(p.rgb, p.a, bg, tol);
      }
    }
    const visited = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
    const stack: [number, number][] = [];
    const seed = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      if (!candidate[y][x] || visited[y][x]) return;
      visited[y][x] = true;
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
      Array.from({ length: w }, (_, x) => !visited[y][x] && pixel(raster, x, y).a >= MIN_ALPHA)
    );
  };

  const scoreMask = (mask: boolean[][]) => {
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
    if (hits < 32) return { hits, fill: 0, frame: true, mask };
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const fill = hits / (bw * bh);
    const fullPlane = bw >= w * 0.92 && bh >= h * 0.92;
    const frame = fullPlane && fill < 0.12;
    return { hits, fill, frame, mask };
  };

  let best: boolean[][] | null = null;
  let bestHits = 0;
  for (const tol of [26, 36, 48, 64, 84]) {
    const scored = scoreMask(tryTol(tol));
    if (scored.frame) continue;
    if (scored.hits > bestHits && scored.fill >= 0.12) {
      best = scored.mask;
      bestHits = scored.hits;
    }
  }

  if (!best) {
    for (const tol of [22, 40, 72]) {
      const scored = scoreMask(tryTol(tol));
      if (!scored.frame && scored.hits > bestHits) {
        best = scored.mask;
        bestHits = scored.hits;
      }
    }
  }

  if (!best || bestHits < 32) {
    throw new Error("No visible subject found");
  }

  const kept = dropIslands(best);
  if (scoreMask(kept).hits < 32) throw new Error("No visible subject found");
  return kept;
}

function dropIslands(mask: boolean[][]) {
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
  const largest = Math.max(...parts.map((p) => p.length));
  const min = Math.max(24, Math.round(largest * 0.02));
  const out = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  for (const cells of parts) {
    if (cells.length < min) continue;
    for (const [x, y] of cells) out[y][x] = true;
  }
  return out;
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
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
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

function createPalette(raster: Raster, mask: boolean[][], size = 48) {
  const buckets = new Map<string, { rgb: Rgb; n: number }>();
  for (let y = 0; y < raster.height; y += 2) {
    for (let x = 0; x < raster.width; x += 2) {
      if (!mask[y]?.[x]) continue;
      const p = pixel(raster, x, y);
      if (p.a < MIN_ALPHA) continue;
      const r = Math.round(p.rgb[0] / 8) * 8;
      const g = Math.round(p.rgb[1] / 8) * 8;
      const b = Math.round(p.rgb[2] / 8) * 8;
      const key = `${r}:${g}:${b}`;
      const hit = buckets.get(key);
      if (hit) hit.n += 1;
      else buckets.set(key, { rgb: [r, g, b], n: 1 });
    }
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  const chosen: Rgb[] = [];
  for (const item of sorted) {
    if (chosen.every((c) => dist2(c, item.rgb) > 650)) chosen.push(item.rgb);
    if (chosen.length >= size) break;
  }
  for (const hex of DEFAULT_PALETTE) {
    if (chosen.length >= size) break;
    const h = hex.replace("#", "");
    const rgb: Rgb = [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16)
    ];
    if (chosen.every((c) => dist2(c, rgb) > 400)) chosen.push(rgb);
  }
  return chosen.map((c) => hexOf(c[0], c[1], c[2]));
}

function paletteRgb(palette: string[]): Rgb[] {
  return palette.map((hex) => {
    const h = hex.replace("#", "");
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16)
    ];
  });
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

function buildSolidModel(
  raster: Raster,
  mask: boolean[][],
  bounds: Bounds,
  options: Required<ImageVoxelOptions>,
  palette: string[]
): ImageImport {
  const maxAxis = Math.max(8, options.volumeSize - 6);
  const scale = Math.min(1, maxAxis / Math.max(bounds.width, bounds.height));
  const width = Math.max(4, Math.round(bounds.width * scale));
  const height = Math.max(4, Math.round(bounds.height * scale));
  const depth = Math.max(2, Math.min(maxAxis, Math.round(options.heightMax)));
  const colors = paletteRgb(palette);
  const voxels: ImageVoxel[] = [];

  for (let y = 0; y < height; y += 1) {
    const srcY = Math.round(bounds.minY + (y / Math.max(1, height - 1)) * (bounds.height - 1));
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.round(bounds.minX + (x / Math.max(1, width - 1)) * (bounds.width - 1));
      if (!mask[srcY]?.[srcX]) continue;
      const p = pixel(raster, srcX, srcY);
      const c = nearestColor(p.rgb, colors);
      for (let z = 0; z < depth; z += 1) {
        voxels.push({ x, y, z, c });
      }
    }
  }

  if (!voxels.length) throw new Error("No voxels reconstructed");

  const flipped = voxels.map((v) => ({ ...v, y: height - 1 - v.y }));
  const grounded = placeOnGround(flipped, options.volumeSize);
  return {
    width: raster.width,
    height: raster.height,
    voxels: grounded,
    palette,
    count: grounded.length
  };
}

function normalizeOptions(options: ImageVoxelOptions): Required<ImageVoxelOptions> {
  return {
    volumeSize: options.volumeSize ?? 128,
    heightMax: options.heightMax ?? 12,
    maxVoxels: options.maxVoxels ?? 100000,
    symmetrize: options.symmetrize ?? false
  };
}

function convert(raster: Raster, options: Required<ImageVoxelOptions>): ImageImport {
  const mask = buildSubjectMask(raster);
  const bounds = findBounds(mask);
  if (!bounds) throw new Error("No visible subject found");
  const palette = createPalette(raster, mask, 64);
  return buildSolidModel(raster, mask, bounds, options, palette);
}

export async function imageToVoxels(
  file: File,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  return convert(await loadImage(file), normalizeOptions(options));
}

export async function imagesToVoxels(
  views: ImageViews,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  if (!views.front) throw new Error("FRONT IMAGE REQUIRED");
  return convert(await loadImage(views.front), normalizeOptions(options));
}
