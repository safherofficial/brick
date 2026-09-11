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

function nearestIndex(r: number, g: number, b: number, colors: [number, number, number][]) {
  let best = 0;
  let dist = Infinity;
  for (let i = 0; i < colors.length; i++) {
    const [pr, pg, pb] = colors[i];
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

function quantize(unique: number[], maxColors: number) {
  if (unique.length <= maxColors) return unique.map((n) => unpack(n));
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const shift = unique.length > 1024 ? 3 : 2;
  for (const p of unique) {
    const [r, g, b] = unpack(p);
    const key = pack(r >> shift, g >> shift, b >> shift);
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cur.n += 1;
    cur.r += r;
    cur.g += g;
    cur.b += b;
    buckets.set(key, cur);
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, maxColors)
    .map((c) => [Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)] as [number, number, number]);
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

function knockFringe(mask: Uint8Array, data: Uint8ClampedArray, w: number, h: number) {
  const next = new Uint8Array(mask);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const a = data[i * 4 + 3];
      if (a >= 250) continue;
      let empty = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) empty++;
        }
      }
      if (empty >= 2) next[i] = 0;
    }
  }
  mask.set(next);
}

function dropIslands(mask: Uint8Array, w: number, h: number, minSize: number) {
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
    if (cells.length < minSize) for (const i of cells) mask[i] = 0;
  }
}

function floodBackdrop(data: Uint8ClampedArray, mask: Uint8Array, w: number, h: number) {
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) opaque++;
  if (opaque / (w * h) < 0.97) return;

  const corners = [0, w - 1, (h - 1) * w, h * w - 1];
  const samples = corners.map((i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  const [cr, cg, cb] = samples[0];
  const similar = samples.every(([r, g, b]) => (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2 < 900);
  if (!similar) return;

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
    if ((r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2 >= 1400) continue;
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
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let best = d[i];
      if (x > 0) best = Math.min(best, d[i - 1] + 1);
      if (y > 0) best = Math.min(best, d[i - w] + 1);
      if (x > 0 && y > 0) best = Math.min(best, d[i - w - 1] + 1.414);
      if (x + 1 < w && y > 0) best = Math.min(best, d[i - w + 1] + 1.414);
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
      if (x + 1 < w && y + 1 < h) best = Math.min(best, d[i + w + 1] + 1.414);
      if (x > 0 && y + 1 < h) best = Math.min(best, d[i + w - 1] + 1.414);
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

function depthRadius(mode: ImageMode, luma: number, fieldT: number, depthMax: number) {
  if (mode === "flat") return 0;
  if (mode === "solid") return Math.max(2, Math.floor(depthMax / 2));
  if (mode === "relief") return Math.max(1, Math.round((0.35 + luma * 0.65) * Math.max(2, depthMax / 2)));
  return Math.max(2, Math.round(Math.pow(fieldT, 0.72) * Math.max(3, depthMax)));
}

export async function imageToVoxels(
  file: File,
  options: {
    volumeSize: number;
    mode: ImageMode;
    heightMax: number;
    maxEdge?: number;
    maxVoxels?: number;
  }
): Promise<ImageImport> {
  const img = await loadImage(file);
  const maxEdge = Math.min(options.maxEdge ?? 128, options.volumeSize);
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height, 1));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2d context");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] >= 28) mask[i] = 1;
  }
  floodBackdrop(data, mask, w, h);
  knockFringe(mask, data, w, h);
  dropIslands(mask, w, h, 10);

  const unique = new Set<number>();
  let visible = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    visible += 1;
    unique.add(pack(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]));
  }
  if (!visible) throw new Error("Empty image");

  const colors = quantize([...unique], 256);
  const palette = Array.from({ length: 256 }, (_, i) => (colors[i] ? hexOf(...colors[i]) : "#000000"));

  const field = blurField(distanceField(mask, w, h), w, h);
  let fieldMax = 1;
  for (let i = 0; i < field.length; i++) if (field[i] > fieldMax) fieldMax = field[i];

  const depthMax = Math.max(4, Math.min(options.heightMax, 28, Math.floor(options.volumeSize / 3)));
  const cap = options.maxVoxels ?? 140_000;

  const ox = Math.floor((options.volumeSize - w) / 2);
  const midZ = Math.floor(options.volumeSize / 2);
  const voxels: ImageVoxel[] = [];

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = py * w + px;
      if (!mask[i]) continue;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const c = nearestIndex(r, g, b, colors);
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const t = Math.sqrt(field[i] / fieldMax);
      const radius = depthRadius(options.mode, luma, t, depthMax);
      const x = ox + px;
      const y = h - 1 - py;
      if (x < 0 || y < 0 || x >= options.volumeSize || y >= options.volumeSize) continue;
      for (let dz = -radius; dz <= radius; dz++) {
        const z = midZ + dz;
        if (z < 0 || z >= options.volumeSize) continue;
        const norm = radius === 0 ? 0 : Math.abs(dz) / (radius + 0.001);
        if (options.mode === "model" && norm * norm + (1 - t) * 0.15 > 1.02) continue;
        voxels.push({ x, y, z, c });
        if (voxels.length > cap) throw new Error("Image too dense");
      }
    }
  }

  return { voxels, palette, width: w, height: h, count: voxels.length };
}
