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
  back?: File;
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

const MAX_RASTER_EDGE = 320;
const MIN_ALPHA = 20;

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

  return {
    r,
    g,
    b,
    a,
    visible: a >= MIN_ALPHA
  };
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

  const tolerance = mode === "flat" ? 24 : 34;

  return dist < tolerance && Math.abs(l - bgL) < 26 && saturation < 245;
}

function buildMask(
  raster: Raster,
  mode: ImageMode
): boolean[][] {
  const bg = looksLikeBackground(raster);
  const mask = Array.from({ length: raster.height }, () =>
    Array<boolean>(raster.width).fill(false)
  );

  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = sampleAt(raster, x, y);
      mask[y][x] = !backgroundLike(s, bg, mode);
    }
  }

  // Remove only tiny border noise. Do not aggressively delete islands:
  // small details are important for character/weapon silhouettes.
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (!mask[y][x]) continue;

      let neighbours = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (!ox && !oy) continue;
          const yy = y + oy;
          const xx = x + ox;
          if (
            yy >= 0 &&
            yy < raster.height &&
            xx >= 0 &&
            xx < raster.width &&
            mask[yy][xx]
          ) {
            neighbours += 1;
          }
        }
      }

      if (neighbours === 0) mask[y][x] = false;
    }
  }

  return mask;
}

function findBounds(mask: boolean[][]) {
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

function normalizedX(
  x: number,
  bounds: { minX: number; width: number }
) {
  if (bounds.width <= 1) return 0.5;
  return clamp((x - bounds.minX) / (bounds.width - 1), 0, 1);
}

function sideDepthAtX(
  mask: boolean[][],
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  nx: number,
  yRatio: number
) {
  const x = Math.round(
    bounds.minX + nx * (bounds.maxX - bounds.minX)
  );

  const y = Math.round(
    bounds.minY + yRatio * (bounds.maxY - bounds.minY)
  );

  const radius = Math.max(
    1,
    Math.round((bounds.maxX - bounds.minX + 1) * 0.012)
  );

  for (let dx = -radius; dx <= radius; dx += 1) {
    const xx = x + dx;
    if (xx < 0 || xx >= mask[0].length) continue;
    if (mask[y]?.[xx]) return true;
  }

  return false;
}

function columnThickness(
  sideMask: boolean[][],
  sideBounds: ContentBoundsLike,
  nx: number,
  yRatio: number
) {
  if (!sideBounds) return 0.28;

  const x = Math.round(
    sideBounds.minX + nx * (sideBounds.maxX - sideBounds.minX)
  );

  const centerY = Math.round(
    sideBounds.minY + yRatio * (sideBounds.maxY - sideBounds.minY)
  );

  const scan = Math.max(
    1,
    sideBounds.maxY - sideBounds.minY + 1
  );

  let lo = centerY;
  let hi = centerY;

  while (lo > sideBounds.minY && sideMask[lo - 1]?.[x]) lo -= 1;
  while (hi < sideBounds.maxY && sideMask[hi + 1]?.[x]) hi += 1;

  return clamp(
    (hi - lo + 1) / scan,
    0.04,
    1
  );
}

type ContentBoundsLike = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function dominantPalette(
  samples: { r: number; g: number; b: number; weight: number }[],
  size: number
): string[] {
  if (!samples.length) return DEFAULT_PALETTE.slice(0, size);

  const sorted = samples
    .slice()
    .sort((a, b) => b.weight - a.weight);

  const chosen: [number, number, number][] = [];

  for (const item of sorted) {
    const rgb: [number, number, number] = [item.r, item.g, item.b];

    if (
      chosen.every(
        (c) => rgbDistance(rgb, c) > 900
      )
    ) {
      chosen.push(rgb);
    }

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

      if (chosen.every((c) => rgbDistance(rgb, c) > 400)) {
        chosen.push(rgb);
      }
    }
  }

  return chosen.map(([r, g, b]) => hexOf(r, g, b));
}

