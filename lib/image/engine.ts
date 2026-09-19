import {
  aiCategoryHeightMax,
  aiCategoryPrecision,
  aiCategoryWantsDepth,
  styleFromCategory
} from "@/lib/ai/aiCategories";
import { profileById } from "@/lib/ai/styleProfiles";
import { adaptiveAssetProfile, adaptiveHeightMax, type AdaptiveAssetProfile } from "@/lib/ai/assetProfiles";
import { guessRevolve } from "@/lib/ai/revolve";
import type {
  ImageMode,
  OutputLock,
  ImageVoxel,
  ImageImport,
  ImageVoxelOptions,
  ImageViews,
  NormalizedImageVoxelOptions,
  Raster,
  Sample,
  Bounds,
  Dimensions,
  AiPrecisionProfile,
  LocalAiResult
} from "@/lib/image/types";
import { dynamicVoxelBudget } from "@/lib/image/budget";
import {
  DEFAULT_PALETTE,
  MAX_RASTER_EDGE,
  MIN_ALPHA,
  MODEL_BUDGET_FILL,
  MODEL_MIN_AXIS,
  MODEL_EDGE_TOLERANCE,
  MODEL_EDGE_LUMINANCE_TOLERANCE,
  MODEL_MIN_COMPONENT_RATIO,
  MODEL_MIN_COMPONENT_PIXELS,
  MODEL_BG_COLOR_TOLERANCE,
  MODEL_BG_LUMINANCE_TOLERANCE,
  BAYER_4X4
} from "@/lib/image/constants";

export type {
  ImageMode,
  OutputLock,
  ImageVoxel,
  ImageImport,
  ImageVoxelOptions,
  ImageViews
} from "@/lib/image/types";


function applyOutputLock(normalized: NormalizedImageVoxelOptions) {
  if (normalized.output === "2d") {
    normalized.mode = "flat";
    normalized.heightMax = 1;
    normalized.symmetrize = false;
    normalized.useDepthThickness = false;
    normalized.sideAmbiguous = false;
    if (normalized.outline === undefined) normalized.outline = true;
    return;
  }
  if (normalized.output === "25d") {
    if (normalized.mode === "flat" || normalized.mode === "solid" || normalized.mode === "model") {
      normalized.mode = "relief";
    }
    normalized.heightMax = Math.max(2, Math.min(normalized.heightMax, 6));
    normalized.symmetrize = false;
  }
}

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
  // Rec.601 luma-weighted distance — greys and metals stay distinct.
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
}

