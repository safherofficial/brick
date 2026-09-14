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
  "#4b5563",
  "#9ca3af",
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

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp(t, 0, 1);
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k
  ];
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
  const largest = Math.max(...parts.map((part) => part.length));
  const min = Math.max(24, Math.round(largest * 0.015));
  const out = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  for (const cells of parts) {
    if (cells.length < min) continue;
    for (const [x, y] of cells) out[y][x] = true;
  }
  return out;
}

function fillInteriorHoles(mask: boolean[][]) {
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
  if (holes.length > Math.max(16, Math.round(w * h * 0.01))) return mask;
  const out = mask.map((row) => row.slice());
  for (const [x, y] of holes) out[y][x] = true;
  return out;
}

async function buildSubjectMask(raster: Raster) {
  let alphaHits = 0;
  for (let i = 3; i < raster.rgba.length; i += 4) {
    if (raster.rgba[i] < 128) alphaHits += 1;
  }
  const useAlpha = alphaHits / (raster.width * raster.height) >= 0.02;
  let best: boolean[][] | null = null;
  let bestScore = -1;
  for (const tol of [24, 32, 40, 52, 64, 80]) {
    const raw = fillInteriorHoles(dropIslands(floodSubject(raster, tol, useAlpha)));
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
  const refined = await refineSubjectMask(best);
  return fillInteriorHoles(dropIslands(refined));
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
      if (nx >= 0 && nx < w) out[y][nx] = true;
    }
  }
  return out;
}

function rowSpan(row: boolean[] | undefined): Span | null {
  if (!row) return null;
  let min = -1;
  let max = -1;
  for (let i = 0; i < row.length; i += 1) {
    if (!row[i]) continue;
    if (min < 0) min = i;
    max = i;
  }
  return min < 0 ? null : { min, max };
}

function sideProfile(mask: boolean[][]): Array<Span | null> {
  return mask.map((row) => rowSpan(row));
}

function profileCoverage(front: boolean[][], profile: Array<Span | null>) {
  let frontRows = 0;
  let hitRows = 0;
  for (let y = 0; y < front.length; y += 1) {
    if (!front[y].some(Boolean)) continue;
    frontRows += 1;
    if (profile[y]) hitRows += 1;
  }
  return frontRows ? hitRows / frontRows : 0;
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

type ColorField = {
  colors: (Rgb | null)[][];
  nearest: Int32Array;
  width: number;
  height: number;
  leftEdge: Rgb[];
  rightEdge: Rgb[];
}

function buildColorField(colors: (Rgb | null)[][], mask: boolean[][]): ColorField {
  const height = colors.length;
  const width = colors[0]?.length ?? 0;
  const nearest = new Int32Array(Math.max(0, width * height));
  nearest.fill(-1);

  const queueX = new Int32Array(Math.max(1, width * height));
  const queueY = new Int32Array(Math.max(1, width * height));
  let head = 0;
  let tail = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y]?.[x] || !colors[y]?.[x]) continue;
      const index = y * width + x;
      nearest[index] = index;
      queueX[tail] = x;
      queueY[tail] = y;
      tail += 1;
    }
  }

  const neighbours = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],            [1, 0],
    [-1, 1],  [0, 1],   [1, 1]
  ] as const;

  while (head < tail) {
    const x = queueX[head];
    const y = queueY[head];
    const sourceIndex = nearest[y * width + x];
    head += 1;

    for (const [dx, dy] of neighbours) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const target = ny * width + nx;
      if (nearest[target] !== -1) continue;
      nearest[target] = sourceIndex;
      queueX[tail] = nx;
      queueY[tail] = ny;
      tail += 1;
    }
  }

  const fallback: Rgb = [214, 214, 214];
  const leftEdge: Rgb[] = Array.from({ length: height }, () => fallback);
  const rightEdge: Rgb[] = Array.from({ length: height }, () => fallback);

  for (let y = 0; y < height; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x += 1) {
      if (mask[y]?.[x]) {
        left = x;
        break;
      }
    }
    for (let x = width - 1; x >= 0; x -= 1) {
      if (mask[y]?.[x]) {
        right = x;
        break;
      }
    }

    if (left >= 0) {
      const idx = nearest[y * width + left];
      const source = idx >= 0 ? colors[Math.floor(idx / width)]?.[idx % width] : null;
      if (source) leftEdge[y] = source;
    }
    if (right >= 0) {
      const idx = nearest[y * width + right];
      const source = idx >= 0 ? colors[Math.floor(idx / width)]?.[idx % width] : null;
      if (source) rightEdge[y] = source;
    }
  }

  return { colors, nearest, width, height, leftEdge, rightEdge };
}

