import type { StyleId } from "@/lib/ai/styleProfiles";
import type { AiCategory } from "@/lib/ai/aiCategories";

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

export type RecognitionEvidence = {
  hits: number;
  fill: number;
  aspect: number;
  slenderness: number;
  symmetry: number;
  taper: number;
  bulge: number;
  widthCv: number;
  edgeThinness: number;
};

export type RecognitionFeatures = {
  thin: boolean;
  long: boolean;
  tapered: boolean;
  symmetric: boolean;
  broadHead: boolean;
  irregular: boolean;
};

export type ShapeGuess = {
  kind: ShapeKind;
  style: StyleId;
  category: AiCategory;
  confidence: number;
  evidence: RecognitionEvidence;
  features: RecognitionFeatures;
};


export type CategoryResolution = {
  category: AiCategory;
  source: "manual" | "auto";
  recognizedCategory: AiCategory;
  recognizedConfidence: number;
  manualOverride: boolean;
};

export const AUTO_CATEGORY_CONFIDENCE = 0.64;

function categoryEvidenceIsConsistent(guess: ShapeGuess): boolean {
  switch (guess.category) {
    case "swords":
      return guess.features.thin && (guess.features.tapered || guess.evidence.aspect >= 1.7);
    case "rifles":
      return guess.features.thin && guess.features.long;
    case "guns":
      return guess.features.thin && guess.evidence.aspect <= 1.25;
    case "objects":
    default:
      return true;
  }
}

export function resolveRecognizedCategory(
  guess: ShapeGuess,
  manualCategory?: AiCategory
): CategoryResolution {
  if (manualCategory) {
    return {
      category: manualCategory,
      source: "manual",
      recognizedCategory: guess.category,
      recognizedConfidence: guess.confidence,
      manualOverride: guess.category !== manualCategory
    };
  }

  const confident = guess.confidence >= AUTO_CATEGORY_CONFIDENCE;
  const structurallyConsistent = categoryEvidenceIsConsistent(guess);
  const category = confident && structurallyConsistent ? guess.category : "objects";
  return {
    category,
    source: "auto",
    recognizedCategory: guess.category,
    recognizedConfidence: guess.confidence,
    manualOverride: false
  };
}

export function categoryFromKind(kind: ShapeKind, slenderness = 1, aspect = 1): AiCategory {
  if (kind === "sword" && aspect <= 0.78 && slenderness >= 3.15) return "rifles";
  if (kind === "sword") return "swords";
  if (kind === "axe" && aspect <= 0.78) return "guns";
  if (kind === "axe") return "objects";
  return "objects";
}

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
  const minWidth = widths[0] ?? 1;
  const edgeThinness = live.length
    ? Math.max(0, Math.min(1, 1 - minWidth / Math.max(1, median)))
    : 0;

  return {
    hits,
    fill: hits / (bw * bh),
    aspect: bh / bw,
    slenderness: Math.max(bw, bh) / Math.min(bw, bh),
    symmetry: checked ? same / checked : 0,
    head: maxRow / Math.max(1, median),
    cv,
    bulge,
    taper,
    edgeThinness
  };
}

function evidenceFromStats(s: ReturnType<typeof maskStats>): RecognitionEvidence {
  return {
    hits: s.hits,
    fill: s.fill,
    aspect: s.aspect,
    slenderness: s.slenderness,
    symmetry: s.symmetry,
    taper: s.taper,
    bulge: s.bulge,
    widthCv: s.cv,
    edgeThinness: s.edgeThinness
  };
}

function featuresFromEvidence(evidence: RecognitionEvidence): RecognitionFeatures {
  return {
    thin: evidence.slenderness >= 2.8 || evidence.edgeThinness >= 0.18,
    long: evidence.aspect >= 2.2 || evidence.slenderness >= 2.6,
    tapered: evidence.taper <= 0.6,
    symmetric: evidence.symmetry >= 0.72,
    broadHead: evidence.fill <= 0.42 && evidence.widthCv >= 0.2,
    irregular: evidence.widthCv >= 0.32 || evidence.symmetry < 0.55
  };
}

function confidenceFromEvidence(
  base: number,
  support: number,
  ambiguity: number
) {
  const evidenceBoost = (support - 0.5) * 0.18;
  const ambiguityPenalty = ambiguity * 0.16;
  return Math.max(0.18, Math.min(0.98, base + evidenceBoost - ambiguityPenalty));
}

function ambiguityFor(
  aspect: number,
  fill: number,
  symmetry: number,
  slenderness: number
) {
  let score = 0;
  if (Math.abs(aspect - 1) < 0.2) score += 0.25;
  if (fill > 0.45 && fill < 0.7) score += 0.2;
  if (symmetry > 0.68 && slenderness > 1.6 && slenderness < 2.8) score += 0.2;
  return Math.min(1, score);
}