function applySharpness(rgb: [number, number, number], sharpness: number): [number, number, number] {
  if (sharpness <= 1) return rgb;
  const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return [
    clamp(l + (rgb[0] - l) * sharpness, 0, 255),
    clamp(l + (rgb[1] - l) * sharpness, 0, 255),
    clamp(l + (rgb[2] - l) * sharpness, 0, 255)
  ];
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

  const largestIndex = componentSizes.reduce(
    (best, size, index) => (size > componentSizes[best] ? index : best),
    0
  );
  const largest = componentSizes[largestIndex];
  const precision = aiPrecisionProfile(aiCategory);
  const minComponent = Math.max(
    precision?.minComponentPixels ?? MODEL_MIN_COMPONENT_PIXELS,
    Math.round(largest * (precision?.minComponentRatio ?? MODEL_MIN_COMPONENT_RATIO))
  );

  // A real asset detail can arrive as a tiny disconnected mask component
  // (trigger, muzzle tip, guard, stock/end-cap, thin prop handle) after
  // segmentation. Do not let the generic component-size filter erase it
  // when it is close to the main subject, has meaningful foreground
  // contrast, and has a feature-like shape. This is intentionally a local
  // preservation rule: large detached background noise is still removed.
  const mainComponent = components[largestIndex] ?? [];
  const mainSet = new Set(mainComponent.map(([x, y]) => `${x}:${y}`));
  const featureGap = precision?.preserveThinContour ? 4 : 3;

  const isSilhouetteFeature = (cells: [number, number][]) => {
    if (cells.length < 2 || !mainComponent.length) return false;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let contrastTotal = 0;
    let contrastHits = 0;
    const step = Math.max(1, Math.floor(cells.length / 48));

    for (let i = 0; i < cells.length; i += step) {
      const [x, y] = cells[i];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const sample = sampleAt(raster, x, y);
      const distanceToBg = Math.sqrt(
        (sample.r - bg[0]) ** 2 +
        (sample.g - bg[1]) ** 2 +
        (sample.b - bg[2]) ** 2
      );
      contrastTotal += distanceToBg;
      if (distanceToBg >= (precision?.preserveThinContour ? 38 : 48)) {
        contrastHits += 1;
      }
    }

    const width = Math.max(1, maxX - minX + 1);
    const height = Math.max(1, maxY - minY + 1);
    const slenderness = Math.max(width, height) / Math.min(width, height);
    const averageContrast = contrastTotal / Math.max(1, Math.ceil(cells.length / step));

    let nearMain = false;
    for (const [x, y] of cells) {
      let found = false;
      for (let dy = -featureGap; dy <= featureGap && !found; dy += 1) {
        for (let dx = -featureGap; dx <= featureGap; dx += 1) {
          if (Math.abs(dx) + Math.abs(dy) > featureGap) continue;
          if (mainSet.has(`${x + dx}:${y + dy}`)) {
            found = true;
            break;
          }
        }
      }
      if (found) {
        nearMain = true;
        break;
      }
    }

    const elongated = slenderness >= 2.2;
    const compactDetail = cells.length <= Math.max(24, Math.round(minComponent * 1.5));
    const contrastRatio = contrastHits / Math.max(1, Math.ceil(cells.length / step));

    return (
      nearMain &&
      averageContrast >= (precision?.preserveThinContour ? 34 : 44) &&
      contrastRatio >= 0.5 &&
      (elongated || compactDetail)
    );
  };

  for (let i = 0; i < components.length; i += 1) {
    if (componentSizes[i] >= minComponent) continue;
    if (i !== largestIndex && isSilhouetteFeature(components[i])) continue;
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

function createPalette(rasters: Raster[], masks: boolean[][][], size = 48, viewWeights?: number[]) {
  const buckets = new Map<string, { r: number; g: number; b: number; weight: number }>();

  for (let view = 0; view < rasters.length; view += 1) {
    const raster = rasters[view];
    const viewWeight = Math.max(0.1, viewWeights?.[view] ?? 1);
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
        if (existing) existing.weight += viewWeight;
        else buckets.set(key, { r, g, b, weight: viewWeight });
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

function materialAwareDitheredColor(
  rgb: [number, number, number],
  px: number,
  py: number,
  strength = 10
): [number, number, number] {
  const luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  const chroma = Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);

  // Keep source material colors stable when a Bayer offset would become a
  // visible fake highlight/shadow. This especially protects real blacks, dark
  // metals and neutral surfaces while retaining normal dithering for textured
  // and chromatic materials.
  let factor = 1;
  if (luma < 48) factor *= 0.35;
  else if (luma < 86) factor *= 0.58;
  else if (luma > 228) factor *= 0.52;
  if (chroma < 18) factor *= 0.62;

  return ditheredColor(rgb, px, py, strength * factor);
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

/**
 * Blend FRONT/SIDE material information without letting the hidden-side
 * sample arbitrarily darken or brighten the established FRONT luminance.
 * This keeps hue/value continuity while preserving the source read of the
 * object for 2.5D/voxel assets.
 */
function blendMaterialPreserveLuma(
  front: Sample,
  side: Sample,
  t: number
): [number, number, number] {
  const amount = clamp(t, 0, 1);
  const blended = blendRgb(front, side, amount);
  const frontLuma = 0.299 * front.r + 0.587 * front.g + 0.114 * front.b;
  const sideLuma = 0.299 * side.r + 0.587 * side.g + 0.114 * side.b;
  const blendedLuma = 0.299 * blended[0] + 0.587 * blended[1] + 0.114 * blended[2];
  if (blendedLuma < 1) return blended;

  // FRONT remains the material anchor. SIDE contributes luminance more gently
  // than its raw RGB blend so hidden/lateral samples cannot wash out a dark
  // source or artificially darken a bright one.
  const allowedLumaShift = clamp(8 + amount * 24, 8, 32);
  const rawShift = sideLuma - frontLuma;
  const cappedShift = clamp(rawShift, -allowedLumaShift, allowedLumaShift);
  const targetLuma = frontLuma + cappedShift * clamp(amount * 0.7, 0, 0.55);
  const scale = clamp(targetLuma / blendedLuma, 0.78, 1.22);

  return [
    clamp(blended[0] * scale, 0, 255),
    clamp(blended[1] * scale, 0, 255),
    clamp(blended[2] * scale, 0, 255)
  ];
}

function materialAgreement(a: Sample, b: Sample): number {
  if (!a.visible || !b.visible) return 0;
  const distance = Math.sqrt(
    rgbDistance([a.r, a.g, a.b], [b.r, b.g, b.b])
  );
  // Similar source colors are safe to interpolate; strong disagreement is
  // treated as a material boundary and keeps FRONT dominant.
  return 1 - clamp((distance - 18) / 150, 0, 1);
}

function localMaterialSample(
  raster: Raster,
  x: number,
  y: number
): Sample {
  const cx = clamp(Math.round(x), 0, raster.width - 1);
  const cy = clamp(Math.round(y), 0, raster.height - 1);
  const samples: Sample[] = [];

  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const s = sampleAt(raster, cx + ox, cy + oy);
      if (s.visible) samples.push(s);
    }
  }

  if (samples.length <= 1) return sampleAt(raster, cx, cy);

  const sortedR = samples.map((s) => s.r).sort((a, b) => a - b);
  const sortedG = samples.map((s) => s.g).sort((a, b) => a - b);
  const sortedB = samples.map((s) => s.b).sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  const center = sampleAt(raster, cx, cy);

  // Keep the exact source pixel dominant while taking only a small median
  // support sample. This smooths JPEG/antialias noise without flattening real
  // material boundaries or dark details.
  const support: [number, number, number] = [
    sortedR[mid],
    sortedG[mid],
    sortedB[mid]
  ];
  const supportWeight = center.visible ? 0.18 : 1;
  return {
    r: center.r * (1 - supportWeight) + support[0] * supportWeight,
    g: center.g * (1 - supportWeight) + support[1] * supportWeight,
    b: center.b * (1 - supportWeight) + support[2] * supportWeight,
    a: Math.max(center.a, 255),
    visible: true
  };
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

function maskFillRatio(mask: boolean[][], bounds?: Bounds | null) {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return 0;
  let hits = 0;
  const minX = Math.max(0, bounds.minX);
  const maxX = Math.min(mask[0]?.length ?? 0, bounds.maxX + 1);
  const minY = Math.max(0, bounds.minY);
  const maxY = Math.min(mask.length, bounds.maxY + 1);
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      if (mask[y]?.[x]) hits += 1;
    }
  }
  return hits / Math.max(1, bounds.width * bounds.height);
}

function effectiveBudget(
  volumeSize: number,
  requested: number | undefined,
  mode: ImageMode,
  geometry?: {
    width: number;
    height: number;
    depth: number;
    projectedFill?: number;
    category?: ImageVoxelOptions["aiCategory"];
    profileScale?: number;
  }
) {
  return dynamicVoxelBudget({
    volumeSize,
    mode,
    requested,
    defaultCap: 100000,
    width: geometry?.width ?? volumeSize,
    height: geometry?.height ?? volumeSize,
    depth: geometry?.depth ?? (mode === "model" ? 8 : 1),
    projectedFill: geometry?.projectedFill,
    category: geometry?.category,
    profileScale: geometry?.profileScale
  });
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


function normalizedRowProfile(mask: boolean[][], bounds: Bounds, bins = 64): number[] {
  const profile = Array.from({ length: bins }, () => 0);
  if (!bounds.width || !bounds.height) return profile;

  for (let bin = 0; bin < bins; bin += 1) {
    const y0 = bounds.minY + (bin / bins) * bounds.height;
    const y1 = bounds.minY + ((bin + 1) / bins) * bounds.height;
    const startY = clamp(Math.floor(y0), bounds.minY, bounds.maxY);
    const endY = clamp(Math.max(startY, Math.ceil(y1) - 1), bounds.minY, bounds.maxY);

    let hits = 0;
    let total = 0;
    for (let y = startY; y <= endY; y += 1) {
      const row = mask[y];
      if (!row) continue;
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        total += 1;
        if (row[x]) hits += 1;
      }
    }
    profile[bin] = total > 0 ? hits / total : 0;
  }

  return profile;
}

function sampleProfile(profile: number[], normalizedY: number) {
  if (!profile.length) return 0;
  const y = clamp(normalizedY, 0, 1) * (profile.length - 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(profile.length - 1, y0 + 1);
  const t = y - y0;
  return profile[y0] * (1 - t) + profile[y1] * t;
}

/**
 * Refine the existing SIDE Y alignment without replacing the established
 * viewAlign decision. The comparison is done on normalized silhouette-row
 * occupancy, so FRONT and SIDE may have different source resolutions.
 */
function refineSideYOffset(
  frontMask: boolean[][],
  frontBounds: Bounds,
  sideMask: boolean[][],
  sideBounds: Bounds,
  initialOffset: number
) {
  const frontProfile = normalizedRowProfile(frontMask, frontBounds);
  const sideProfile = normalizedRowProfile(sideMask, sideBounds);
  if (!frontProfile.some(Boolean) || !sideProfile.some(Boolean)) return initialOffset;

  const clampOffset = (value: number) => clamp(value, -0.08, 0.08);
  const base = clampOffset(initialOffset);
  const candidates = new Set<number>();

  // Keep the existing alignment as the anchor and only search a narrow band.
  for (let step = -8; step <= 8; step += 1) {
    candidates.add(clampOffset(base + step * 0.01));
  }

  let bestOffset = base;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    let error = 0;
    let weight = 0;
    let overlap = 0;

    for (let i = 0; i < frontProfile.length; i += 1) {
      const ny = frontProfile.length <= 1 ? 0.5 : i / (frontProfile.length - 1);
      const side = sampleProfile(sideProfile, ny + candidate);
      const front = frontProfile[i];
      const localWeight = 0.35 + Math.max(front, side) * 1.8;
      error += Math.abs(front - side) * localWeight;
      weight += localWeight;
      if (front > 0.06 && side > 0.06) overlap += Math.min(front, side);
    }

    const normalizedError = error / Math.max(1, weight);
    const overlapBonus = overlap / Math.max(1, frontProfile.length) * 0.12;
    const shiftPenalty = Math.abs(candidate - base) * 0.10;
    const score = normalizedError + shiftPenalty - overlapBonus;

    if (score < bestScore) {
      bestScore = score;
      bestOffset = candidate;
    }
  }

  return bestOffset;
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
  const adaptiveDepthGrid = buildAdaptiveDepthGrid(frontDepth, frontRaster, frontMask);
  const h = dimensions.height;

  for (let y = 0; y < h; y += 1) {
    const ny = h <= 1 ? 0.5 : y / (h - 1);
    // Align SIDE row to FRONT (tip-to-base correlation from viewAlign).
    const ySide = clamp(Math.round(y + sideYOffset * Math.max(0, h - 1)), 0, h - 1);

    for (let x = 0; x < dimensions.width; x += 1) {
      if (!front[y]?.[x]) continue;

      const nx = dimensions.width <= 1 ? 0.5 : x / (dimensions.width - 1);
      const frontColor = localMaterialSample(frontRaster, frontBounds.minX + nx * (frontBounds.maxX - frontBounds.minX), frontBounds.minY + ny * (frontBounds.maxY - frontBounds.minY));
      const px = frontBounds.minX + nx * (frontBounds.maxX - frontBounds.minX);
      const py = frontBounds.minY + ny * (frontBounds.maxY - frontBounds.minY);
      const depthSample = adaptiveDepthAt(
        frontDepth,
        frontRaster,
        frontMask,
        px,
        py,
        options.aiCategory,
        adaptiveDepthGrid
      );

      // Depth soft-clamp: ambiguous SIDE (legacy) OR (C) guns/rifles/objects
      // per-row thickness from MiDaS. Swords never use this path.
      const useDepthClamp =
        Boolean(frontDepth) &&
        dimensions.depth > 2 &&
        (options.sideAmbiguous === true || options.useDepthThickness === true);
      const depthHalf = useDepthClamp
        ? Math.max(
            1,
            Math.round(
              dimensions.depth *
                (options.useDepthThickness
                  ? 0.18 + depthSample * 0.5
                  : 0.22 + depthSample * 0.4)
            )
          )
        : dimensions.depth;
      const zMid = (dimensions.depth - 1) * 0.5;

      for (let z = 0; z < dimensions.depth; z += 1) {
        const nz = dimensions.depth <= 1 ? 0.5 : z / (dimensions.depth - 1);

        // TRUE VISUAL HULL: FRONT = X/Y, SIDE = Z/Y (Y-aligned).
        if (side && !side[ySide]?.[z]) continue;

        if (useDepthClamp && Math.abs(z - zMid) > depthHalf) continue;

        let color: [number, number, number] = [
          frontColor.r,
          frontColor.g,
          frontColor.b
        ];

        if (sideRaster && sideBounds && side?.[ySide]?.[z]) {
          const sideX = sideBounds.minX + clamp(nz, 0, 1) * (sideBounds.maxX - sideBounds.minX);
          const sideY = sideBounds.minY + clamp(ny + sideYOffset, 0, 1) * (sideBounds.maxY - sideBounds.minY);
          const sideColor = localMaterialSample(sideRaster, sideX, sideY);
          // SIDE contributes most near lateral surfaces. When FRONT/SIDE colors
          // disagree strongly, reduce the blend so one material cannot bleed
          // into another across the reconstructed volume.
          const edgeProximity = 1 - Math.min(nz, 1 - nz) * 2;
          const eased = edgeProximity * edgeProximity * (3 - 2 * edgeProximity);
          const agreement = materialAgreement(frontColor, sideColor);
          const sideWeight =
            (0.08 + eased * 0.54) * (0.38 + agreement * 0.62);
          color = blendMaterialPreserveLuma(frontColor, sideColor, sideWeight);
        }

        voxels.push({
          x,
          y,
          z,
          c: nearestColor(materialAwareDitheredColor(color, x, y + z, 3), paletteValues)
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


function dropMaskSpurs(mask: boolean[][]) {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  const next = mask.map((row) => row.slice());
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      const n =
        (y > 0 && mask[y - 1][x] ? 1 : 0) +
        (y + 1 < h && mask[y + 1][x] ? 1 : 0) +
        (x > 0 && mask[y][x - 1] ? 1 : 0) +
        (x + 1 < w && mask[y][x + 1] ? 1 : 0);
      if (n === 0) next[y][x] = false;
    }
  }
  return next;
}

function outlineFront1px(voxels: ImageVoxel[], ink: number) {
  const face = new Map<string, ImageVoxel>();
  for (const v of voxels) if (v.z === 0) face.set(`${v.x}:${v.y}`, v);
  for (const v of face.values()) {
    const open =
      !face.has(`${v.x + 1}:${v.y}`) ||
      !face.has(`${v.x - 1}:${v.y}`) ||
      !face.has(`${v.x}:${v.y + 1}`) ||
      !face.has(`${v.x}:${v.y - 1}`);
    if (open) v.c = ink;
  }
  return voxels;
}

function pickOutlineIndex(palette: string[]) {
  let best = 0, bestL = 256;
  for (let i = 0; i < palette.length; i += 1) {
    const hex = palette[i].replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (l < bestL) { bestL = l; best = i; }
  }
  return best;
}

function buildFlatSprite(
  raster: Raster,
  mask: boolean[][],
  bounds: Bounds,
  options: NormalizedImageVoxelOptions,
  paletteValues: [number, number, number][],
  palette: string[]
): ImageImport {
  const maxAxis = Math.max(4, options.volumeSize - 8);
  const scale = Math.min(1, maxAxis / Math.max(bounds.width, bounds.height));
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const sourceMask = dropMaskSpurs(resampleMaskToBounds(mask, bounds, width, height));
  const voxels: ImageVoxel[] = [];
  for (let y = 0; y < height; y += 1) {
    const ny = height <= 1 ? 0.5 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      if (!sourceMask[y]?.[x]) continue;
      const nx = width <= 1 ? 0.5 : x / (width - 1);
      const frontColor = localMaterialSample(raster, bounds.minX + nx * (bounds.maxX - bounds.minX), bounds.minY + ny * (bounds.maxY - bounds.minY));
      voxels.push({
        x, y, z: 0,
        c: nearestColor(applySharpness([frontColor.r, frontColor.g, frontColor.b], options.aiCategory === "swords" ? 1.18 : 1.12), paletteValues)
      });
    }
  }
  if (!voxels.length) throw new Error("No voxels reconstructed");
  if (options.outline !== false) outlineFront1px(voxels, pickOutlineIndex(palette));
  const budget = effectiveBudget(
    options.volumeSize,
    options.maxVoxelsExplicit ? options.maxVoxels : undefined,
    "flat",
    {
      width,
      height,
      depth: 1,
      projectedFill: maskFillRatio(sourceMask, { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1, width, height }),
      category: options.aiCategory,
      profileScale: options.adaptiveBudgetScale
    }
  );
  const limited = voxels.length <= budget ? voxels : spatialBudget(voxels, budget);
  const packed = normalizeToVolume(limited, options.volumeSize);
  return { width: raster.width, height: raster.height, voxels: packed, palette, count: packed.length };
}

function quantizeUnit(value: number, levels: number) {
  const l = Math.max(2, levels);
  return Math.round(Math.max(0, Math.min(1, value)) * (l - 1)) / (l - 1);
}

function medianFilterZ(grid: number[][], mask: boolean[][]) {
  const h = grid.length, w = grid[0]?.length ?? 0;
  const out = grid.map((row) => row.slice());
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y]?.[x]) continue;
      const vals: number[] = [];
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= h || xx >= w || !mask[yy][xx]) continue;
        vals.push(grid[yy][xx]);
      }
      if (!vals.length) continue;
      vals.sort((a, b) => a - b);
      out[y][x] = vals[Math.floor(vals.length / 2)];
    }
  }
  return out;
}