function nearestPaint(field: ColorField, x: number, y: number): Rgb {
  if (!field.width || !field.height) return [214, 214, 214];
  const xx = clamp(Math.round(x), 0, field.width - 1);
  const yy = clamp(Math.round(y), 0, field.height - 1);
  const sourceIndex = field.nearest[yy * field.width + xx];
  if (sourceIndex < 0) return [214, 214, 214];
  return field.colors[Math.floor(sourceIndex / field.width)]?.[sourceIndex % field.width] ?? [214, 214, 214];
}

function edgeColor(field: ColorField, y: number, fromLeft: boolean): Rgb {
  if (y < 0 || y >= field.height) return [214, 214, 214];
  return fromLeft ? field.leftEdge[y] : field.rightEdge[y];
}

function boundaryWeight(
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  frontMask: boolean[][],
  sideMask?: boolean[][] | null
) {
  let frontBoundary = 0;
  const frontHere = Boolean(frontMask[y]?.[x]);
  if (frontHere) {
    let exposed = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      if (!frontMask[y + dy]?.[x + dx]) exposed += 1;
    }
    frontBoundary = exposed / 4;
  }

  let sideBoundary = 0;
  if (sideMask) {
    const sideHere = Boolean(sideMask[y]?.[z]);
    if (sideHere) {
      let exposed = 0;
      for (const [dz, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        if (!sideMask[y + dy]?.[z + dz]) exposed += 1;
      }
      sideBoundary = exposed / 4;
    }
  }

  const frontFace =
    z === 0 || z === depth - 1
      ? 1
      : Math.max(frontBoundary, 0.18);

  const sideFace =
    sideMask
      ? Math.max(sideBoundary, z === 0 || z === depth - 1 ? 0.65 : 0.08)
      : 0;

  const silhouetteBias =
    width <= 1
      ? 0
      : Math.max(0, 1 - Math.abs((x / (width - 1)) * 2 - 1));

  return { frontFace, sideFace, silhouetteBias };
}

function wrapColor(
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  frontMask: boolean[][],
  frontField: ColorField,
  sideMask?: boolean[][] | null,
  sideField?: ColorField | null
): Rgb {
  const front = nearestPaint(frontField, x, y);
  const rearProjection = nearestPaint(
    frontField,
    clamp(width - 1 - x, 0, width - 1),
    y
  );

  const hasSide = Boolean(sideMask && sideField);
  const side = hasSide
    ? nearestPaint(sideField!, z, y)
    : rearProjection;

  const { frontFace, sideFace, silhouetteBias } = boundaryWeight(
    x,
    y,
    z,
    width,
    depth,
    frontMask,
    sideMask
  );

  const nz = depth <= 1 ? 0.5 : z / (depth - 1);

  // Front material remains dominant near the observed FRONT surface.
  let color = mixRgb(
    front,
    side,
    hasSide ? clamp(0.22 + sideFace * 0.58, 0, 0.82) : 0
  );

  // Infer unobserved depth from coherent source colors instead of darkening it.
  if (z > 0 && z < depth - 1) {
    const inferredRear = mixRgb(front, rearProjection, 0.5 + (nz - 0.5) * 0.28);
    color = mixRgb(color, inferredRear, 0.18 + (1 - frontFace) * 0.18);
  }

  const rim = mixRgb(
    edgeColor(frontField, y, true),
    edgeColor(frontField, y, false),
    width <= 1 ? 0.5 : x / (width - 1)
  );

  return mixRgb(
    color,
    rim,
    clamp(0.06 + silhouetteBias * 0.10 + frontFace * 0.18, 0, 0.36)
  );
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

function createPalette(rasters: Raster[], masks: boolean[][][], size = 56) {
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
          Math.round(p.rgb[0] / 8) * 8,
          Math.round(p.rgb[1] / 8) * 8,
          Math.round(p.rgb[2] / 8) * 8
        ];
        const key = rgb.join(":");
        const hit = buckets.get(key);
        if (hit) hit.n += 1;
        else buckets.set(key, { rgb, n: 1 });
      }
    }
  }
  const chosen: Rgb[] = [];
  for (const item of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    if (chosen.every((c) => dist2(c, item.rgb) > 600)) chosen.push(item.rgb);
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
      Number.parseInt(h.slice(0, 2), 16) || 0,
      Number.parseInt(h.slice(2, 4), 16) || 0,
      Number.parseInt(h.slice(4, 6), 16) || 0
    ];
  });
}

