import type { Cell } from "@/lib/voxelEngine";

export type ImageMode = "solid" | "flat" | "relief" | "model";

export type ImageVoxel = Cell & { c: number };

export type ImageImport = {
  voxels: ImageVoxel[];
  palette: string[];
  width: number;
  height: number;
  count: number;
};

type RGB = [number, number, number];
type Lab = [number, number, number];

type ColorEntry = {
  rgb: RGB;
  lab: Lab;
};

function clamp(value: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function hexOf(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((n) => clamp(Math.round(n)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function pack(r: number, g: number, b: number) {
  return (r << 16) | (g << 8) | b;
}

function unpack(n: number): RGB {
  return [
    (n >> 16) & 255,
    (n >> 8) & 255,
    n & 255
  ];
}

function srgbToLinear(value: number) {
  const v = value / 255;
  return v <= 0.04045
    ? v / 12.92
    : Math.pow((v + 0.055) / 1.055, 2.4);
}

function rgbToOklab(rgb: RGB): Lab {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);

  const l =
    0.4122214708 * r +
    0.5363325363 * g +
    0.0514459929 * b;

  const m =
    0.2119034982 * r +
    0.6806995456 * g +
    0.1073969566 * b;

  const s =
    0.0883024619 * r +
    0.2817188376 * g +
    0.6299787005 * b;

  const l3 = Math.cbrt(Math.max(0, l));
  const m3 = Math.cbrt(Math.max(0, m));
  const s3 = Math.cbrt(Math.max(0, s));

  return [
    0.2104542553 * l3 +
      0.7936177850 * m3 -
      0.0040720468 * s3,

    1.9779984951 * l3 -
      2.4285922050 * m3 +
      0.4505937099 * s3,

    0.0259040371 * l3 +
      0.7827717662 * m3 -
      0.8086757660 * s3
  ];
}

function oklabDistanceSquared(a: Lab, b: Lab) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];

  return dl * dl + da * da + db * db;
}

function shade(rgb: RGB, t: number): RGB {
  return [
    clamp(Math.round(rgb[0] * t)),
    clamp(Math.round(rgb[1] * t)),
    clamp(Math.round(rgb[2] * t))
  ];
}

function blendRgb(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));

  return [
    clamp(Math.round(a[0] + (b[0] - a[0]) * k)),
    clamp(Math.round(a[1] + (b[1] - a[1]) * k)),
    clamp(Math.round(a[2] + (b[2] - a[2]) * k))
  ];
}

