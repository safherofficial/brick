export type ImageMode =
  | "solid"
  | "flat"
  | "relief"
  | "model";

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
  mode?: ImageMode;
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

type Dimensions = {
  width: number;
  height: number;
  depth: number;
};

const DEFAULT_PALETTE = [
  "#111111",
  "#ffffff",
  "#d9d9d9",
  "#8a8a8a",
  "#3f3f3f",
  "#d72d32",
  "#ff6b2d",
  "#f0c52b",
  "#4fae4f",
  "#1596d1",
  "#3456c1",
  "#754bc4",
  "#d34893",
  "#7a4b2a",
  "#5a9b47",
  "#9e6a3a"
];

const MAX_RASTER_EDGE = 512;
const MIN_ALPHA = 20;
const MODEL_BUDGET_FILL = 0.90;
const MODEL_MIN_AXIS = 4;
const MODEL_EDGE_TOLERANCE = 50;
const MODEL_EDGE_LUMINANCE_TOLERANCE = 38;

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function hexOf(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgbDistance(
  a: [number, number, number],
  b: [number, number, number]
) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
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

function looksLikeBackground(raster: Raster): [number, number, number] {
  const points = [
    [0, 0],
    [raster.width - 1, 0],
    [0, raster.height - 1],
    [raster.width - 1, raster.height - 1],
    [Math.floor(raster.width / 2), 0],
    [0, Math.floor(raster.height / 2)],
    [raster.width - 1, Math.floor(raster.height / 2)],
    [Math.floor(raster.width / 2), raster.height - 1]
  ];

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (const [x, y] of points) {
    const s = sampleAt(raster, x, y);
    if (s.a < MIN_ALPHA) continue;
    r += s.r;
    g += s.g;
    b += s.b;
    count += 1;
  }

  if (!count) return [255, 255, 255];
  return [r / count, g / count, b / count];
}

function backgroundLike(
  s: Sample,
  bg: [number, number, number],
  mode: ImageMode
) {
  if (!s.visible) return true;

  const dr = s.r - bg[0];
  const dg = s.g - bg[1];
  const db = s.b - bg[2];
  const dist = Math.sqrt(dr * dr + dg * dg + db * db);
  const bgL = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
  const l = 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
  const saturation = Math.max(s.r, s.g, s.b) - Math.min(s.r, s.g, s.b);
  const tolerance =
    mode === "model"
      ? MODEL_EDGE_TOLERANCE
      : mode === "flat"
        ? 24
        : 34;
  const luminanceTolerance =
    mode === "model"
      ? MODEL_EDGE_LUMINANCE_TOLERANCE
      : 26;

  return (
    dist < tolerance &&
    Math.abs(l - bgL) < luminanceTolerance &&
    saturation < 245
  );
}

function buildMask(raster: Raster, mode: ImageMode): boolean[][] {
  const bg = looksLikeBackground(raster);
  const w = raster.width;
  const h = raster.height;
  const candidate = Array.from({ length: h }, () => Array<boolean>(w).fill(false));

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      candidate[y][x] = backgroundLike(sampleAt(raster, x, y), bg, mode);
    }
  }

  const isBackground = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  const stack: [number, number][] = [];

  const seed = (x: number, y: number) => {
    if (candidate[y][x] && !isBackground[y][x]) {
      isBackground[y][x] = true;
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
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (isBackground[ny][nx] || !candidate[ny][nx]) continue;
      isBackground[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }

  const mask = Array.from(
    { length: h },
    (_, y) => Array.from({ length: w }, (_, x) => !isBackground[y][x])
  );

  // Remove isolated one-pixel noise only. Do not erode thin limbs or details.
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      let neighbours = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (!ox && !oy) continue;
          if (mask[y + oy]?.[x + ox]) neighbours += 1;
        }
      }
      if (neighbours === 0) mask[y][x] = false;
    }
  }

  return mask;
}

