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

function linearToSrgb(value: number) {
  const v = Math.max(0, value);
  return v <= 0.0031308
    ? v * 12.92
    : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
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
    0.6806995451 * g +
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
      0.793617785 * m3 -
      0.0040720468 * s3,

    1.9779984951 * l3 -
      2.428592205 * m3 +
      0.4505937099 * s3,

    0.0259040371 * l3 +
      0.7827717662 * m3 -
      0.808675766 * s3
  ];
}

function oklabDistanceSquared(a: Lab, b: Lab) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];

  return dl * dl + da * da + db * db;
}

function shade(rgb: RGB, amount: number): RGB {
  return [
    clamp(Math.round(rgb[0] * amount)),
    clamp(Math.round(rgb[1] * amount)),
    clamp(Math.round(rgb[2] * amount))
  ];
}

function makeColorEntries(
  colors: RGB[]
): ColorEntry[] {
  return colors.map((rgb) => ({
    rgb,
    lab: rgbToOklab(rgb)
  }));
}

function quantize(
  histogram: Map<number, number>,
  maxColors: number
): RGB[] {
  const entries = [...histogram.entries()].map(
    ([packed, count]) => ({
      rgb: unpack(packed),
      count,
      lab: rgbToOklab(unpack(packed))
    })
  );

  if (entries.length <= maxColors) {
    return entries
      .sort((a, b) => b.count - a.count)
      .map((item) => item.rgb);
  }

  /*
   * First reduce the number of candidates.
   * This prevents the farthest-point pass from becoming expensive
   * on photographic PNGs with thousands of subtly different RGB values.
   */
  const bucketShift =
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

  for (const item of entries) {
    const r = item.rgb[0];
    const g = item.rgb[1];
    const b = item.rgb[2];

    const key = pack(
      r >> bucketShift,
      g >> bucketShift,
      b >> bucketShift
    );

    const bucket = buckets.get(key) ?? {
      count: 0,
      r: 0,
      g: 0,
      b: 0
    };

    bucket.count += item.count;
    bucket.r += r * item.count;
    bucket.g += g * item.count;
    bucket.b += b * item.count;

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
    return candidates.map((item) => item.rgb);
  }

  /*
   * Farthest-point selection in OKLab.
   *
   * First pick the most frequent color.
   * Then repeatedly select the color that adds the most
   * perceptual separation while still rewarding frequency.
   */
  const selected: typeof candidates = [];
  const used = new Uint8Array(candidates.length);

  selected.push(candidates[0]);
  used[0] = 1;

  const minDistance = new Float32Array(
    candidates.length
  );

  for (let i = 0; i < candidates.length; i++) {
    minDistance[i] =
      oklabDistanceSquared(
        candidates[i].lab,
        candidates[0].lab
      );
  }

  while (selected.length < maxColors) {
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      if (used[i]) continue;

      const frequencyWeight =
        Math.sqrt(
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

    const selectedLab =
      candidates[bestIndex].lab;

    for (
      let i = 0;
      i < candidates.length;
      i++
    ) {
      if (used[i]) continue;

      const d =
        oklabDistanceSquared(
          candidates[i].lab,
          selectedLab
        );

      if (d < minDistance[i]) {
        minDistance[i] = d;
      }
    }
  }

  return selected.map((item) => item.rgb);
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
  let dist = Infinity;

  for (let i = 0; i < colors.length; i++) {
    const d =
      oklabDistanceSquared(
        target,
        colors[i].lab
      );

    if (d < dist) {
      dist = d;
      best = i;
    }
  }

  cache.set(key, best);
  return best;
}

function loadImage(
  file: File
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url =
      URL.createObjectURL(file);

    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error("Invalid image")
      );
    };

    img.src = url;
  });
}

function smoothAlpha(
  data: Uint8ClampedArray,
  w: number,
  h: number
) {
  const src = new Float32Array(
    w * h
  );

  for (let i = 0; i < w * h; i++) {
    src[i] =
      data[i * 4 + 3];
  }

  const out = new Float32Array(
    w * h
  );

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;

      for (
        let dy = -1;
        dy <= 1;
        dy++
      ) {
        for (
          let dx = -1;
          dx <= 1;
          dx++
        ) {
          const nx = x + dx;
          const ny = y + dy;

          if (
            nx < 0 ||
            ny < 0 ||
            nx >= w ||
            ny >= h
          ) {
            continue;
          }

          sum +=
            src[ny * w + nx];

          count++;
        }
      }

      out[y * w + x] =
        sum / count;
    }
  }

  for (
    let i = 0;
    i < w * h;
    i++
  ) {
    data[i * 4 + 3] =
      Math.round(out[i]);
  }
}

