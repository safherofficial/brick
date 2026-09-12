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

type Sample = {
  r: number;
  g: number;
  b: number;
  a: number;
  visible: boolean;
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

const DEFAULT_PALETTE = [
  "#111111", "#ffffff", "#d9d9d9", "#8a8a8a", "#3f3f3f",
  "#d72d32", "#ff6b2d", "#f0c52b", "#4fae4f", "#1596d1",
  "#3456c1", "#754bc4", "#d34893", "#7a4b2a", "#5a9b47", "#9e6a3a"
];

const MAX_RASTER_EDGE = 512;
const MIN_ALPHA = 16;
const BG_COLOR_TOL = 38;
const BG_LUMA_TOL = 28;
const MIN_COMPONENT_RATIO = 0.004;
const MIN_COMPONENT_PIXELS = 32;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function hexOf(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgbDistance(a: [number, number, number], b: [number, number, number]) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
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

function sampleAt(raster: Raster, x: number, y: number): Sample {
  const xx = clamp(Math.round(x), 0, raster.width - 1);
  const yy = clamp(Math.round(y), 0, raster.height - 1);
  const i = (yy * raster.width + xx) * 4;
  const r = raster.rgba[i];
  const g = raster.rgba[i + 1];
  const b = raster.rgba[i + 2];
  const a = raster.rgba[i + 3];
  return { r, g, b, a, visible: a >= MIN_ALPHA };
}

function borderProbes(raster: Raster): [number, number, number][] {
  const probes: [number, number, number][] = [];
  const add = (x: number, y: number) => {
    const s = sampleAt(raster, x, y);
    if (!s.visible) return;
    const color: [number, number, number] = [s.r, s.g, s.b];
    if (!probes.some((p) => rgbDistance(p, color) < 28 * 28)) probes.push(color);
  };
  const n = 32;
  for (let i = 0; i < n; i += 1) {
    const t = i / Math.max(1, n - 1);
    add(Math.round(t * (raster.width - 1)), 0);
    add(Math.round(t * (raster.width - 1)), raster.height - 1);
    add(0, Math.round(t * (raster.height - 1)));
    add(raster.width - 1, Math.round(t * (raster.height - 1)));
  }
  return probes;
}

function isBackground(
  sample: Sample,
  probes: [number, number, number][],
  colorTol: number,
  lumaTol: number,
  maxSat: number
) {
  if (!sample.visible) return true;
  if (!probes.length) return false;
  const sampleL = luma(sample.r, sample.g, sample.b);
  const sat =
    Math.max(sample.r, sample.g, sample.b) -
    Math.min(sample.r, sample.g, sample.b);
  for (const probe of probes) {
    const dist = Math.sqrt(rgbDistance([sample.r, sample.g, sample.b], probe));
    if (
      dist <= colorTol &&
      Math.abs(sampleL - luma(probe[0], probe[1], probe[2])) <= lumaTol &&
      sat <= maxSat
    ) {
      return true;
    }
  }
  return false;
}

function coverageOf(mask: boolean[][]) {
  let hits = 0;
  let total = 0;
  for (const row of mask) {
    for (const bit of row) {
      total += 1;
      if (bit) hits += 1;
    }
  }
  return total ? hits / total : 0;
}

function alphaMask(raster: Raster) {
  return Array.from({ length: raster.height }, (_, y) =>
    Array.from({ length: raster.width }, (_, x) => sampleAt(raster, x, y).visible)
  );
}

function hasUsefulAlpha(raster: Raster) {
  let transparent = 0;
  const total = raster.width * raster.height;
  for (let i = 3; i < raster.rgba.length; i += 4) {
    if (raster.rgba[i] < 128) transparent += 1;
  }
  return transparent / Math.max(1, total) >= 0.01;
}

function floodBackground(
  raster: Raster,
  colorTol: number,
  lumaTol: number,
  maxSat: number
) {
  const probes = borderProbes(raster);
  const w = raster.width;
  const h = raster.height;
  const candidate = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      candidate[y][x] = isBackground(
        sampleAt(raster, x, y),
        probes,
        colorTol,
        lumaTol,
        maxSat
      );
    }
  }

  const bg = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  const stack: [number, number][] = [];
  const seed = (x: number, y: number) => {
    if (candidate[y][x] && !bg[y][x]) {
      bg[y][x] = true;
      stack.push([x, y]);
    }
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
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (bg[ny][nx] || !candidate[ny][nx]) continue;
      bg[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }

  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => !bg[y][x] && sampleAt(raster, x, y).visible)
  );
}