function cleanModelMask(mask: boolean[][]) {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  if (!w || !h) return mask;

  const output = mask.map((row) => row.slice());

  // The image importer is intentionally conservative about the silhouette,
  // but MODEL needs a production-ready matte: remove detached background
  // specks and one/two-pixel contour hairs without eroding the actual body.
  // Keep every meaningful connected component; only discard tiny noise.
  const visited = new Set<string>();
  const componentSizes: number[] = [];
  const components: [number, number][][] = [];

  const key = (x: number, y: number) => `${x}:${y}`;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      const startKey = key(x, y);
      if (visited.has(startKey)) continue;

      const cells: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];
      visited.add(startKey);

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
          if (!mask[ny][nx]) continue;
          const nextKey = key(nx, ny);
          if (visited.has(nextKey)) continue;
          visited.add(nextKey);
          stack.push([nx, ny]);
        }
      }

      componentSizes.push(cells.length);
      components.push(cells);
    }
  }

  if (!components.length) return output;

  const largest = Math.max(...componentSizes);
  const minComponent = Math.max(12, Math.round(largest * 0.0008));

  for (let i = 0; i < components.length; i += 1) {
    if (componentSizes[i] >= minComponent) continue;
    for (const [x, y] of components[i]) output[y][x] = false;
  }

  // Remove contour hairs only when the local neighborhood confirms that the
  // pixel is an isolated protrusion. Thin intentional limbs remain intact.
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (!output[y][x]) continue;

      let neighbours8 = 0;
      let local5x5 = 0;
      for (let oy = -2; oy <= 2; oy += 1) {
        for (let ox = -2; ox <= 2; ox += 1) {
          if (output[y + oy]?.[x + ox]) local5x5 += 1;
          if (Math.abs(ox) <= 1 && Math.abs(oy) <= 1 && (ox || oy)) {
            if (output[y + oy]?.[x + ox]) neighbours8 += 1;
          }
        }
      }

      if (neighbours8 <= 1 || (neighbours8 === 2 && local5x5 <= 6)) {
        output[y][x] = false;
      }
    }
  }

  return repairSilhouette(output);
}

function findBounds(mask: boolean[][]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let y = 0; y < mask.length; y += 1) {
    for (let x = 0; x < (mask[y]?.length ?? 0); x += 1) {
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

function paletteRgb(palette: string[]) {
  return palette.map((hex) => {
    const value = hex.replace("#", "");
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16)
    ] as [number, number, number];
  });
}

function dominantPalette(
  samples: { r: number; g: number; b: number; weight: number }[],
  size: number
): string[] {
  if (!samples.length) return DEFAULT_PALETTE.slice(0, size);

  const sorted = samples.slice().sort((a, b) => b.weight - a.weight);
  const chosen: [number, number, number][] = [];

  for (const item of sorted) {
    const rgb: [number, number, number] = [item.r, item.g, item.b];
    if (chosen.every((c) => rgbDistance(rgb, c) > 900)) chosen.push(rgb);
    if (chosen.length >= size) break;
  }

  if (chosen.length < size) {
    for (const base of DEFAULT_PALETTE) {
      if (chosen.length >= size) break;
      const hex = base.replace("#", "");
      const rgb: [number, number, number] = [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16)
      ];
      if (chosen.every((c) => rgbDistance(rgb, c) > 400)) chosen.push(rgb);
    }
  }

  return chosen.map(([r, g, b]) => hexOf(r, g, b));
}