function smoothStep(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function quantize(
  histogram: Map<number, number>,
  maxColors: number
): RGB[] {
  const entries = [...histogram.entries()].map(
    ([packed, count]) => {
      const rgb = unpack(packed);

      return {
        rgb,
        count,
        lab: rgbToOklab(rgb)
      };
    }
  );

  if (entries.length <= maxColors) {
    return entries
      .sort((a, b) => b.count - a.count)
      .map((entry) => entry.rgb);
  }

  const shift =
    entries.length > 12000
      ? 4
      : entries.length > 4000
        ? 3
        : 2;

  const buckets = new Map<
    number,
    {
      count: number;
      r: number;
      g: number;
      b: number;
    }
  >();

  for (const entry of entries) {
    const [r, g, b] = entry.rgb;

    const key = pack(
      r >> shift,
      g >> shift,
      b >> shift
    );

    const bucket = buckets.get(key) ?? {
      count: 0,
      r: 0,
      g: 0,
      b: 0
    };

    bucket.count += entry.count;
    bucket.r += r * entry.count;
    bucket.g += g * entry.count;
    bucket.b += b * entry.count;

    buckets.set(key, bucket);
  }

  const candidates = [...buckets.values()]
    .map((bucket) => {
      const rgb: RGB = [
        Math.round(bucket.r / bucket.count),
        Math.round(bucket.g / bucket.count),
        Math.round(bucket.b / bucket.count)
      ];

      return {
        rgb,
        count: bucket.count,
        lab: rgbToOklab(rgb)
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(maxColors * 6, 192));

  if (candidates.length <= maxColors) {
    return candidates.map((entry) => entry.rgb);
  }

  const selected: typeof candidates = [];
  const used = new Uint8Array(candidates.length);
  const minDistance = new Float32Array(candidates.length);

  selected.push(candidates[0]);
  used[0] = 1;

  for (let i = 0; i < candidates.length; i++) {
    minDistance[i] = oklabDistanceSquared(
      candidates[i].lab,
      candidates[0].lab
    );
  }

  while (selected.length < maxColors) {
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      if (used[i]) continue;

      const frequencyWeight = Math.sqrt(
        candidates[i].count /
          Math.max(1, candidates[0].count)
      );

      const distanceWeight = Math.min(
        1,
        Math.sqrt(minDistance[i]) * 7
      );

      const score =
        distanceWeight *
        (0.72 + frequencyWeight * 0.28);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) break;

    used[bestIndex] = 1;
    selected.push(candidates[bestIndex]);

    const selectedLab = candidates[bestIndex].lab;

    for (let i = 0; i < candidates.length; i++) {
      if (used[i]) continue;

      const distance = oklabDistanceSquared(
        candidates[i].lab,
        selectedLab
      );

      if (distance < minDistance[i]) {
        minDistance[i] = distance;
      }
    }
  }

  return selected.map((entry) => entry.rgb);
}

function makePalette(
  histogram: Map<number, number>
) {
  const baseColors = quantize(histogram, 64);
  const colors: RGB[] = [];

  for (const rgb of baseColors.slice(0, 64)) {
    colors.push(rgb);
    colors.push(shade(rgb, 0.82));
    colors.push(shade(rgb, 0.62));
    colors.push(shade(rgb, 0.46));
  }

  const palette = Array.from(
    { length: 256 },
    (_, i) =>
      colors[i]
        ? hexOf(...colors[i])
        : "#000000"
  );

  return {
    colors,
    palette,
    entries: colors.map((rgb) => ({
      rgb,
      lab: rgbToOklab(rgb)
    }))
  };
}

function nearestIndex(
  r: number,
  g: number,
  b: number,
  colors: ColorEntry[],
  cache: Map<number, number>
) {
  const key = pack(r, g, b);
  const cached = cache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const target = rgbToOklab([r, g, b]);

  let best = 0;
  let bestDistance = Infinity;

  for (let i = 0; i < colors.length; i++) {
    const distance = oklabDistanceSquared(
      target,
      colors[i].lab
    );

    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }

  cache.set(key, best);
  return best;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Invalid image"));
    };

    img.src = url;
  });
}

function renderImage(
  img: HTMLImageElement,
  width: number,
  height: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  if (!ctx) {
    throw new Error("No 2d context");
  }

  const scale = Math.min(
    width / Math.max(img.width, 1),
    height / Math.max(img.height, 1)
  );

  const drawWidth = Math.max(
    1,
    Math.round(img.width * scale)
  );

  const drawHeight = Math.max(
    1,
    Math.round(img.height * scale)
  );

  const offsetX = Math.floor(
    (width - drawWidth) / 2
  );

  const offsetY = Math.floor(
    (height - drawHeight) / 2
  );

  ctx.clearRect(
    0,
    0,
    width,
    height
  );

  ctx.imageSmoothingEnabled = true;

  if ("imageSmoothingQuality" in ctx) {
    ctx.imageSmoothingQuality = "high";
  }

  ctx.drawImage(
    img,
    offsetX,
    offsetY,
    drawWidth,
    drawHeight
  );

  return {
    data: ctx.getImageData(
      0,
      0,
      width,
      height
    ).data
  };
}

function smoothAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number
) {
  const source = new Float32Array(
    width * height
  );

  for (let i = 0; i < source.length; i++) {
    source[i] = data[i * 4 + 3];
  }

  const output = new Float32Array(
    width * height
  );

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;

          if (
            nx < 0 ||
            ny < 0 ||
            nx >= width ||
            ny >= height
          ) {
            continue;
          }

          sum += source[
            ny * width + nx
          ];

          count++;
        }
      }

      output[
        y * width + x
      ] = sum / count;
    }
  }

  for (let i = 0; i < output.length; i++) {
    data[i * 4 + 3] = Math.round(
      output[i]
    );
  }
}