function knockFringe(
  mask: Uint8Array,
  data: Uint8ClampedArray,
  w: number,
  h: number
) {
  const next =
    new Uint8Array(mask);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;

      if (!mask[i]) continue;

      const alpha =
        data[i * 4 + 3];

      if (alpha >= 245) continue;

      let empty = 0;

      for (
        let dy = -1;
        dy <= 1;
        dy++
      ) {
        for (
          let dx = -1;
          dx <= 1;
          dx++
        ) {
          if (!dx && !dy) continue;

          const nx = x + dx;
          const ny = y + dy;

          if (
            nx < 0 ||
            ny < 0 ||
            nx >= w ||
            ny >= h ||
            !mask[ny * w + nx]
          ) {
            empty++;
          }
        }
      }

      /*
       * Only remove very weak edge pixels.
       * This preserves thin details significantly better
       * than the previous aggressive fringe cleanup.
       */
      if (
        alpha < 80 &&
        empty >= 3
      ) {
        next[i] = 0;
      }
    }
  }

  mask.set(next);
}

function dropIslands(
  mask: Uint8Array,
  w: number,
  h: number,
  minSize: number
) {
  if (minSize <= 1) return;

  const seen =
    new Uint8Array(
      w * h
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

    const cells: number[] = [
      start
    ];

    while (stack.length) {
      const i =
        stack.pop()!;

      const x = i % w;
      const y =
        (i / w) | 0;

      for (
        const n of [
          i - 1,
          i + 1,
          i - w,
          i + w
        ]
      ) {
        if (
          n < 0 ||
          n >= mask.length ||
          seen[n] ||
          !mask[n]
        ) {
          continue;
        }

        const nx = n % w;
        const ny =
          (n / w) | 0;

        if (
          Math.abs(nx - x) +
            Math.abs(ny - y) !==
          1
        ) {
          continue;
        }

        seen[n] = 1;
        stack.push(n);
        cells.push(n);
      }
    }

    if (
      cells.length < minSize
    ) {
      for (
        const i of cells
      ) {
        mask[i] = 0;
      }
    }
  }
}

function floodBackdrop(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  w: number,
  h: number
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

  /*
   * Only treat the image as having a removable flat background
   * when nearly all pixels are opaque.
   */
  if (
    opaque / (w * h) <
    0.965
  ) {
    return;
  }

  const corners = [
    0,
    w - 1,
    (h - 1) * w,
    h * w - 1
  ];

  const samples =
    corners.map((i) => [
      data[i * 4],
      data[i * 4 + 1],
      data[i * 4 + 2]
    ]);

  const [
    cr,
    cg,
    cb
  ] = samples[0];

  if (
    !samples.every(
      ([r, g, b]) =>
        (r - cr) ** 2 +
          (g - cg) ** 2 +
          (b - cb) ** 2 <
        1150
    )
  ) {
    return;
  }

  const seen =
    new Uint8Array(
      w * h
    );

  const queue =
    [...corners];

  for (
    const i of queue
  ) {
    seen[i] = 1;
  }

  while (queue.length) {
    const i =
      queue.pop()!;

    const x = i % w;
    const y =
      (i / w) | 0;

    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];

    const distance =
      (r - cr) ** 2 +
      (g - cg) ** 2 +
      (b - cb) ** 2;

    if (distance >= 1700) {
      continue;
    }

    mask[i] = 0;

    for (
      const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ] as const
    ) {
      if (
        nx < 0 ||
        ny < 0 ||
        nx >= w ||
        ny >= h
      ) {
        continue;
      }

      const n =
        ny * w + nx;

      if (seen[n]) continue;

      seen[n] = 1;
      queue.push(n);
    }
  }
}