function createPalette(rasters: Raster[], masks: boolean[][][], size = 48) {
  const buckets = new Map<string, { r: number; g: number; b: number; weight: number }>();

  for (let view = 0; view < rasters.length; view += 1) {
    const raster = rasters[view];
    const mask = masks[view];
    const stride = Math.max(
      1,
      Math.floor(Math.sqrt((raster.width * raster.height) / 50000))
    );

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

  return dominantPalette([...buckets.values()], size);
}

function ditheredColor(
  rgb: [number, number, number],
  px: number,
  py: number,
  strength = 10
): [number, number, number] {
  const offset = (BAYER_4X4[py & 3][px & 3] / 16 - 0.5) * strength;
  return [
    clamp(rgb[0] + offset, 0, 255),
    clamp(rgb[1] + offset, 0, 255),
    clamp(rgb[2] + offset, 0, 255)
  ];
}

function nearestColor(
  rgb: [number, number, number],
  palette: [number, number, number][]
) {
  let best = 0;
  let distance = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const d = rgbDistance(rgb, palette[i]);
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return best;
}

function blendRgb(a: Sample, b: Sample, t: number): [number, number, number] {
  const amount = clamp(t, 0, 1);
  return [
    a.r * (1 - amount) + b.r * amount,
    a.g * (1 - amount) + b.g * amount,
    a.b * (1 - amount) + b.b * amount
  ];
}

function sampleMapped(raster: Raster, bounds: Bounds, nx: number, ny: number) {
  return sampleAt(
    raster,
    bounds.minX + clamp(nx, 0, 1) * (bounds.maxX - bounds.minX),
    bounds.minY + clamp(ny, 0, 1) * (bounds.maxY - bounds.minY)
  );
}

function maskMapped(mask: boolean[][], bounds: Bounds, nx: number, ny: number) {
  const x = Math.round(
    bounds.minX + clamp(nx, 0, 1) * (bounds.maxX - bounds.minX)
  );
  const y = Math.round(
    bounds.minY + clamp(ny, 0, 1) * (bounds.maxY - bounds.minY)
  );
  return Boolean(mask[y]?.[x]);
}

/**
 * Resamples only the content rectangle. Unlike resizing the whole image,
 * this preserves the subject's aspect ratio and avoids introducing gaps
 * when FRONT and SIDE have different canvas sizes.
 */
function resampleMaskToBounds(
  mask: boolean[][],
  bounds: Bounds,
  targetWidth: number,
  targetHeight: number
) {
  const result = Array.from(
    { length: targetHeight },
    () => Array<boolean>(targetWidth).fill(false)
  );

  for (let y = 0; y < targetHeight; y += 1) {
    const ny = targetHeight <= 1 ? 0.5 : y / (targetHeight - 1);
    const sourceY = bounds.minY + ny * (bounds.height - 1);
    const iy = Math.round(sourceY);

    for (let x = 0; x < targetWidth; x += 1) {
      const nx = targetWidth <= 1 ? 0.5 : x / (targetWidth - 1);
      const sourceX = bounds.minX + nx * (bounds.width - 1);
      const ix = Math.round(sourceX);

      if (mask[iy]?.[ix]) {
        result[y][x] = true;
        continue;
      }

      // Only use a tiny footprint. This repairs downsampling gaps without
      // globally dilating the silhouette.
      let hits = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (mask[iy + oy]?.[ix + ox]) hits += 1;
        }
      }
      result[y][x] = hits >= 3;
    }
  }

  return result;
}

function repairSilhouette(mask: boolean[][]) {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  if (!w || !h) return mask;

  const output = mask.map((row) => row.slice());

  // Fill only tiny one-pixel cavities. Large holes remain untouched because
  // they can represent real geometry, e.g. the gap between two legs.
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (mask[y][x]) continue;
      let hits = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          if (mask[y + oy]?.[x + ox]) hits += 1;
        }
      }
      if (hits >= 7) output[y][x] = true;
    }
  }

  return output;
}

function voxelKey(v: ImageVoxel) {
  return `${v.x}:${v.y}:${v.z}`;
}

function symmetrizeVoxels(
  voxels: ImageVoxel[],
  volumeSize: number,
  paletteSize: number
) {
  if (!voxels.length) return;

  let minX = Infinity;
  let maxX = -Infinity;
  for (const v of voxels) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return;

  const center = (minX + maxX) / 2;
  const existing = new Set(voxels.map(voxelKey));
  const additions: ImageVoxel[] = [];

  for (const voxel of voxels) {
    const mirroredX = Math.round(center * 2 - voxel.x);
    if (mirroredX < 0 || mirroredX >= volumeSize) continue;
    const key = `${mirroredX}:${voxel.y}:${voxel.z}`;
    if (existing.has(key)) continue;
    existing.add(key);
    additions.push({
      x: mirroredX,
      y: voxel.y,
      z: voxel.z,
      c: clamp(voxel.c, 0, paletteSize - 1)
    });
  }

  voxels.push(...additions);
}

function normalizeToVolume(voxels: ImageVoxel[], volumeSize: number) {
  if (!voxels.length) return voxels;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const v of voxels) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z);
    maxZ = Math.max(maxZ, v.z);
  }

  const width = maxX - minX + 1;
  const depth = maxZ - minZ + 1;
  const xOffset = Math.floor((volumeSize - width) / 2) - minX;
  const zOffset = Math.floor((volumeSize - depth) / 2) - minZ;
  const yOffset = Math.max(0, Math.floor((volumeSize - (maxY - minY + 1)) * 0.10) - minY);

  return voxels.map((v) => ({
    x: clamp(v.x + xOffset, 0, volumeSize - 1),
    y: clamp(maxY - v.y + yOffset, 0, volumeSize - 1),
    z: clamp(v.z + zOffset, 0, volumeSize - 1),
    c: v.c
  }));
}

/**
 * Adaptive MODEL resolution.
 *
 * We never build a huge voxel volume and then decimate it. The dimensions are
 * solved first from the reference aspect ratios and the requested voxel
 * budget. The final reconstruction is therefore generated at its final
 * resolution and cannot create horizontal missing bands.
 */