function floodBackdrop(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number
) {
  let opaque = 0;

  for (
    let i = 3;
    i < data.length;
    i += 4
  ) {
    if (data[i] > 8) {
      opaque++;
    }
  }

  if (
    opaque /
      Math.max(1, width * height) <
    0.965
  ) {
    return;
  }

  const corners = [
    0,
    width - 1,
    (height - 1) * width,
    width * height - 1
  ];

  const samples = corners.map((index) => [
    data[index * 4],
    data[index * 4 + 1],
    data[index * 4 + 2]
  ]);

  const [cr, cg, cb] = samples[0];

  const similar = samples.every(
    ([r, g, b]) =>
      (r - cr) ** 2 +
        (g - cg) ** 2 +
        (b - cb) ** 2 <
      1150
  );

  if (!similar) return;

  const seen = new Uint8Array(
    width * height
  );

  const queue = [...corners];

  for (const index of queue) {
    seen[index] = 1;
  }

  while (queue.length) {
    const index = queue.pop()!;
    const x = index % width;
    const y = Math.floor(index / width);

    const r = data[index * 4];
    const g = data[index * 4 + 1];
    const b = data[index * 4 + 2];

    const distance =
      (r - cr) ** 2 +
      (g - cg) ** 2 +
      (b - cb) ** 2;

    if (distance >= 1700) {
      continue;
    }

    mask[index] = 0;

    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ] as const;

    for (const [nx, ny] of neighbors) {
      if (
        nx < 0 ||
        ny < 0 ||
        nx >= width ||
        ny >= height
      ) {
        continue;
      }

      const next = ny * width + nx;

      if (seen[next]) continue;

      seen[next] = 1;
      queue.push(next);
    }
  }
}

function knockFringe(
  mask: Uint8Array,
  data: Uint8ClampedArray,
  width: number,
  height: number
) {
  const next = new Uint8Array(mask);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index =
        y * width + x;

      if (!mask[index]) continue;

      const alpha =
        data[index * 4 + 3];

      if (alpha >= 245) continue;

      let empty = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;

          const nx = x + dx;
          const ny = y + dy;

          if (
            nx < 0 ||
            ny < 0 ||
            nx >= width ||
            ny >= height ||
            !mask[ny * width + nx]
          ) {
            empty++;
          }
        }
      }

      if (
        alpha < 80 &&
        empty >= 3
      ) {
        next[index] = 0;
      }
    }
  }

  mask.set(next);
}

function dropIslands(
  mask: Uint8Array,
  width: number,
  height: number,
  minimumSize: number
) {
  if (minimumSize <= 1) return;

  const seen = new Uint8Array(
    width * height
  );

  const stack: number[] = [];

  for (
    let start = 0;
    start < mask.length;
    start++
  ) {
    if (
      !mask[start] ||
      seen[start]
    ) {
      continue;
    }

    stack.length = 0;
    stack.push(start);
    seen[start] = 1;

    const cells = [start];

    while (stack.length) {
      const index = stack.pop()!;

      const x =
        index % width;

      const y =
        Math.floor(
          index / width
        );

      for (const next of [
        index - 1,
        index + 1,
        index - width,
        index + width
      ]) {
        if (
          next < 0 ||
          next >= mask.length ||
          seen[next] ||
          !mask[next]
        ) {
          continue;
        }

        const nx =
          next % width;

        const ny =
          Math.floor(
            next / width
          );

        if (
          Math.abs(nx - x) +
            Math.abs(ny - y) !==
          1
        ) {
          continue;
        }

        seen[next] = 1;
        stack.push(next);
        cells.push(next);
      }
    }

    if (
      cells.length <
      minimumSize
    ) {
      for (const index of cells) {
        mask[index] = 0;
      }
    }
  }
}

function prepareMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mode: ImageMode
) {
  const mask =
    new Uint8Array(
      width * height
    );

  smoothAlpha(
    data,
    width,
    height
  );

  for (
    let i = 0;
    i < mask.length;
    i++
  ) {
    if (
      data[i * 4 + 3] >= 16
    ) {
      mask[i] = 1;
    }
  }

  floodBackdrop(
    data,
    mask,
    width,
    height
  );

  knockFringe(
    mask,
    data,
    width,
    height
  );

  dropIslands(
    mask,
    width,
    height,
    mode === "flat"
      ? 1
      : 2
  );

  return mask;
}