function distanceField(
  mask: Uint8Array,
  w: number,
  h: number
) {
  const INF =
    w + h + 8;

  const d =
    new Float32Array(
      w * h
    );

  for (
    let i = 0;
    i < d.length;
    i++
  ) {
    d[i] = mask[i]
      ? INF
      : 0;
  }

  for (
    let y = 0;
    y < h;
    y++
  ) {
    for (
      let x = 0;
      x < w;
      x++
    ) {
      const i =
        y * w + x;

      if (!mask[i]) continue;

      let best = d[i];

      if (x > 0) {
        best = Math.min(
          best,
          d[i - 1] + 1
        );
      }

      if (y > 0) {
        best = Math.min(
          best,
          d[i - w] + 1
        );
      }

      if (
        x > 0 &&
        y > 0
      ) {
        best = Math.min(
          best,
          d[i - w - 1] +
            1.414
        );
      }

      if (
        x + 1 < w &&
        y > 0
      ) {
        best = Math.min(
          best,
          d[i - w + 1] +
            1.414
        );
      }

      d[i] = best;
    }
  }

  for (
    let y = h - 1;
    y >= 0;
    y--
  ) {
    for (
      let x = w - 1;
      x >= 0;
      x--
    ) {
      const i =
        y * w + x;

      if (!mask[i]) continue;

      let best = d[i];

      if (x + 1 < w) {
        best = Math.min(
          best,
          d[i + 1] + 1
        );
      }

      if (y + 1 < h) {
        best = Math.min(
          best,
          d[i + w] + 1
        );
      }

      if (
        x + 1 < w &&
        y + 1 < h
      ) {
        best = Math.min(
          best,
          d[i + w + 1] +
            1.414
        );
      }

      if (
        x > 0 &&
        y + 1 < h
      ) {
        best = Math.min(
          best,
          d[i + w - 1] +
            1.414
        );
      }

      d[i] = best;
    }
  }

  return d;
}

function blurField(
  src: Float32Array,
  w: number,
  h: number
) {
  const out =
    new Float32Array(
      src.length
    );

  for (
    let y = 0;
    y < h;
    y++
  ) {
    for (
      let x = 0;
      x < w;
      x++
    ) {
      let sum = 0;
      let count = 0;

      for (
        let dy = -1;
        dy <= 1;
        dy++
      ) {
        for (
          let dx = -1;
          dx <= 1;
          dx++
        ) {
          const nx =
            x + dx;
          const ny =
            y + dy;

          if (
            nx < 0 ||
            ny < 0 ||
            nx >= w ||
            ny >= h
          ) {
            continue;
          }

          sum +=
            src[ny * w + nx];

          count++;
        }
      }

      out[
        y * w + x
      ] =
        sum / count;
    }
  }

  return out;
}

function prepareImage(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  mode: ImageMode
) {
  const mask =
    new Uint8Array(
      w * h
    );

  smoothAlpha(
    data,
    w,
    h
  );

  for (
    let i = 0;
    i < w * h;
    i++
  ) {
    if (
      data[i * 4 + 3] >=
      16
    ) {
      mask[i] = 1;
    }
  }

  floodBackdrop(
    data,
    mask,
    w,
    h
  );

  knockFringe(
    mask,
    data,
    w,
    h
  );

  /*
   * Model keeps tiny components.
   * Weapons/props are also protected from over-cleaning.
   */
  const minIslandSize =
    mode === "flat"
      ? 1
      : mode === "model"
        ? 2
        : 2;

  dropIslands(
    mask,
    w,
    h,
    minIslandSize
  );

  return mask;
}

function imageCanvas(
  img: HTMLImageElement,
  w: number,
  h: number
) {
  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width = w;
  canvas.height = h;

  const ctx =
    canvas.getContext(
      "2d",
      {
        willReadFrequently: true
      }
    );

  if (!ctx) {
    throw new Error(
      "No 2d context"
    );
  }

  const sourceScale =
    Math.max(
      img.width / Math.max(w, 1),
      img.height / Math.max(h, 1)
    );

  const shouldSmooth =
    sourceScale > 1.08;

  ctx.imageSmoothingEnabled =
    shouldSmooth;

  if (
    "imageSmoothingQuality" in
    ctx
  ) {
    ctx.imageSmoothingQuality =
      "high";
  }

  ctx.clearRect(
    0,
    0,
    w,
    h
  );

  ctx.drawImage(
    img,
    0,
    0,
    w,
    h
  );

  return {
    canvas,
    ctx,
    data: ctx.getImageData(
      0,
      0,
      w,
      h
    ).data
  };
}