function adaptiveModelDimensions(
  frontBounds: Bounds,
  sideBounds: Bounds | null,
  volumeSize: number,
  maxVoxels: number,
  heightMax: number,
  symmetrize = false
): Dimensions {
  const maxAxis = Math.max(MODEL_MIN_AXIS, volumeSize - 8);
  const safeBudget = Math.max(
    MODEL_MIN_AXIS * MODEL_MIN_AXIS * MODEL_MIN_AXIS,
    Math.min(Math.floor(maxVoxels), Math.floor(volumeSize ** 3 * MODEL_BUDGET_FILL))
  );

  let height = Math.min(maxAxis, Math.max(MODEL_MIN_AXIS, frontBounds.height));
  let width = Math.max(
    MODEL_MIN_AXIS,
    Math.round(height * (frontBounds.width / Math.max(1, frontBounds.height)))
  );

  let depth: number;
  if (sideBounds) {
    depth = Math.max(
      MODEL_MIN_AXIS,
      Math.round(height * (sideBounds.width / Math.max(1, sideBounds.height)))
    );
  } else {
    depth = Math.max(MODEL_MIN_AXIS, Math.round(heightMax * 1.05));
  }

  width = Math.min(maxAxis, width);
  depth = Math.min(maxAxis, depth);

  let product = width * height * depth;
  const targetBudget = symmetrize
    ? Math.floor(safeBudget * 0.46)
    : Math.floor(safeBudget * 0.94);

  const targetProduct = Math.max(
    MODEL_MIN_AXIS ** 3,
    targetBudget
  );

  if (product > targetProduct) {
    const scale = Math.cbrt(targetProduct / product);
    width = Math.max(MODEL_MIN_AXIS, Math.floor(width * scale));
    height = Math.max(MODEL_MIN_AXIS, Math.floor(height * scale));
    depth = Math.max(MODEL_MIN_AXIS, Math.floor(depth * scale));
  }

  // Reduce the largest dimension until even the complete bounding box is
  // inside the budget. Visual-hull occupancy is always <= this box.
  while (width * height * depth > safeBudget) {
    if (height >= width && height >= depth && height > MODEL_MIN_AXIS) height -= 1;
    else if (width >= depth && width > MODEL_MIN_AXIS) width -= 1;
    else if (depth > MODEL_MIN_AXIS) depth -= 1;
    else break;
  }

  return {
    width: Math.max(MODEL_MIN_AXIS, width),
    height: Math.max(MODEL_MIN_AXIS, height),
    depth: Math.max(MODEL_MIN_AXIS, depth)
  };
}

function effectiveBudget(
  volumeSize: number,
  requested: number | undefined,
  mode: ImageMode
) {
  const physical = volumeSize * volumeSize * volumeSize;
  if (mode === "model") {
    return Math.max(
      4096,
      Math.min(requested ?? Math.floor(physical * 0.30), Math.floor(physical * MODEL_BUDGET_FILL))
    );
  }

  const safety = mode === "relief" ? 0.12 : mode === "flat" ? 0.06 : 0.16;
  return Math.max(
    4096,
    Math.min(requested ?? Math.floor(physical * safety), Math.floor(physical * 0.42))
  );
}

function keepLargestComponents(voxels: ImageVoxel[]) {
  if (voxels.length < 2) return voxels;

  const map = new Map<string, ImageVoxel>();
  for (const v of voxels) map.set(voxelKey(v), v);

  const visited = new Set<string>();
  const components: ImageVoxel[][] = [];
  const neighbours = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1]
  ] as const;

  for (const start of voxels) {
    const startKey = voxelKey(start);
    if (visited.has(startKey)) continue;

    const component: ImageVoxel[] = [];
    const stack = [start];
    visited.add(startKey);

    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);

      for (const [dx, dy, dz] of neighbours) {
        const key = `${current.x + dx}:${current.y + dy}:${current.z + dz}`;
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
  const threshold = Math.max(6, Math.round(largest * 0.015));
  return components.filter((c) => c.length >= threshold).flat();
}