function componentMedianZ(mask: boolean[][], zGrid: number[][], minZ: number, maxZ: number) {
  const h = mask.length, w = mask[0]?.length ?? 0;
  const seen = Array.from({ length: h }, () => Array(w).fill(false));
  const out = zGrid.map((row) => row.slice());
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x] || seen[y][x]) continue;
      const stack = [[x, y]], cells: [number, number][] = [], zs: number[] = [];
      seen[y][x] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        cells.push([cx, cy]); zs.push(zGrid[cy][cx]);
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (ny < 0 || nx < 0 || ny >= h || nx >= w || !mask[ny][nx] || seen[ny][nx]) continue;
          seen[ny][nx] = true; stack.push([nx, ny]);
        }
      }
      zs.sort((a, b) => a - b);
      const z = Math.max(minZ, Math.min(maxZ, Math.round(zs[Math.floor(zs.length / 2)])));
      for (const [cx, cy] of cells) out[cy][cx] = z;
    }
  }
  return out;
}

function buildColumnRunRatios(mask: boolean[][]): number[][] {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  const ratios = Array.from({ length: h }, () => Array(w).fill(0));
  if (!w || !h) return ratios;

  for (let x = 0; x < w; x += 1) {
    let y = 0;
    while (y < h) {
      while (y < h && !mask[y]?.[x]) y += 1;
      if (y >= h) break;

      const start = y;
      while (y < h && mask[y]?.[x]) y += 1;
      const run = Math.max(1, y - start);
      const ratio = run / Math.max(1, h);
      for (let ry = start; ry < y; ry += 1) ratios[ry][x] = ratio;
    }
  }

  return ratios;
}

