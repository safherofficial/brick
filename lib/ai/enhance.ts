// lib/ai/enhance.ts
import type { AiCategory } from "@/lib/ai/aiCategories";
import { aiAvailable, loadModel } from "@/lib/ai/runtime";

export type AiRaster = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

type SegmentationPolicy = {
  strongThreshold: number;
  weakThreshold: number;
  preserveRadius: number;
};

/**
 * Category-aware local-AI matte policy.
 * Thin weapon features get a lower weak threshold so small blades/barrels are
 * not discarded before voxel reconstruction. Generic props keep a stricter
 * threshold to avoid background spill. The existing model mask cleanup still
 * removes detached noise after this pass.
 */
const SEGMENT_POLICIES: Record<AiCategory, SegmentationPolicy> = {
  swords: { strongThreshold: 0.30, weakThreshold: 0.12, preserveRadius: 2 },
  guns: { strongThreshold: 0.38, weakThreshold: 0.16, preserveRadius: 2 },
  rifles: { strongThreshold: 0.34, weakThreshold: 0.14, preserveRadius: 2 },
  objects: { strongThreshold: 0.44, weakThreshold: 0.22, preserveRadius: 1 }
};

const DEFAULT_SEGMENT_POLICY: SegmentationPolicy = SEGMENT_POLICIES.objects;

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

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1))));
  return sorted[index];
}

/**
 * Hysteresis-style alpha refinement: preserve strong foreground, retain weak
 * alpha only when it is spatially attached to confident foreground. This is
 * intentionally category-aware and remains deterministic.
 */
export function refineSegmentAlpha(
  alpha: Float32Array,
  width: number,
  height: number,
  category?: AiCategory
) {
  if (!alpha.length || width <= 0 || height <= 0) return alpha;
  const policy = category ? SEGMENT_POLICIES[category] : DEFAULT_SEGMENT_POLICY;
  const strong = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    if (alpha[i] >= policy.strongThreshold) strong[i] = 1;
  }

  const out = new Float32Array(alpha.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = clamp(alpha[index] ?? 0, 0, 1);
      if (value >= policy.strongThreshold) {
        out[index] = value;
        continue;
      }
      if (value < policy.weakThreshold) continue;
      let attached = false;
      for (let dy = -policy.preserveRadius; dy <= policy.preserveRadius && !attached; dy += 1) {
        for (let dx = -policy.preserveRadius; dx <= policy.preserveRadius; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (strong[ny * width + nx]) {
            attached = true;
            break;
          }
        }
      }
      if (attached) out[index] = Math.max(value, policy.weakThreshold + (policy.strongThreshold - policy.weakThreshold) * 0.45);
    }
  }
  return out;
}

/**
 * Re-normalize MiDaS using the foreground support instead of the full image.
 * The robust foreground percentiles prevent bright/dark backgrounds from
 * consuming most of the usable depth range. A conservative blend keeps the
 * original model signal so this remains a refinement, not a new depth model.
 */
export function normalizeDepthToForeground(
  depth: Float32Array,
  alpha: Float32Array,
  category?: AiCategory
) {
  if (!depth.length || depth.length !== alpha.length) return depth;
  const policy = category ? SEGMENT_POLICIES[category] : DEFAULT_SEGMENT_POLICY;
  const values: number[] = [];
  for (let i = 0; i < depth.length; i += 1) {
    if ((alpha[i] ?? 0) >= policy.weakThreshold) values.push(depth[i]);
  }
  const coverage = values.length / Math.max(1, depth.length);
  if (values.length < 32 || coverage < 0.03 || coverage > 0.96) return depth;
  values.sort((a, b) => a - b);
  const low = quantile(values, 0.08);
  const high = quantile(values, 0.92);
  const span = Math.max(1e-5, high - low);
  const blend = category === "rifles" || category === "guns" ? 0.72 : category === "objects" ? 0.62 : 0.5;
  const out = new Float32Array(depth.length);
  for (let i = 0; i < depth.length; i += 1) {
    const original = clamp(depth[i] ?? 0.5, 0, 1);
    if ((alpha[i] ?? 0) < policy.weakThreshold) {
      out[i] = original;
      continue;
    }
    const local = clamp((original - low) / span, 0, 1);
    out[i] = original * (1 - blend) + local * blend;
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

export async function enhanceRaster(
  raster: AiRaster,
  options: { depth?: boolean; category?: AiCategory } = {}
) {
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

  let foregroundAlpha: Float32Array | null = null;
  if (wantSegment) {
    const alpha = await runMap("segment", raster);
    if (alpha) {
      foregroundAlpha = refineSegmentAlpha(alpha, raster.width, raster.height, options.category);
      let kept = 0;
      for (let i = 0; i < foregroundAlpha.length; i += 1) {
        if (foregroundAlpha[i] >= 0.08) kept += 1;
      }
      if (kept >= raster.width * raster.height * 0.01) {
        for (let i = 0; i < foregroundAlpha.length; i += 1) {
          next.rgba[i * 4 + 3] = clamp(Math.round(foregroundAlpha[i] * 255), 0, 255);
        }
      }
    }
  } else if (cutout) {
    foregroundAlpha = new Float32Array(raster.width * raster.height);
    for (let i = 0; i < foregroundAlpha.length; i += 1) {
      foregroundAlpha[i] = raster.rgba[i * 4 + 3] / 255;
    }
  }

  const rawDepth = wantDepth ? await runMap("depth", raster) : null;
  const depth = rawDepth && foregroundAlpha
    ? normalizeDepthToForeground(rawDepth, foregroundAlpha, options.category)
    : rawDepth;

  return { raster: next, depth };
}
