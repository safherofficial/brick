export type RevolveKind = "sphere" | "cylinder" | "cone" | "barrel" | "capsule";
export type RevolveAxis = "y" | "x";

export type RevolveGuess = {
  kind: RevolveKind;
  axis: RevolveAxis;
  confidence: number;
};

type Span = { lo: number; hi: number; mid: number; radius: number };

function spansAlong(
  mask: boolean[][],
  major: number,
  minor: number,
  read: (major: number, minor: number) => boolean
): Span[] {
  const out: Span[] = [];
  for (let i = 0; i < major; i += 1) {
    let lo = minor;
    let hi = -1;
    for (let j = 0; j < minor; j += 1) {
      if (!read(i, j)) continue;
      lo = Math.min(lo, j);
      hi = Math.max(hi, j);
    }
    if (hi < 0) {
      out.push({ lo: 0, hi: -1, mid: (minor - 1) / 2, radius: 0 });
      continue;
    }
    out.push({
      lo,
      hi,
      mid: (lo + hi) / 2,
      radius: (hi - lo + 1) / 2
    });
  }
  return out;
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((a, v) => a + (v - m) * (v - m), 0) / values.length;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function linReg(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 3) return { slope: 0, r2: 0 };
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
    ssTot += (ys[i] - my) * (ys[i] - my);
  }
  const slope = den > 1e-6 ? num / den : 0;
  let ssRes = 0;
  for (let i = 0; i < n; i += 1) {
    const pred = my + slope * (xs[i] - mx);
    ssRes += (ys[i] - pred) * (ys[i] - pred);
  }
  const r2 = ssTot > 1e-6 ? 1 - ssRes / ssTot : 0;
  return { slope, r2: clamp(r2, 0, 1) };
}

function symmetryScore(mask: boolean[][], h: number, w: number, axis: RevolveAxis) {
  let same = 0;
  let checked = 0;
  if (axis === "y") {
    const mid = (w - 1) / 2;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const mx = Math.round(mid * 2 - x);
        if (mx < 0 || mx >= w) continue;
        checked += 1;
        if (Boolean(mask[y][x]) === Boolean(mask[y][mx])) same += 1;
      }
    }
  } else {
    const mid = (h - 1) / 2;
    for (let y = 0; y < h; y += 1) {
      const my = Math.round(mid * 2 - y);
      if (my < 0 || my >= h) continue;
      for (let x = 0; x < w; x += 1) {
        checked += 1;
        if (Boolean(mask[y][x]) === Boolean(mask[my][x])) same += 1;
      }
    }
  }
  return checked ? same / checked : 0;
}

function circularFit(radii: number[]) {
  const live = radii.map((r, i) => ({ r, i })).filter((s) => s.r > 0);
  if (live.length < 4) return 0;
  const i0 = live[0].i;
  const i1 = live[live.length - 1].i;
  const cy = (i0 + i1) / 2;
  const R = Math.max(...live.map((s) => s.r), (i1 - i0 + 1) / 2);
  if (R < 1) return 0;
  let err = 0;
  let n = 0;
  for (const s of live) {
    const expected = Math.sqrt(Math.max(0, R * R - (s.i - cy) * (s.i - cy)));
    err += Math.abs(s.r - expected);
    n += 1;
  }
  return clamp(1 - err / (n * Math.max(1, R)), 0, 1);
}

export function guessRevolve(mask: boolean[][]): RevolveGuess | null {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  if (h < 6 || w < 6) return null;

  let hits = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      hits += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (hits < 32) return null;

  const bw = Math.max(1, maxX - minX + 1);
  const bh = Math.max(1, maxY - minY + 1);
  const fill = hits / (bw * bh);
  const aspect = bh / bw;
  if (fill < 0.34 || fill > 0.97) return null;

  const rowSpans = spansAlong(mask, h, w, (y, x) => Boolean(mask[y]?.[x]));
  const colSpans = spansAlong(mask, w, h, (x, y) => Boolean(mask[y]?.[x]));
  const rowR = rowSpans.map((s) => s.radius).filter((r) => r > 0);
  const colR = colSpans.map((s) => s.radius).filter((r) => r > 0);
  if (rowR.length < 4 || colR.length < 4) return null;

  const rowCv = Math.sqrt(variance(rowR)) / Math.max(0.5, mean(rowR));
  const colCv = Math.sqrt(variance(colR)) / Math.max(0.5, mean(colR));
  const ySym = symmetryScore(mask, h, w, "y");
  const xSym = symmetryScore(mask, h, w, "x");
  const circY = circularFit(rowSpans.map((s) => s.radius));
  const circX = circularFit(colSpans.map((s) => s.radius));

  const xs = rowR.map((_, i) => i / Math.max(1, rowR.length - 1));
  const taper = linReg(xs, rowR);
  const first = mean(rowR.slice(0, Math.max(2, Math.floor(rowR.length * 0.22))));
  const last = mean(rowR.slice(Math.floor(rowR.length * 0.78)));
  const mid = mean(rowR.slice(Math.floor(rowR.length * 0.36), Math.ceil(rowR.length * 0.64)));
  const taperRatio = Math.min(first, last) / Math.max(1e-3, Math.max(first, last));
  const bulge = mid / Math.max(1e-3, (first + last) * 0.5);

  if (
    aspect >= 0.78 &&
    aspect <= 1.28 &&
    fill >= 0.58 &&
    fill <= 0.9 &&
    Math.max(circY, circX) >= 0.78 &&
    Math.max(ySym, xSym) >= 0.8
  ) {
    return {
      kind: "sphere",
      axis: "y",
      confidence: 0.5 + 0.5 * Math.max(circY, circX)
    };
  }

  if (ySym >= 0.76 && taper.r2 >= 0.72 && taperRatio <= 0.62 && aspect >= 0.9) {
    return { kind: "cone", axis: "y", confidence: 0.55 + 0.4 * taper.r2 };
  }

  if (ySym >= 0.74 && aspect >= 1.35 && rowCv <= 0.38 && taperRatio <= 0.72 && bulge < 1.18) {
    return { kind: "capsule", axis: "y", confidence: 0.78 };
  }

  if (xSym >= 0.74 && aspect <= 0.74 && colCv <= 0.38) {
    return { kind: "capsule", axis: "x", confidence: 0.76 };
  }

  if (
    ySym >= 0.76 &&
    aspect >= 1.05 &&
    aspect <= 2.4 &&
    bulge >= 1.08 &&
    bulge <= 1.45 &&
    rowCv <= 0.28
  ) {
    return { kind: "barrel", axis: "y", confidence: 0.8 };
  }

  if (ySym >= 0.78 && aspect >= 1.12 && rowCv <= 0.16 && fill >= 0.42) {
    return { kind: "cylinder", axis: "y", confidence: 0.84 };
  }

  if (xSym >= 0.78 && aspect <= 0.82 && colCv <= 0.16 && fill >= 0.42) {
    return { kind: "cylinder", axis: "x", confidence: 0.82 };
  }

  return null;
}