function createPalette(
  rasters: Raster[],
  masks: boolean[][][],
  size = 48
) {
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

        if (existing) {
          existing.weight += 1;
        } else {
          buckets.set(key, {
            r,
            g,
            b,
            weight: 1
          });
        }
      }
    }
  }

  return dominantPalette(
    [...buckets.values()],
    size
  );
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

function resizeMask(
  mask: boolean[][],
  targetWidth: number,
  targetHeight: number
) {
  if (!mask.length || !mask[0]?.length) {
    return Array.from(
      { length: targetHeight },
      () => Array<boolean>(targetWidth).fill(false)
    );
  }

  const sourceHeight = mask.length;
  const sourceWidth = mask[0].length;

  return Array.from({ length: targetHeight }, (_, y) => {
    const sy = (y / Math.max(1, targetHeight - 1)) * (sourceHeight - 1);

    return Array.from({ length: targetWidth }, (_, x) => {
      const sx = (x / Math.max(1, targetWidth - 1)) * (sourceWidth - 1);
      const ix = Math.round(sx);
      const iy = Math.round(sy);

      if (mask[iy]?.[ix]) return true;

      // 4-neighbour dilation at resampling boundaries preserves thin parts.
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        if (mask[iy + oy]?.[ix + ox]) return true;
      }

      return false;
    });
  });
}

function buildSingleView(
  raster: Raster,
  options: Required<ImageVoxelOptions>,
  palette: string[]
): ImageImport {
  const mode = options.mode;
  const mask = buildMask(raster, mode);
  const bounds = findBounds(mask);

  if (!bounds) {
    throw new Error("No visible subject found");
  }

  const longest = Math.max(bounds.width, bounds.height);
  const target = Math.max(
    4,
    Math.min(
      Math.max(4, options.heightMax * 4),
      Math.max(4, options.volumeSize - 4),
      longest
    )
  );

  const scale = Math.min(
    1,
    (options.volumeSize - 4) / Math.max(1, longest)
  );

  const sx = Math.max(1, Math.round(bounds.width * scale));
  const sy = Math.max(1, Math.round(bounds.height * scale));

  const resized = resizeMask(mask, sx, sy);
  const paletteValues = paletteRgb(palette);
  const voxels: ImageVoxel[] = [];

  const centerX = (sx - 1) / 2;
  const yStep = sy > 1 ? options.heightMax / (sy - 1) : options.heightMax;

  const depthLayers = (() => {
    switch (mode) {
      case "flat":
        return 1;
      case "relief":
        return Math.max(2, Math.round(options.heightMax * 0.35));
      case "model":
        return Math.max(2, Math.round(options.heightMax * 0.85));
      case "solid":
      default:
        return Math.max(2, Math.round(options.heightMax * 0.65));
    }
  })();

  for (let y = 0; y < sy; y += 1) {
    for (let x = 0; x < sx; x += 1) {
      if (!resized[y]?.[x]) continue;

      const sourceX = bounds.minX + (x / Math.max(1, sx - 1)) * (bounds.width - 1);
      const sourceY = bounds.minY + (y / Math.max(1, sy - 1)) * (bounds.height - 1);
      const sample = sampleAt(raster, sourceX, sourceY);

      const luma = (0.2126 * sample.r + 0.7152 * sample.g + 0.0722 * sample.b) / 255;
      const edgeLift = mode === "model" ? 1 + (1 - luma) * 0.25 : 1;
      const localDepth = Math.max(
        1,
        Math.round(depthLayers * edgeLift)
      );

      for (let z = 0; z < localDepth; z += 1) {
        const c = nearestColor(
          [sample.r, sample.g, sample.b],
          paletteValues
        );

        voxels.push({
          x,
          y: Math.max(0, Math.min(options.volumeSize - 1, Math.round(y * yStep))),
          z,
          c
        });
      }
    }
  }

  if (options.symmetrize && mode === "model") {
    symmetrizeVoxels(voxels, options.volumeSize, paletteValues.length);
  }

  const limited = enforceVoxelBudget(
    voxels,
    options.maxVoxels,
    "model"
  );

  return {
    width: raster.width,
    height: raster.height,
    voxels: normalizeToVolume(
      limited,
      options.volumeSize,
      sy,
      depthLayers
    ),
    palette,
    count: limited.length
  };
}