function distanceField(
  mask: Uint8Array,
  width: number,
  height: number
) {
  const infinity =
    width + height + 8;

  const field =
    new Float32Array(
      width * height
    );

  for (
    let i = 0;
    i < field.length;
    i++
  ) {
    field[i] =
      mask[i]
        ? infinity
        : 0;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index =
        y * width + x;

      if (!mask[index]) continue;

      let best =
        field[index];

      if (x > 0) {
        best = Math.min(
          best,
          field[index - 1] + 1
        );
      }

      if (y > 0) {
        best = Math.min(
          best,
          field[index - width] + 1
        );
      }

      if (
        x > 0 &&
        y > 0
      ) {
        best = Math.min(
          best,
          field[
            index -
              width -
              1
          ] + 1.414
        );
      }

      if (
        x + 1 < width &&
        y > 0
      ) {
        best = Math.min(
          best,
          field[
            index -
              width +
              1
          ] + 1.414
        );
      }

      field[index] = best;
    }
  }

  for (
    let y = height - 1;
    y >= 0;
    y--
  ) {
    for (
      let x = width - 1;
      x >= 0;
      x--
    ) {
      const index =
        y * width + x;

      if (!mask[index]) continue;

      let best =
        field[index];

      if (
        x + 1 < width
      ) {
        best = Math.min(
          best,
          field[index + 1] + 1
        );
      }

      if (
        y + 1 < height
      ) {
        best = Math.min(
          best,
          field[index + width] + 1
        );
      }

      if (
        x + 1 < width &&
        y + 1 < height
      ) {
        best = Math.min(
          best,
          field[
            index +
              width +
              1
          ] + 1.414
        );
      }

      if (
        x > 0 &&
        y + 1 < height
      ) {
        best = Math.min(
          best,
          field[
            index +
              width -
              1
          ] + 1.414
        );
      }

      field[index] = best;
    }
  }

  return field;
}

function blurField(
  source: Float32Array,
  width: number,
  height: number
) {
  const output =
    new Float32Array(
      source.length
    );

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;

          if (
            nx < 0 ||
            ny < 0 ||
            nx >= width ||
            ny >= height
          ) {
            continue;
          }

          sum += source[
            ny * width + nx
          ];

          count++;
        }
      }

      output[
        y * width + x
      ] = sum / count;
    }
  }

  return output;
}

function symmetrizeX(
  voxels: ImageVoxel[]
) {
  if (!voxels.length) {
    return voxels;
  }

  let minX = Infinity;
  let maxX = -Infinity;

  for (const voxel of voxels) {
    minX = Math.min(
      minX,
      voxel.x
    );

    maxX = Math.max(
      maxX,
      voxel.x
    );
  }

  const middle =
    minX +
    (maxX - minX) / 2;

  let left = 0;
  let right = 0;

  for (const voxel of voxels) {
    if (voxel.x < middle) {
      left++;
    } else if (
      voxel.x > middle
    ) {
      right++;
    }
  }

  const sourceIsLeft =
    left >= right;

  const map = new Map<
    string,
    ImageVoxel
  >();

  for (const voxel of voxels) {
    map.set(
      `${voxel.x},${voxel.y},${voxel.z}`,
      voxel
    );
  }

  for (const voxel of voxels) {
    const source =
      sourceIsLeft
        ? voxel.x <= middle
        : voxel.x >= middle;

    if (!source) continue;

    const mirroredX = Math.round(
      2 * middle - voxel.x
    );

    map.set(
      `${mirroredX},${voxel.y},${voxel.z}`,
      {
        x: mirroredX,
        y: voxel.y,
        z: voxel.z,
        c: voxel.c
      }
    );
  }

  return [...map.values()];
}

