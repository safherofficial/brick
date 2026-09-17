import type { StyleId } from "@/lib/ai/styleProfiles";

export type ShapeKind =
  | "sphere"
  | "cylinder"
  | "cone"
  | "barrel"
  | "capsule"
  | "sword"
  | "axe"
  | "bottle"
  | "tile"
  | "character"
  | "prop";

export type ShapeGuess = {
  kind: ShapeKind;
  style: StyleId;
  confidence: number;
};

function maskStats(mask: boolean[][]) {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  let hits = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  const rowW = new Array<number>(h).fill(0);

  for (let y = 0; y < h; y += 1) {
    let lo = w;
    let hi = -1;
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      hits += 1;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    rowW[y] = hi >= 0 ? hi - lo + 1 : 0;
  }

  const bw = Math.max(1, maxX - minX + 1);
  const bh = Math.max(1, maxY - minY + 1);
  const mid = minX + bw / 2;
  let same = 0;
  let checked = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const mx = Math.round(mid * 2 - x);
      if (mx < 0 || mx >= w) continue;
      checked += 1;
      if (Boolean(mask[y][x]) === Boolean(mask[y][mx])) same += 1;
    }
  }

  const live = rowW.filter((n) => n > 0);
  const widths = live.slice().sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] ?? 1;
  const maxRow = widths[widths.length - 1] ?? 1;
  const mean = live.length ? live.reduce((a, b) => a + b, 0) / live.length : 1;
  const variance =
    live.length < 2
      ? 0
      : live.reduce((a, v) => a + (v - mean) * (v - mean), 0) / live.length;
  const cv = mean > 1e-6 ? Math.sqrt(variance) / mean : 1;

  const midW = live[Math.floor(live.length / 2)] ?? mean;
  const endW = ((live[0] ?? 0) + (live[live.length - 1] ?? 0)) / 2;
  const bulge = endW > 1e-6 ? midW / endW : 1;
  const first = live[0] ?? 1;
  const last = live[live.length - 1] ?? 1;
  const taper = Math.min(first, last) / Math.max(1, Math.max(first, last));

  return {
    hits,
    fill: hits / (bw * bh),
    aspect: bh / bw,
    slenderness: Math.max(bw, bh) / Math.min(bw, bh),
    symmetry: checked ? same / checked : 0,
    head: maxRow / Math.max(1, median),
    cv,
    bulge,
    taper
  };
}

export function recognizeFromMask(mask: boolean[][]): ShapeGuess {
  const s = maskStats(mask);
  if (s.hits < 24) return { kind: "prop", style: "prop", confidence: 0.2 };

  if (
    s.aspect >= 0.78 &&
    s.aspect <= 1.28 &&
    s.fill >= 0.66 &&
    s.fill <= 0.87 &&
    s.symmetry >= 0.7
  ) {
    return { kind: "sphere", style: "pickup", confidence: 0.9 };
  }

  if (
    s.aspect >= 1.12 &&
    s.aspect <= 2.6 &&
    s.fill >= 0.5 &&
    s.fill <= 0.84 &&
    s.cv <= 0.14 &&
    s.symmetry >= 0.68 &&
    s.bulge < 1.12
  ) {
    return { kind: "cylinder", style: "pickup", confidence: 0.86 };
  }

  if (
    s.aspect >= 1.05 &&
    s.aspect <= 1.9 &&
    s.fill >= 0.48 &&
    s.fill <= 0.82 &&
    s.bulge >= 1.1 &&
    s.symmetry >= 0.66
  ) {
    return { kind: "barrel", style: "prop", confidence: 0.84 };
  }

  if (
    s.aspect >= 1.22 &&
    s.fill >= 0.26 &&
    s.fill <= 0.56 &&
    s.taper <= 0.58 &&
    s.symmetry >= 0.64
  ) {
    return { kind: "cone", style: "pickup", confidence: 0.82 };
  }

  if (
    s.aspect >= 1.3 &&
    s.fill >= 0.3 &&
    s.fill <= 0.64 &&
    s.symmetry >= 0.74 &&
    s.taper >= 0.42 &&
    s.cv <= 0.28
  ) {
    return { kind: "capsule", style: "pickup", confidence: 0.8 };
  }

  if (s.aspect < 1.15 && s.fill >= 0.9) {
    return { kind: "tile", style: "tile", confidence: 0.82 };
  }
  // Landscape photos of firearms (aspect = H/W).
  if (s.aspect <= 0.78 && s.fill >= 0.12 && s.fill <= 0.48 && s.slenderness >= 2.05) {
    return {
      kind: s.slenderness >= 3.15 ? "sword" : "axe",
      style: "weapon",
      confidence: s.slenderness >= 3.15 ? 0.78 : 0.74
    };
  }
  if (s.aspect >= 1.7 && s.fill <= 0.28 && s.slenderness >= 2.4 && s.head < 2.2) {
    return { kind: "sword", style: "weapon", confidence: 0.8 };
  }
  if (s.aspect >= 1.2 && s.head >= 2.3 && s.fill <= 0.42) {
    return { kind: "axe", style: "weapon", confidence: 0.74 };
  }
  if (s.aspect >= 1.35 && s.symmetry >= 0.78 && s.fill >= 0.28 && s.fill <= 0.62) {
    return { kind: "bottle", style: "pickup", confidence: 0.76 };
  }
  if (s.aspect >= 1.6 && s.symmetry >= 0.72 && s.fill >= 0.22 && s.fill <= 0.5) {
    return { kind: "character", style: "character", confidence: 0.7 };
  }
  return { kind: "prop", style: "prop", confidence: 0.55 };
}