function buildRowRunRatios(mask: boolean[][]): number[][] {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  const ratios = Array.from({ length: h }, () => Array(w).fill(0));
  if (!w || !h) return ratios;

  for (let y = 0; y < h; y += 1) {
    let x = 0;
    while (x < w) {
      while (x < w && !mask[y]?.[x]) x += 1;
      if (x >= w) break;

      const start = x;
      while (x < w && mask[y]?.[x]) x += 1;
      const run = Math.max(1, x - start);
      const ratio = run / Math.max(1, w);
      for (let rx = start; rx < x; rx += 1) ratios[y][rx] = ratio;
    }
  }

  return ratios;
}

function buildSingleViewModel(
  raster: Raster,
  mask: boolean[][],
  bounds: Bounds,
  options: NormalizedImageVoxelOptions,
  paletteValues: [number, number, number][],
  palette: string[],
  depthMap: Float32Array | null
): ImageImport {
  const maxAxis = Math.max(4, options.volumeSize - 8);
  const scale = Math.min(1, maxAxis / Math.max(bounds.width, bounds.height));
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const sourceMask = resampleMaskToBounds(mask, bounds, width, height);

  // Hidden-surface inference is deliberately conservative. Only high-confidence
  // rotational objects in the generic OBJECTS category are eligible; weapon
  // categories always retain the normal silhouette/depth pipeline.
  const revolve = options.aiCategory === "objects" ? guessRevolve(sourceMask) : null;
  if (!revolve || revolve.confidence < 0.82) {
    return buildNonModel(
      raster,
      mask,
      bounds,
      undefined,
      null,
      { ...options, mode: "solid" },
      paletteValues,
      palette,
      depthMap
    );
  }

  const rowRatios = buildRowRunRatios(sourceMask);
  const columnRatios = buildColumnRunRatios(sourceMask);
  let maxRatio = 0;
  for (const row of revolve.axis === "y" ? rowRatios : columnRatios) {
    for (const ratio of row) maxRatio = Math.max(maxRatio, ratio);
  }
  if (maxRatio <= 0) {
    return buildNonModel(
      raster,
      mask,
      bounds,
      undefined,
      null,
      { ...options, mode: "solid" },
      paletteValues,
      palette,
      depthMap
    );
  }

  const voxels: ImageVoxel[] = [];
  const adaptiveDepthGrid = buildAdaptiveDepthGrid(depthMap, raster, mask);
  const depthCap = Math.max(2, Math.min(options.heightMax, Math.round(maxAxis * 0.22)));
  const sharpness = options.aiCategory === "objects" ? 1.02 : 1;

  for (let y = 0; y < height; y += 1) {
    const ny = height <= 1 ? 0.5 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      if (!sourceMask[y]?.[x]) continue;
      const nx = width <= 1 ? 0.5 : x / (width - 1);
      const frontColor = localMaterialSample(raster, bounds.minX + nx * (bounds.maxX - bounds.minX), bounds.minY + ny * (bounds.maxY - bounds.minY));
      const px = bounds.minX + nx * (bounds.maxX - bounds.minX);
      const py = bounds.minY + ny * (bounds.maxY - bounds.minY);
      const d = adaptiveDepthAt(depthMap, raster, mask, px, py, options.aiCategory, adaptiveDepthGrid);
      const supportRatio = revolve.axis === "y"
        ? rowRatios[y]?.[x] ?? 0
        : columnRatios[y]?.[x] ?? 0;

      // The silhouette supplies the revolved radius. MiDaS is only a gentle
      // modulation, so a noisy depth map cannot destroy the inferred shape.
      const depthModulation = 0.88 + d * 0.24;
      const rawDepth = depthCap * (supportRatio / Math.max(maxRatio, 1)) * depthModulation;
      const finalDepth = Math.max(1, Math.min(depthCap, Math.round(rawDepth)));
      const colorIndex = nearestColor(
        materialAwareDitheredColor(
          applySharpness([frontColor.r, frontColor.g, frontColor.b], sharpness),
          x,
          y,
          8
        ),
        paletteValues
      );

      for (let z = 0; z < finalDepth; z += 1) {
        voxels.push({ x, y, z, c: colorIndex });
      }
    }
  }

  if (!voxels.length) {
    return buildNonModel(
      raster,
      mask,
      bounds,
      undefined,
      null,
      { ...options, mode: "solid" },
      paletteValues,
      palette,
      depthMap
    );
  }

  const budget = effectiveBudget(
    options.volumeSize,
    options.maxVoxelsExplicit ? options.maxVoxels : undefined,
    "model",
    {
      width,
      height,
      depth: depthCap,
      projectedFill: maskFillRatio(sourceMask, {
        minX: 0,
        minY: 0,
        maxX: width - 1,
        maxY: height - 1,
        width,
        height
      }),
      category: options.aiCategory,
      profileScale: options.adaptiveBudgetScale
    }
  );

  const limited = voxels.length <= budget ? voxels : spatialBudget(voxels, budget);
  const packed = normalizeToVolume(limited, options.volumeSize);
  return {
    width: raster.width,
    height: raster.height,
    voxels: packed,
    palette,
    count: packed.length,
    shape: revolve.kind,
    category: options.aiCategory
  };
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
  const rowRunRatios = buildRowRunRatios(sourceMask);
  const adaptiveDepthGrid = buildAdaptiveDepthGrid(depthMap, raster, mask);

  if (options.output === "2d" || options.mode === "flat") {
    return buildFlatSprite(raster, mask, bounds, options, paletteValues, palette);
  }

  const depthBase =
    options.mode === "relief" || options.output === "25d"
      ? Math.max(2, Math.round(options.heightMax * 0.30))
      : Math.max(2, Math.round(options.heightMax * 0.62));

  const useQuantizedRelief = options.output === "25d" || options.mode === "relief";
  const useDepthRelief =
    Boolean(depthMap) && (options.mode === "relief" || options.mode === "solid" || options.output === "25d");

  const voxels: ImageVoxel[] = [];

  if (useQuantizedRelief) {
    const levels = Math.max(3, Math.min(5, Math.round(options.heightMax)));
    const raw: number[][] = Array.from({ length: height }, () => Array(width).fill(1));
    for (let y = 0; y < height; y += 1) {
      const ny = height <= 1 ? 0.5 : y / (height - 1);
      for (let x = 0; x < width; x += 1) {
        if (!sourceMask[y]?.[x]) continue;
        const nx = width <= 1 ? 0.5 : x / (width - 1);
        const px = bounds.minX + nx * (bounds.maxX - bounds.minX);
        const py = bounds.minY + ny * (bounds.maxY - bounds.minY);
        const d = useDepthRelief ? depthAt(depthMap, raster, px, py) : 0.55;
        raw[y][x] = 1 + Math.round(quantizeUnit(d, levels) * (levels - 1));
      }
    }
    const zGrid = componentMedianZ(sourceMask, medianFilterZ(raw, sourceMask), 2, Math.max(2, options.heightMax));
    for (let y = 0; y < height; y += 1) {
      const ny = height <= 1 ? 0.5 : y / (height - 1);
      for (let x = 0; x < width; x += 1) {
        if (!sourceMask[y]?.[x]) continue;
        const nx = width <= 1 ? 0.5 : x / (width - 1);
        const frontColor = localMaterialSample(raster, bounds.minX + nx * (bounds.maxX - bounds.minX), bounds.minY + ny * (bounds.maxY - bounds.minY));
        const finalDepth = zGrid[y][x];
        const colorIndex = nearestColor(
          materialAwareDitheredColor(
            applySharpness([frontColor.r, frontColor.g, frontColor.b], options.aiCategory === "swords" ? 1.18 : options.aiCategory === "guns" ? 1.08 : 1),
            x, y,
            options.aiCategory === "swords" || options.aiCategory === "guns" ? 4 : 8
          ),
          paletteValues
        );
        for (let z = 0; z < finalDepth; z += 1) voxels.push({ x, y, z, c: colorIndex });
      }
    }
    if (!voxels.length) throw new Error("No voxels reconstructed");
    const budgetQ = effectiveBudget(
      options.volumeSize,
      options.maxVoxelsExplicit ? options.maxVoxels : undefined,
      options.mode,
      {
        width,
        height,
        depth: Math.max(1, options.heightMax),
        projectedFill: maskFillRatio(sourceMask, { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1, width, height }),
        category: options.aiCategory,
        profileScale: options.adaptiveBudgetScale
      }
    );
    const limitedQ = voxels.length <= budgetQ ? voxels : spatialBudget(voxels, budgetQ);
    const packedQ = normalizeToVolume(limitedQ, options.volumeSize);
    return { width: raster.width, height: raster.height, voxels: packedQ, palette, count: packedQ.length };
  }

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

      const px = bounds.minX + nx * (bounds.maxX - bounds.minX);
      const py = bounds.minY + ny * (bounds.maxY - bounds.minY);
      const d = adaptiveDepthAt(
        depthMap,
        raster,
        mask,
        px,
        py,
        options.aiCategory,
        adaptiveDepthGrid
      );

      // Local thickness: use the connected foreground run containing this
      // pixel, not the entire row. This preserves thin barrels, blades, handles
      // and protrusions even when a separate bulky part exists on the same Y.
      const localRunRatio = rowRunRatios[y]?.[x] ?? 0;
      const profile = 0.16 + localRunRatio * 0.84;
      const depthMix = useDepthRelief ? 0.4 + d * 0.7 : 1;
      finalDepth = Math.max(
        1,
        Math.round(depthBase * profile * depthMix)
      );
      finalDepth = Math.min(finalDepth, Math.max(2, options.heightMax));

      for (let z = 0; z < finalDepth; z += 1) {
        const colorSample = frontColor;

        voxels.push({
          x,
          y,
          z,
          c: nearestColor(
            materialAwareDitheredColor(
              applySharpness(
                [colorSample.r, colorSample.g, colorSample.b],
                options.aiCategory === "swords" ? 1.18 : options.aiCategory === "guns" ? 1.08 : 1
              ),
              x,
              y + z,
              options.aiCategory === "swords" || options.aiCategory === "guns" ? 4 : 10
            ),
            paletteValues
          )
        });
      }
    }
  }

  if (!voxels.length) throw new Error("No voxels reconstructed");

  const budget = effectiveBudget(
    options.volumeSize,
    options.maxVoxelsExplicit ? options.maxVoxels : undefined,
    options.mode,
    {
      width,
      height,
      depth: Math.max(1, options.heightMax),
      projectedFill: maskFillRatio(sourceMask, { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1, width, height }),
      category: options.aiCategory,
      profileScale: options.adaptiveBudgetScale
    }
  );
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

  // Prefer a watertight shell over a holey first-voxel-in-cell downsample.
  const key = (v: ImageVoxel) => `${v.x}:${v.y}:${v.z}`;
  const map = new Map(voxels.map((v) => [key(v), v]));
  const surface: ImageVoxel[] = [];
  const interior: ImageVoxel[] = [];
  for (const v of voxels) {
    const exposed =
      !map.has(`${v.x + 1}:${v.y}:${v.z}`) ||
      !map.has(`${v.x - 1}:${v.y}:${v.z}`) ||
      !map.has(`${v.x}:${v.y + 1}:${v.z}`) ||
      !map.has(`${v.x}:${v.y - 1}:${v.z}`) ||
      !map.has(`${v.x}:${v.y}:${v.z + 1}`) ||
      !map.has(`${v.x}:${v.y}:${v.z - 1}`);
    if (exposed) surface.push(v);
    else interior.push(v);
  }
  if (surface.length >= Math.min(budget, voxels.length * 0.35)) {
    if (surface.length >= budget) {
      // Preserve high-information surface voxels first (corners, tips, thin
      // edges and exposed feature turns), then distribute the remaining
      // budget deterministically across the rest of the shell.
      const scored = surface.map((voxel) => {
        let neighbours = 0;
        if (map.has(`${voxel.x + 1}:${voxel.y}:${voxel.z}`)) neighbours += 1;
        if (map.has(`${voxel.x - 1}:${voxel.y}:${voxel.z}`)) neighbours += 1;
        if (map.has(`${voxel.x}:${voxel.y + 1}:${voxel.z}`)) neighbours += 1;
        if (map.has(`${voxel.x}:${voxel.y - 1}:${voxel.z}`)) neighbours += 1;
        if (map.has(`${voxel.x}:${voxel.y}:${voxel.z + 1}`)) neighbours += 1;
        if (map.has(`${voxel.x}:${voxel.y}:${voxel.z - 1}`)) neighbours += 1;
        const xyBoundary =
          (!map.has(`${voxel.x + 1}:${voxel.y}:${voxel.z}`) ? 1 : 0) +
          (!map.has(`${voxel.x - 1}:${voxel.y}:${voxel.z}`) ? 1 : 0) +
          (!map.has(`${voxel.x}:${voxel.y + 1}:${voxel.z}`) ? 1 : 0) +
          (!map.has(`${voxel.x}:${voxel.y - 1}:${voxel.z}`) ? 1 : 0);
        const score = (6 - neighbours) * 2 + xyBoundary * 1.5;
        return { voxel, score };
      });
      scored.sort(
        (a, b) =>
          b.score - a.score ||
          voxelKey(a.voxel).localeCompare(voxelKey(b.voxel))
      );
      const reserve = Math.min(
        Math.max(1, Math.floor(budget * 0.18)),
        scored.length
      );
      const preserved = scored.slice(0, reserve).map((item) => item.voxel);
      const preservedKeys = new Set(preserved.map(voxelKey));
      const remaining = surface.filter((voxel) => !preservedKeys.has(voxelKey(voxel)));
      const room = budget - preserved.length;
      const stride = Math.max(1, Math.ceil(remaining.length / Math.max(1, room)));
      const distributed = remaining
        .filter((_, i) => i % stride === 0)
        .slice(0, room);
      return preserved.concat(distributed).slice(0, budget);
    }
    const room = budget - surface.length;
    const stride = Math.max(1, Math.ceil(interior.length / Math.max(1, room)));
    return surface.concat(interior.filter((_, i) => i % stride === 0).slice(0, room));
  }

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
      depth: enhanced.depth,
      diagnostics: enhanced.diagnostics
    };
  } catch {
    return {
      raster,
      depth: null,
      diagnostics: { segment: "fail", depth: "skip", segmentSize: "-" }
    };
  }
}

