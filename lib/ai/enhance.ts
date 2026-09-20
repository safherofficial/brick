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
      out[y * dstW + x] =
        a * (1 - fx) * (1 - fy) +
        b * fx * (1 - fy) +
        c * (1 - fx) * fy +
        d * fx * fy;
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
      if (attached) {
        out[index] = Math.max(
          value,
          policy.weakThreshold + (policy.strongThreshold - policy.weakThreshold) * 0.45
        );
      }
    }
  }
  return out;
}

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

/**
 * P17: add a bounded silhouette-derived structural prior to single-view depth.
 * The prior is deliberately soft: MiDaS remains the dominant signal and the
 * silhouette can only steer local thickness where it is well supported.
 */
export function refineDepthToShape(
  depth: Float32Array,
  alpha: Float32Array,
  width: number,
  height: number,
  category?: AiCategory
) {
  if (!depth.length || depth.length !== alpha.length || width <= 1 || height <= 1) return depth;
  if (!category || category === "swords") return depth;

  const policy = SEGMENT_POLICIES[category];
  const mask = new Uint8Array(alpha.length);
  let foreground = 0;
  for (let i = 0; i < alpha.length; i += 1) {
    if ((alpha[i] ?? 0) >= policy.weakThreshold) {
      mask[i] = 1;
      foreground += 1;
    }
  }
  if (foreground < 32) return depth;

  const rowWidth = new Uint16Array(height);
  const colHeight = new Uint16Array(width);
  let maxRow = 1;
  let maxCol = 1;
  const rowMin = new Int16Array(height);
  const rowMax = new Int16Array(height);
  rowMin.fill(width);
  rowMax.fill(-1);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      rowWidth[y] += 1;
      colHeight[x] += 1;
      if (x < rowMin[y]) rowMin[y] = x;
      if (x > rowMax[y]) rowMax[y] = x;
    }
  }
  for (let y = 0; y < height; y += 1) maxRow = Math.max(maxRow, rowWidth[y]);
  for (let x = 0; x < width; x += 1) maxCol = Math.max(maxCol, colHeight[x]);

  const blend = category === "rifles" ? 0.34 : category === "guns" ? 0.30 : 0.25;
  const out = new Float32Array(depth.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const original = clamp(depth[index] ?? 0.5, 0, 1);
      if (!mask[index]) {
        out[index] = original;
        continue;
      }

      const widthSignal = rowWidth[y] / maxRow;
      const heightSignal = colHeight[x] / maxCol;
      const span = Math.max(1, rowMax[y] - rowMin[y]);
      const edgeDistance =
        rowMax[y] < 0
          ? 0
          : Math.min(x - rowMin[y], rowMax[y] - x) / Math.max(1, span * 0.5);
      const edgeSafe = clamp(edgeDistance, 0, 1);

      // Broad silhouette bands are a safer depth prior than isolated pixels.
      // Guns favour horizontal body mass; rifles additionally preserve long,
      // thin runs by giving local column support a smaller but meaningful role.
      const bodySignal = category === "rifles"
        ? widthSignal * 0.62 + heightSignal * 0.38
        : widthSignal * 0.70 + heightSignal * 0.30;
      const shapePrior = clamp(
        0.38 + bodySignal * 0.42 + edgeSafe * 0.20,
        0.24,
        0.88
      );

      // Keep the structural prior centered around 0.5 so it cannot create a
      // global depth bias or flatten the original MiDaS gradient.
      const anchoredPrior = 0.5 + (shapePrior - 0.5) * 0.72;
      out[index] = clamp(
        original * (1 - blend) + anchoredPrior * blend,
        0,
        1
      );
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
  const map = resizeMap(
    normalizeMap(Float32Array.from(plane.map)),
    plane.width,
    plane.height,
    raster.width,
    raster.height
  );
  return { map, size };
}

export type EnhanceDiagnostics = {
  segment: string;
  depth: string;
  segmentSize: string;
};

export async function enhanceRaster(
  raster: AiRaster,
  options: { depth?: boolean; category?: AiCategory } = {}
): Promise<{ raster: AiRaster; depth: Float32Array | null; diagnostics: EnhanceDiagnostics }> {
  const cutout = hasCutoutAlpha(raster);
  const available = await aiAvailable();
  const wantSegment = Boolean(available.segment) && !cutout;
  const wantDepth = options.depth === true && Boolean(available.depth);
  let segmentStatus = cutout ? "cutout" : "skip";
  let depthStatus = "skip";
  let segmentSize = "-";

  if (!wantSegment && !wantDepth) {
    return {
      raster,
      depth: null,
      diagnostics: { segment: segmentStatus, depth: depthStatus, segmentSize }
    };
  }

  const next: AiRaster = {
    width: raster.width,
    height: raster.height,
    rgba: new Uint8ClampedArray(raster.rgba)
  };
  let foregroundAlpha: Float32Array | null = null;

  if (wantSegment) {
    const segmentResult = await runMap("segment", raster);
    if (segmentResult) {
      segmentSize = `${segmentResult.size.width}×${segmentResult.size.height}`;
      foregroundAlpha = refineSegmentAlpha(
        segmentResult.map,
        raster.width,
        raster.height,
        options.category
      );
      let kept = 0;
      for (let i = 0; i < foregroundAlpha.length; i += 1) {
        if (foregroundAlpha[i] >= 0.08) kept += 1;
      }
      if (kept >= raster.width * raster.height * 0.01) {
        for (let i = 0; i < foregroundAlpha.length; i += 1) {
          next.rgba[i * 4 + 3] = clamp(Math.round(foregroundAlpha[i] * 255), 0, 255);
        }
        segmentStatus = "ok";
      } else {
        segmentStatus = "weak";
      }
    } else {
      segmentStatus = "fail";
    }
  } else if (cutout) {
    foregroundAlpha = new Float32Array(raster.width * raster.height);
    for (let i = 0; i < foregroundAlpha.length; i += 1) {
      foregroundAlpha[i] = raster.rgba[i * 4 + 3] / 255;
    }
  }

  let rawDepth: Float32Array | null = null;
  if (wantDepth) {
    const depthResult = await runMap("depth", raster);
    if (depthResult) {
      rawDepth = depthResult.map;
      depthStatus = "ok";
    } else {
      depthStatus = "fail";
    }
  }

  let depth = rawDepth && foregroundAlpha
    ? normalizeDepthToForeground(rawDepth, foregroundAlpha, options.category)
    : rawDepth;

  // P17 is deliberately downstream of MiDaS normalization. This keeps the
  // existing model signal and adds only a bounded silhouette-aware correction.
  if (depth && foregroundAlpha && options.category) {
    depth = refineDepthToShape(
      depth,
      foregroundAlpha,
      raster.width,
      raster.height,
      options.category
    );
  }

  return {
    raster: next,
    depth,
    diagnostics: { segment: segmentStatus, depth: depthStatus, segmentSize }
  };
}