function smoothRadii(values: number[], kind: RevolveKind): number[] {
  if (kind === "cylinder") {
    const live = values.filter((v) => v > 0);
    const sorted = live.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] ?? 1;
    return values.map((v) => (v > 0 ? med : 0));
  }

  if (kind === "sphere") {
    const liveIdx = values.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
    const i0 = liveIdx[0] ?? 0;
    const i1 = liveIdx[liveIdx.length - 1] ?? values.length - 1;
    const cy = (i0 + i1) / 2;
    const R = Math.max((i1 - i0) / 2, ...values);
    return values.map((_, i) => {
      const d = i - cy;
      const r = Math.sqrt(Math.max(0, R * R - d * d));
      return r > 0.35 ? r : 0;
    });
  }

  if (kind === "cone") {
    const live = values.map((v, i) => ({ v, i })).filter((s) => s.v > 0);
    if (live.length < 3) return values;
    const xs = live.map((s) => s.i);
    const ys = live.map((s) => s.v);
    const fit = linReg(xs, ys);
    const mx = mean(xs);
    const my = mean(ys);
    return values.map((v, i) => {
      if (v <= 0) return 0;
      return Math.max(0.5, my + fit.slope * (i - mx));
    });
  }

  const out = values.slice();
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] <= 0) continue;
    let acc = 0;
    let n = 0;
    for (let k = -2; k <= 2; k += 1) {
      const j = i + k;
      if (j < 0 || j >= values.length || values[j] <= 0) continue;
      acc += values[j];
      n += 1;
    }
    out[i] = n ? acc / n : values[i];
  }
  return out;
}

export function radiiForMask(
  mask: boolean[][],
  guess: RevolveGuess
): {
  radii: number[];
  center: number;
  major: number;
  minor: number;
} {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;

  if (guess.axis === "y") {
    const spans = spansAlong(mask, h, w, (y, x) => Boolean(mask[y]?.[x]));
    const live = spans.filter((s) => s.radius > 0);
    return {
      radii: smoothRadii(
        spans.map((s) => s.radius),
        guess.kind
      ),
      center: mean(live.map((s) => s.mid)),
      major: h,
      minor: w
    };
  }

  const spans = spansAlong(mask, w, h, (x, y) => Boolean(mask[y]?.[x]));
  const live = spans.filter((s) => s.radius > 0);
  return {
    radii: smoothRadii(
      spans.map((s) => s.radius),
      guess.kind
    ),
    center: mean(live.map((s) => s.mid)),
    major: w,
    minor: h
  };
}
export type RevolveProfile = {
  radii: number[];
  center: number;
  major: number;
  minor: number;
};

export function estimateRevolveCount(radii: number[]) {
  let n = 0;
  for (const r of radii) {
    if (r <= 0.4) continue;
    n += Math.PI * r * r;
  }
  return n;
}

export function thinPreserveShell<T extends { x: number; y: number; z: number; c: number }>(
  voxels: T[],
  budget: number
): T[] {
  if (voxels.length <= budget) return voxels;

  const key = (v: T) => `${v.x}:${v.y}:${v.z}`;
  const map = new Map(voxels.map((v) => [key(v), v]));
  const surface: T[] = [];
  const interior: T[] = [];

  for (const v of voxels) {
    const exposed =
      !map.has(`${v.x + 1}:${v.y}:${v.z}`) ||
      !map.has(`${v.x - 1}:${v.y}:${v.z}`) ||
      !map.has(`${v.x}:${v.y + 1}:${v.z}`) ||
      !map.has(`${v.x}:${v.y - 1}:${v.z}`) ||
      !map.has(`${v.x}:${v.y}:${v.z + 1}`) ||
      !map.has(`${v.x}:${v.y}:${v.z - 1}`);
    if (exposed) surface.push(v);
    else interior.push(v);
  }

  if (surface.length >= budget) {
    const stride = Math.ceil(surface.length / budget);
    return surface.filter((_, i) => i % stride === 0).slice(0, budget);
  }

  const room = budget - surface.length;
  const stride = Math.max(1, Math.ceil(interior.length / Math.max(1, room)));
  return surface.concat(interior.filter((_, i) => i % stride === 0).slice(0, room));
}
