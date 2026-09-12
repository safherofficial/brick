```ts
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

function hexOf(r: number, g: number, b: number) {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function pack(r: number, g: number, b: number) {
  return (r << 16) | (g << 8) | b;
}

function unpack(n: number): [number, number, number] {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function nearestIndex(
  r: number,
  g: number,
  b: number,
  colors: [number, number, number][]
) {
  let best = 0;
  let dist = Infinity;

  for (let i = 0; i < colors.length; i++) {
    const [pr, pg, pb] = colors[i];
    const d =
      (r - pr) ** 2 +
      (g - pg) ** 2 +
      (b - pb) ** 2;

    if (d < dist) {
      dist = d;
      best = i;
    }
  }

  return best;
}

function shade(
  rgb: [number, number, number],
  t: number
): [number, number, number] {
  return [
    Math.max(0, Math.min(255, Math.round(rgb[0] * t))),
    Math.max(0, Math.min(255, Math.round(rgb[1] * t))),
    Math.max(0, Math.min(255, Math.round(rgb[2] * t)))
  ];
}

function quantize(unique: number[], maxColors: number) {
  if (unique.length <= maxColors) return unique.map((n) => unpack(n));

  const buckets = new Map<
    number,
    { n: number; r: number; g: number; b: number }
  >();

  const shift = unique.length > 1800 ? 3 : 2;

  for (const p of unique) {
    const [r, g, b] = unpack(p);
    const key = pack(r >> shift, g >> shift, b >> shift);

    const cur = buckets.get(key) ?? {
      n: 0,
      r: 0,
      g: 0,
      b: 0
    };

    cur.n += 1;
    cur.r += r;
    cur.g += g;
    cur.b += b;

    buckets.set(key, cur);
  }

  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, maxColors)
    .map(
      (c) =>
        [
          Math.round(c.r / c.n),
          Math.round(c.g / c.n),
          Math.round(c.b / c.n)
        ] as [number, number, number]
    );
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

function knockFringe(
  mask: Uint8Array,
  data: Uint8ClampedArray,
  w: number,
  h: number
) {
  const next = new Uint8Array(mask);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (data[i * 4 + 3] >= 250) continue;

      let empty = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
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

      if (empty >= 2) next[i] = 0;
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
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];

  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;

    stack.length = 0;
    stack.push(s);
    seen[s] = 1;

    const cells = [s];

    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i / w) | 0;

      for (const n of [i - 1, i + 1, i - w, i + w]) {
        if (n < 0 || n >= mask.length || seen[n] || !mask[n]) continue;

        const nx = n % w;
        const ny = (n / w) | 0;

        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;

        seen[n] = 1;
        stack.push(n);
        cells.push(n);
      }
    }

    if (cells.length < minSize) {
      for (const i of cells) mask[i] = 0;
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

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 8) opaque++;
  }

  if (opaque / (w * h) < 0.97) return;

  const corners = [
    0,
    w - 1,
    (h - 1) * w,
    h * w - 1
  ];

  const samples = corners.map((i) => [
    data[i * 4],
    data[i * 4 + 1],
    data[i * 4 + 2]
  ]);

  const [cr, cg, cb] = samples[0];

  if (
    !samples.every(
      ([r, g, b]) =>
        (r - cr) ** 2 +
          (g - cg) ** 2 +
          (b - cb) ** 2 <
        900
    )
  ) {
    return;
  }

  const seen = new Uint8Array(w * h);
  const q = [...corners];

  for (const i of q) seen[i] = 1;

  while (q.length) {
    const i = q.pop()!;
    const x = i % w;
    const y = (i / w) | 0;

    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];

    if (
      (r - cr) ** 2 +
        (g - cg) ** 2 +
        (b - cb) ** 2 >=
      1400
    ) {
      continue;
    }

    mask[i] = 0;

    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

      const n = ny * w + nx;

      if (seen[n]) continue;

      seen[n] = 1;
      q.push(n);
    }
  }
}

function distanceField(mask: Uint8Array, w: number, h: number) {
  const INF = w + h + 8;
  const d = new Float32Array(w * h);

  for (let i = 0; i < d.length; i++) {
    d[i] = mask[i] ? INF : 0;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;

      let best = d[i];

      if (x > 0) best = Math.min(best, d[i - 1] + 1);
      if (y > 0) best = Math.min(best, d[i - w] + 1);
      if (x > 0 && y > 0) {
        best = Math.min(best, d[i - w - 1] + 1.414);
      }
      if (x + 1 < w && y > 0) {
        best = Math.min(best, d[i - w + 1] + 1.414);
      }

      d[i] = best;
    }
  }

  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!mask[i]) continue;

      let best = d[i];

      if (x + 1 < w) best = Math.min(best, d[i + 1] + 1);
      if (y + 1 < h) best = Math.min(best, d[i + w] + 1);

      if (x + 1 < w && y + 1 < h) {
        best = Math.min(best, d[i + w + 1] + 1.414);
      }

      if (x > 0 && y + 1 < h) {
        best = Math.min(best, d[i + w - 1] + 1.414);
      }

      d[i] = best;
    }
  }

  return d;
}

function blurField(src: Float32Array, w: number, h: number) {
  const out = new Float32Array(src.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

          s += src[ny * w + nx];
          n++;
        }
      }

      out[y * w + x] = s / n;
    }
  }

  return out;
}

function smoothAlpha(
  data: Uint8ClampedArray,
  w: number,
  h: number
) {
  // Leggero blur del solo canale alpha prima della sogliatura.
  const src = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    src[i] = data[i * 4 + 3];
  }

  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

          s += src[ny * w + nx];
          n++;
        }
      }

      out[y * w + x] = s / n;
    }
  }

  for (let i = 0; i < w * h; i++) {
    data[i * 4 + 3] = Math.round(out[i]);
  }
}

function symmetrizeX(voxels: ImageVoxel[]): ImageVoxel[] {
  // Questa trasformazione è specifica per la modalità MODEL.
  // Non deve mai essere applicata automaticamente ad armi o oggetti.
  if (!voxels.length) return voxels;

  let minX = Infinity;
  let maxX = -Infinity;

  for (const v of voxels) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
  }

  const mid = minX + (maxX - minX) / 2;

  let leftCount = 0;
  let rightCount = 0;

  for (const v of voxels) {
    if (v.x < mid) leftCount++;
    else if (v.x > mid) rightCount++;
  }

  const sourceIsLeft = leftCount >= rightCount;

  const map = new Map<string, ImageVoxel>();

  for (const v of voxels) {
    map.set(`${v.x},${v.y},${v.z}`, v);
  }

  for (const v of voxels) {
    const onSourceSide = sourceIsLeft
      ? v.x <= mid
      : v.x >= mid;

    if (!onSourceSide) continue;

    const mirroredX = Math.round(2 * mid - v.x);

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

  return [...map.values()];
}

function shiftToCenter(
  voxels: ImageVoxel[],
  volumeSize: number
) {
  if (!voxels.length) return voxels;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const v of voxels) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    minZ = Math.min(minZ, v.z);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    maxZ = Math.max(maxZ, v.z);
  }

  const sx =
    Math.floor(
      (volumeSize - (maxX - minX + 1)) / 2
    ) - minX;

  const sy = 0 - minY;

  const sz =
    Math.floor(
      (volumeSize - (maxZ - minZ + 1)) / 2
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

async function rasterMask(
  file: File,
  w: number,
  h: number
) {
  const img = await loadImage(file);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  if (!ctx) throw new Error("No 2d context");

  ctx.imageSmoothingEnabled = false;

  const scale = Math.min(
    w / Math.max(img.width, 1),
    h / Math.max(img.height, 1)
  );

  const dw = Math.max(
    1,
    Math.round(img.width * scale)
  );

  const dh = Math.max(
    1,
    Math.round(img.height * scale)
  );

  const ox = Math.floor((w - dw) / 2);
  const oy = Math.floor((h - dh) / 2);

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, ox, oy, dw, dh);

  const data = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);

  smoothAlpha(data, w, h);

  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] >= 24) mask[i] = 1;
  }

  floodBackdrop(data, mask, w, h);
  knockFringe(mask, data, w, h);
  dropIslands(mask, w, h, 6);

  return { data, mask };
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
  const img = await loadImage(file);

  /*
   * MODEL mantiene la risoluzione superiore specifica per i personaggi.
   * Gli altri mode mantengono la pipeline asset originale.
   */
  const defaultEdge =
    options.mode === "model" ? 176 : 112;

  const maxEdge = Math.min(
    options.maxEdge ?? defaultEdge,
    options.volumeSize
  );

  const scale = Math.min(
    1,
    maxEdge /
      Math.max(
        img.width,
        img.height,
        1
      )
  );

  const w = Math.max(
    1,
    Math.round(img.width * scale)
  );

  const h = Math.max(
    1,
    Math.round(img.height * scale)
  );

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  if (!ctx) throw new Error("No 2d context");

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, w, h);

  const data = ctx.getImageData(
    0,
    0,
    w,
    h
  ).data;

  const mask = new Uint8Array(w * h);

  smoothAlpha(data, w, h);

  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] >= 24) mask[i] = 1;
  }

  floodBackdrop(data, mask, w, h);
  knockFringe(mask, data, w, h);
  dropIslands(mask, w, h, 6);

  const unique = new Set<number>();
  let visible = 0;
  let minPx = w;
  let maxPx = 0;

  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;

    visible += 1;

    minPx = Math.min(
      minPx,
      i % w
    );

    maxPx = Math.max(
      maxPx,
      i % w
    );

    unique.add(
      pack(
        data[i * 4],
        data[i * 4 + 1],
        data[i * 4 + 2]
      )
    );
  }

  if (!visible) throw new Error("Empty image");

  /*
   * La palette est più ampia esclusivamente per MODEL.
   * La pipeline degli asset mantiene il proprio comportamento.
   */
  const baseColors = quantize(
    [...unique],
    options.mode === "model" ? 72 : 64
  );

  const colors: [number, number, number][] = [];

  for (const rgb of baseColors) {
    colors.push(rgb);
    colors.push(shade(rgb, 0.72));
    colors.push(shade(rgb, 0.48));
  }

  const palette = Array.from(
    { length: 256 },
    (_, i) =>
      colors[i]
        ? hexOf(...colors[i])
        : "#000000"
  );

  const field = blurField(
    distanceField(mask, w, h),
    w,
    h
  );

  let fieldMax = 1;

  for (let i = 0; i < field.length; i++) {
    if (field[i] > fieldMax) fieldMax = field[i];
  }

  const spanX = Math.max(
    6,
    maxPx - minPx + 1
  );

  const depthMax =
    options.mode === "flat"
      ? 0
      : Math.max(
          3,
          Math.min(
            options.heightMax,
            Math.floor(options.volumeSize / 3),
            Math.round(
              spanX *
                (
                  options.mode === "solid"
                    ? 0.38
                    : options.mode === "relief"
                      ? 0.22
                      : 0.46
                )
            )
          )
        );

  const cap =
    options.maxVoxels ?? 160_000;

  const raw: ImageVoxel[] = [];

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = py * w + px;

      if (!mask[i]) continue;

      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];

      const luma =
        (
          0.2126 * r +
          0.7152 * g +
          0.0722 * b
        ) / 255;

      const t = Math.sqrt(
        field[i] / fieldMax
      );

      let radius = 0;

      if (options.mode === "solid") {
        radius = Math.max(
          2,
          Math.round(depthMax / 2)
        );
      } else if (options.mode === "relief") {
        radius = Math.max(
          1,
          Math.round(
            (0.35 + luma * 0.65) *
              (depthMax / 2)
          )
        );
      } else if (options.mode === "model") {
        /*
         * Character pipeline:
         * profilo a cupola, più pieno al centro e
         * più sottile verso i bordi.
         */
        const dome = Math.sqrt(
          Math.max(
            0.03,
            1 - Math.pow(1 - t, 1.6)
          )
        );

        radius = Math.max(
          1,
          Math.round(
            dome * depthMax
          )
        );
      }

      const x = px;
      const y = h - 1 - py;

      for (
        let dz = -radius;
        dz <= radius;
        dz++
      ) {
        const depthT =
          radius === 0
            ? 0
            : (radius - dz) /
              (2 * radius);

        const shadeAmt = Math.max(
          0.42,
          1 - depthT * 0.62
        );

        const rgb = shade(
          [r, g, b],
          shadeAmt
        );

        raw.push({
          x,
          y,
          z: dz,
          c: nearestIndex(
            rgb[0],
            rgb[1],
            rgb[2],
            colors
          )
        });

        if (raw.length > cap) {
          throw new Error(
            "Image too dense"
          );
        }
      }
    }
  }

  /*
   * IMPORTANT:
   * la simmetrizzazione è ora rigidamente confinata
   * alla modalità MODEL.
   *
   * Quindi armi e oggetti non vengono più specchiati
   * anche se un caller passa symmetrize: true.
   */
  const shouldSymmetrize =
    options.mode === "model" &&
    options.symmetrize === true;

  const voxels = shiftToCenter(
    shouldSymmetrize
      ? symmetrizeX(raw)
      : raw,
    options.volumeSize
  );

  return {
    voxels,
    palette,
    width: w,
    height: h,
    count: voxels.length
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

  /*
   * MODEL mantiene la risoluzione più alta
   * anche nella pipeline FRONT + SIDE.
   */
  const defaultEdge =
    options.mode === "model"
      ? 160
      : 96;

  const maxEdge = Math.min(
    options.maxEdge ?? defaultEdge,
    options.volumeSize
  );

  const frontImg =
    await loadImage(views.front);

  const sideImg =
    await loadImage(views.side);

  const srcH = Math.max(
    frontImg.height,
    sideImg.height,
    1
  );

  const srcW = Math.max(
    frontImg.width,
    sideImg.width,
    1
  );

  const h = Math.max(
    8,
    Math.min(
      maxEdge,
      Math.round(
        srcH *
          Math.min(
            1,
            maxEdge /
              Math.max(srcH, srcW)
          )
      )
    )
  );

  const w = Math.max(
    8,
    Math.min(
      maxEdge,
      Math.round(
        frontImg.width *
          (h /
            Math.max(
              frontImg.height,
              1
            ))
      )
    )
  );

  const depth = Math.max(
    8,
    Math.min(
      maxEdge,
      Math.round(
        sideImg.width *
          (h /
            Math.max(
              sideImg.height,
              1
            ))
      )
    )
  );

  const front = await rasterMask(
    views.front,
    w,
    h
  );

  const side = await rasterMask(
    views.side,
    depth,
    h
  );

  const unique = new Set<number>();

  for (
    let i = 0;
    i < w * h;
    i++
  ) {
    if (!front.mask[i]) continue;

    unique.add(
      pack(
        front.data[i * 4],
        front.data[i * 4 + 1],
        front.data[i * 4 + 2]
      )
    );
  }

  if (!unique.size) {
    return imageToVoxels(
      views.front,
      options
    );
  }

  const colors = quantize(
    [...unique],
    options.mode === "model"
      ? 72
      : 48
  );

  const palette = Array.from(
    { length: 256 },
    (_, i) =>
      colors[i]
        ? hexOf(...colors[i])
        : "#000000"
  );

  const cap =
    options.maxVoxels ??
    160_000;

  const raw: ImageVoxel[] = [];

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const fi =
        py * w + px;

      if (!front.mask[fi]) continue;

      const y =
        h - 1 - py;

      const fr =
        front.data[fi * 4];

      const fg =
        front.data[fi * 4 + 1];

      const fb =
        front.data[fi * 4 + 2];

      for (
        let pz = 0;
        pz < depth;
        pz++
      ) {
        if (
          !side.mask[
            py * depth + pz
          ]
        ) {
          continue;
        }

        const depthT =
          depth <= 1
            ? 0
            : pz /
              (depth - 1);

        const rgb = shade(
          [fr, fg, fb],
          0.42 +
            depthT * 0.58
        );

        raw.push({
          x: px,
          y,
          z: pz,
          c: nearestIndex(
            rgb[0],
            rgb[1],
            rgb[2],
            colors
          )
        });

        if (raw.length > cap) {
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
   * Anche FRONT + SIDE rispetta la stessa regola:
   * symmetry solo per MODEL.
   */
  const shouldSymmetrize =
    options.mode === "model" &&
    options.symmetrize === true;

  const voxels = shiftToCenter(
    shouldSymmetrize
      ? symmetrizeX(raw)
      : raw,
    options.volumeSize
  );

  return {
    voxels,
    palette,
    width: w,
    height: h,
    count: raw.length
  };
}
```
