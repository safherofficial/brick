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
  /** P26 — orientation-aware thin-feature signal derived from local thickness. */
  thinFeatureScore?: number;
  /** P26 — terminal narrowing signal for tip/barrel/edge preservation. */
  tipSharpness?: number;
  /** P28 — bounded input/mask quality used to gate automatic recognition. */
  inputQuality?: number;
  /** P28 — ambiguity evidence reused by the automatic recognition gate. */
  ambiguityScore?: number;
  /** P32 — bounded projection-based silhouette part decomposition. */
  silhouetteParts?: SilhouetteParts;
};
export type RecognitionFeatures = {
  thin: boolean;
  long: boolean;
  tapered: boolean;
  symmetric: boolean;
  broadHead: boolean;
  irregular: boolean;
  /** P26 — explicit thin-feature confidence used by reconstruction profiles. */
  thinFeatureScore?: number;
  /** P26 — useful for preserving tips, muzzles and other terminal features. */
  tipLike?: boolean;
};

export type SilhouetteParts = Readonly<{
  primaryAxis: "vertical" | "horizontal";
  partCount: number;
  coreRatio: number;
  terminalRatio: number;
  junctionScore: number;
}>;

export type RecognitionThresholds = Readonly<{
  autoConfidence: number;
  minScore: number;
  minMargin: number;
  swordAspectMin: number;
  swordSlenderMin: number;
  rifleAspectMax: number;
  rifleSlenderMin: number;
  rifleFillMax: number;
  gunAspectMax: number;
  gunSlenderMin: number;
  gunFillMax: number;
}>;

export type ReconstructionCompatibility = Readonly<{
  category: AiCategory;
  confidence: number;
  compatible: boolean;
  depthBias: "conservative" | "neutral" | "volumetric";
  detailBias: "standard" | "protected";
  reason: string;
}>;

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
  const thresholds = adaptiveRecognitionThresholds(guess.evidence);
  const confident = guess.confidence >= thresholds.autoConfidence;
  const structurallyConsistent = categoryEvidenceIsConsistent(guess);
  const inputQuality = clamp01(guess.evidence.inputQuality ?? 1);
  const ambiguityScore = clamp01(guess.evidence.ambiguityScore ?? 0);
  const qualityGate = inputQuality >= 0.42;
  const ambiguityGate = ambiguityScore < 0.48 || guess.confidence < 0.72;
  const category =
    confident &&
    structurallyConsistent &&
    qualityGate &&
    ambiguityGate
      ? guess.category
      : "objects";
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
function decomposeSilhouette(
  rowWidths: number[],
  colHeights: number[],
  bw: number,
  bh: number
): SilhouetteParts {
  const vertical = bh >= bw;
  const thickness = (vertical ? rowWidths : colHeights).filter((value) => value > 0);
  if (thickness.length < 3) {
    return {
      primaryAxis: vertical ? "vertical" : "horizontal",
      partCount: 1,
      coreRatio: 1,
      terminalRatio: 0,
      junctionScore: 0
    };
  }

  const sorted = thickness.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 1;
  const coreThreshold = Math.max(2, median * 0.72);
  const terminalThreshold = Math.max(2, median * 0.58);
  let coreCount = 0;
  let terminalCount = 0;
  let junctions = 0;
  for (let i = 0; i < thickness.length; i += 1) {
    const value = thickness[i];
    if (value >= coreThreshold) coreCount += 1;
    if (value <= terminalThreshold) terminalCount += 1;
    if (i <= 0 || i >= thickness.length - 1) continue;
    const left = thickness[i - 1];
    const right = thickness[i + 1];
    const localBody = (left + right) * 0.5;
    if (value <= Math.max(2, median * 0.62) && localBody >= median * 0.9) {
      junctions += 1;
    }
  }

  const junctionScore = clamp01(junctions / Math.max(1, thickness.length * 0.18));
  const partCount = Math.max(1, Math.min(4, 1 + Math.min(3, Math.round(junctionScore * 2))));
  return {
    primaryAxis: vertical ? "vertical" : "horizontal",
    partCount,
    coreRatio: clamp01(coreCount / thickness.length),
    terminalRatio: clamp01(terminalCount / thickness.length),
    junctionScore
  };
}