function normalizeToVolume(
  voxels: ImageVoxel[],
  volumeSize: number,
  sx: number,
  sz: number
) {
  if (!voxels.length) return voxels;

  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const v of voxels) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    maxZ = Math.max(maxZ, v.z);
  }

  const width = Math.max(1, maxX - minX + 1);
  const centerOffset = Math.floor((volumeSize - width) / 2) - minX;
  const yOffset = Math.max(0, Math.floor((volumeSize - maxY - 1) * 0.14));
  const zOffset = Math.floor((volumeSize - Math.min(maxZ + 1, volumeSize)) / 2);

  return voxels.map((v) => ({
    x: clamp(v.x + centerOffset, 0, volumeSize - 1),
    y: clamp(v.y + yOffset, 0, volumeSize - 1),
    z: clamp(v.z + zOffset, 0, volumeSize - 1),
    c: v.c
  }));
}

function symmetrizeVoxels(
  voxels: ImageVoxel[],
  volumeSize: number,
  paletteSize: number
) {
  const existing = new Set(
    voxels.map((v) => `${v.x}:${v.y}:${v.z}`)
  );

  const center = (volumeSize - 1) / 2;
  const additions: ImageVoxel[] = [];

  for (const voxel of voxels) {
    const mirroredX = Math.round(center * 2 - voxel.x);
    if (
      mirroredX < 0 ||
      mirroredX >= volumeSize
    ) {
      continue;
    }

    const key = `${mirroredX}:${voxel.y}:${voxel.z}`;
    if (!existing.has(key)) {
      additions.push({
        x: mirroredX,
        y: voxel.y,
        z: voxel.z,
        c: Math.max(0, Math.min(paletteSize - 1, voxel.c))
      });
      existing.add(key);
    }
  }

  voxels.push(...additions);
}

function enforceVoxelBudget(
  voxels: ImageVoxel[],
  maxVoxels: number,
  mode: ImageMode
) {
  const limit = Math.max(1024, Math.floor(maxVoxels));

  if (voxels.length <= limit) return voxels;

  // Keep every voxel around silhouette-sensitive regions and thin out
  // repeated interior samples. The output always respects the budget.
  const stride = Math.max(
    2,
    Math.ceil(Math.sqrt(voxels.length / limit))
  );

  const kept: ImageVoxel[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < voxels.length; i += 1) {
    const voxel = voxels[i];

    const keep =
      mode === "model"
        ? i % Math.max(2, stride - 1) === 0
        : i % stride === 0;

    if (!keep) continue;

    const key = `${voxel.x}:${voxel.y}:${voxel.z}`;
    if (seen.has(key)) continue;

    seen.add(key);
    kept.push(voxel);

    if (kept.length >= limit) break;
  }

  // Deterministic fallback: fill remaining budget from skipped voxels.
  if (kept.length < limit) {
    for (const voxel of voxels) {
      if (kept.length >= limit) break;

      const key = `${voxel.x}:${voxel.y}:${voxel.z}`;
      if (seen.has(key)) continue;

      seen.add(key);
      kept.push(voxel);
    }
  }

  return kept;
}