function shiftToCenter(
  voxels: ImageVoxel[],
  volumeSize: number
) {
  if (!voxels.length) {
    return voxels;
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;

  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const voxel of voxels) {
    minX = Math.min(
      minX,
      voxel.x
    );

    minY = Math.min(
      minY,
      voxel.y
    );

    minZ = Math.min(
      minZ,
      voxel.z
    );

    maxX = Math.max(
      maxX,
      voxel.x
    );

    maxY = Math.max(
      maxY,
      voxel.y
    );

    maxZ = Math.max(
      maxZ,
      voxel.z
    );
  }

  const sx =
    Math.floor(
      (
        volumeSize -
        (maxX - minX + 1)
      ) / 2
    ) -
    minX;

  const sy = -minY;

  const sz =
    Math.floor(
      (
        volumeSize -
        (maxZ - minZ + 1)
      ) / 2
    ) -
    minZ;

  return voxels
    .map((voxel) => ({
      x: voxel.x + sx,
      y: voxel.y + sy,
      z: voxel.z + sz,
      c: voxel.c
    }))
    .filter(
      (voxel) =>
        voxel.x >= 0 &&
        voxel.y >= 0 &&
        voxel.z >= 0 &&
        voxel.x < volumeSize &&
        voxel.y < volumeSize &&
        voxel.z < volumeSize
    );
}

function calculateWorkingSize(
  img: HTMLImageElement,
  mode: ImageMode,
  volumeSize: number,
  maxEdge?: number
) {
  const requested =
    maxEdge ??
    (
      mode === "model"
        ? 192
        : mode === "flat"
          ? 160
          : 176
    );

  const edge = Math.max(
    32,
    Math.min(
      requested,
      volumeSize
    )
  );

  const scale = Math.min(
    1,
    edge /
      Math.max(
        img.width,
        img.height,
        1
      )
  );

  return {
    width: Math.max(
      1,
      Math.round(
        img.width * scale
      )
    ),
    height: Math.max(
      1,
      Math.round(
        img.height * scale
      )
    )
  };
}

function buildDepthRadius(
  mode: ImageMode,
  depthMax: number,
  fieldT: number,
  luma: number
) {
  if (mode === "flat") {
    return 0;
  }

  const half = Math.max(
    1,
    depthMax / 2
  );

  if (mode === "solid") {
    return Math.max(
      1,
      Math.round(
        half *
          (0.58 + 0.42 * fieldT)
      )
    );
  }

  if (mode === "relief") {
    return Math.max(
      1,
      Math.round(
        half *
          (
            0.28 +
            luma * 0.52 +
            fieldT * 0.20
          )
      )
    );
  }

  const dome =
    Math.sqrt(
      Math.max(
        0.035,
        1 -
          Math.pow(
            1 - fieldT,
            1.65
          )
      )
    );

  return Math.max(
    1,
    Math.round(
      dome * depthMax
    )
  );
}

function getDepthMax(
  mode: ImageMode,
  volumeSize: number,
  heightMax: number,
  spanX: number
) {
  if (mode === "flat") {
    return 0;
  }

  const hardLimit = Math.max(
    4,
    Math.floor(
      volumeSize / 2.5
    )
  );

  const ratio =
    mode === "solid"
      ? 0.46
      : mode === "relief"
        ? 0.26
        : 0.52;

  return Math.max(
    3,
    Math.min(
      heightMax,
      hardLimit,
      Math.round(
        spanX * ratio
      )
    )
  );
}

function depthShade(
  rgb: RGB,
  depthT: number
) {
  return shade(
    rgb,
    Math.max(
      0.44,
      1 - depthT * 0.58
    )
  );
}

function getHistogram(
  data: Uint8ClampedArray,
  mask: Uint8Array
) {
  const histogram =
    new Map<number, number>();

  for (
    let i = 0;
    i < mask.length;
    i++
  ) {
    if (!mask[i]) continue;

    const packed = pack(
      data[i * 4],
      data[i * 4 + 1],
      data[i * 4 + 2]
    );

    histogram.set(
      packed,
      (histogram.get(packed) ?? 0) + 1
    );
  }

  return histogram;
}

function pixelRgb(
  data: Uint8ClampedArray,
  index: number
): RGB {
  return [
    data[index * 4],
    data[index * 4 + 1],
    data[index * 4 + 2]
  ];
}