export function adaptiveRecognitionThresholds(
  evidence: RecognitionEvidence
): RecognitionThresholds {
  const quality = clamp01(evidence.inputQuality ?? 1);
  const ambiguity = clamp01(evidence.ambiguityScore ?? 0);
  const pressure = clamp01((1 - quality) * 0.72 + ambiguity * 0.38);
  return {
    autoConfidence: clamp01(0.64 + pressure * 0.075),
    minScore: clamp01(0.58 + pressure * 0.065),
    minMargin: clamp01(0.06 + pressure * 0.055),
    swordAspectMin: 1.5 + pressure * 0.16,
    swordSlenderMin: 2.4 + pressure * 0.16,
    rifleAspectMax: 0.9 - pressure * 0.05,
    rifleSlenderMin: 2.65 + pressure * 0.15,
    rifleFillMax: 0.55 - pressure * 0.04,
    gunAspectMax: 0.95 - pressure * 0.04,
    gunSlenderMin: 2.05 + pressure * 0.12,
    gunFillMax: 0.55 - pressure * 0.04
  };
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
  const colH = new Array<number>(w).fill(0);
  const colLo = new Array<number>(w).fill(h);
  const colHi = new Array<number>(w).fill(-1);
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
      colLo[x] = Math.min(colLo[x], y);
      colHi[x] = Math.max(colHi[x], y);
    }
    rowW[y] = hi >= 0 ? hi - lo + 1 : 0;
  }
  for (let x = 0; x < w; x += 1) {
    colH[x] = colHi[x] >= 0 ? colHi[x] - colLo[x] + 1 : 0;
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
  const liveCols = colH.filter((n) => n > 0);
  const widths = live.slice().sort((a, b) => a - b);
  const heights = liveCols.slice().sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] ?? 1;
  const medianCol = heights[Math.floor(heights.length / 2)] ?? 1;
  const maxRow = widths[widths.length - 1] ?? 1;
  const mean = live.length ? live.reduce((a, b) => a + b, 0) / live.length : 1;
  const meanCol = liveCols.length
    ? liveCols.reduce((a, b) => a + b, 0) / liveCols.length
    : 1;
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
  const rowThinRatio = live.length
    ? live.filter((value) => value <= Math.max(2, Math.ceil(median * 0.65))).length /
      live.length
    : 0;
  const colThinRatio = liveCols.length
    ? liveCols.filter((value) => value <= Math.max(2, Math.ceil(medianCol * 0.65))).length /
      liveCols.length
    : 0;

  const verticalAxisThinness = Math.max(0, Math.min(1, 1 - mean / Math.max(1, bh)));
  const horizontalAxisThinness = Math.max(0, Math.min(1, 1 - meanCol / Math.max(1, bw)));
  const verticalTip = Math.max(
    0,
    Math.min(1, 1 - Math.min(first, last) / Math.max(1, median))
  );
  const colFirst = liveCols[0] ?? 1;
  const colLast = liveCols[liveCols.length - 1] ?? 1;
  const horizontalTip = Math.max(
    0,
    Math.min(1, 1 - Math.min(colFirst, colLast) / Math.max(1, medianCol))
  );
  const verticalOrientation = bh >= bw;
  const axisThinness = verticalOrientation
    ? verticalAxisThinness
    : horizontalAxisThinness;
  const orientedThinRatio = verticalOrientation ? rowThinRatio : colThinRatio;
  const elongationGate = clamp01(
    (Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) - 1.3) / 1.7
  );
  const tipSharpness = Math.max(verticalTip, horizontalTip) * elongationGate;
  // P26 hardening: local thinness must still have enough global shape
  // structure before it can materially raise the thin-feature score. This
  // prevents isolated one-pixel noise inside compact props from being treated
  // like a blade/barrel while preserving long thin silhouettes.
  const structureGate = clamp01(
    (Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) - 1.18) / 1.45
  );
  const rawThinFeatureScore =
    axisThinness * 0.52 +
    orientedThinRatio * 0.18 +
    edgeThinness * 0.12 +
    tipSharpness * 0.18;
  const thinFeatureScore = Math.max(
    0,
    Math.min(
      1,
      rawThinFeatureScore * (0.42 + structureGate * 0.58)
    )
  );
  const minFrameMargin = Math.max(
    0,
    Math.min(minX, minY, Math.max(0, w - 1 - maxX), Math.max(0, h - 1 - maxY))
  );
  const resolutionQuality = clamp01(
    (Math.min(bw, bh) - 8) / 32
  );
  const pixelEvidence = greaterFit(hits, 24, 320);
  const frameMarginQuality = clamp01(
    minFrameMargin / Math.max(2, Math.min(w, h) * 0.08)
  );
  const inputQuality = clamp01(
    resolutionQuality * 0.48 +
      pixelEvidence * 0.30 +
      frameMarginQuality * 0.22
  );
  const ambiguityScore = clamp01(
    ambiguityFor(
      bh / bw,
      hits / (bw * bh),
      checked ? same / checked : 0,
      Math.max(bw, bh) / Math.min(bw, bh)
    )
  );
  const silhouetteParts = decomposeSilhouette(rowW, colH, bw, bh);
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
    edgeThinness,
    thinFeatureScore,
    tipSharpness,
    inputQuality,
    ambiguityScore,
    silhouetteParts
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
    edgeThinness: s.edgeThinness,
    thinFeatureScore: s.thinFeatureScore,
    tipSharpness: s.tipSharpness,
    inputQuality: s.inputQuality,
    ambiguityScore: s.ambiguityScore,
    silhouetteParts: s.silhouetteParts
  };
}
function featuresFromEvidence(evidence: RecognitionEvidence): RecognitionFeatures {
  const thinFeatureScore = clamp01(evidence.thinFeatureScore ?? 0);
  const tipSharpness = clamp01(evidence.tipSharpness ?? 0);
  return {
    thin:
      evidence.slenderness >= 2.8 ||
      evidence.edgeThinness >= 0.18 ||
      thinFeatureScore >= 0.44,
    long: evidence.aspect >= 2.2 || evidence.slenderness >= 2.6,
    tapered: evidence.taper <= 0.6 || tipSharpness >= 0.58,
    symmetric: evidence.symmetry >= 0.72,
    broadHead: evidence.fill <= 0.42 && evidence.widthCv >= 0.2,
    irregular: evidence.widthCv >= 0.32 || evidence.symmetry < 0.55,
    thinFeatureScore,
    tipLike: tipSharpness >= 0.58
  };
}

export type RecognitionCategoryScores = Readonly<Record<AiCategory, number>>;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function greaterFit(value: number, start: number, full: number) {
  return clamp01((value - start) / Math.max(1e-6, full - start));
}