function voxelKey(v: ImageVoxel) {
  return `${v.x}:${v.y}:${v.z}`;
}

function keepLargest(voxels: ImageVoxel[]) {
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
        const key = `${cur.x + dx}:${cur.y + dy}:${cur.z + dz}`;
        if (seen.has(key)) continue;
        const next = map.get(key);
        if (!next) continue;
        seen.add(key);
        stack.push(next);
      }
    }

    parts.push(part);
  }

  const largest = Math.max(...parts.map((part) => part.length));
  const min = Math.max(8, Math.round(largest * 0.005));
  return parts.filter((part) => part.length >= min).flat();
}

function removeIsolatedVoxels(voxels: ImageVoxel[]) {
  if (voxels.length < 3) return voxels;

  const map = new Set(voxels.map(voxelKey));
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ] as const;

  return voxels.filter((v) => {
    let neighbors = 0;
    for (const [dx, dy, dz] of dirs) {
      if (map.has(`${v.x + dx}:${v.y + dy}:${v.z + dz}`)) {
        neighbors += 1;
        if (neighbors >= 1) return true;
      }
    }
    return false;
  });
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
    const key = `${mx}:${voxel.y}:${voxel.z}`;
    if (existing.has(key)) continue;
    existing.add(key);
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

function modelSize(
  bounds: Bounds,
  volumeSize: number,
  heightMax: number,
  maxVoxels: number,
  symmetrize: boolean
) {
  const maxAxis = Math.max(8, volumeSize - 6);
  const safeBudget = Math.max(4096, Math.min(maxVoxels, volumeSize ** 3 * 0.90));

  const aspectW = Math.max(0.05, bounds.width / Math.max(1, bounds.height));
  let height = Math.min(maxAxis, Math.max(8, bounds.height));
  let width = Math.min(maxAxis, Math.max(8, Math.round(height * aspectW)));
  let depth = Math.min(maxAxis, Math.max(3, Math.round(heightMax)));

  let product = width * height * depth;
  const target = Math.max(4096, safeBudget * (symmetrize ? 0.44 : 0.92));

  if (product > target) {
    const scale = Math.cbrt(target / product);
    width = Math.max(8, Math.floor(width * scale));
    height = Math.max(8, Math.floor(height * scale));
    depth = Math.max(3, Math.floor(depth * scale));
  }

  while (width * height * depth > safeBudget) {
    if (height >= width && height >= depth && height > 8) height -= 1;
    else if (width >= depth && width > 8) width -= 1;
    else if (depth > 3) depth -= 1;
    else break;
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

function inSpan(z: number, span: Span | null, centerZ: number, radius: number) {
  if (span) return z >= span.min - 1 && z <= span.max + 1;
  return Math.abs(z - centerZ) <= radius;
}

function buildModel(
  frontRaster: Raster,
  frontMask: boolean[][],
  frontBounds: Bounds,
  options: Required<ImageVoxelOptions>,
  palette: string[],
  side?: { raster: Raster; mask: boolean[][]; bounds: Bounds },
  depthMap?: Float32Array | null
): ImageImport {
  const dims = modelSize(
    frontBounds,
    options.volumeSize,
    options.heightMax,
    options.maxVoxels,
    options.symmetrize
  );
  const front = resampleMask(frontMask, frontBounds, dims.width, dims.height);
  const frontColors = resampleColor(frontRaster, frontMask, frontBounds, dims.width, dims.height);
  const frontField = buildColorField(frontColors, front);
  const mappedDepth = resampleDepth(
    depthMap,
    frontRaster.width,
    frontRaster.height,
    frontBounds,
    dims.width,
    dims.height
  );
  const dist = distanceField(front);
  let maxDist = 1;
  for (const row of dist) for (const value of row) maxDist = Math.max(maxDist, value);

  let sideMask: boolean[][] | null = null;
  let sideColors: (Rgb | null)[][] | null = null;
  let sideField: ColorField | null = null;
  let profile: Array<Span | null> | null = null;
  if (side) {
    sideMask = centerMaskX(resampleMask(side.mask, side.bounds, dims.depth, dims.height));
    sideColors = resampleColor(side.raster, side.mask, side.bounds, dims.depth, dims.height);
    sideField = buildColorField(sideColors, sideMask);
    const raw = sideProfile(sideMask);
    profile = profileCoverage(front, raw) >= 0.35 ? raw : null;
  }

  const colors = paletteRgb(palette);
  const voxels: ImageVoxel[] = [];
  const centerZ = (dims.depth - 1) / 2;
  const maxRadius = Math.max(1, Math.floor((dims.depth - 1) / 2));

  for (let y = 0; y < dims.height; y += 1) {
    const span = profile?.[y] ?? null;
    for (let x = 0; x < dims.width; x += 1) {
      if (!front[y][x]) continue;
      const t = dist[y][x] / maxDist;
      const depthT = sampleDepth(mappedDepth, x, y, dims.width);
      const mixed = depthT === null ? t : 0.35 * t + 0.65 * depthT;
      const radius = Math.max(1, Math.round((0.28 + 0.72 * mixed) * maxRadius));
      for (let z = 0; z < dims.depth; z += 1) {
        if (!inSpan(z, span, centerZ, radius)) continue;
        if (!span && Math.abs(z - centerZ) > radius) continue;
        voxels.push({
          x,
          y,
          z,
          c: nearestColor(
            wrapColor(x, y, z, dims.width, dims.depth, front, frontField, sideMask, sideField),
            colors
          )
        });
      }
    }
  }

  if (!voxels.length) throw new Error("No voxels reconstructed");

  let cleaned = voxels.map((v) => ({
    ...v,
    y: dims.height - 1 - v.y
  }));

  // BVH spatial cleanup is intentionally not run in the image reconstruction
  // path. Point-cloud BVH queries are CPU-heavy on the browser main thread and
  // can freeze the Builder when a second FRONT/SIDE image is imported.
  // The deterministic voxel cleanup below is sufficient for reconstruction.
  cleaned = keepLargest(cleaned);

  if (options.symmetrize) {
    symmetrizeVoxels(cleaned, options.volumeSize);
    cleaned = keepLargest(cleaned);
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

function normalizeOptions(options: ImageVoxelOptions): Required<ImageVoxelOptions> {
  return {
    volumeSize: options.volumeSize ?? 128,
    heightMax: options.heightMax ?? 8,
    maxVoxels: options.maxVoxels ?? 100000,
    symmetrize: options.symmetrize ?? false,
    useLocalAi: options.useLocalAi ?? true
  };
}

async function refineSubjectMask(mask: boolean[][]) {
  const { refineMaskWithOpenCv } = await import("@/lib/ai/opencv");
  return refineMaskWithOpenCv(mask);
}

async function prepareRaster(raster: Raster, enabled: boolean) {
  if (!enabled) return { raster, depth: null as Float32Array | null };
  const { enhanceRaster } = await import("@/lib/ai/enhance");
  return enhanceRaster(raster);
}

export async function imageToVoxels(file: File, options: ImageVoxelOptions = {}): Promise<ImageImport> {
  const normalized = normalizeOptions(options);
  const prepared = await prepareRaster(await loadImage(file), normalized.useLocalAi);
  const raster = prepared.raster;
  const mask = await buildSubjectMask(raster);
  const bounds = findBounds(mask);
  if (!bounds) throw new Error("No visible subject found");
  return buildModel(raster, mask, bounds, normalized, createPalette([raster], [mask]), undefined, prepared.depth);
}

export async function imagesToVoxels(views: ImageViews, options: ImageVoxelOptions = {}): Promise<ImageImport> {
  if (!views.front) throw new Error("FRONT IMAGE REQUIRED");
  const normalized = normalizeOptions(options);
  const frontPrepared = await prepareRaster(await loadImage(views.front), normalized.useLocalAi);
  const frontRaster = frontPrepared.raster;
  const frontMask = await buildSubjectMask(frontRaster);
  const frontBounds = findBounds(frontMask);
  if (!frontBounds) throw new Error("No visible subject found in FRONT");
  if (!views.side) {
    return buildModel(
      frontRaster,
      frontMask,
      frontBounds,
      normalized,
      createPalette([frontRaster], [frontMask]),
      undefined,
      frontPrepared.depth
    );
  }
  // SIDE uses the deterministic/OpenCV mask pipeline. Running the local depth model
  // a second time here blocks the browser main thread and its depth map is not used
  // by buildModel; keep the SIDE raster raw while retaining OpenCV refinement below.
  const sideRaster = await loadImage(views.side);
  const sideMask = await buildSubjectMask(sideRaster);
  const sideBounds = findBounds(sideMask);
  if (!sideBounds) throw new Error("No visible subject found in SIDE");
  return buildModel(
    frontRaster,
    frontMask,
    frontBounds,
    normalized,
    createPalette([frontRaster, sideRaster], [frontMask, sideMask]),
    { raster: sideRaster, mask: sideMask, bounds: sideBounds },
    frontPrepared.depth
  );
}