export async function imageToVoxels(
  file: File,
  options: {
    volumeSize: number;
    mode: ImageMode;
    heightMax: number;
    maxEdge?: number;
    maxVoxels?: number;
    symmetrize?: boolean;
  }
): Promise<ImageImport> {
  const img =
    await loadImage(file);

  const size =
    calculateWorkingSize(
      img,
      options.mode,
      options.volumeSize,
      options.maxEdge
    );

  const rendered =
    renderImage(
      img,
      size.width,
      size.height
    );

  const mask =
    prepareMask(
      rendered.data,
      size.width,
      size.height,
      options.mode
    );

  const histogram =
    getHistogram(
      rendered.data,
      mask
    );

  if (!histogram.size) {
    throw new Error(
      "Empty image"
    );
  }

  const paletteData =
    makePalette(histogram);

  const field =
    blurField(
      distanceField(
        mask,
        size.width,
        size.height
      ),
      size.width,
      size.height
    );

  let fieldMax = 1;

  for (const value of field) {
    fieldMax = Math.max(
      fieldMax,
      value
    );
  }

  let minX = size.width;
  let maxX = 0;

  for (
    let y = 0;
    y < size.height;
    y++
  ) {
    for (
      let x = 0;
      x < size.width;
      x++
    ) {
      if (
        mask[
          y * size.width + x
        ]
      ) {
        minX = Math.min(
          minX,
          x
        );

        maxX = Math.max(
          maxX,
          x
        );
      }
    }
  }

  const spanX =
    Math.max(
      6,
      maxX - minX + 1
    );

  const depthMax =
    getDepthMax(
      options.mode,
      options.volumeSize,
      options.heightMax,
      spanX
    );

  const cap =
    options.maxVoxels ??
    160_000;

  const raw: ImageVoxel[] = [];
  const cache =
    new Map<number, number>();

  for (
    let py = 0;
    py < size.height;
    py++
  ) {
    for (
      let px = 0;
      px < size.width;
      px++
    ) {
      const index =
        py * size.width + px;

      if (!mask[index]) {
        continue;
      }

      const r =
        rendered.data[index * 4];

      const g =
        rendered.data[index * 4 + 1];

      const b =
        rendered.data[index * 4 + 2];

      const luma =
        (
          0.2126 * r +
          0.7152 * g +
          0.0722 * b
        ) /
        255;

      const fieldT =
        Math.sqrt(
          Math.max(
            0,
            field[index] /
              fieldMax
          )
        );

      const radius =
        buildDepthRadius(
          options.mode,
          depthMax,
          fieldT,
          luma
        );

      const x = px;
      const y =
        size.height -
        1 -
        py;

      for (
        let dz = -radius;
        dz <= radius;
        dz++
      ) {
        const depthT =
          radius <= 0
            ? 0
            : (
                radius - dz
              ) /
              (2 * radius);

        const rgb =
          depthShade(
            [r, g, b],
            depthT
          );

        const c =
          nearestIndex(
            rgb[0],
            rgb[1],
            rgb[2],
            paletteData.entries,
            cache
          );

        raw.push({
          x,
          y,
          z: dz,
          c
        });

        if (
          raw.length >
          cap
        ) {
          throw new Error(
            "Image too dense"
          );
        }
      }
    }
  }

  const shouldSymmetrize =
    options.mode === "model" &&
    options.symmetrize === true;

  const voxels =
    shiftToCenter(
      shouldSymmetrize
        ? symmetrizeX(raw)
        : raw,
      options.volumeSize
    );

  return {
    voxels,
    palette:
      paletteData.palette,
    width:
      size.width,
    height:
      size.height,
    count:
      voxels.length
  };
}