function lesserFit(value: number, full: number, zero: number) {
  return clamp01((zero - value) / Math.max(1e-6, zero - full));
}

function bandFit(value: number, center: number, radius: number) {
  return clamp01(1 - Math.abs(value - center) / Math.max(1e-6, radius));
}

/**
 * P21 Semantic Recognition 2.0
 *
 * Keeps the existing geometric evidence but scores all weapon categories
 * against multiple signals at once. This deliberately rejects silhouettes
 * that are only long/thin and therefore prevents rods, bars and blank blades
 * from becoming weapons.
 */
export function semanticCategoryScores(evidence: RecognitionEvidence): RecognitionCategoryScores {
  const aspect = Math.max(0.01, evidence.aspect);
  const vertical = greaterFit(aspect, 1.16, 2.8);
  const horizontal = greaterFit(1 / aspect, 1.16, 2.8);
  const elongated = greaterFit(evidence.slenderness, 2.05, 4.2);
  const veryElongated = greaterFit(evidence.slenderness, 2.65, 4.6);
  const compact = bandFit(evidence.slenderness, 2.35, 1.55);
  const lowFill = lesserFit(evidence.fill, 0.3, 0.68);
  const mediumFill = bandFit(evidence.fill, 0.36, 0.34);
  const dense = greaterFit(evidence.fill, 0.48, 0.92);
  const edgeSignal = clamp01(evidence.edgeThinness * 1.25);
  const thinFeatureSignal = clamp01(evidence.thinFeatureScore ?? 0);
  const tipSignal = clamp01(evidence.tipSharpness ?? 0);
  const taperSignal = lesserFit(evidence.taper, 0.55, 0.9);
  const contourVariation = clamp01(evidence.widthCv / 0.3);
  const massVariation = clamp01(Math.max(0, evidence.bulge - 1) / 1.8);
  const structure = clamp01(contourVariation * 0.58 + massVariation * 0.42);
  const asymmetry = clamp01(1 - evidence.symmetry);
  const uniformContour = 1 - clamp01(evidence.widthCv / 0.26);
  const parts = evidence.silhouetteParts;
  const multipartSignal = parts ? clamp01((parts.partCount - 1) / 2) : 0;
  const junctionSignal = parts?.junctionScore ?? 0;
  const terminalPartSignal = parts?.terminalRatio ?? 0;

  const swordSignals = [
    vertical,
    elongated,
    lesserFit(evidence.fill, 0.34, 0.72),
    taperSignal,
    Math.max(edgeSignal, thinFeatureSignal),
    tipSignal
  ];
  const rifleSignals = [
    horizontal,
    veryElongated,
    structure,
    lowFill,
    thinFeatureSignal,
    asymmetry,
    multipartSignal * 0.72 + junctionSignal * 0.28
  ];
  const gunSignals = [
    horizontal,
    compact,
    mediumFill,
    taperSignal,
    Math.max(edgeSignal, thinFeatureSignal * 0.9),
    structure,
    multipartSignal * 0.58 + terminalPartSignal * 0.22 + junctionSignal * 0.20
  ];

  const swordContradiction = clamp01(
    horizontal * 0.42 + dense * 0.18 + (1 - taperSignal) * 0.2 + (1 - tipSignal) * 0.2
  );
  const rifleContradiction = clamp01(
    vertical * 0.44 + bandFit(evidence.slenderness, 1.45, 1.2) * 0.2 + dense * 0.16 +
      (1 - horizontal) * 0.2
  );
  const gunContradiction = clamp01(
    vertical * 0.18 + veryElongated * 0.34 + lowFill * 0.16 + (1 - compact) * 0.32
  );

  function fused(signals: number[], contradiction: number) {
    const mean = signals.reduce((sum, value) => sum + value, 0) / signals.length;
    const sorted = signals.slice().sort((a, b) => b - a);
    const top = sorted[0] ?? 0;
    const second = sorted[1] ?? 0;
    const lowerTail = sorted.slice(2).reduce((sum, value) => sum + value, 0) /
      Math.max(1, sorted.length - 2);
    const agreement = clamp01((second * 0.42 + lowerTail * 0.58));
    return clamp01(mean * 0.76 + top * 0.12 + agreement * 0.12 - contradiction * 0.14);
  }

  const swords = fused(swordSignals, swordContradiction);
  const rifles = fused(rifleSignals, rifleContradiction);
  const guns = fused(gunSignals, gunContradiction);
  const ambiguity = ambiguityFor(
    evidence.aspect,
    evidence.fill,
    evidence.symmetry,
    evidence.slenderness
  );
  const objectBase =
    0.22 +
    dense * 0.34 +
    uniformContour * 0.18 +
    ambiguity * 0.14 +
    (1 - Math.max(swords, guns, rifles)) * 0.12;
  const objects = clamp01(objectBase);

  return { swords, guns, rifles, objects };
}
export type RecognitionViewMode = "single" | "front+side";

export type RecognitionViewConfidence = Readonly<{
  mode: RecognitionViewMode;
  confidence: number;
}>;

/**
 * P27 — estimates how much structural view evidence is available for
 * reconstruction. This is a view-evidence confidence, not a probability
 * that the reconstruction is correct. FRONT+SIDE receives a higher bounded
 * confidence because depth is constrained by two silhouettes; single-view
 * remains conservative.
 */
