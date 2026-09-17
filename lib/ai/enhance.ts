// lib/ai/enhance.ts
/**
 * Local ONNX enhance: U2Net segment → alpha matte, optional MiDaS depth.
 * Tuned for 2.5D voxel fidelity (sharp silhouettes, less halo, thin-feature safe).
 */
import { aiAvailable, loadModel } from "@/lib/ai/runtime";
import type { AiCategory } from "@/lib/ai/aiCategories";
import { aiCategoryProfile } from "@/lib/ai/aiCategories";

export type AiRaster = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

export type EnhanceOptions = {
  depth?: boolean;
  /** Guides matte hardness / acceptance thresholds. */
  category?: AiCategory;
};

/** Matte refinement knobs (derived from category when present). */
type MatteParams = {
  /** Soft-threshold center for alpha contrast (higher = tighter subject). */
  threshold: number;
  /** Transition width around threshold (lower = harder edge). */
  softness: number;
  /** Min fraction of pixels above soft-high to accept the ONNX map. */
  minKeepRatio: number;
  /** Soft-high used only for the acceptance count. */
  acceptFloor: number;
};

const DEFAULT_MATTE: MatteParams = {
  threshold: 0.42,
  softness: 0.1,
  minKeepRatio: 0.008,
  acceptFloor: 0.32
};

function matteParamsFor(category?: AiCategory): MatteParams {
  if (!category) return DEFAULT_MATTE;
  const p = aiCategoryProfile(category);
  if (p.thinFeatures) {
    // Blades / barrels: keep weak tips, slightly softer acceptance.
    return {
      threshold: 0.38,
      softness: 0.09,
      minKeepRatio: 0.005,
      acceptFloor: 0.28
    };
  }
  // Props: tighter matte, less background bleed.
  return {
    threshold: 0.45,
    softness: 0.08,
    minKeepRatio: 0.01,
    acceptFloor: 0.35
  };
}

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
  // High-quality downscale into model input (better than default when available).
  try {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  } catch {
    /* ignore */
  }
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

/**
 * Smoothstep contrast around threshold → cleaner game-ready matte.
 * Preserves a thin AA band (softness) so thin blades are not hard-clipped.
 */
function refineAlphaMap(alpha: Float32Array, params: MatteParams): Float32Array {
  const lo = clamp(params.threshold - params.softness, 0, 1);
  const hi = clamp(params.threshold + params.softness, 0, 1);
  const span = Math.max(1e-6, hi - lo);
  const out = new Float32Array(alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    const t = clamp((alpha[i] - lo) / span, 0, 1);
    // Smoothstep: 3t² − 2t³
    const s = t * t * (3 - 2 * t);
    out[i] = s;
  }
  return out;
}

/**
 * Mild 3×3 unsharp on alpha after refine — recovers edge acuity lost to
 * model→full bilinear upscale without reintroducing speckles.
 */
function sharpenAlphaMap(alpha: Float32Array, width: number, height: number, amount = 0.35): Float32Array {
  if (width < 3 || height < 3 || amount <= 0) return alpha;
  const out = new Float32Array(alpha.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        out[i] = alpha[i];
        continue;
      }
      const c = alpha[i];
      const blur =
        (alpha[i - 1] +
          alpha[i + 1] +
          alpha[i - width] +
          alpha[i + width] +
          c) /
        5;
      out[i] = clamp(c + (c - blur) * amount, 0, 1);
    }
  }
  return out;
}

/**
 * (2) Joint bilateral-ish refine: smooth alpha only where RGB guide is flat.
 * Keeps hard edges of the subject (guided by luminance of the source raster).
 */