function reconstructVisualHull(
  frontRaster: Raster,
  frontMask: boolean[][],
  frontBounds: Bounds,
  sideRaster: Raster,
  sideMask: boolean[][],
  sideBounds: Bounds,
  options: Required<ImageVoxelOptions>,
  paletteValues: [number, number, number][],
  dimensions: Dimensions,
  palette: string[]
) {
  const front = repairSilhouette(
    resampleMaskToBounds(
      frontMask,
      frontBounds,
      dimensions.width,
      dimensions.height
    )
  );

  const side = repairSilhouette(
    resampleMaskToBounds(
      sideMask,
      sideBounds,
      dimensions.depth,
      dimensions.height
    )
  );

  const voxels: ImageVoxel[] = [];

  for (let y = 0; y < dimensions.height; y += 1) {
    const ny = dimensions.height <= 1 ? 0.5 : y / (dimensions.height - 1);

    for (let x = 0; x < dimensions.width; x += 1) {
      if (!front[y]?.[x]) continue;

      const nx = dimensions.width <= 1 ? 0.5 : x / (dimensions.width - 1);
      const frontColor = sampleMapped(frontRaster, frontBounds, nx, ny);

      for (let z = 0; z < dimensions.depth; z += 1) {
        const nz = dimensions.depth <= 1 ? 0.5 : z / (dimensions.depth - 1);

        // TRUE VISUAL HULL:
        // FRONT gives the X/Y silhouette and SIDE gives the Z/Y silhouette.
        // A voxel exists only in the intersection of the two silhouette
        // volumes. There is no later voxel thinning step.
        if (side && !side[y]?.[z]) continue;

        let color: [number, number, number] = [
          frontColor.r,
          frontColor.g,
          frontColor.b
        ];

        if (sideRaster && sideBounds && side?.[y]?.[z]) {
          const sideColor = sampleMapped(sideRaster, sideBounds, nz, ny);
          color = blendRgb(frontColor, sideColor, 0.16 + nz * 0.34);
        }

        // The rear volume is inferred only from the required FRONT + SIDE
        // silhouettes and their colors; no third view is sampled.
        const shade = 1 - nz * 0.22;
        color = [color[0] * shade, color[1] * shade, color[2] * shade];

        voxels.push({
          x,
          y,
          z,
          c: nearestColor(ditheredColor(color, x, y + z, 3), paletteValues)
        });
      }
    }
  }

  if (!voxels.length) throw new Error("No voxels reconstructed");

  // The adaptive dimensions guarantee the requested budget before this point.
  // No post-generation decimation is performed.
  if (options.symmetrize) {
    symmetrizeVoxels(voxels, options.volumeSize, palette.length);
  }

  const normalized = normalizeToVolume(voxels, options.volumeSize);
  return {
    width: frontRaster.width,
    height: frontRaster.height,
    voxels: normalized,
    palette,
    count: normalized.length
  } satisfies ImageImport;
}

function buildNonModel(
  raster: Raster,
  mask: boolean[][],
  bounds: Bounds,
  sideMask: boolean[][] | undefined,
  sideBounds: Bounds | null,
  options: Required<ImageVoxelOptions>,
  paletteValues: [number, number, number][],
  palette: string[]
): ImageImport {
  const maxAxis = Math.max(4, options.volumeSize - 8);
  const scale = Math.min(1, maxAxis / Math.max(bounds.width, bounds.height));
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const sourceMask = resampleMaskToBounds(mask, bounds, width, height);

  const depthBase =
    options.mode === "flat"
      ? 1
      : options.mode === "relief"
        ? Math.max(2, Math.round(options.heightMax * 0.30))
        : Math.max(2, Math.round(options.heightMax * 0.62));

  const voxels: ImageVoxel[] = [];

  for (let y = 0; y < height; y += 1) {
    const ny = height <= 1 ? 0.5 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      if (!sourceMask[y]?.[x]) continue;
      const nx = width <= 1 ? 0.5 : x / (width - 1);
      const frontColor = sampleMapped(raster, bounds, nx, ny);
      let finalDepth = depthBase;

      if (sideMask && sideBounds && maskMapped(sideMask, sideBounds, 0.5, ny)) {
        finalDepth = Math.max(1, Math.round(depthBase * 1.18));
      }

      for (let z = 0; z < finalDepth; z += 1) {
        const colorSample = frontColor;

        voxels.push({
          x,
          y,
          z,
          c: nearestColor(
            ditheredColor([colorSample.r, colorSample.g, colorSample.b], x, y + z),
            paletteValues
          )
        });
      }
    }
  }

  if (!voxels.length) throw new Error("No voxels reconstructed");

  const budget = effectiveBudget(options.volumeSize, options.maxVoxels, options.mode);
  const limited = voxels.length <= budget ? voxels : spatialBudget(voxels, budget);
  const normalized = normalizeToVolume(limited, options.volumeSize);

  return {
    width: raster.width,
    height: raster.height,
    voxels: normalized,
    palette,
    count: normalized.length
  };
}