function withEvidence(
  stats: ReturnType<typeof maskStats>,
  guess: Omit<ShapeGuess, 'confidence' | 'evidence' | 'features'>,
  baseConfidence: number,
  support: number
): ShapeGuess {
  const ambiguity = ambiguityFor(stats.aspect, stats.fill, stats.symmetry, stats.slenderness);
  return {
    ...guess,
    confidence: confidenceFromEvidence(baseConfidence, support, ambiguity),
    evidence: evidenceFromStats(stats),
    features: featuresFromEvidence(evidenceFromStats(stats))
  };
}

export function recognizeFromMask(mask: boolean[][]): ShapeGuess {
  const s = maskStats(mask);
  const fallbackEvidence = evidenceFromStats(s);
  if (s.hits < 24) {
    return {
      kind: "prop",
      style: "prop",
      category: "objects",
      confidence: 0.2,
      evidence: fallbackEvidence,
      features: featuresFromEvidence(fallbackEvidence)
    };
  }

  if (
    s.aspect >= 0.78 &&
    s.aspect <= 1.28 &&
    s.fill >= 0.66 &&
    s.fill <= 0.87 &&
    s.symmetry >= 0.7
  ) {
    return withEvidence(
      s,
      { kind: "sphere", style: "pickup", category: "objects" },
      0.86,
      0.86
    );
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
    return withEvidence(
      s,
      { kind: "cylinder", style: "pickup", category: "objects" },
      0.82,
      0.84
    );
  }

  if (
    s.aspect >= 1.05 &&
    s.aspect <= 1.9 &&
    s.fill >= 0.48 &&
    s.fill <= 0.82 &&
    s.bulge >= 1.1 &&
    s.symmetry >= 0.66
  ) {
    return withEvidence(
      s,
      { kind: "barrel", style: "prop", category: "objects" },
      0.8,
      0.82
    );
  }

  if (
    s.aspect >= 1.22 &&
    s.fill >= 0.26 &&
    s.fill <= 0.56 &&
    s.taper <= 0.58 &&
    s.symmetry >= 0.64
  ) {
    return withEvidence(
      s,
      { kind: "cone", style: "pickup", category: "objects" },
      0.78,
      0.8
    );
  }

  if (
    s.aspect >= 1.3 &&
    s.fill >= 0.3 &&
    s.fill <= 0.64 &&
    s.symmetry >= 0.74 &&
    s.taper >= 0.42 &&
    s.cv <= 0.28
  ) {
    return withEvidence(
      s,
      { kind: "capsule", style: "pickup", category: "objects" },
      0.76,
      0.78
    );
  }

  if (s.aspect < 1.15 && s.fill >= 0.9) {
    return withEvidence(
      s,
      { kind: "tile", style: "tile", category: "objects" },
      0.78,
      0.84
    );
  }

  if (s.aspect <= 0.78 && s.fill >= 0.12 && s.fill <= 0.48 && s.slenderness >= 2.05) {
    const category = s.slenderness >= 3.15 ? "rifles" : "guns";
    return withEvidence(
      s,
      { kind: "prop", style: "weapon", category },
      category === "rifles" ? 0.76 : 0.72,
      Math.min(0.92, 0.52 + Math.min(0.28, s.edgeThinness * 0.9) + Math.min(0.12, (s.slenderness - 2) * 0.05))
    );
  }

  if (s.aspect >= 1.7 && s.fill <= 0.28 && s.slenderness >= 2.4 && s.head < 2.2) {
    return withEvidence(
      s,
      { kind: "sword", style: "weapon", category: "swords" },
      0.78,
      Math.min(0.92, 0.62 + s.edgeThinness * 0.3 + s.symmetry * 0.16)
    );
  }

  if (s.aspect >= 1.2 && s.head >= 2.3 && s.fill <= 0.42) {
    return withEvidence(
      s,
      { kind: "axe", style: "weapon", category: "objects" },
      0.72,
      Math.min(0.9, 0.58 + s.bulge * 0.08 + s.symmetry * 0.12)
    );
  }

  if (s.aspect >= 1.35 && s.symmetry >= 0.78 && s.fill >= 0.28 && s.fill <= 0.62) {
    return withEvidence(
      s,
      { kind: "bottle", style: "pickup", category: "objects" },
      0.74,
      Math.min(0.9, 0.62 + s.symmetry * 0.16 + (1 - s.cv) * 0.08)
    );
  }

  if (s.aspect >= 1.6 && s.symmetry >= 0.72 && s.fill >= 0.22 && s.fill <= 0.5) {
    return withEvidence(
      s,
      { kind: "character", style: "character", category: "objects" },
      0.68,
      Math.min(0.86, 0.56 + s.symmetry * 0.18 + Math.max(0, 0.3 - s.cv) * 0.12)
    );
  }

  return withEvidence(
    s,
    { kind: "prop", style: "prop", category: "objects" },
    0.55,
    0.5
  );
}