function morph(mask: boolean[][], minHits: number, fill: boolean): boolean[][] {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  const out = mask.map((row) => row.slice());
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (mask[y][x] === fill) continue;
      let hits = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (!ox && !oy) continue;
          if (mask[y + oy]?.[x + ox]) hits += 1;
        }
      }
      if (hits >= minHits) out[y][x] = fill;
    }
  }
  return out;
}

function dropSmallComponents(mask: boolean[][]) {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  const visited = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  const parts: [number, number][][] = [];

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x] || visited[y][x]) continue;
      const cells: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];
      visited[y][x] = true;
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
          if (!mask[ny][nx] || visited[ny][nx]) continue;
          visited[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      parts.push(cells);
    }
  }

  if (!parts.length) return mask;
  const largest = Math.max(...parts.map((p) => p.length));
  const minSize = Math.min(
    largest,
    Math.max(MIN_COMPONENT_PIXELS, Math.round(largest * MIN_COMPONENT_RATIO))
  );
  const out = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  for (const cells of parts) {
    if (cells.length < minSize && cells.length < largest) continue;
    for (const [x, y] of cells) out[y][x] = true;
  }
  return out;
}

function polishMask(mask: boolean[][]) {
  let next = morph(mask, 6, true);
  next = morph(next, 7, false);
  next = dropSmallComponents(next);
  return coverageOf(next) > 0 ? next : mask;
}

function cleanMask(raster: Raster) {
  if (hasUsefulAlpha(raster)) {
    const fromAlpha = polishMask(alphaMask(raster));
    if (coverageOf(fromAlpha) >= 0.002) return fromAlpha;
  }

  const attempts: [number, number, number][] = [
    [28, 22, 55],
    [38, 28, 90],
    [58, 40, 140],
    [84, 56, 220]
  ];

  let best: boolean[][] | null = null;
  let bestScore = -1;

  for (const [colorTol, lumaTol, maxSat] of attempts) {
    const raw = floodBackground(raster, colorTol, lumaTol, maxSat);
    const polished = polishMask(raw);
    const cov = coverageOf(polished);
    if (cov < 0.004 || cov > 0.97) continue;
    const score = cov < 0.65 ? cov : 1.3 - cov;
    if (score > bestScore) {
      best = polished;
      bestScore = score;
    }
  }

  if (best) return best;

  const opaque = alphaMask(raster);
  if (coverageOf(opaque) >= 0.002) return polishMask(opaque);

  return Array.from({ length: raster.height }, () =>
    Array.from({ length: raster.width }, () => true)
  );
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

function resampleMask(mask: boolean[][], bounds: Bounds, width: number, height: number) {
  const out = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
  for (let y = 0; y < height; y += 1) {
    const srcY = Math.round(
      bounds.minY + (y / Math.max(1, height - 1)) * (bounds.height - 1)
    );
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.round(
        bounds.minX + (x / Math.max(1, width - 1)) * (bounds.width - 1)
      );
      out[y][x] = !!mask[srcY]?.[srcX];
    }
  }
  return out;
}

function resampleColor(
  raster: Raster,
  mask: boolean[][],
  bounds: Bounds,
  width: number,
  height: number
) {
  const colors: ([number, number, number] | null)[][] = Array.from(
    { length: height },
    () => Array(width).fill(null)
  );
  for (let y = 0; y < height; y += 1) {
    const srcY =
      bounds.minY + (y / Math.max(1, height - 1)) * (bounds.height - 1);
    for (let x = 0; x < width; x += 1) {
      const srcX =
        bounds.minX + (x / Math.max(1, width - 1)) * (bounds.width - 1);
      const sx = Math.round(srcX);
      const sy = Math.round(srcY);
      if (!mask[sy]?.[sx]) continue;
      const s = sampleAt(raster, srcX, srcY);
      colors[y][x] = [s.r, s.g, s.b];
    }
  }
  return colors;
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

function paletteRgb(palette: string[]): [number, number, number][] {
  return palette.map((hex) => {
    const h = hex.replace("#", "");
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16)
    ];
  });
}