export function viewConfidenceForEvidence(
  evidence: RecognitionEvidence | undefined,
  hasSide: boolean,
  hasDepth = true
): RecognitionViewConfidence {
  const evidenceQuality = clamp01(
    0.42 +
      greaterFit(evidence?.hits ?? 0, 24, 320) * 0.18 +
      clamp01(evidence?.edgeThinness ?? 0) * 0.12 +
      clamp01(evidence?.symmetry ?? 0) * 0.1 +
      clamp01((evidence?.widthCv ?? 0) / 0.3) * 0.08 +
      clamp01(evidence?.thinFeatureScore ?? 0) * 0.1
  );
  const mode: RecognitionViewMode = hasSide ? "front+side" : "single";
  const confidence = clamp01(
    (hasSide ? 0.78 : 0.60) +
      evidenceQuality * (hasSide ? 0.16 : 0.14) +
      (hasDepth ? 0.03 : 0)
  );
  return {
    mode,
    confidence: Math.max(0.5, Math.min(hasSide ? 0.94 : 0.82, confidence))
  };
}

/**
 * P22 Confidence Calibration. The margin between the selected category and
 * the strongest alternative now affects confidence, so near-ties cannot look
 * as certain as clean semantic matches.
 */
export function calibrateCategoryConfidence(
  baseConfidence: number,
  topScore: number,
  runnerUpScore: number,
  evidence: RecognitionEvidence
) {
  const margin = clamp01(topScore - runnerUpScore);
  const ambiguity = ambiguityFor(
    evidence.aspect,
    evidence.fill,
    evidence.symmetry,
    evidence.slenderness
  );
  const evidenceQuality = clamp01(
    0.34 +
      greaterFit(evidence.hits, 24, 320) * 0.2 +
      clamp01(evidence.edgeThinness) * 0.12 +
      clamp01(evidence.widthCv / 0.3) * 0.12 +
      clamp01(Math.max(0, evidence.bulge - 1) / 1.8) * 0.12 +
      clamp01(evidence.symmetry) * 0.1
  );
  const marginBoost = (margin - 0.18) * 0.18;
  const ambiguityPenalty = Math.max(ambiguity, evidence.ambiguityScore ?? 0) * 0.11;
  const lowEvidencePenalty = (1 - evidenceQuality) * 0.08;
  const inputQualityPenalty = (1 - clamp01(evidence.inputQuality ?? 1)) * 0.14;
  return Math.max(
    0.18,
    Math.min(
      0.98,
      baseConfidence +
        marginBoost -
        ambiguityPenalty -
        lowEvidencePenalty -
        inputQualityPenalty
    )
  );
}
function confidenceFromEvidence(
  base: number,
  support: number,
  ambiguity: number,
  inputQuality = 1
) {
  const evidenceBoost = (support - 0.5) * 0.18;
  const ambiguityPenalty = ambiguity * 0.16;
  const inputQualityPenalty = (1 - clamp01(inputQuality)) * 0.10;
  return Math.max(
    0.18,
    Math.min(0.98, base + evidenceBoost - ambiguityPenalty - inputQualityPenalty)
  );
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
function semanticWeaponGuess(
  stats: ReturnType<typeof maskStats>,
  category: Extract<AiCategory, "swords" | "guns" | "rifles">
): ShapeGuess {
  const evidence = evidenceFromStats(stats);
  const scores = semanticCategoryScores(evidence);
  const runnerUpScore = Math.max(
    ...(["swords", "guns", "rifles"] as const)
      .filter((item) => item !== category)
      .map((item) => scores[item])
  );
  const preliminary: ShapeGuess = {
    kind: category === "swords" ? "sword" : "prop",
    style: "weapon",
    category,
    confidence: 0.54 + scores[category] * 0.38,
    evidence,
    features: featuresFromEvidence(evidence)
  };
  const compatibility = reconstructionCompatibility(preliminary);
  const calibrated = calibrateCategoryConfidence(
    0.54 + scores[category] * 0.38,
    scores[category],
    Math.max(runnerUpScore, scores.objects),
    evidence
  ) * (compatibility.compatible ? 1 : 0.92);
  const kind: ShapeKind = category === "swords" ? "sword" : "prop";
  return {
    kind,
    style: "weapon",
    category,
    confidence: calibrated,
    evidence,
    features: featuresFromEvidence(evidence)
  };
}

function semanticWeaponCategory(stats: ReturnType<typeof maskStats>) {
  const evidence = evidenceFromStats(stats);
  const thresholds = adaptiveRecognitionThresholds(evidence);
  const scores = semanticCategoryScores(evidence);
  const eligible = (["swords", "guns", "rifles"] as const).filter((category) => {
    if (category === "swords") {
      return (
        evidence.aspect >= thresholds.swordAspectMin &&
        evidence.slenderness >= thresholds.swordSlenderMin &&
        (evidence.taper <= 0.82 || evidence.edgeThinness >= 0.22)
      );
    }
    if (category === "rifles") {
      return (
        evidence.aspect <= thresholds.rifleAspectMax &&
        evidence.slenderness >= thresholds.rifleSlenderMin &&
        evidence.fill <= thresholds.rifleFillMax &&
        (evidence.widthCv >= 0.12 || evidence.taper <= 0.82 || evidence.edgeThinness >= 0.2)
      );
    }
    return (
      evidence.aspect <= thresholds.gunAspectMax &&
      evidence.slenderness >= thresholds.gunSlenderMin &&
      evidence.fill <= thresholds.gunFillMax &&
      evidence.taper <= 0.88
    );
  });

  if (!eligible.length) return null;
  const ranked = eligible.slice().sort((a, b) => scores[b] - scores[a]);
  const best = ranked[0];
  const runner = ranked[1];
  const objectScore = scores.objects;
  const runnerScore = runner ? scores[runner] : 0;
  const margin = scores[best] - Math.max(runnerScore, objectScore);

  if (scores[best] < thresholds.minScore || margin < thresholds.minMargin) return null;
  return best;
}

export function reconstructionCompatibility(guess: ShapeGuess): ReconstructionCompatibility {
  const evidence = guess.evidence;
  const parts = evidence.silhouetteParts;
  const partSupport = parts ? clamp01((parts.partCount - 1) / 2) : 0;
  const junctionSupport = parts?.junctionScore ?? 0;
  const terminalSupport = parts?.terminalRatio ?? 0;
  let contradiction = 0;
  let detailBias: ReconstructionCompatibility["detailBias"] = "standard";
  let depthBias: ReconstructionCompatibility["depthBias"] = "neutral";
  if (guess.category === "swords") {
    contradiction += evidence.aspect < 1.25 ? 0.35 : 0;
    contradiction += evidence.thinFeatureScore !== undefined && evidence.thinFeatureScore < 0.28 ? 0.18 : 0;
    contradiction += evidence.taper > 0.82 && terminalSupport < 0.12 ? 0.16 : 0;
    detailBias = "protected";
    depthBias = "conservative";
  } else if (guess.category === "rifles") {
    contradiction += evidence.aspect > 1.05 ? 0.34 : 0;
    contradiction += evidence.slenderness < 2.45 ? 0.28 : 0;
    contradiction += evidence.fill > 0.62 ? 0.18 : 0;
    contradiction += partSupport < 0.15 && junctionSupport < 0.06 ? 0.12 : 0;
    detailBias = "protected";
  } else if (guess.category === "guns") {
    contradiction += evidence.aspect > 1.15 ? 0.28 : 0;
    contradiction += evidence.slenderness > 3.9 ? 0.24 : 0;
    contradiction += evidence.fill > 0.66 ? 0.18 : 0;
    contradiction += partSupport < 0.1 && junctionSupport < 0.04 ? 0.08 : 0;
    detailBias = "protected";
  }
  const confidence = clamp01(guess.confidence * (1 - contradiction * 0.72));
  const compatible = contradiction < 0.4 && confidence >= 0.5;
  if (contradiction >= 0.4) depthBias = "conservative";
  else if (partSupport >= 0.5 || junctionSupport >= 0.2) depthBias = "volumetric";
  const reason = compatible
    ? "reconstruction profile coherent with silhouette evidence"
    : "reconstruction profile is contradicted by the reconstructed silhouette";
  return {
    category: guess.category,
    confidence,
    compatible,
    depthBias,
    detailBias,
    reason
  };
}

export type ReconstructionFeedbackVoxel = Readonly<{ x: number; y: number; z: number }>;

export function reconstructionFeedbackFromVoxels(
  expectedCategory: AiCategory,
  voxels: readonly ReconstructionFeedbackVoxel[]
) {
  if (!voxels.length) {
    return {
      recommendedCategory: expectedCategory,
      observedCategory: "objects" as AiCategory,
      confidence: 0.18,
      corrected: false,
      reason: "empty reconstruction"
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const voxel of voxels) {
    minX = Math.min(minX, voxel.x);
    minY = Math.min(minY, voxel.y);
    maxX = Math.max(maxX, voxel.x);
    maxY = Math.max(maxY, voxel.y);
  }
  const width = Math.max(1, maxX - minX + 1);
  const height = Math.max(1, maxY - minY + 1);
  const projected = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
  for (const voxel of voxels) {
    projected[voxel.y - minY][voxel.x - minX] = true;
  }
  const observed = recognizeFromMask(projected);
  const expectedCompatibility = reconstructionCompatibility({
    ...observed,
    category: expectedCategory
  });
  // The projected reconstruction is already a dense, normalized signal, so
  // P31 intentionally bypasses the image-quality fallback when comparing its
  // semantic category. The normal P28 gate still governs the original input.
  const observedCategory = observed.category;
  const mismatch = observedCategory !== expectedCategory;
  const strongObservation = observedCategory !== "objects" && observed.confidence >= 0.7;
  const correctionAllowed = expectedCategory !== "objects" && strongObservation && mismatch;
  const recommendedCategory = correctionAllowed ? observedCategory : expectedCategory;
  return {
    recommendedCategory,
    observedCategory,
    confidence: clamp01(Math.max(observed.confidence, expectedCompatibility.confidence)),
    corrected: recommendedCategory !== expectedCategory,
    reason: recommendedCategory !== expectedCategory
      ? "reconstruction projection disagrees with the previous automatic category"
      : expectedCompatibility.reason
  };
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
    confidence: confidenceFromEvidence(
      baseConfidence,
      support,
      ambiguity,
      stats.inputQuality
    ),
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
  const semanticCategory = semanticWeaponCategory(s);
  if (semanticCategory) {
    return semanticWeaponGuess(s, semanticCategory);
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
}  thin: boolean;
  long: boolean;
  tapered: boolean;
  symmetric: boolean;
  broadHead: boolean;
  irregular: boolean;
  /** P26 — explicit thin-feature confidence used by reconstruction profiles. */
  thinFeatureScore?: number;
  /** P26 — useful for preserving tips, muzzles and other terminal features. */
  tipLike?: boolean;
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
  const inputQuality = clamp01(guess.evidence.inputQuality ?? 1);
  const ambiguityScore = clamp01(guess.evidence.ambiguityScore ?? 0);
  const qualityGate = inputQuality >= 0.42;
  const ambiguityGate = ambiguityScore < 0.48 || guess.confidence < 0.72;
  const category =
    confident &&
    structurallyConsistent &&
    qualityGate &&
    ambiguityGate
      ? guess.category
      : "objects";
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
  const colH = new Array<number>(w).fill(0);
  const colLo = new Array<number>(w).fill(h);
  const colHi = new Array<number>(w).fill(-1);
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
      colLo[x] = Math.min(colLo[x], y);
      colHi[x] = Math.max(colHi[x], y);
    }
    rowW[y] = hi >= 0 ? hi - lo + 1 : 0;
  }
  for (let x = 0; x < w; x += 1) {
    colH[x] = colHi[x] >= 0 ? colHi[x] - colLo[x] + 1 : 0;
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
  const liveCols = colH.filter((n) => n > 0);
  const widths = live.slice().sort((a, b) => a - b);
  const heights = liveCols.slice().sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] ?? 1;
  const medianCol = heights[Math.floor(heights.length / 2)] ?? 1;
  const maxRow = widths[widths.length - 1] ?? 1;
  const mean = live.length ? live.reduce((a, b) => a + b, 0) / live.length : 1;
  const meanCol = liveCols.length
    ? liveCols.reduce((a, b) => a + b, 0) / liveCols.length
    : 1;
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
  const rowThinRatio = live.length
    ? live.filter((value) => value <= Math.max(2, Math.ceil(median * 0.65))).length /
      live.length
    : 0;
  const colThinRatio = liveCols.length
    ? liveCols.filter((value) => value <= Math.max(2, Math.ceil(medianCol * 0.65))).length /
      liveCols.length
    : 0;

  const verticalAxisThinness = Math.max(0, Math.min(1, 1 - mean / Math.max(1, bh)));
  const horizontalAxisThinness = Math.max(0, Math.min(1, 1 - meanCol / Math.max(1, bw)));
  const verticalTip = Math.max(
    0,
    Math.min(1, 1 - Math.min(first, last) / Math.max(1, median))
  );
  const colFirst = liveCols[0] ?? 1;
  const colLast = liveCols[liveCols.length - 1] ?? 1;
  const horizontalTip = Math.max(
    0,
    Math.min(1, 1 - Math.min(colFirst, colLast) / Math.max(1, medianCol))
  );
  const verticalOrientation = bh >= bw;
  const axisThinness = verticalOrientation
    ? verticalAxisThinness
    : horizontalAxisThinness;
  const orientedThinRatio = verticalOrientation ? rowThinRatio : colThinRatio;
  const elongationGate = clamp01(
    (Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) - 1.3) / 1.7
  );
  const tipSharpness = Math.max(verticalTip, horizontalTip) * elongationGate;
  // P26 hardening: local thinness must still have enough global shape
  // structure before it can materially raise the thin-feature score. This
  // prevents isolated one-pixel noise inside compact props from being treated
  // like a blade/barrel while preserving long thin silhouettes.
  const structureGate = clamp01(
    (Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) - 1.18) / 1.45
  );
  const rawThinFeatureScore =
    axisThinness * 0.52 +
    orientedThinRatio * 0.18 +
    edgeThinness * 0.12 +
    tipSharpness * 0.18;
  const thinFeatureScore = Math.max(
    0,
    Math.min(
      1,
      rawThinFeatureScore * (0.42 + structureGate * 0.58)
    )
  );
  const minFrameMargin = Math.max(
    0,
    Math.min(minX, minY, Math.max(0, w - 1 - maxX), Math.max(0, h - 1 - maxY))
  );
  const resolutionQuality = clamp01(
    (Math.min(bw, bh) - 8) / 32
  );
  const pixelEvidence = greaterFit(hits, 24, 320);
  const frameMarginQuality = clamp01(
    minFrameMargin / Math.max(2, Math.min(w, h) * 0.08)
  );
  const inputQuality = clamp01(
    resolutionQuality * 0.48 +
      pixelEvidence * 0.30 +
      frameMarginQuality * 0.22
  );
  const ambiguityScore = clamp01(
    ambiguityFor(
      bh / bw,
      hits / (bw * bh),
      checked ? same / checked : 0,
      Math.max(bw, bh) / Math.min(bw, bh)
    )
  );
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
    edgeThinness,
    thinFeatureScore,
    tipSharpness,
    inputQuality,
    ambiguityScore
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
    edgeThinness: s.edgeThinness,
    thinFeatureScore: s.thinFeatureScore,
    tipSharpness: s.tipSharpness,
    inputQuality: s.inputQuality,
    ambiguityScore: s.ambiguityScore
  };
}
function featuresFromEvidence(evidence: RecognitionEvidence): RecognitionFeatures {
  const thinFeatureScore = clamp01(evidence.thinFeatureScore ?? 0);
  const tipSharpness = clamp01(evidence.tipSharpness ?? 0);
  return {
    thin:
      evidence.slenderness >= 2.8 ||
      evidence.edgeThinness >= 0.18 ||
      thinFeatureScore >= 0.44,
    long: evidence.aspect >= 2.2 || evidence.slenderness >= 2.6,
    tapered: evidence.taper <= 0.6 || tipSharpness >= 0.58,
    symmetric: evidence.symmetry >= 0.72,
    broadHead: evidence.fill <= 0.42 && evidence.widthCv >= 0.2,
    irregular: evidence.widthCv >= 0.32 || evidence.symmetry < 0.55,
    thinFeatureScore,
    tipLike: tipSharpness >= 0.58
  };
}