function makePalette(
  histogram: Map<number, number>,
  maxBaseColors: number
) {
  const baseColors =
    quantize(
      histogram,
      maxBaseColors
    );

  /*
   * Four controlled tonal variants per base color:
   * full, soft shadow, medium shadow, deep shadow.
   *
   * 64 base colors × 4 = 256 maximum.
   */
  const colors: RGB[] = [];

  for (
    const rgb of baseColors.slice(
      0,
      64
    )
  ) {
    colors.push(
      rgb
    );

    colors.push(
      shade(
        rgb,
        0.82
      )
    );

    colors.push(
      shade(
        rgb,
        0.62
      )
    );

    colors.push(
      shade(
        rgb,
        0.46
      )
    );
  }

  const palette =
    Array.from(
      {
        length: 256
      },
      (_, i) =>
        colors[i]
          ? hexOf(
              ...colors[i]
            )
          : "#000000"
    );

  return {
    colors,
    palette,
    entries:
      makeColorEntries(
        colors
      )
  };
}

function symmetrizeX(
  voxels: ImageVoxel[]
): ImageVoxel[] {
  if (!voxels.length) {
    return voxels;
  }

  let minX = Infinity;
  let maxX = -Infinity;

  for (
    const v of voxels
  ) {
    minX = Math.min(
      minX,
      v.x
    );

    maxX = Math.max(
      maxX,
      v.x
    );
  }

  const mid =
    minX +
    (maxX - minX) /
      2;

  let leftCount = 0;
  let rightCount = 0;

  for (
    const v of voxels
  ) {
    if (v.x < mid) {
      leftCount++;
    } else if (
      v.x > mid
    ) {
      rightCount++;
    }
  }

  const sourceIsLeft =
    leftCount >=
    rightCount;

  const map =
    new Map<
      string,
      ImageVoxel
    >();

  for (
    const v of voxels
  ) {
    map.set(
      `${v.x},${v.y},${v.z}`,
      v
    );
  }

  for (
    const v of voxels
  ) {
    const source =
      sourceIsLeft
        ? v.x <= mid
        : v.x >= mid;

    if (!source) {
      continue;
    }

    const mirroredX =
      Math.round(
        2 * mid - v.x
      );

    map.set(
      `${mirroredX},${v.y},${v.z}`,
      {
        x: mirroredX,
        y: v.y,
        z: v.z,
        c: v.c
      }
    );
  }

  return [
    ...map.values()
  ];
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

  for (
    const v of voxels
  ) {
    minX = Math.min(
      minX,
      v.x
    );

    minY = Math.min(
      minY,
      v.y
    );

    minZ = Math.min(
      minZ,
      v.z
    );

    maxX = Math.max(
      maxX,
      v.x
    );

    maxY = Math.max(
      maxY,
      v.y
    );

    maxZ = Math.max(
      maxZ,
      v.z
    );
  }

  const sx =
    Math.floor(
      (
        volumeSize -
        (maxX - minX + 1)
      ) / 2
    ) - minX;

  const sy =
    -minY;

  const sz =
    Math.floor(
      (
        volumeSize -
        (maxZ - minZ + 1)
      ) / 2
    ) - minZ;

  return voxels
    .map((v) => ({
      x: v.x + sx,
      y: v.y + sy,
      z: v.z + sz,
      c: v.c
    }))
    .filter(
      (v) =>
        v.x >= 0 &&
        v.y >= 0 &&
        v.z >= 0 &&
        v.x < volumeSize &&
        v.y < volumeSize &&
        v.z < volumeSize
    );
}