function spatialBudget(voxels: ImageVoxel[], budget: number) {
  if (voxels.length <= budget) return voxels;

  const buckets = new Map<string, ImageVoxel>();
  const ratio = Math.max(1, voxels.length / budget);
  const cell = Math.max(1, Math.ceil(Math.cbrt(ratio)));

  for (const voxel of voxels) {
    const bx = Math.floor(voxel.x / cell);
    const by = Math.floor(voxel.y / cell);
    const bz = Math.floor(voxel.z / cell);
    const key = `${bx}:${by}:${bz}`;
    if (!buckets.has(key)) buckets.set(key, voxel);
  }

  const result = [...buckets.values()];
  if (result.length >= budget) return result.slice(0, budget);

  const seen = new Set(result.map(voxelKey));
  for (const voxel of voxels) {
    if (result.length >= budget) break;
    const key = voxelKey(voxel);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(voxel);
  }
  return result;
}

export async function imageToVoxels(
  file: File,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  const normalized: Required<ImageVoxelOptions> = {
    volumeSize: options.volumeSize ?? 128,
    mode: options.mode ?? "solid",
    heightMax: options.heightMax ?? 16,
    maxVoxels: options.maxVoxels ?? 100000,
    symmetrize: options.symmetrize ?? false
  };

  const raster = await loadImage(file);
  const mask = buildMask(raster, normalized.mode);
  const bounds = findBounds(mask);
  if (!bounds) throw new Error("No visible subject found");

  const palette = createPalette(
    [raster],
    [mask],
    normalized.mode === "model" ? 64 : 48
  );
  const paletteValues = paletteRgb(palette);

  if (normalized.mode === "model") {
    throw new Error("MODEL MODE REQUIRES FRONT + SIDE");
  }

  return buildNonModel(
    raster,
    mask,
    bounds,
    undefined,
    null,
    normalized,
    paletteValues,
    palette
  );
}

export async function imagesToVoxels(
  views: ImageViews,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  if (!views.front) throw new Error("FRONT IMAGE REQUIRED");

  const normalized: Required<ImageVoxelOptions> = {
    volumeSize: options.volumeSize ?? 128,
    mode: options.mode ?? "solid",
    heightMax: options.heightMax ?? 16,
    maxVoxels: options.maxVoxels ?? 100000,
    symmetrize: options.symmetrize ?? false
  };

  if (normalized.mode === "model" && !views.side) {
    throw new Error("MODEL MODE REQUIRES FRONT + SIDE");
  }

  const files = [views.front, views.side].filter(Boolean) as File[];
  const rasters = await Promise.all(files.map((file) => loadImage(file)));
  const masks = rasters.map((raster) => {
    const mask = buildMask(raster, normalized.mode);
    return normalized.mode === "model" ? cleanModelMask(mask) : mask;
  });

  const palette = createPalette(
    rasters,
    masks,
    normalized.mode === "model" ? 64 : 48
  );
  const paletteValues = paletteRgb(palette);

  const frontRaster = rasters[0];
  const frontMask = masks[0];
  const frontBounds = findBounds(frontMask);
  if (!frontBounds) throw new Error("No visible subject found in FRONT");

  const sideRaster = views.side ? rasters[1] : undefined;
  const sideMask = views.side ? masks[1] : undefined;
  const sideBounds = sideMask ? findBounds(sideMask) : null;


  if (normalized.mode === "model") {
    const budget = effectiveBudget(
      normalized.volumeSize,
      normalized.maxVoxels,
      "model"
    );

    const dimensions = adaptiveModelDimensions(
      frontBounds,
      sideBounds,
      normalized.volumeSize,
      budget,
      normalized.heightMax,
      normalized.symmetrize
    );

    if (!sideRaster || !sideMask || !sideBounds) {
      throw new Error("MODEL MODE REQUIRES A VALID SIDE VIEW");
    }

    return reconstructVisualHull(
      frontRaster,
      frontMask,
      frontBounds,
      sideRaster,
      sideMask,
      sideBounds,
      normalized,
      paletteValues,
      dimensions,
      palette
    );
  }

  return buildNonModel(
    frontRaster,
    frontMask,
    frontBounds,
    sideMask,
    sideBounds,
    normalized,
    paletteValues,
    palette
  );
}