export type RecognitionCategoryScores = Readonly<Record<AiCategory, number>>;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function greaterFit(value: number, start: number, full: number) {
  return clamp01((value - start) / Math.max(1e-6, full - start));
}

function lesserFit(value: number, full: number, zero: number) {
  return clamp01((zero - value) / Math.max(1e-6, zero - full));
}

function bandFit(value: number, center: number, radius: number) {
  return clamp01(1 - Math.abs(value - center) / Math.max(1e-6, radius));
}

/**
 * P21 Semantic Recognition 2.0
 *
 * Keeps the existing geometric evidence but scores all weapon categories
 * against multiple signals at once. This deliberately rejects silhouettes
 * that are only long/thin and therefore prevents rods, bars and blank blades
 * from becoming weapons.
 */
export function semanticCategoryScores(evidence: RecognitionEvidence): RecognitionCategoryScores {
  const aspect = Math.max(0.01, evidence.aspect);
  const vertical = greaterFit(aspect, 1.16, 2.8);
  const horizontal = greaterFit(1 / aspect, 1.16, 2.8);
  const elongated = greaterFit(evidence.slenderness, 2.05, 4.2);
  const veryElongated = greaterFit(evidence.slenderness, 2.65, 4.6);
  const compact = bandFit(evidence.slenderness, 2.35, 1.55);
  const lowFill = lesserFit(evidence.fill, 0.3, 0.68);
  const mediumFill = bandFit(evidence.fill, 0.36, 0.34);
  const dense = greaterFit(evidence.fill, 0.48, 0.92);
  const edgeSignal = clamp01(evidence.edgeThinness * 1.25);
  const thinFeatureSignal = clamp01(evidence.thinFeatureScore ?? 0);
  const tipSignal = clamp01(evidence.tipSharpness ?? 0);
  const taperSignal = lesserFit(evidence.taper, 0.55, 0.9);
  const contourVariation = clamp01(evidence.widthCv / 0.3);
  const massVariation = clamp01(Math.max(0, evidence.bulge - 1) / 1.8);
  const structure = clamp01(contourVariation * 0.58 + massVariation * 0.42);
  const asymmetry = clamp01(1 - evidence.symmetry);
  const uniformContour = 1 - clamp01(evidence.widthCv / 0.26);

  const swordSignals = [
    vertical,
    elongated,
    lesserFit(evidence.fill, 0.34, 0.72),
    taperSignal,
    Math.max(edgeSignal, thinFeatureSignal),
    tipSignal
  ];
  const rifleSignals = [
    horizontal,
    veryElongated,
    structure,
    lowFill,
    thinFeatureSignal,
    asymmetry
  ];
  const gunSignals = [
    horizontal,
    compact,
    mediumFill,
    taperSignal,
    Math.max(edgeSignal, thinFeatureSignal * 0.9),
    structure
  ];

  const swordContradiction = clamp01(
    horizontal * 0.42 + dense * 0.18 + (1 - taperSignal) * 0.2 + (1 - tipSignal) * 0.2
  );
  const rifleContradiction = clamp01(
    vertical * 0.44 + bandFit(evidence.slenderness, 1.45, 1.2) * 0.2 + dense * 0.16 +
      (1 - horizontal) * 0.2
  );
  const gunContradiction = clamp01(
    vertical * 0.18 + veryElongated * 0.34 + lowFill * 0.16 + (1 - compact) * 0.32
  );

  function fused(signals: number[], contradiction: number) {
    const mean = signals.reduce((sum, value) => sum + value, 0) / signals.length;
    const sorted = signals.slice().sort((a, b) => b - a);
    const top = sorted[0] ?? 0;
    const second = sorted[1] ?? 0;
    const lowerTail = sorted.slice(2).reduce((sum, value) => sum + value, 0) /
      Math.max(1, sorted.length - 2);
    const agreement = clamp01((second * 0.42 + lowerTail * 0.58));
    return clamp01(mean * 0.76 + top * 0.12 + agreement * 0.12 - contradiction * 0.14);
  }

  const swords = fused(swordSignals, swordContradiction);
  const rifles = fused(rifleSignals, rifleContradiction);
  const guns = fused(gunSignals, gunContradiction);
  const ambiguity = ambiguityFor(
    evidence.aspect,
    evidence.fill,
    evidence.symmetry,
    evidence.slenderness
  );
  const objectBase =
    0.22 +
    dense * 0.34 +
    uniformContour * 0.18 +
    ambiguity * 0.14 +
    (1 - Math.max(swords, guns, rifles)) * 0.12;
  const objects = clamp01(objectBase);

  return { swords, guns, rifles, objects };
}
export type RecognitionViewMode = "single" | "front+side";