function guidedAlphaRefine(
  alpha: Float32Array,
  raster: AiRaster,
  radius = 1,
  eps = 0.01
): Float32Array {
  const { width: w, height: h, rgba } = raster;
  if (w < 3 || h < 3) return alpha;
  const guide = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    guide[i] = (0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) / 255;
  }
  const out = new Float32Array(alpha.length);
  const r = Math.max(1, radius);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      let sumA = 0;
      let sumG = 0;
      let sumAG = 0;
      let sumGG = 0;
      let n = 0;
      for (let oy = -r; oy <= r; oy += 1) {
        for (let ox = -r; ox <= r; ox += 1) {
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          const g = guide[j];
          const a = alpha[j];
          sumA += a;
          sumG += g;
          sumAG += a * g;
          sumGG += g * g;
          n += 1;
        }
      }
      const inv = 1 / Math.max(1, n);
      const meanA = sumA * inv;
      const meanG = sumG * inv;
      const covAG = sumAG * inv - meanA * meanG;
      const varG = sumGG * inv - meanG * meanG;
      const A = covAG / (varG + eps);
      const B = meanA - A * meanG;
      out[i] = clamp(A * guide[i] + B, 0, 1);
    }
  }
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
  // Slightly stricter mid cap → prefer ONNX re-matte when alpha is mushy.
  return transparent / total >= 0.08 && opaque / total >= 0.08 && mid / total <= 0.14;
}

async function runMap(id: "segment" | "depth", raster: AiRaster) {
  const session = await loadModel(id);
  if (!session) return null;
  const ort = await import("onnxruntime-web");
  const inputName = session.inputNames[0];
  const dims = session.inputMetadata?.[inputName]?.dims;
  // (4) Prefer higher segment resolution when the model allows (cap 512 for WASM).
  let fallback = id === "segment" ? 320 : 256;
  if (id === "segment") {
    const edge = Math.max(raster.width, raster.height);
    const dyn = dims?.[2] === -1 || dims?.[3] === -1 || dims?.[2] === 0 || dims?.[3] === 0;
    if (dyn || !dims?.[2] || !dims?.[3]) {
      fallback = Math.min(512, Math.max(320, edge));
    } else {
      const fixed = Math.max(Number(dims[2]) || 0, Number(dims[3]) || 0);
      fallback = fixed > 0 ? fixed : 320;
    }
  }
  const size = modelSize(dims, fallback);
  // Hard cap — large tensors hurt ort-wasm on low-end devices.
  const cap = id === "segment" ? 512 : 384;
  const width = Math.min(cap, size.width);
  const height = Math.min(cap, size.height);
  const tensor = new ort.Tensor("float32", toNchw(raster, width, height, true), [
    1,
    3,
    height,
    width
  ]);
  const result = await session.run({ [inputName]: tensor });
  const output = result[session.outputNames[0]] as unknown as {
    dims: readonly number[];
    data: Float32Array;
  };
  const plane = planeFromOutput(output.data, output.dims);
  return resizeMap(
    normalizeMap(Float32Array.from(plane.map)),
    plane.width,
    plane.height,
    raster.width,
    raster.height
  );
}

export async function enhanceRaster(raster: AiRaster, options: EnhanceOptions = {}) {
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

  const matte = matteParamsFor(options.category);

  if (wantSegment) {
    const raw = await runMap("segment", raster);
    if (raw) {
      let kept = 0;
      for (let i = 0; i < raw.length; i += 1) if (raw[i] >= matte.acceptFloor) kept += 1;
      if (kept >= raster.width * raster.height * matte.minKeepRatio) {
        let alpha = refineAlphaMap(raw, matte);
        alpha = guidedAlphaRefine(alpha, raster, 1, 0.012);
        alpha = sharpenAlphaMap(alpha, raster.width, raster.height, 0.28);
        for (let i = 0; i < alpha.length; i += 1) {
          // Near-binary write: crush residual haze outside the soft band.
          const a = alpha[i];
          const byte =
            a <= 0.04 ? 0 : a >= 0.96 ? 255 : clamp(Math.round(a * 255), 0, 255);
          next.rgba[i * 4 + 3] = byte;
        }
      }
    }
  }

  const depth = wantDepth ? await runMap("depth", raster) : null;
  return { raster: next, depth };
}