function effectiveBudget(
  volumeSize: number,
  requested: number | undefined,
  mode: ImageMode,
  viewCount: number
) {
  const physical = volumeSize * volumeSize * volumeSize;

  const safety =
    mode === "model"
      ? 0.24
      : mode === "relief"
        ? 0.12
        : mode === "flat"
          ? 0.06
          : 0.16;

  const derived = Math.floor(physical * safety);
  const requestedBudget = requested ?? derived;

  // Three views need enough room for meaningful depth; never let a very low
  // caller budget destroy the reconstruction completely.
  const minimumForViews =
    viewCount >= 3
      ? Math.floor(volumeSize * volumeSize * 2.5)
      : Math.floor(volumeSize * volumeSize * 1.5);

  return Math.max(
    4096,
    Math.min(
      Math.max(requestedBudget, minimumForViews),
      Math.floor(physical * 0.38)
    )
  );
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
  const palette = createPalette(
    [raster],
    [mask],
    normalized.mode === "model" ? 64 : 48
  );

  return buildSingleView(
    raster,
    normalized,
    palette
  );
}

export async function imagesToVoxels(
  views: ImageViews,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  if (!views.front) {
    throw new Error("FRONT IMAGE REQUIRED");
  }

  const normalized: Required<ImageVoxelOptions> = {
    volumeSize: options.volumeSize ?? 128,
    mode: options.mode ?? "solid",
    heightMax: options.heightMax ?? 16,
    maxVoxels: options.maxVoxels ?? 100000,
    symmetrize: options.symmetrize ?? false
  };

  const files = [
    views.front,
    views.side,
    views.back
  ].filter(Boolean) as File[];

  const rasters = await Promise.all(
    files.map((file) => loadImage(file))
  );

  const masks = rasters.map((raster) =>
    buildMask(raster, normalized.mode)
  );

  const palette = createPalette(
    rasters,
    masks,
    normalized.mode === "model" ? 64 : 48
  );

  const frontRaster = rasters[0];
  const frontMask = masks[0];
  const frontBounds = findBounds(frontMask);

  if (!frontBounds) {
    throw new Error("No visible subject found in FRONT");
  }

  const sideRaster = views.side ? rasters[1] : undefined;
  const sideMask = views.side ? masks[1] : undefined;
  const sideBounds = sideMask ? findBounds(sideMask) : null;

  const backRaster = views.back
    ? rasters[views.side ? 2 : 1]
    : undefined;
  const backMask = views.back
    ? masks[views.side ? 2 : 1]
    : undefined;
  const backBounds = backMask ? findBounds(backMask) : null;

  const viewCount = 1 + Number(Boolean(sideMask)) + Number(Boolean(backMask));
  const budget = effectiveBudget(
    normalized.volumeSize,
    normalized.maxVoxels,
    normalized.mode,
    viewCount
  );

  const widthScale = Math.min(
    1,
    (normalized.volumeSize - 6) /
      Math.max(1, frontBounds.width)
  );

  const targetWidth = Math.max(
    4,
    Math.min(
      frontBounds.width,
      Math.round(frontBounds.width * widthScale)
    )
  );

  const targetHeight = Math.max(
    4,
    Math.min(
      normalized.volumeSize - 4,
      Math.round(frontBounds.height * widthScale)
    )
  );

  const sourceMask = resizeMask(
    frontMask,
    targetWidth,
    targetHeight
  );

  const paletteRgbValues = paletteRgb(palette);
  const voxels: ImageVoxel[] = [];

  const depthBase =
    normalized.mode === "flat"
      ? 1
      : normalized.mode === "relief"
        ? Math.max(2, Math.round(normalized.heightMax * 0.3))
        : normalized.mode === "model"
          ? Math.max(3, Math.round(normalized.heightMax * 0.9))
          : Math.max(2, Math.round(normalized.heightMax * 0.62));

  const hasDepthView = Boolean(sideMask);
  const hasBackView = Boolean(backMask);

  for (let y = 0; y < targetHeight; y += 1) {
    const yRatio =
      y / Math.max(1, targetHeight - 1);

    for (let x = 0; x < targetWidth; x += 1) {
      if (!sourceMask[y]?.[x]) continue;

      const nx =
        x / Math.max(1, targetWidth - 1);

      const sourceX =
        frontBounds.minX +
        nx * (frontBounds.width - 1);

      const sourceY =
        frontBounds.minY +
        yRatio * (frontBounds.height - 1);

      const frontColor = sampleAt(
        frontRaster,
        sourceX,
        sourceY
      );

      let thicknessRatio =
        hasDepthView && sideMask && sideBounds
          ? columnThickness(
              sideMask,
              sideBounds,
              nx,
              yRatio
            )
          : normalized.mode === "flat"
            ? 0.04
            : normalized.mode === "relief"
              ? 0.34
              : normalized.mode === "model"
                ? 0.72
                : 0.52;

      if (hasBackView) {
        thicknessRatio = Math.min(
          1,
          thicknessRatio * 1.08
        );
      }

      const depth = Math.max(
        1,
        Math.min(
          normalized.volumeSize - 4,
          Math.round(
            depthBase *
              (0.55 + thicknessRatio * 0.85)
          )
        )
      );

      const edgeDistance = Math.min(
        x,
        y,
        targetWidth - 1 - x,
        targetHeight - 1 - y
      );

      const edgeBoost =
        edgeDistance <= 2 ? 1.12 : 1;

      const finalDepth = Math.max(
        1,
        Math.min(
          normalized.volumeSize - 4,
          Math.round(depth * edgeBoost)
        )
      );

      for (let z = 0; z < finalDepth; z += 1) {
        const zRatio =
          finalDepth <= 1
            ? 0
            : z / (finalDepth - 1);

        let colorSample = frontColor;

        if (backRaster && backBounds) {
          const backX =
            backBounds.minX +
            nx * (backBounds.width - 1);

          const backY =
            backBounds.minY +
            yRatio * (backBounds.height - 1);

          const backColor = sampleAt(
            backRaster,
            backX,
            backY
          );

          colorSample = {
            r:
              frontColor.r * (1 - zRatio) +
              backColor.r * zRatio,
            g:
              frontColor.g * (1 - zRatio) +
              backColor.g * zRatio,
            b:
              frontColor.b * (1 - zRatio) +
              backColor.b * zRatio,
            a: 255,
            visible: true
          };
        }

        if (
          sideMask &&
          sideBounds &&
          hasDepthView &&
          normalized.mode !== "flat"
        ) {
          const sideVisible = sideDepthAtX(
            sideMask,
            sideBounds,
            nx,
            yRatio
          );

          if (!sideVisible && z > Math.max(0, finalDepth * 0.82)) {
            continue;
          }
        }

        voxels.push({
          x,
          y: Math.round(
            yRatio * (normalized.volumeSize - 1)
          ),
          z,
          c: nearestColor(
            [
              colorSample.r,
              colorSample.g,
              colorSample.b
            ],
            paletteRgbValues
          )
        });
      }
    }
  }

  if (!voxels.length) {
    throw new Error("No voxels reconstructed");
  }

  if (
    normalized.symmetrize &&
    normalized.mode === "model"
  ) {
    symmetrizeVoxels(
      voxels,
      normalized.volumeSize,
      palette.length
    );
  }

  const limited = enforceVoxelBudget(
    voxels,
    budget,
    normalized.mode
  );

  const normalizedVoxels = normalizeToVolume(
    limited,
    normalized.volumeSize,
    targetWidth,
    finalDepthFromVoxels(limited)
  );

  return {
    width: frontRaster.width,
    height: frontRaster.height,
    voxels: normalizedVoxels,
    palette,
    count: normalizedVoxels.length
  };
}

function finalDepthFromVoxels(voxels: ImageVoxel[]) {
  let maxZ = 0;
  for (const voxel of voxels) {
    maxZ = Math.max(maxZ, voxel.z);
  }
  return maxZ + 1;
}
