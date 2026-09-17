import {
  aiCategoryPrecision,
  aiCategoryWantsDepth
} from "@/lib/ai/aiCategories";

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
  useLocalAi?: boolean;
  aiCategory?: import("@/lib/ai/aiCategories").AiCategory;
};

export type ImageViews = {
  front: File;
  side?: File;
};

type NormalizedImageVoxelOptions = Omit<Required<ImageVoxelOptions>, "aiCategory" | "useLocalAi"> & {
  aiCategory?: ImageVoxelOptions["aiCategory"];
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
/** Pixels below this alpha are treated as empty (post-ONNX matte is near-binary). */
const MIN_ALPHA = 16;
const MODEL_BUDGET_FILL = 0.90;
const MODEL_MIN_AXIS = 4;
const MODEL_EDGE_TOLERANCE = 72;
const MODEL_EDGE_LUMINANCE_TOLERANCE = 54;
const MODEL_MIN_COMPONENT_RATIO = 0.0025;
const MODEL_MIN_COMPONENT_PIXELS = 24;
const MODEL_BG_COLOR_TOLERANCE = 92;
const MODEL_BG_LUMINANCE_TOLERANCE = 72;

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

function modelBackgroundProbes(raster: Raster): [number, number, number][] {
  const probes: [number, number, number][] = [];
  const sampleCount = 24;
  const add = (x: number, y: number) => {
    const s = sampleAt(raster, x, y);
    if (!s.visible) return;
    const color: [number, number, number] = [s.r, s.g, s.b];
    if (!probes.some((probe) => rgbDistance(probe, color) < 56 * 56)) {
      probes.push(color);
    }
  };

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / Math.max(1, sampleCount - 1);
    add(Math.round(t * (raster.width - 1)), 0);
    add(Math.round(t * (raster.width - 1)), raster.height - 1);
    add(0, Math.round(t * (raster.height - 1)));
    add(raster.width - 1, Math.round(t * (raster.height - 1)));
  }
  return probes;
}

