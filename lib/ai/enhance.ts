// lib/ai/enhance.ts
import { aiAvailable, loadModel } from "@/lib/ai/runtime";

export type AiRaster = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function modelSize(dims: readonly number[] | undefined, fallback: number) {
  const w = dims?.[3] && dims[3] > 0 ? dims[3] : fallback;
  const h = dims?.[2] && dims[2] > 0 ? dims[2] : fallback;
  return { width: Number(w), height: Number(h) };
}

function rasterToCanvas(raster: AiRaster) {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const image = ctx.createImageData(raster.width, raster.height);
  image.data.set(raster.rgba);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function toNchw(raster: AiRaster, width: number, height: number, imagenet: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(rasterToCanvas(raster), 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const plane = width * height;
  const data = new Float32Array(3 * plane);
  const mean = imagenet ? [0.485, 0.456, 0.406] : [0, 0, 0];
  const std = imagenet ? [0.229, 0.224, 0.225] : [1, 1, 1];
  for (let i = 0; i < plane; i += 1) {
    data[i] = (pixels[i * 4] / 255 - mean[0]) / std[0];
    data[plane + i] = (pixels[i * 4 + 1] / 255 - mean[1]) / std[1];
    data[plane * 2 + i] = (pixels[i * 4 + 2] / 255 - mean[2]) / std[2];
  }
  return data;
}

function planeFromOutput(data: Float32Array, dims: readonly number[]) {
  if (dims.length === 4) {
    const h = Number(dims[2]);
    const w = Number(dims[3]);
    const channels = Number(dims[1]);
    const start = Math.max(0, channels - 1) * h * w;
    return { map: data.subarray(start, start + h * w), width: w, height: h };
  }
  if (dims.length === 3) {
    return { map: data, width: Number(dims[2]), height: Number(dims[1]) };
  }
  const side = Math.max(1, Math.round(Math.sqrt(data.length)));
  return { map: data, width: side, height: side };
}

function resizeMap(src: Float32Array, srcW: number, srcH: number, dstW: number, dstH: number) {
  const out = new Float32Array(dstW * dstH);
  for (let y = 0; y < dstH; y += 1) {
    const sy = ((y + 0.5) * srcH) / dstH - 0.5;
    const y0 = clamp(Math.floor(sy), 0, srcH - 1);
    const y1 = clamp(y0 + 1, 0, srcH - 1);
    const fy = sy - y0;
    for (let x = 0; x < dstW; x += 1) {
      const sx = ((x + 0.5) * srcW) / dstW - 0.5;
      const x0 = clamp(Math.floor(sx), 0, srcW - 1);
      const x1 = clamp(x0 + 1, 0, srcW - 1);
      const fx = sx - x0;
      const a = src[y0 * srcW + x0];
      const b = src[y0 * srcW + x1];
      const c = src[y1 * srcW + x0];
      const d = src[y1 * srcW + x1];
      out[y * dstW + x] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    }
  }
  return out;
}

function normalizeMap(values: Float32Array) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = Math.max(1e-6, max - min);
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = (values[i] - min) / span;
  return out;
}

export function hasCutoutAlpha(raster: AiRaster) {
  const total = raster.width * raster.height;
  if (!total) return false;
  let transparent = 0;
  let opaque = 0;
  let mid = 0;
  for (let i = 3; i < raster.rgba.length; i += 4) {
    const a = raster.rgba[i];
    if (a < 12) transparent += 1;
    else if (a >= 240) opaque += 1;
    else mid += 1;
  }
  return transparent / total >= 0.08 && opaque / total >= 0.08 && mid / total <= 0.18;
}

async function runMap(id: "segment" | "depth", raster: AiRaster) {
  const session = await loadModel(id);
  if (!session) return null;
  const ort = await import("onnxruntime-web");
  const inputName = session.inputNames[0];
  const dims = session.inputMetadata?.[inputName]?.dims;
  const size = modelSize(dims, id === "segment" ? 320 : 256);
  const tensor = new ort.Tensor("float32", toNchw(raster, size.width, size.height, true), [
    1,
    3,
    size.height,
    size.width
  ]);
  const result = await session.run({ [inputName]: tensor });
  const output = result[session.outputNames[0]] as unknown as {
    dims: readonly number[];
    data: Float32Array;
  };
  const plane = planeFromOutput(output.data, output.dims);
  return resizeMap(normalizeMap(Float32Array.from(plane.map)), plane.width, plane.height, raster.width, raster.height);
}

export async function enhanceRaster(raster: AiRaster, options: { depth?: boolean } = {}) {
  const cutout = hasCutoutAlpha(raster);
  const available = await aiAvailable();
  const wantSegment = Boolean(available.segment) && !cutout;
  const wantDepth = options.depth === true && Boolean(available.depth);
  if (!wantSegment && !wantDepth) {
    return { raster, depth: null as Float32Array | null };
  }

  const next: AiRaster = {
    width: raster.width,
    height: raster.height,
    rgba: new Uint8ClampedArray(raster.rgba)
  };

  if (wantSegment) {
    const alpha = await runMap("segment", raster);
    if (alpha) {
      let kept = 0;
      for (let i = 0; i < alpha.length; i += 1) if (alpha[i] >= 0.35) kept += 1;
      if (kept >= raster.width * raster.height * 0.01) {
        for (let i = 0; i < alpha.length; i += 1) {
          next.rgba[i * 4 + 3] = clamp(Math.round(alpha[i] * 255), 0, 255);
        }
      }
    }
  }

  const depth = wantDepth ? await runMap("depth", raster) : null;
  return { raster: next, depth };
}