export type RecognitionViewConfidence = Readonly<{
  mode: RecognitionViewMode;
  confidence: number;
}>;

/**
 * P27 — estimates how much structural view evidence is available for
 * reconstruction. This is a view-evidence confidence, not a probability
 * that the reconstruction is correct. FRONT+SIDE receives a higher bounded
 * confidence because depth is constrained by two silhouettes; single-view
 * remains conservative.
 */
export function viewConfidenceForEvidence(
  evidence: RecognitionEvidence | undefined,
  hasSide: boolean,
  hasDepth = true
): RecognitionViewConfidence {
  const evidenceQuality = clamp01(
    0.42 +
      greaterFit(evidence?.hits ?? 0, 24, 320) * 0.18 +
      clamp01(evidence?.edgeThinness ?? 0) * 0.12 +
      clamp01(evidence?.symmetry ?? 0) * 0.1 +
      clamp01((evidence?.widthCv ?? 0) / 0.3) * 0.08 +
      clamp01(evidence?.thinFeatureScore ?? 0) * 0.1
  );
  const mode: RecognitionViewMode = hasSide ? "front+side" : "single";
  const confidence = clamp01(
    (hasSide ? 0.78 : 0.60) +
      evidenceQuality * (hasSide ? 0.16 : 0.14) +
      (hasDepth ? 0.03 : 0)
  );
  return {
    mode,
    confidence: Math.max(0.5, Math.min(hasSide ? 0.94 : 0.82, confidence))
  };
}