function modelBackgroundLike(
  sample: Sample,
  probes: [number, number, number][]
) {
  if (!sample.visible) return true;
  if (!probes.length) return false;

  const luminance = 0.299 * sample.r + 0.587 * sample.g + 0.114 * sample.b;
  const saturation = Math.max(sample.r, sample.g, sample.b) - Math.min(sample.r, sample.g, sample.b);

  for (const probe of probes) {
    const distance = Math.sqrt(rgbDistance([sample.r, sample.g, sample.b], probe));
    const probeLuminance = 0.299 * probe[0] + 0.587 * probe[1] + 0.114 * probe[2];
    if (
      distance <= MODEL_BG_COLOR_TOLERANCE &&
      Math.abs(luminance - probeLuminance) <= MODEL_BG_LUMINANCE_TOLERANCE &&
      saturation < 220
    ) {
      return true;
    }
  }

  return false;
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
  const modelProbes = mode === "model" ? modelBackgroundProbes(raster) : [];
  const w = raster.width;
  const h = raster.height;
  const candidate = Array.from({ length: h }, () => Array<boolean>(w).fill(false));

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sample = sampleAt(raster, x, y);
      candidate[y][x] =
        mode === "model"
          ? modelBackgroundLike(sample, modelProbes)
          : backgroundLike(sample, bg, mode);
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

type AiPrecisionProfile = {
  minComponentPixels: number;
  minComponentRatio: number;
  preserveThinContour: boolean;
};

function aiPrecisionProfile(category: ImageVoxelOptions["aiCategory"]): AiPrecisionProfile | null {
  if (!category) return null;
  return aiCategoryPrecision(category);
}

function cleanModelMask(
  mask: boolean[][],
  raster: Raster,
  aiCategory?: ImageVoxelOptions["aiCategory"]
) {
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

  const bg = looksLikeBackground(raster);
  const bgProbes = modelBackgroundProbes(raster);
  const bgL = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];

  // Opaque reference images often contain a one-to-several-pixel antialias
  // halo between the subject and its background. Those pixels are connected
  // to the subject, so a connected-component cleanup cannot remove them.
  // Trim only boundary pixels that are both background-like and low-contrast
  // against their immediate subject neighbours; dark outlines remain intact.
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (!output[y][x]) continue;

      let hasBackgroundNeighbour = false;
      let foregroundNeighbours = 0;
      let neighbourR = 0;
      let neighbourG = 0;
      let neighbourB = 0;

      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        if (!output[y + dy]?.[x + dx]) {
          hasBackgroundNeighbour = true;
          continue;
        }

        const neighbour = sampleAt(raster, x + dx, y + dy);
        foregroundNeighbours += 1;
        neighbourR += neighbour.r;
        neighbourG += neighbour.g;
        neighbourB += neighbour.b;
      }

      if (!hasBackgroundNeighbour || foregroundNeighbours < 2) continue;

      const current = sampleAt(raster, x, y);
      const currentL = 0.299 * current.r + 0.587 * current.g + 0.114 * current.b;
      const distanceToBg = Math.sqrt(
        (current.r - bg[0]) ** 2 +
        (current.g - bg[1]) ** 2 +
        (current.b - bg[2]) ** 2
      );
      const averageNeighbour = {
        r: neighbourR / foregroundNeighbours,
        g: neighbourG / foregroundNeighbours,
        b: neighbourB / foregroundNeighbours
      };
      const distanceToSubject = Math.sqrt(
        (current.r - averageNeighbour.r) ** 2 +
        (current.g - averageNeighbour.g) ** 2 +
        (current.b - averageNeighbour.b) ** 2
      );

      const probeMatch = modelBackgroundLike(current, bgProbes);
      if (
        probeMatch &&
        distanceToBg < MODEL_BG_COLOR_TOLERANCE &&
        Math.abs(currentL - bgL) < MODEL_BG_LUMINANCE_TOLERANCE &&
        distanceToSubject < 56
      ) {
        output[y][x] = false;
      }
    }
  }

  const largest = Math.max(...componentSizes);
  const precision = aiPrecisionProfile(aiCategory);
  const minComponent = Math.max(
    precision?.minComponentPixels ?? MODEL_MIN_COMPONENT_PIXELS,
    Math.round(largest * (precision?.minComponentRatio ?? MODEL_MIN_COMPONENT_RATIO))
  );

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

      if (
        precision?.preserveThinContour
          ? neighbours8 === 0
          : neighbours8 <= 1 || (neighbours8 === 2 && local5x5 <= 6)
      ) {
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
        // Finer buckets → closer to source colors (was /8).
        const r = Math.round(s.r / 4) * 4;
        const g = Math.round(s.g / 4) * 4;
        const b = Math.round(s.b / 4) * 4;
        const key = `${r}:${g}:${b}`;
        const existing = buckets.get(key);
        if (existing) existing.weight += 1;
        else buckets.set(key, { r, g, b, weight: 1 });
      }
    }
  }

  const samples = [...buckets.values()];
  // (6) Adaptive palette size: few unique colors → pixel-art path (smaller palette, exact).
  const unique = samples.length;
  let target = size;
  if (unique > 0 && unique <= 24) target = Math.min(size, Math.max(12, unique + 4));
  else if (unique >= 120) target = Math.min(96, size + 16);
  return dominantPalette(samples, target);
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

  // Treat each output voxel as an area sample, not as a nearest-pixel lookup.
  // This rejects antialiased background fringes and single-pixel contour hairs
  // while preserving the solid mass of the source silhouette.
  const samplesPerAxis = 4;

  for (let y = 0; y < targetHeight; y += 1) {
    const y0 = bounds.minY + (y / Math.max(1, targetHeight)) * bounds.height;
    const y1 =
      bounds.minY +
      ((y + 1) / Math.max(1, targetHeight)) * bounds.height;

    for (let x = 0; x < targetWidth; x += 1) {
      const x0 = bounds.minX + (x / Math.max(1, targetWidth)) * bounds.width;
      const x1 =
        bounds.minX +
        ((x + 1) / Math.max(1, targetWidth)) * bounds.width;

      let hits = 0;
      let total = 0;

      for (let sy = 0; sy < samplesPerAxis; sy += 1) {
        const py = Math.round(
          y0 + ((sy + 0.5) / samplesPerAxis) * Math.max(0, y1 - y0 - 1)
        );
        for (let sx = 0; sx < samplesPerAxis; sx += 1) {
          const px = Math.round(
            x0 + ((sx + 0.5) / samplesPerAxis) * Math.max(0, x1 - x0 - 1)
          );
          if (mask[py]?.[px]) hits += 1;
          total += 1;
        }
      }

      result[y][x] = hits / total >= 0.5;
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
  const height = maxY - minY + 1;
  const depth = maxZ - minZ + 1;

  // Center on XZ. Place on the floor with a small pad; if the mesh is taller
  // than the volume, center on Y so it is not crushed into a corner.
  const xOffset = Math.floor((volumeSize - width) / 2) - minX;
  const zOffset = Math.floor((volumeSize - depth) / 2) - minZ;
  const floorPad = Math.max(1, Math.floor(volumeSize * 0.04));
  const yRoom = volumeSize - height;
  const yOffset =
    yRoom >= floorPad
      ? floorPad - minY
      : Math.floor((volumeSize - height) / 2) - minY;

  return voxels.map((v) => ({
    x: clamp(v.x + xOffset, 0, volumeSize - 1),
    // Flip image-Y (top of PNG = tip) to world-Y up.
    y: clamp(maxY - v.y + yOffset, 0, volumeSize - 1),
    z: clamp(v.z + zOffset, 0, volumeSize - 1),
    c: v.c
  }));
}

/**
 * Adaptive MODEL resolution.
 * FRONT locks W/H; SIDE locks depth. Budget pressure scales all axes uniformly
 * so tall props are not height-crushed (legacy height-first loop removed).
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

  const targetBudget = symmetrize
    ? Math.floor(safeBudget * 0.46)
    : Math.floor(safeBudget * 0.94);
  const targetProduct = Math.max(MODEL_MIN_AXIS ** 3, targetBudget);

  let product = width * height * depth;
  if (product > targetProduct) {
    const scale = Math.cbrt(targetProduct / product);
    width = Math.max(MODEL_MIN_AXIS, Math.floor(width * scale));
    height = Math.max(MODEL_MIN_AXIS, Math.floor(height * scale));
    depth = Math.max(MODEL_MIN_AXIS, Math.floor(depth * scale));
  }

  // Uniform integer fit only (never prefer eating height alone).
  let guard = 0;
  while (width * height * depth > safeBudget && guard < 64) {
    const scale = Math.pow(safeBudget / Math.max(1, width * height * depth), 1 / 3) * 0.99;
    const nw = Math.max(MODEL_MIN_AXIS, Math.floor(width * scale));
    const nh = Math.max(MODEL_MIN_AXIS, Math.floor(height * scale));
    const nd = Math.max(MODEL_MIN_AXIS, Math.floor(depth * scale));
    if (nw === width && nh === height && nd === depth) {
      // Last resort: shave the largest axis by 1.
      if (width >= height && width >= depth && width > MODEL_MIN_AXIS) width -= 1;
      else if (depth >= height && depth > MODEL_MIN_AXIS) depth -= 1;
      else if (height > MODEL_MIN_AXIS) height -= 1;
      else break;
    } else {
      width = nw;
      height = nh;
      depth = nd;
    }
    guard += 1;
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
  options: NormalizedImageVoxelOptions,
  paletteValues: [number, number, number][],
  dimensions: Dimensions,
  palette: string[],
  /** Fractional Y shift of SIDE vs FRONT from viewAlign (±~0.08). */
  sideYOffset = 0,
  /** Optional ONNX depth [0..1] same size as frontRaster — mild shade only. */
  frontDepth: Float32Array | null = null
) {
  const front = resampleMaskToBounds(
    frontMask,
    frontBounds,
    dimensions.width,
    dimensions.height
  );

  const side = resampleMaskToBounds(
    sideMask,
    sideBounds,
    dimensions.depth,
    dimensions.height
  );

  const voxels: ImageVoxel[] = [];
  const h = dimensions.height;

  for (let y = 0; y < h; y += 1) {
    const ny = h <= 1 ? 0.5 : y / (h - 1);
    // Align SIDE row to FRONT (tip-to-base correlation from viewAlign).
    const ySide = clamp(Math.round(y + sideYOffset * Math.max(0, h - 1)), 0, h - 1);

    for (let x = 0; x < dimensions.width; x += 1) {
      if (!front[y]?.[x]) continue;

      const nx = dimensions.width <= 1 ? 0.5 : x / (dimensions.width - 1);
      const frontColor = sampleMapped(frontRaster, frontBounds, nx, ny);
      const px = frontBounds.minX + nx * (frontBounds.maxX - frontBounds.minX);
      const py = frontBounds.minY + ny * (frontBounds.maxY - frontBounds.minY);
      const depthSample = depthAt(frontDepth, frontRaster, px, py);

      // (3) Soft depth clamp: if ONNX depth says the surface is thin, reject
      // extreme Z from a wide SIDE without inventing voxels (hull still required).
      const depthHalf =
        frontDepth && dimensions.depth > 2
          ? Math.max(1, Math.round(dimensions.depth * (0.2 + depthSample * 0.45)))
          : dimensions.depth;
      const zMid = (dimensions.depth - 1) * 0.5;

      for (let z = 0; z < dimensions.depth; z += 1) {
        const nz = dimensions.depth <= 1 ? 0.5 : z / (dimensions.depth - 1);

        // TRUE VISUAL HULL: FRONT = X/Y, SIDE = Z/Y (Y-aligned).
        if (side && !side[ySide]?.[z]) continue;

        if (frontDepth && dimensions.depth > 2) {
          if (Math.abs(z - zMid) > depthHalf) continue;
        }

        let color: [number, number, number] = [
          frontColor.r,
          frontColor.g,
          frontColor.b
        ];

        if (sideRaster && sideBounds && side?.[ySide]?.[z]) {
          const sideColor = sampleMapped(sideRaster, sideBounds, nz, ny + sideYOffset);
          const surfaceT = clamp((nz - 0.14) / 0.72, 0, 1);
          const eased = surfaceT * surfaceT * (3 - 2 * surfaceT);
          color = blendRgb(frontColor, sideColor, 0.1 + eased * 0.72);
        }

        // Depth map: subtle volumetric shade (geometry still hull ∩ clamp).
        const shade = (0.98 - nz * 0.16) * (0.94 + depthSample * 0.1);
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
  options: NormalizedImageVoxelOptions,
  paletteValues: [number, number, number][],
  palette: string[],
  depthMap: Float32Array | null = null
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

  const useDepthRelief =
    Boolean(depthMap) && (options.mode === "relief" || options.mode === "solid");

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

      // ONNX depth modulates extrusion so relief follows subject volume, not a slab.
      if (useDepthRelief) {
        const px = bounds.minX + nx * (bounds.maxX - bounds.minX);
        const py = bounds.minY + ny * (bounds.maxY - bounds.minY);
        const d = depthAt(depthMap, raster, px, py);
        // Near-camera / brighter depth → more voxels; keep at least 1.
        finalDepth = Math.max(1, Math.round(depthBase * (0.45 + d * 1.05)));
        finalDepth = Math.min(finalDepth, Math.max(depthBase, options.heightMax));
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


type LocalAiResult = {
  raster: Raster;
  depth: Float32Array | null;
};

async function applyLocalAiRaster(
  raster: Raster,
  options: {
    depth?: boolean;
    category?: ImageVoxelOptions["aiCategory"];
  }
): Promise<LocalAiResult> {
  try {
    const { enhanceRaster } = await import("@/lib/ai/enhance");
    const enhanced = await enhanceRaster(
      { width: raster.width, height: raster.height, rgba: raster.rgba },
      { depth: options.depth === true, category: options.category }
    );
    return {
      raster: {
        width: enhanced.raster.width,
        height: enhanced.raster.height,
        rgba: enhanced.raster.rgba
      },
      depth: enhanced.depth
    };
  } catch {
    return { raster, depth: null };
  }
}

/** Sample normalized depth [0..1] at raster pixel; missing map → mid bias. */
function depthAt(depth: Float32Array | null, raster: Raster, x: number, y: number): number {
  if (!depth || !raster.width) return 0.55;
  const xx = clamp(Math.round(x), 0, raster.width - 1);
  const yy = clamp(Math.round(y), 0, raster.height - 1);
  return clamp(depth[yy * raster.width + xx] ?? 0.55, 0, 1);
}

async function finalizeLocalAi(
  result: ImageImport,
  volumeSize: number,
  mask: boolean[][],
  aiCategory?: ImageVoxelOptions["aiCategory"]
): Promise<ImageImport> {
  try {
    const [{ recognizeFromMask }, { finishVoxels }, { lintVoxels }, { aiCategoryProfile }] =
      await Promise.all([
        import("@/lib/ai/recognize"),
        import("@/lib/ai/finish"),
        import("@/lib/ai/lint"),
        import("@/lib/ai/aiCategories")
      ]);
    const guess = recognizeFromMask(mask);
    // (5) Auto-category from silhouette when UI left AUTO.
    let resolvedCategory = aiCategory;
    if (!resolvedCategory) {
      if (guess.kind === "sword" || guess.kind === "axe") resolvedCategory = "swords";
      else if (guess.kind === "bottle" || guess.kind === "prop") resolvedCategory = "objects";
    }
    const thinFeatures = resolvedCategory
      ? aiCategoryProfile(resolvedCategory).thinFeatures
      : guess.kind === "sword" || guess.kind === "axe";
    let voxels = result.voxels;
    voxels = lintVoxels(voxels, { thinFeatures });
    voxels = finishVoxels(voxels, volumeSize, guess.kind !== "tile", { thinFeatures });
    return {
      ...result,
      voxels,
      count: voxels.length
    };
  } catch {
    return result;
  }
}

export async function imageToVoxels(
  file: File,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  const useLocalAi = options.useLocalAi ?? true;
  const normalized: NormalizedImageVoxelOptions = {
    volumeSize: options.volumeSize ?? 128,
    mode: options.mode ?? "solid",
    heightMax: options.heightMax ?? 16,
    maxVoxels: options.maxVoxels ?? 100000,
    symmetrize: options.symmetrize ?? false,
    aiCategory: options.aiCategory
  };

  let raster = await loadImage(file);
  let depthMap: Float32Array | null = null;
  if (useLocalAi) {
    const ai = await applyLocalAiRaster(raster, {
      depth: aiCategoryWantsDepth(normalized.aiCategory, normalized.mode),
      category: normalized.aiCategory
    });
    raster = ai.raster;
    depthMap = ai.depth;
  }
  const mask = buildMask(raster, normalized.mode);
  const bounds = findBounds(mask);
  if (!bounds) throw new Error("No visible subject found");

  const palette = createPalette(
    [raster],
    [mask],
    normalized.mode === "model" ? 64 : 48
  );
  const paletteValues = paletteRgb(palette);

  // Single-view: MODEL needs a SIDE image for visual-hull. Fall back to relief
  // so the UI can still preview FRONT while waiting for SIDE (no hard crash).
  if (normalized.mode === "model") {
    const reliefOpts: NormalizedImageVoxelOptions = {
      ...normalized,
      mode: "relief",
      heightMax: Math.max(normalized.heightMax, 8)
    };
    const result = buildNonModel(
      raster,
      mask,
      bounds,
      undefined,
      null,
      reliefOpts,
      paletteValues,
      palette,
      depthMap
    );
    return useLocalAi
      ? await finalizeLocalAi(result, normalized.volumeSize, mask, normalized.aiCategory)
      : result;
  }

  const result = buildNonModel(
    raster,
    mask,
    bounds,
    undefined,
    null,
    normalized,
    paletteValues,
    palette,
    depthMap
  );
  return useLocalAi
    ? await finalizeLocalAi(result, normalized.volumeSize, mask, normalized.aiCategory)
    : result;
}

export async function imagesToVoxels(
  views: ImageViews,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  if (!views.front) throw new Error("FRONT IMAGE REQUIRED");

  const normalized: NormalizedImageVoxelOptions = {
    volumeSize: options.volumeSize ?? 128,
    mode: options.mode ?? "solid",
    heightMax: options.heightMax ?? 16,
    maxVoxels: options.maxVoxels ?? 100000,
    symmetrize: options.symmetrize ?? false,
    aiCategory: options.aiCategory
  };

  if (normalized.mode === "model" && !views.side) {
    throw new Error("MODEL MODE REQUIRES FRONT + SIDE");
  }

  const useLocalAi = options.useLocalAi ?? true;
  const files = [views.front, views.side].filter(Boolean) as File[];
  let rasters = await Promise.all(files.map((file) => loadImage(file)));
  let frontDepth: Float32Array | null = null;
  if (useLocalAi) {
    const wantDepth = aiCategoryWantsDepth(normalized.aiCategory, normalized.mode);
    const enhanced = await Promise.all(
      rasters.map((raster) =>
        applyLocalAiRaster(raster, {
          depth: wantDepth,
          category: normalized.aiCategory
        })
      )
    );
    rasters = enhanced.map((e) => e.raster);
    frontDepth = enhanced[0]?.depth ?? null;
  }
  const masks = rasters.map((raster) => {
    const mask = buildMask(raster, normalized.mode);
    return normalized.mode === "model"
      ? cleanModelMask(mask, raster, normalized.aiCategory)
      : mask;
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

    // (1) Only skip hull when SIDE is clearly a second FRONT (strict assess).
    // Default path always uses FRONT ∩ SIDE visual hull.
    try {
      const { assessSideView } = await import("@/lib/ai/viewAlign");
      const quality = assessSideView(frontBounds, sideBounds);
      if (quality.sideLooksLikeFront) {
        // Soft fallback: still build hull but depth is already limited by
        // heightMax in adaptiveModelDimensions — do NOT replace with flat
        // extrusion (that ignored SIDE entirely and looked "flat").
        // Keep hull path; warning is available via assessSideView.message.
      }
    } catch {
      /* keep hull path */
    }

    // A: correlate FRONT/SIDE vertical profiles → small Y shift for hull sampling.
    let sideYOffset = 0;
    try {
      const { bestSideYShiftBins, sideYOffsetFromShift } = await import("@/lib/ai/viewAlign");
      const align = bestSideYShiftBins(frontMask, frontBounds, sideMask, sideBounds);
      sideYOffset = sideYOffsetFromShift(align.shiftBins);
    } catch {
      sideYOffset = 0;
    }

    const hull = reconstructVisualHull(
      frontRaster,
      frontMask,
      frontBounds,
      sideRaster,
      sideMask,
      sideBounds,
      normalized,
      paletteValues,
      dimensions,
      palette,
      sideYOffset,
      frontDepth
    );
    return useLocalAi
      ? await finalizeLocalAi(hull, normalized.volumeSize, frontMask, normalized.aiCategory)
      : hull;
  }

  const flat = buildNonModel(
    frontRaster,
    frontMask,
    frontBounds,
    sideMask,
    sideBounds,
    normalized,
    paletteValues,
    palette,
    frontDepth
  );
  return useLocalAi
    ? await finalizeLocalAi(flat, normalized.volumeSize, frontMask, normalized.aiCategory)
    : flat;
}