function calculateDepthMax(
  mode: ImageMode,
  volumeSize: number,
  heightMax: number,
  spanX: number
) {
  if (
    mode === "flat"
  ) {
    return 0;
  }

  const hardLimit =
    Math.max(
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

function buildDepthRadius(
  mode: ImageMode,
  depthMax: number,
  t: number,
  luma: number
) {
  if (
    mode === "flat"
  ) {
    return 0;
  }

  const half =
    Math.max(
      1,
      depthMax / 2
    );

  if (
    mode === "solid"
  ) {
    /*
     * Solid objects stay robust,
     * but edges become slightly thinner.
     * This preserves silhouettes of weapons and props.
     */
    return Math.max(
      1,
      Math.round(
        half *
          (0.58 + 0.42 * t)
      )
    );
  }

  if (
    mode === "relief"
  ) {
    return Math.max(
      1,
      Math.round(
        half *
          (
            0.28 +
            luma * 0.52 +
            t * 0.20
          )
      )
    );
  }

  /*
   * MODEL:
   * organic dome with additional
   * silhouette-aware falloff.
   */
  const dome =
    Math.sqrt(
      Math.max(
        0.035,
        1 -
          Math.pow(
            1 - t,
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

function depthShade(
  rgb: RGB,
  depthT: number
) {
  /*
   * Preserve the original image on the front.
   * Progressively darken hidden/rear surfaces.
   */
  const amount =
    Math.max(
      0.44,
      1 -
        depthT * 0.58
    );

  return shade(
    rgb,
    amount
  );
}

async function rasterMask(
  file: File,
  w: number,
  h: number,
  mode: ImageMode
) {
  const img =
    await loadImage(
      file
    );

  const canvasData =
    imageCanvas(
      img,
      w,
      h
    );

  const mask =
    prepareImage(
      canvasData.data,
      w,
      h,
      mode
    );

  return {
    data:
      canvasData.data,
    mask
  };
}

function chooseSingleViewSize(
  img: HTMLImageElement,
  mode: ImageMode,
  volumeSize: number,
  requested?: number
) {
  /*
   * The voxel volume remains the final resolution ceiling.
   * The working edge is therefore tied to the actual editable volume.
   *
   * The defaults are intentionally higher than the previous pipeline.
   */
  const modeDefault =
    mode === "model"
      ? 192
      : mode === "flat"
        ? 160
        : 176;

  const maxEdge = Math.max(
    32,
    Math.min(
      requested ??
        modeDefault,
      volumeSize
    )
  );

  const scale =
    Math.min(
      1,
      maxEdge /
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
    await loadImage(
      file
    );

  const size =
    chooseSingleViewSize(
      img,
      options.mode,
      options.volumeSize,
      options.maxEdge
    );

  const rendered =
    imageCanvas(
      img,
      size.width,
      size.height
    );

  const data =
    rendered.data;

  const mask =
    prepareImage(
      data,
      size.width,
      size.height,
      options.mode
    );

  const histogram =
    new Map<number, number>();

  let visible = 0;
  let minPx = size.width;
  let maxPx = 0;

  for (
    let i = 0;
    i <
      size.width *
        size.height;
    i++
  ) {
    if (!mask[i]) {
      continue;
    }

    visible++;

    minPx =
      Math.min(
        minPx,
        i % size.width
      );

    maxPx =
      Math.max(
        maxPx,
        i % size.width
      );

    const packed =
      pack(
        data[i * 4],
        data[i * 4 + 1],
        data[i * 4 + 2]
      );

    histogram.set(
      packed,
      (histogram.get(
        packed
      ) ?? 0) + 1
    );
  }

  if (!visible) {
    throw new Error(
      "Empty image"
    );
  }

  /*
   * Keep the base palette within 64 colors
   * so four tonal variants fit exactly in 256 slots.
   */
  const paletteData =
    makePalette(
      histogram,
      64
    );

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

  for (
    let i = 0;
    i < field.length;
    i++
  ) {
    if (
      field[i] >
      fieldMax
    ) {
      fieldMax =
        field[i];
    }
  }

  const spanX =
    Math.max(
      6,
      maxPx - minPx + 1
    );

  const depthMax =
    calculateDepthMax(
      options.mode,
      options.volumeSize,
      options.heightMax,
      spanX
    );

  const cap =
    options.maxVoxels ??
    160_000;

  const raw: ImageVoxel[] =
    [];

  const cache =
    new Map<
      number,
      number
    >();

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
      const i =
        py * size.width +
        px;

      if (!mask[i]) {
        continue;
      }

      const r =
        data[i * 4];

      const g =
        data[i * 4 + 1];

      const b =
        data[i * 4 + 2];

      const luma =
        (
          0.2126 * r +
          0.7152 * g +
          0.0722 * b
        ) / 255;

      const t =
        Math.sqrt(
          Math.max(
            0,
            field[i] /
              fieldMax
          )
        );

      const radius =
        buildDepthRadius(
          options.mode,
          depthMax,
          t,
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
            : (radius - dz) /
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
    options.mode ===
      "model" &&
    options.symmetrize ===
      true;

  const resultVoxels =
    shouldSymmetrize
      ? symmetrizeX(raw)
      : raw;

  const voxels =
    shiftToCenter(
      resultVoxels,
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

  const modeDefault =
    options.mode ===
      "model"
      ? 192
      : 160;

  const maxEdge =
    Math.max(
      32,
      Math.min(
        options.maxEdge ??
          modeDefault,
        options.volumeSize
      )
    );

  const srcH =
    Math.max(
      frontImg.height,
      sideImg.height,
      1
    );

  const srcW =
    Math.max(
      frontImg.width,
      sideImg.width,
      1
    );

  const scale =
    Math.min(
      1,
      maxEdge /
        Math.max(
          srcH,
          srcW
        )
    );

  const h =
    Math.max(
      8,
      Math.round(
        srcH * scale
      )
    );

  const w =
    Math.max(
      8,
      Math.min(
        maxEdge,
        Math.round(
          frontImg.width *
            (
              h /
              Math.max(
                frontImg.height,
                1
              )
            )
        )
      )
    );

  const depth =
    Math.max(
      8,
      Math.min(
        maxEdge,
        Math.round(
          sideImg.width *
            (
              h /
              Math.max(
                sideImg.height,
                1
              )
            )
        )
      )
    );

  const front =
    await rasterMask(
      views.front,
      w,
      h,
      options.mode
    );

  const side =
    await rasterMask(
      views.side,
      depth,
      h,
      options.mode
    );

  const histogram =
    new Map<number, number>();

  for (
    let i = 0;
    i < w * h;
    i++
  ) {
    if (!front.mask[i]) {
      continue;
    }

    const packed =
      pack(
        front.data[i * 4],
        front.data[i * 4 + 1],
        front.data[i * 4 + 2]
      );

    histogram.set(
      packed,
      (histogram.get(
        packed
      ) ?? 0) + 1
    );
  }

  if (!histogram.size) {
    return imageToVoxels(
      views.front,
      options
    );
  }

  const paletteData =
    makePalette(
      histogram,
      64
    );

  const cap =
    options.maxVoxels ??
    160_000;

  const raw: ImageVoxel[] =
    [];

  const cache =
    new Map<
      number,
      number
    >();

  for (
    let py = 0;
    py < h;
    py++
  ) {
    for (
      let px = 0;
      px < w;
      px++
    ) {
      const fi =
        py * w + px;

      if (!front.mask[fi]) {
        continue;
      }

      const y =
        h - 1 - py;

      const fr =
        front.data[
          fi * 4
        ];

      const fg =
        front.data[
          fi * 4 + 1
        ];

      const fb =
        front.data[
          fi * 4 + 2
        ];

      const localDepth =
        Math.max(
          0,
          Math.min(
            1,
            py /
              Math.max(
                1,
                h - 1
              )
          )
        );

      for (
        let pz = 0;
        pz < depth;
        pz++
      ) {
        const sideIndex =
          py * depth +
          pz;

        if (
          !side.mask[
            sideIndex
          ]
        ) {
          continue;
        }

        /*
         * Front view controls material/color.
         * Side view controls occupancy/depth.
         */
        const depthT =
          depth <= 1
            ? 0
            : pz /
              (depth - 1);

        /*
         * Slightly adaptive shading:
         * stronger differentiation in rear surfaces,
         * while keeping the front visually faithful.
         */
        const shadeAmount =
          Math.max(
            0.46,
            1 -
              (
                depthT *
                0.52
              )
          );

        const rgb =
          shade(
            [fr, fg, fb],
            shadeAmount
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

  if (!raw.length) {
    return imageToVoxels(
      views.front,
      options
    );
  }

  /*
   * The side-view mask can sometimes create a small amount
   * of staircase noise. A character/armor workflow benefits
   * from symmetry, but weapons and props must never inherit it.
   */
  const shouldSymmetrize =
    options.mode ===
      "model" &&
    options.symmetrize ===
      true;

  const resultVoxels =
    shouldSymmetrize
      ? symmetrizeX(raw)
      : raw;

  const voxels =
    shiftToCenter(
      resultVoxels,
      options.volumeSize
    );

  return {
    voxels,
    palette:
      paletteData.palette,
    width: w,
    height: h,
    count:
      voxels.length
  };
}