function formatAiStatus(
  diag: LocalAiResult["diagnostics"] | undefined,
  dims?: { width: number; height: number; depth: number }
): string {
  const seg = diag?.segment ?? "skip";
  const dep = diag?.depth ?? "skip";
  const sz = diag?.segmentSize && diag.segmentSize !== "-" ? ` · net ${diag.segmentSize}` : "";
  const hull = dims ? ` · hull ${dims.width}×${dims.height}×${dims.depth}` : "";
  return `segment ${seg} · depth ${dep}${sz}${hull}`;
}

/** Sample normalized depth [0..1] at raster pixel; missing map → mid bias. */
function depthAt(depth: Float32Array | null, raster: Raster, x: number, y: number): number {
  if (!depth || !raster.width) return 0.55;
  const xx = clamp(Math.round(x), 0, raster.width - 1);
  const yy = clamp(Math.round(y), 0, raster.height - 1);
  return clamp(depth[yy * raster.width + xx] ?? 0.55, 0, 1);
}

/**
 * Stabilise local depth before converting it into voxel thickness.
 *
 * MiDaS is intentionally treated as a relative depth hint, not ground-truth
 * geometry. A small neighbourhood median suppresses isolated spikes, while
 * edge-aware blending prevents the contour from becoming thicker than the
 * surrounding body. Category-specific bias is deliberately tiny so the
 * existing heightMax/category budgets remain authoritative.
 */