/**
 * P22 Confidence Calibration. The margin between the selected category and
 * the strongest alternative now affects confidence, so near-ties cannot look
 * as certain as clean semantic matches.
 */
export function calibrateCategoryConfidence(
  baseConfidence: number,
  topScore: number,
  runnerUpScore: number,
  evidence: RecognitionEvidence
) {
  const margin = clamp01(topScore - runnerUpScore);
  const ambiguity = ambiguityFor(
    evidence.aspect,
    evidence.fill,
    evidence.symmetry,
    evidence.slenderness
  );
  const evidenceQuality = clamp01(
    0.34 +
      greaterFit(evidence.hits, 24, 320) * 0.2 +
      clamp01(evidence.edgeThinness) * 0.12 +
      clamp01(evidence.widthCv / 0.3) * 0.12 +
      clamp01(Math.max(0, evidence.bulge - 1) / 1.8) * 0.12 +
      clamp01(evidence.symmetry) * 0.1
  );
  const marginBoost = (margin - 0.18) * 0.18;
  const ambiguityPenalty = Math.max(ambiguity, evidence.ambiguityScore ?? 0) * 0.11;
  const lowEvidencePenalty = (1 - evidenceQuality) * 0.08;
  const inputQualityPenalty = (1 - clamp01(evidence.inputQuality ?? 1)) * 0.14;
  return Math.max(
    0.18,
    Math.min(
      0.98,
      baseConfidence +
        marginBoost -
        ambiguityPenalty -
        lowEvidencePenalty -
        inputQualityPenalty
    )
  );
}
function confidenceFromEvidence(
  base: number,
  support: number,
  ambiguity: number,
  inputQuality = 1
) {
  const evidenceBoost = (support - 0.5) * 0.18;
  const ambiguityPenalty = ambiguity * 0.16;
  const inputQualityPenalty = (1 - clamp01(inputQuality)) * 0.10;
  return Math.max(
    0.18,
    Math.min(0.98, base + evidenceBoost - ambiguityPenalty - inputQualityPenalty)
  );
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
function semanticWeaponGuess(
  stats: ReturnType<typeof maskStats>,
  category: Extract<AiCategory, "swords" | "guns" | "rifles">
): ShapeGuess {
  const evidence = evidenceFromStats(stats);
  const scores = semanticCategoryScores(evidence);
  const runnerUpScore = Math.max(
    ...(["swords", "guns", "rifles"] as const)
      .filter((item) => item !== category)
      .map((item) => scores[item])
  );
  const calibrated = calibrateCategoryConfidence(
    0.54 + scores[category] * 0.38,
    scores[category],
    Math.max(runnerUpScore, scores.objects),
    evidence
  );
  const kind: ShapeKind = category === "swords" ? "sword" : "prop";
  return {
    kind,
    style: "weapon",
    category,
    confidence: calibrated,
    evidence,
    features: featuresFromEvidence(evidence)
  };
}

function semanticWeaponCategory(stats: ReturnType<typeof maskStats>) {
  const evidence = evidenceFromStats(stats);
  const scores = semanticCategoryScores(evidence);
  const eligible = (["swords", "guns", "rifles"] as const).filter((category) => {
    if (category === "swords") {
      return (
        evidence.aspect >= 1.5 &&
        evidence.slenderness >= 2.4 &&
        (evidence.taper <= 0.82 || evidence.edgeThinness >= 0.22)
      );
    }
    if (category === "rifles") {
      return (
        evidence.aspect <= 0.9 &&
        evidence.slenderness >= 2.65 &&
        evidence.fill <= 0.55 &&
        (evidence.widthCv >= 0.12 || evidence.taper <= 0.82 || evidence.edgeThinness >= 0.2)
      );
    }
    return (
      evidence.aspect <= 0.95 &&
      evidence.slenderness >= 2.05 &&
      evidence.fill <= 0.55 &&
      evidence.taper <= 0.88
    );
  });

  if (!eligible.length) return null;
  const ranked = eligible.slice().sort((a, b) => scores[b] - scores[a]);
  const best = ranked[0];
  const runner = ranked[1];
  const objectScore = scores.objects;
  const runnerScore = runner ? scores[runner] : 0;
  const margin = scores[best] - Math.max(runnerScore, objectScore);

  if (scores[best] < 0.58 || margin < 0.06) return null;
  return best;
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
    confidence: confidenceFromEvidence(
      baseConfidence,
      support,
      ambiguity,
      stats.inputQuality
    ),
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
  const semanticCategory = semanticWeaponCategory(s);
  if (semanticCategory) {
    return semanticWeaponGuess(s, semanticCategory);
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