export async function imagesToVoxels(
  views: {
    front: File;
    side?: File;
    back?: File;
  },
  options: {
    volumeSize: number;
    mode: ImageMode;
    heightMax: number;
    maxEdge?: number;
    maxVoxels?: number;
    symmetrize?: boolean;
  }
): Promise<ImageImport> {
  /*
   * Without SIDE we retain the single-image pipeline.
   */
  if (!views.side) {
    return imageToVoxels(
      views.front,
      options
    );
  }

  const frontImg =
    await loadImage(
      views.front
    );

  const sideImg =
    await loadImage(
      views.side
    );

  const backImg =
    views.back
      ? await loadImage(
          views.back
        )
      : null;

  const maxEdge =
    Math.max(
      32,
      Math.min(
        options.maxEdge ??
          (
            options.mode === "model"
              ? 192
              : 160
          ),
        options.volumeSize
      )
    );

  const commonHeightScale =
    maxEdge /
    Math.max(
      frontImg.height,
      sideImg.height,
      backImg?.height ?? 0,
      1
    );

  const height =
    Math.max(
      8,
      Math.min(
        maxEdge,
        Math.round(
          Math.max(
            frontImg.height,
            sideImg.height,
            backImg?.height ?? 0,
            8
          ) *
            Math.min(
              1,
              commonHeightScale
            )
        )
      )
    );

  const frontWidth =
    Math.max(
      8,
      Math.min(
        maxEdge,
        Math.round(
          frontImg.width *
            (
              height /
              Math.max(
                frontImg.height,
                1
              )
            )
        )
      )
    );

  const depthWidth =
    Math.max(
      8,
      Math.min(
        maxEdge,
        Math.round(
          sideImg.width *
            (
              height /
              Math.max(
                sideImg.height,
                1
              )
            )
        )
      )
    );

  const backWidth =
    backImg
      ? Math.max(
          8,
          Math.min(
            maxEdge,
            Math.round(
              backImg.width *
                (
                  height /
                  Math.max(
                    backImg.height,
                    1
                  )
                )
            )
          )
        )
      : frontWidth;

  /*
   * FRONT:
   * X = horizontal
   * Y = vertical
   *
   * SIDE:
   * Z = horizontal
   * Y = vertical
   *
   * BACK:
   * X = horizontal
   * Y = vertical
   *
   * Therefore all three images constrain
   * the same voxel coordinate system.
   */
  const frontRendered =
    renderImage(
      frontImg,
      frontWidth,
      height
    );

  const sideRendered =
    renderImage(
      sideImg,
      depthWidth,
      height
    );

  const backRendered =
    backImg
      ? renderImage(
          backImg,
          backWidth,
          height
        )
      : null;

  const frontMask =
    prepareMask(
      frontRendered.data,
      frontWidth,
      height,
      options.mode
    );

  const sideMask =
    prepareMask(
      sideRendered.data,
      depthWidth,
      height,
      options.mode
    );

  const backMask =
    backRendered
      ? prepareMask(
          backRendered.data,
          backWidth,
          height,
          options.mode
        )
      : null;

  const histogram =
    new Map<number, number>();

  for (
    let i = 0;
    i < frontMask.length;
    i++
  ) {
    if (!frontMask[i]) continue;

    const packed =
      pack(
        frontRendered.data[i * 4],
        frontRendered.data[i * 4 + 1],
        frontRendered.data[i * 4 + 2]
      );

    histogram.set(
      packed,
      (histogram.get(packed) ?? 0) + 1
    );
  }

  if (backRendered && backMask) {
    for (
      let i = 0;
      i < backMask.length;
      i++
    ) {
      if (!backMask[i]) continue;

      const packed =
        pack(
          backRendered.data[i * 4],
          backRendered.data[i * 4 + 1],
          backRendered.data[i * 4 + 2]
        );

      histogram.set(
        packed,
        (histogram.get(packed) ?? 0) + 1
      );
    }
  }

  if (!histogram.size) {
    return imageToVoxels(
      views.front,
      options
    );
  }

  const paletteData =
    makePalette(histogram);

  const cap =
    options.maxVoxels ??
    160_000;

  const raw: ImageVoxel[] = [];

  const cache =
    new Map<number, number>();

  /*
   * For a true three-view model,
   * each view constrains the final occupancy:
   *
   * FRONT  -> X/Y
   * SIDE   -> Z/Y
   * BACK   -> X/Y
   *
   * This is a silhouette carving pass rather
   * than a simple extrusion.
   */
  for (
    let py = 0;
    py < height;
    py++
  ) {
    const y =
      height -
      1 -
      py;

    for (
      let px = 0;
      px < frontWidth;
      px++
    ) {
      const frontIndex =
        py * frontWidth +
        px;

      if (!frontMask[frontIndex]) {
        continue;
      }

      let backAtX = true;

      /*
       * BACK is aligned to the FRONT horizontal axis.
       * If the source dimensions differ slightly,
       * map normalized X instead of assuming equal width.
       */
      let backX = px;

      if (backMask && backRendered) {
        const normalized =
          frontWidth <= 1
            ? 0
            : px /
              (frontWidth - 1);

        backX = Math.round(
          normalized *
            Math.max(
              0,
              backWidth - 1
            )
        );

        backAtX =
          !!backMask[
            py * backWidth +
              backX
          ];

        /*
         * A very small mismatch between front/back
         * silhouettes should not destroy a complete
         * vertical feature. Check immediate neighbors.
         */
        if (!backAtX) {
          for (
            let dx = -1;
            dx <= 1;
            dx++
          ) {
            const nx =
              backX + dx;

            if (
              nx < 0 ||
              nx >= backWidth
            ) {
              continue;
            }

            if (
              backMask[
                py * backWidth +
                  nx
              ]
            ) {
              backAtX = true;
              break;
            }
          }
        }
      }

      if (
        backMask &&
        !backAtX
      ) {
        continue;
      }

      for (
        let pz = 0;
        pz < depthWidth;
        pz++
      ) {
        const sideIndex =
          py * depthWidth +
          pz;

        if (
          !sideMask[sideIndex]
        ) {
          continue;
        }

        /*
         * Side mask constrains actual depth.
         * This is the critical difference from
         * the previous dome-only reconstruction.
         */
        const depthT =
          depthWidth <= 1
            ? 0
            : pz /
              (depthWidth - 1);

        const frontRgb =
          pixelRgb(
            frontRendered.data,
            frontIndex
          );

        let sourceRgb =
          frontRgb;

        if (
          backRendered &&
          backMask &&
          backAtX
        ) {
          const backIndex =
            py * backWidth +
            backX;

          const backRgb =
            pixelRgb(
              backRendered.data,
              backIndex
            );

          /*
           * Preserve the front material in the
           * front quarter, blend in the middle,
           * and preserve the back material in the
           * rear quarter.
           */
          const blendStart = 0.28;
          const blendEnd = 0.72;

          let blendT = 0;

          if (
            depthT > blendStart
          ) {
            blendT =
              smoothStep(
                (
                  depthT -
                  blendStart
                ) /
                (
                  blendEnd -
                  blendStart
                )
              );
          }

          sourceRgb =
            blendRgb(
              frontRgb,
              backRgb,
              blendT
            );
        }

        /*
         * Keep the visible front close to original RGB.
         * Only hidden/interior surfaces receive shading.
         */
        let shaded =
          sourceRgb;

        if (
          depthT > 0.18
        ) {
          const hiddenT =
            (
              depthT -
              0.18
            ) /
            0.82;

          shaded =
            shade(
              sourceRgb,
              Math.max(
                0.48,
                1 -
                  hiddenT *
                    0.48
              )
            );
        }

        const c =
          nearestIndex(
            shaded[0],
            shaded[1],
            shaded[2],
            paletteData.entries,
            cache
          );

        raw.push({
          x: px,
          y,
          z: pz,
          c
        });

        if (
          raw.length >
          cap
        ) {
          throw new Error(
            "Image too dense"
          );
        }
      }
    }
  }

  /*
   * If the carving produced nothing,
   * fall back safely to the front image.
   */
  if (!raw.length) {
    return imageToVoxels(
      views.front,
      options
    );
  }

  const shouldSymmetrize =
    options.mode === "model" &&
    options.symmetrize === true;

  const result =
    shouldSymmetrize
      ? symmetrizeX(raw)
      : raw;

  const voxels =
    shiftToCenter(
      result,
      options.volumeSize
    );

  return {
    voxels,
    palette:
      paletteData.palette,
    width:
      frontWidth,
    height,
    count:
      voxels.length
  };
}