function computeAdaptiveDepthSample(
  depth: Float32Array,
  raster: Raster,
  mask: boolean[][],
  cx: number,
  cy: number
): number {
  const base = depthAt(depth, raster, cx, cy);
  const values = new Array<number>(25);
  let valueCount = 0;
  let foregroundNeighbours = 0;
  let ringSupport = 0;

  // Use a 5×5 robust neighbourhood. The inner samples stabilize the body;
  // the outer ring tells us when a depth discontinuity is real or simply a
  // MiDaS spike near an anti-aliased contour.
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const xx = cx + dx;
      const yy = cy + dy;
      if (xx < 0 || yy < 0 || xx >= raster.width || yy >= raster.height) continue;
      if (!mask[yy]?.[xx]) continue;
      values[valueCount] = depthAt(depth, raster, xx, yy);
      valueCount += 1;
      foregroundNeighbours += 1;
      if (Math.abs(dx) === 2 || Math.abs(dy) === 2) ringSupport += 1;
    }
  }

  if (valueCount < 3) return base;

  const samples = values.slice(0, valueCount);
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(valueCount / 2)];
  const deviations = new Array<number>(valueCount);
  for (let i = 0; i < valueCount; i += 1) {
    deviations[i] = Math.abs(samples[i] - median);
  }
  deviations.sort((a, b) => a - b);
  const mad = deviations[Math.floor(valueCount / 2)] ?? 0;
  const robustNoise = clamp(mad / 0.12, 0, 1);

  // High local dispersion means the raw depth is unreliable. Trust the
  // neighbourhood more in those areas, but keep a substantial contribution
  // from the original pixel so real gradients do not get flattened.
  const robustBlend = 0.28 + robustNoise * 0.38;
  const smoothed = base * (1 - robustBlend) + median * robustBlend;

  const neighbourCoverage = foregroundNeighbours / 25;
  const sparseWeight = neighbourCoverage < 0.24 ? 0.12 : neighbourCoverage < 0.40 ? 0.06 : 0;
  const sparseSafe = smoothed * (1 - sparseWeight) + 0.5 * sparseWeight;

  // Edge-aware stabilization: a contour pixel with little foreground support
  // must not inherit a deep interior value from a single noisy neighbour.
  const ringCoverage = ringSupport / Math.max(1, foregroundNeighbours);
  const edgeWeight = clamp((0.72 - neighbourCoverage) * 1.35 + ringCoverage * 0.08, 0, 1);
  const edgeSafe = sparseSafe * (1 - edgeWeight * 0.16) + 0.5 * edgeWeight * 0.16;

  // Compress extreme tails only when the local field itself is noisy. This
  // preserves real broad gradients while preventing exaggerated thickness.
  const centred = edgeSafe - 0.5;
  const tailCompression = 0.82 + (1 - robustNoise) * 0.12;
  const compressed = centred >= 0
    ? 0.5 + centred * tailCompression
    : 0.5 + centred * (tailCompression - 0.04);

  return clamp(compressed, 0, 1);
}

