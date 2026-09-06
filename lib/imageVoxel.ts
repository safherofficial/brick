import type { Cell } from "@/lib/voxelEngine";

export type ImageMode = "flat" | "extrude";

export type ImageVoxel = Cell & { c: number };

export type ImageImport = {
  voxels: ImageVoxel[];
  palette: string[];
  width: number;
  height: number;
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
      (r - pr) * (r - pr) + (g - pg) * (g - pg) + (b - pb) * (b - pb);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

function quantize(unique: number[], maxColors: number) {
  if (unique.length <= maxColors) {
    return unique.map((n) => unpack(n));
  }
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
  const ranked = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, maxColors)
    .map((c) =>
      [
        Math.round(c.r / c.n),
        Math.round(c.g / c.n),
        Math.round(c.b / c.n)
      ] as [number, number, number]
    );
  return ranked;
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

export async function imageToVoxels(
  file: File,
  options: {
    volumeSize: number;
    mode: ImageMode;
    heightMax: number;
    maxEdge?: number;
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

  const unique = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue;
    unique.add(pack(data[i], data[i + 1], data[i + 2]));
  }
  const colors = quantize([...unique], 256);
  const palette = Array.from({ length: 256 }, (_, i) =>
    colors[i] ? hexOf(...colors[i]) : "#000000"
  );

  const ox = Math.floor((options.volumeSize - w) / 2);
  const oz = Math.floor((options.volumeSize - h) / 2);
  const heightMax = Math.max(1, Math.min(options.heightMax, options.volumeSize));
  const voxels: ImageVoxel[] = [];

  for (let pz = 0; pz < h; pz++) {
    for (let px = 0; px < w; px++) {
      const i = (pz * w + px) * 4;
      if (data[i + 3] < 16) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const c = nearestIndex(r, g, b, colors);
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) * (data[i + 3] / 255);
      const tall =
        options.mode === "flat"
          ? 1
          : Math.max(1, Math.round((luma / 255) * heightMax));
      const x = ox + px;
      const z = oz + (h - 1 - pz);
      for (let y = 0; y < tall; y++) voxels.push({ x, y, z, c });
    }
  }

  return { voxels, palette, width: w, height: h };
}