function nearestColor(rgb: [number, number, number], palette: [number, number, number][]) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const d = rgbDistance(rgb, palette[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function createPalette(rasters: Raster[], masks: boolean[][][], size = 48) {
  const buckets = new Map<string, { r: number; g: number; b: number; weight: number }>();
  for (let v = 0; v < rasters.length; v += 1) {
    const raster = rasters[v];
    const mask = masks[v];
    const stride = Math.max(1, Math.floor(Math.sqrt((raster.width * raster.height) / 40000)));
    for (let y = 0; y < raster.height; y += stride) {
      for (let x = 0; x < raster.width; x += stride) {
        if (!mask[y]?.[x]) continue;
        const s = sampleAt(raster, x, y);
        if (!s.visible) continue;
        const r = Math.round(s.r / 8) * 8;
        const g = Math.round(s.g / 8) * 8;
        const b = Math.round(s.b / 8) * 8;
        const key = `${r}:${g}:${b}`;
        const existing = buckets.get(key);
        if (existing) existing.weight += 1;
        else buckets.set(key, { r, g, b, weight: 1 });
      }
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => b.weight - a.weight);
  const chosen: [number, number, number][] = [];
  for (const item of sorted) {
    const rgb: [number, number, number] = [item.r, item.g, item.b];
    if (chosen.every((c) => rgbDistance(rgb, c) > 900)) chosen.push(rgb);
    if (chosen.length >= size) break;
  }
  if (chosen.length < size) {
    for (const hex of DEFAULT_PALETTE) {
      if (chosen.length >= size) break;
      const h = hex.replace("#", "");
      const rgb: [number, number, number] = [
        Number.parseInt(h.slice(0, 2), 16),
        Number.parseInt(h.slice(2, 4), 16),
        Number.parseInt(h.slice(4, 6), 16)
      ];
      if (chosen.every((c) => rgbDistance(rgb, c) > 400)) chosen.push(rgb);
    }
  }
  return chosen.map(([r, g, b]) => hexOf(r, g, b));
}

function voxelKey(v: ImageVoxel) {
  return `${v.x}:${v.y}:${v.z}`;
}

function keepLargestComponents(voxels: ImageVoxel[]) {
  if (voxels.length < 2) return voxels;
  const map = new Map(voxels.map((v) => [voxelKey(v), v]));
  const visited = new Set<string>();
  const components: ImageVoxel[][] = [];
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
    if (visited.has(startKey)) continue;
    const component: ImageVoxel[] = [];
    const stack = [start];
    visited.add(startKey);
    while (stack.length) {
      const cur = stack.pop()!;
      component.push(cur);
      for (const [dx, dy, dz] of dirs) {
        const key = `${cur.x + dx}:${cur.y + dy}:${cur.z + dz}`;
        if (visited.has(key)) continue;
        const next = map.get(key);
        if (!next) continue;
        visited.add(key);
        stack.push(next);
      }
    }
    components.push(component);
  }

  if (components.length <= 1) return voxels;
  const largest = Math.max(...components.map((c) => c.length));
  const threshold = Math.max(8, Math.round(largest * 0.02));
  return components.filter((c) => c.length >= threshold).flat();
}

function symmetrizeVoxels(voxels: ImageVoxel[], volumeSize: number, paletteSize: number) {
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
    const mirroredX = Math.round(center * 2 - voxel.x);
    if (mirroredX < 0 || mirroredX >= volumeSize) continue;
    const key = `${mirroredX}:${voxel.y}:${voxel.z}`;
    if (existing.has(key)) continue;
    existing.add(key);
    voxels.push({
      x: mirroredX,
      y: voxel.y,
      z: voxel.z,
      c: clamp(voxel.c, 0, paletteSize - 1)
    });
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

function finish(
  voxels: ImageVoxel[],
  raster: Raster,
  options: Required<ImageVoxelOptions>,
  palette: string[]
): ImageImport {
  let cleaned = keepLargestComponents(voxels);
  if (options.symmetrize) {
    symmetrizeVoxels(cleaned, options.volumeSize, palette.length);
    cleaned = keepLargestComponents(cleaned);
  }
  const normalized = placeOnGround(cleaned, options.volumeSize);
  return {
    width: raster.width,
    height: raster.height,
    voxels: normalized,
    palette,
    count: normalized.length
  };
}

function modelSize(bounds: Bounds, volumeSize: number, heightMax: number) {
  const maxAxis = Math.max(8, volumeSize - 8);
  const scale = Math.min(1, maxAxis / Math.max(bounds.width, bounds.height));
  return {
    width: Math.max(4, Math.round(bounds.width * scale)),
    height: Math.max(4, Math.round(bounds.height * scale)),
    depth: Math.max(2, Math.min(maxAxis, Math.round(heightMax)))
  };
}

function buildSculpted(
  frontRaster: Raster,
  frontMask: boolean[][],
  frontBounds: Bounds,
  options: Required<ImageVoxelOptions>,
  palette: string[],
  side?: { raster: Raster; mask: boolean[][]; bounds: Bounds }
): ImageImport {
  const dims = modelSize(frontBounds, options.volumeSize, options.heightMax);
  const front = resampleMask(frontMask, frontBounds, dims.width, dims.height);
  const colors = resampleColor(frontRaster, frontMask, frontBounds, dims.width, dims.height);
  const dist = distanceField(front);
  let maxDist = 1;
  for (const row of dist) for (const v of row) maxDist = Math.max(maxDist, v);

  let sideMask: boolean[][] | null = null;
  let sideColors: ([number, number, number] | null)[][] | null = null;
  if (side) {
    sideMask = resampleMask(side.mask, side.bounds, dims.depth, dims.height);
    sideColors = resampleColor(side.raster, side.mask, side.bounds, dims.depth, dims.height);
  }

  const paletteValues = paletteRgb(palette);
  const voxels: ImageVoxel[] = [];
  const centerZ = (dims.depth - 1) / 2;

  for (let y = 0; y < dims.height; y += 1) {
    for (let x = 0; x < dims.width; x += 1) {
      if (!front[y][x]) continue;
      const rgb = colors[y][x];
      if (!rgb) continue;

      const half = Math.max(1, Math.round((dist[y][x] / maxDist) * (dims.depth / 2)));

      for (let z = 0; z < dims.depth; z += 1) {
        if (Math.abs(z - centerZ) > half) continue;
        if (sideMask && !sideMask[y]?.[z]) continue;

        const useSide =
          sideColors?.[y]?.[z] &&
          (z === 0 || z === dims.depth - 1 || Math.abs(z - centerZ) > half - 1);
        const shade = 0.88 + 0.12 * (1 - Math.abs(z - centerZ) / Math.max(1, half));
        const src = useSide ? sideColors![y][z]! : rgb;
        voxels.push({
          x,
          y,
          z,
          c: nearestColor([src[0] * shade, src[1] * shade, src[2] * shade], paletteValues)
        });
      }
    }
  }

  if (!voxels.length) throw new Error("No voxels reconstructed");

  const flipped = voxels.map((v) => ({
    ...v,
    y: dims.height - 1 - v.y
  }));

  return finish(flipped, frontRaster, options, palette);
}

function normalizeOptions(options: ImageVoxelOptions): Required<ImageVoxelOptions> {
  return {
    volumeSize: options.volumeSize ?? 128,
    heightMax: options.heightMax ?? 12,
    maxVoxels: options.maxVoxels ?? 100000,
    symmetrize: options.symmetrize ?? false
  };
}

export async function imageToVoxels(
  file: File,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  const normalized = normalizeOptions(options);
  const raster = await loadImage(file);
  const mask = cleanMask(raster);
  const bounds = findBounds(mask);
  if (!bounds) throw new Error("No visible subject found");
  const palette = createPalette([raster], [mask], 64);
  return buildSculpted(raster, mask, bounds, normalized, palette);
}

export async function imagesToVoxels(
  views: ImageViews,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  if (!views.front) throw new Error("FRONT IMAGE REQUIRED");
  const normalized = normalizeOptions(options);
  const frontRaster = await loadImage(views.front);
  const frontMask = cleanMask(frontRaster);
  const frontBounds = findBounds(frontMask);
  if (!frontBounds) throw new Error("No visible subject found in FRONT");

  if (!views.side) {
    const palette = createPalette([frontRaster], [frontMask], 64);
    return buildSculpted(frontRaster, frontMask, frontBounds, normalized, palette);
  }

  const sideRaster = await loadImage(views.side);
  const sideMask = cleanMask(sideRaster);
  const sideBounds = findBounds(sideMask);
  if (!sideBounds) throw new Error("No visible subject found in SIDE");
  const palette = createPalette(
    [frontRaster, sideRaster],
    [frontMask, sideMask],
    64
  );
  return buildSculpted(frontRaster, frontMask, frontBounds, normalized, palette, {
    raster: sideRaster,
    mask: sideMask,
    bounds: sideBounds
  });
}