function buildAdaptiveDepthGrid(
  depth: Float32Array | null,
  raster: Raster,
  mask: boolean[][]
): Float32Array | null {
  if (!depth || !raster.width || !raster.height) return null;
  const grid = new Float32Array(raster.width * raster.height);
  grid.fill(Number.NaN);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (!mask[y]?.[x]) continue;
      grid[y * raster.width + x] = computeAdaptiveDepthSample(depth, raster, mask, x, y);
    }
  }
  return grid;
}

function adaptiveDepthAt(
  depth: Float32Array | null,
  raster: Raster,
  mask: boolean[][],
  x: number,
  y: number,
  category: ImageVoxelOptions["aiCategory"],
  grid: Float32Array | null = null
): number {
  const base = depthAt(depth, raster, x, y);
  if (!depth || !raster.width || !raster.height) return base;
  const cx = clamp(Math.round(x), 0, raster.width - 1);
  const cy = clamp(Math.round(y), 0, raster.height - 1);
  const cached = grid?.[cy * raster.width + cx];
  if (cached !== undefined && Number.isFinite(cached)) return cached;
  void category;
  return computeAdaptiveDepthSample(depth, raster, mask, cx, cy);
}

async function finalizeLocalAi(
  result: ImageImport,
  volumeSize: number,
  mask: boolean[][],
  aiCategory?: ImageVoxelOptions["aiCategory"],
  hasSide = false
): Promise<ImageImport> {
  try {
    const [{ recognizeFromMask }, { finishVoxels, evenPack }, { lintVoxels }, { aiCategoryProfile }] =
      await Promise.all([
        import("@/lib/ai/recognize"),
        import("@/lib/ai/finish"),
        import("@/lib/ai/lint"),
        import("@/lib/ai/aiCategories")
      ]);
    const guess = recognizeFromMask(mask);
    const resolvedCategory = aiCategory ?? guess.category;
    const profile = resolvedCategory ? aiCategoryProfile(resolvedCategory) : null;
    const adaptive = resolvedCategory
      ? adaptiveAssetProfile({
          category: resolvedCategory,
          features: guess.features,
          evidence: guess.evidence,
          width: mask[0]?.length ?? 0,
          height: mask.length,
          volumeSize,
          mode: "model",
          hasSide,
          hasDepth: true
        })
      : null;
    const thinFeatures = Boolean(
      adaptive?.thinFeatures ||
      profile?.thinFeatures ||
      guess.features.thin ||
      guess.kind === "sword" ||
      guess.kind === "axe"
    );
    let voxels = result.voxels;
    voxels = lintVoxels(voxels, { thinFeatures });
    const beforeFinish = voxels;
    const finished = finishVoxels(beforeFinish, volumeSize, guess.kind !== "tile", {
      thinFeatures,
      shell: adaptive?.shell ?? resolvedCategory === "swords"
    });
    // Non-destructive finishing: if the finishing pass unexpectedly removes
    // a large fraction of a non-sword asset, keep the linted geometry and only
    // apply the established packing step. Sword shell behaviour is preserved.
    const finishKeepRatio = resolvedCategory === "swords" ? 0 : 0.62;
    voxels =
      finishKeepRatio > 0 &&
      finished.length < Math.max(8, Math.floor(beforeFinish.length * finishKeepRatio))
        ? evenPack(beforeFinish, volumeSize)
        : finished;
    const shape =
      resolvedCategory === "swords"
        ? "sword"
        : resolvedCategory === "guns" || resolvedCategory === "rifles"
          ? "prop"
          : guess.kind;
    return {
      ...result,
      voxels,
      count: voxels.length,
      shape,
      category: resolvedCategory
    };
  } catch {
    return result;
  }
}


function applyCategoryProfile(normalized: NormalizedImageVoxelOptions) {
  const category = normalized.aiCategory;
  if (!category) {
    applyOutputLock(normalized);
    return;
  }
  const style = styleFromCategory(category);
  const profile = profileById(style);
  if (!normalized.output) {
    normalized.heightMax = aiCategoryHeightMax(category, normalized.volumeSize);
    normalized.useDepthThickness = profile.useDepthHint && category !== "swords";
    if (profile.symmetrize && normalized.mode === "model") {
      normalized.symmetrize = true;
    }
  } else if (normalized.output === "25d") {
    normalized.useDepthThickness = profile.useDepthHint && category !== "swords";
  }
  applyOutputLock(normalized);
}

async function resolveCategoryAndDepth(
  raster: Raster,
  mask: boolean[][],
  normalized: NormalizedImageVoxelOptions,
  depthMap: Float32Array | null,
  useLocalAi: boolean,
  hasSide = false
): Promise<{
  category: NormalizedImageVoxelOptions["aiCategory"];
  depthMap: Float32Array | null;
  raster: Raster;
  adaptiveProfile: AdaptiveAssetProfile | null;
  extraDiag?: LocalAiResult["diagnostics"];
}> {
  let adaptiveProfile: AdaptiveAssetProfile | null = null;
  let category = normalized.aiCategory;
  try {
    const { recognizeFromMask, resolveRecognizedCategory } = await import("@/lib/ai/recognize");
    const guess = recognizeFromMask(mask);
    category = resolveRecognizedCategory(guess, normalized.aiCategory).category;
    adaptiveProfile = adaptiveAssetProfile({
      category,
      features: guess.features,
      evidence: guess.evidence,
      width: mask[0]?.length ?? 0,
      height: mask.length,
      volumeSize: normalized.volumeSize,
      mode: normalized.mode,
      hasSide,
      hasDepth: Boolean(depthMap)
    });
  } catch {
    category = normalized.aiCategory ?? "objects";
  }
  normalized.aiCategory = category;
  applyCategoryProfile(normalized);
  if (adaptiveProfile && !normalized.output) {
    normalized.heightMax = adaptiveHeightMax(
      normalized.heightMax,
      normalized.volumeSize,
      adaptiveProfile
    );
    normalized.useDepthThickness = adaptiveProfile.useDepthHint;
    normalized.adaptiveBudgetScale = adaptiveProfile.budgetScale;
  }
  if (category === "swords" || normalized.output === "2d") depthMap = null;
  const want =
    useLocalAi &&
    normalized.output !== "2d" &&
    category !== "swords" &&
    (aiCategoryWantsDepth(category, normalized.mode) || normalized.useDepthThickness === true);
  if (!want) return { category, depthMap: null, raster, adaptiveProfile };
  if (depthMap) return { category, depthMap, raster, adaptiveProfile };
  const again = await applyLocalAiRaster(raster, { depth: true, category });
  return {
    category,
    depthMap: again.depth,
    raster: again.raster,
    adaptiveProfile,
    extraDiag: again.diagnostics
  };
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
    maxVoxelsExplicit: options.maxVoxels !== undefined,
    symmetrize: options.symmetrize ?? false,
    aiCategory: options.aiCategory,
    output: options.output,
    outline: options.outline
  };
  applyOutputLock(normalized);

  let raster = await loadImage(file);
  let depthMap: Float32Array | null = null;
  let aiDiag: LocalAiResult["diagnostics"];
  if (useLocalAi) {
    const ai = await applyLocalAiRaster(raster, {
      depth: false,
      category: normalized.aiCategory
    });
    raster = ai.raster;
    depthMap = ai.depth;
    aiDiag = ai.diagnostics;
  }
  let mask = buildMask(raster, normalized.mode);
  if (normalized.mode === "model" || useLocalAi) {
    mask = cleanModelMask(mask, raster, normalized.aiCategory);
  }
  const resolved = await resolveCategoryAndDepth(raster, mask, normalized, depthMap, useLocalAi);
  raster = resolved.raster;
  depthMap = resolved.depthMap;
  normalized.aiCategory = resolved.category;
  if (resolved.extraDiag) aiDiag = resolved.extraDiag;
  if (normalized.mode === "model" || useLocalAi) {
    mask = cleanModelMask(buildMask(raster, normalized.mode), raster, normalized.aiCategory);
  }
  const bounds = findBounds(mask);
  if (!bounds) throw new Error("No visible subject found");

  const palette = createPalette(
    [raster],
    [mask],
    normalized.mode === "model" ? 64 : 48
  );
  const paletteValues = paletteRgb(palette);

  const withStatus = async (result: ImageImport) => {
    const finished = useLocalAi
      ? await finalizeLocalAi(result, normalized.volumeSize, mask, normalized.aiCategory, false)
      : result;
    return { ...finished, aiStatus: formatAiStatus(aiDiag) };
  };

  // Single-view MODEL: keep MODEL volumetric while using the existing solid
  // reconstruction as a conservative FRONT-only depth estimate.
  if (normalized.mode === "model") {
    const result = buildSingleViewModel(
      raster,
      mask,
      bounds,
      normalized,
      paletteValues,
      palette,
      depthMap
    );
    return withStatus(result);
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
  return withStatus(result);
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
    maxVoxelsExplicit: options.maxVoxels !== undefined,
    symmetrize: options.symmetrize ?? false,
    aiCategory: options.aiCategory,
    output: options.output,
    outline: options.outline
  };
  applyOutputLock(normalized);

  const useLocalAi = options.useLocalAi ?? true;
  const files = [views.front, views.side].filter(Boolean) as File[];
  let rasters = await Promise.all(files.map((file) => loadImage(file)));
  let frontDepth: Float32Array | null = null;
  let aiDiag: LocalAiResult["diagnostics"];
  if (useLocalAi) {
    const enhanced: LocalAiResult[] = [];
    // Two ONNX segmentation passes in parallel can briefly duplicate model
    // tensors and canvas buffers on low-core browsers. Keep FRONT first and
    // process SIDE afterwards to cap peak memory without changing either view.
    for (const raster of rasters) {
      enhanced.push(
        await applyLocalAiRaster(raster, {
          depth: false,
          category: normalized.aiCategory
        })
      );
    }
    rasters = enhanced.map((e) => e.raster);
    frontDepth = enhanced[0]?.depth ?? null;
    aiDiag = enhanced[0]?.diagnostics;
  }
  let masks = rasters.map((raster) => {
    const mask = buildMask(raster, normalized.mode);
    return normalized.mode === "model"
      ? cleanModelMask(mask, raster, normalized.aiCategory)
      : mask;
  });
  if (useLocalAi && rasters[0] && masks[0]) {
    const resolved = await resolveCategoryAndDepth(
      rasters[0],
      masks[0],
      normalized,
      frontDepth,
      useLocalAi,
      Boolean(views.side)
    );
    rasters[0] = resolved.raster;
    frontDepth = resolved.depthMap;
    normalized.aiCategory = resolved.category;
    if (resolved.adaptiveProfile && !normalized.output) {
      normalized.heightMax = adaptiveHeightMax(
        normalized.heightMax,
        normalized.volumeSize,
        resolved.adaptiveProfile
      );
      normalized.useDepthThickness = resolved.adaptiveProfile.useDepthHint;
    }
    if (resolved.extraDiag) aiDiag = resolved.extraDiag;
    masks[0] = cleanModelMask(
      buildMask(rasters[0], normalized.mode),
      rasters[0],
      normalized.aiCategory
    );
  }
  applyCategoryProfile(normalized);
  normalized.useDepthThickness = Boolean(frontDepth) && normalized.useDepthThickness === true;

  const palette = createPalette(
    rasters,
    masks,
    normalized.mode === "model" ? 64 : 48,
    rasters.length > 1 ? [1.45, 0.85] : undefined
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
      normalized.maxVoxelsExplicit ? normalized.maxVoxels : undefined,
      "model",
      {
        width: frontBounds.width,
        height: frontBounds.height,
        depth: sideBounds?.width ?? Math.max(1, normalized.heightMax),
        projectedFill: maskFillRatio(frontMask, frontBounds),
        category: normalized.aiCategory,
        profileScale: normalized.adaptiveBudgetScale
      }
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
      // FRONT-only MODEL: keep the MODEL contract but reconstruct a volumetric
      // asset from the segmented FRONT, category profile and local depth hint.
      // FRONT + SIDE continues through the existing true visual-hull path.
      const singleView = buildNonModel(
        frontRaster,
        frontMask,
        frontBounds,
        undefined,
        null,
        { ...normalized, mode: "solid" },
        paletteValues,
        palette,
        frontDepth
      );
      const finished = useLocalAi
        ? await finalizeLocalAi(singleView, normalized.volumeSize, frontMask, normalized.aiCategory, false)
        : singleView;
      return {
        ...finished,
        aiStatus: formatAiStatus(aiDiag, dimensions)
      };
    }

    // Metrics + Y-align + optional depth clamp flag (ambiguous SIDE only).
    let sideYOffset = 0;
    try {
      const { computeHullMetrics } = await import("@/lib/ai/importMetrics");
      const { bestSideYShiftBins, sideYOffsetFromShift } = await import("@/lib/ai/viewAlign");
      const metrics = computeHullMetrics(frontBounds, sideBounds);
      normalized.sideAmbiguous = metrics.sideAmbiguous;
      const align = bestSideYShiftBins(frontMask, frontBounds, sideMask, sideBounds);
      const initialYOffset = sideYOffsetFromShift(align.shiftBins);
      sideYOffset = refineSideYOffset(
        frontMask,
        frontBounds,
        sideMask,
        sideBounds,
        initialYOffset
      );
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
    const finished = useLocalAi
      ? await finalizeLocalAi(hull, normalized.volumeSize, frontMask, normalized.aiCategory, true)
      : hull;
    return {
      ...finished,
      aiStatus: formatAiStatus(aiDiag, dimensions)
    };
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
  const finished = useLocalAi
    ? await finalizeLocalAi(flat, normalized.volumeSize, frontMask, normalized.aiCategory, Boolean(views.side))
    : flat;
  return { ...finished, aiStatus: formatAiStatus(aiDiag) };
}
