export type ReconstructionConfidenceSummary = Readonly<{
  mean: number;
  min: number;
  max: number;
  lowConfidenceRatio: number;
}>;

export type ReconstructionConfidenceMap = Readonly<{
  width: number;
  height: number;
  values: readonly number[];
  summary: ReconstructionConfidenceSummary;
}>;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/** P36 — sample the local confidence field in source-image coordinates. */
export function sampleReconstructionConfidence(
  map: ReconstructionConfidenceMap | null | undefined,
  x: number,
  y: number
): number {
  if (!map || map.width <= 0 || map.height <= 0 || !map.values.length) return 1;
  const cx = Math.max(0, Math.min(map.width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(map.height - 1, Math.round(y)));
  return clamp01(map.values[cy * map.width + cx] ?? 0);
}

/** P36 — confidence-aware depth multiplier. High-confidence regions retain
 * the established depth; uncertain silhouette regions receive a conservative
 * reduction without changing FRONT occupancy. */
export function reconstructionDepthScale(confidence: number): number {
  const c = clamp01(confidence);
  return 0.55 + c * 0.45;
}

/**
 * P35 — creates a bounded 2D confidence field from the reconstructed
 * silhouette projection. Foreground pixels with strong local support are
 * high-confidence; isolated edges/cavities remain lower-confidence so a
 * downstream consumer can protect uncertain regions without changing the
 * existing voxel geometry by itself.
 */
export function buildReconstructionConfidenceMap(
  mask: boolean[][],
  width = mask[0]?.length ?? 0,
  height = mask.length
): ReconstructionConfidenceMap {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  const values = new Array<number>(safeWidth * safeHeight).fill(0);

  if (!safeWidth || !safeHeight) {
    return {
      width: safeWidth,
      height: safeHeight,
      values,
      summary: {
        mean: 0,
        min: 0,
        max: 0,
        lowConfidenceRatio: 0
      }
    };
  }

  let sum = 0;
  let min = 1;
  let max = 0;
  let occupied = 0;
  let lowConfidence = 0;

  const at = (x: number, y: number) => Boolean(mask[y]?.[x]);

  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      if (!at(x, y)) continue;

      occupied += 1;
      let neighbours = 0;
      let diagonal = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          if (at(x + dx, y + dy)) {
            if (dx === 0 || dy === 0) neighbours += 1;
            else diagonal += 1;
          }
        }
      }

      const localSupport = clamp01(neighbours / 4);
      const diagonalSupport = clamp01(diagonal / 4);
      const interiorSupport = clamp01((neighbours + diagonal) / 8);
      const edgePenalty = 1 - localSupport;
      const borderSupport =
        x === 0 || y === 0 || x === safeWidth - 1 || y === safeHeight - 1 ? 0.08 : 0;

      const confidence = clamp01(
        localSupport * 0.48 +
          interiorSupport * 0.24 +
          diagonalSupport * 0.12 +
          (1 - edgePenalty) * 0.11 +
          (1 - borderSupport) * 0.05
      );

      values[y * safeWidth + x] = confidence;
      sum += confidence;
      min = Math.min(min, confidence);
      max = Math.max(max, confidence);
      if (confidence < 0.45) lowConfidence += 1;
    }
  }

  if (!occupied) {
    min = 0;
    max = 0;
  }

  return {
    width: safeWidth,
    height: safeHeight,
    values,
    summary: {
      mean: occupied ? clamp01(sum / occupied) : 0,
      min: occupied ? clamp01(min) : 0,
      max: occupied ? clamp01(max) : 0,
      lowConfidenceRatio: occupied ? clamp01(lowConfidence / occupied) : 0
    }
  };
}

export type StructuralDepthProfile = Readonly<{
  bins: readonly number[];
  median: number;
}>;

/**
 * P37 — measures normalized structural width along the primary image Y axis.
 * The profile is intentionally relative to the widest occupied row so that
 * uniformly thin assets do not get penalized just for being thin.
 */
export function buildStructuralDepthProfile(
  mask: boolean[][],
  minX = 0,
  maxX = Math.max(0, (mask[0]?.length ?? 1) - 1),
  minY = 0,
  maxY = Math.max(0, mask.length - 1),
  bins = 64
): StructuralDepthProfile {
  const safeBins = Math.max(1, Math.floor(bins));
  const safeMinX = Math.max(0, Math.min(minX, maxX));
  const safeMaxX = Math.min(
    Math.max(safeMinX, maxX),
    Math.max(0, (mask[0]?.length ?? 1) - 1)
  );
  const safeMinY = Math.max(0, Math.min(minY, maxY));
  const safeMaxY = Math.min(
    Math.max(safeMinY, maxY),
    Math.max(0, mask.length - 1)
  );
  const width = Math.max(1, safeMaxX - safeMinX + 1);
  const height = Math.max(1, safeMaxY - safeMinY + 1);
  const rowRatios = new Array<number>(height).fill(0);

  // Compute row occupancy once. This keeps P37 O(mask area) rather than
  // rescanning the full image once per profile bin.
  for (let localY = 0; localY < height; localY += 1) {
    const y = safeMinY + localY;
    const row = mask[y];
    if (!row) continue;

    let occupied = 0;
    for (let x = safeMinX; x <= safeMaxX; x += 1) {
      if (row[x]) occupied += 1;
    }
    rowRatios[localY] = occupied / width;
  }

  const raw = Array.from({ length: safeBins }, () => 0);
  for (let bin = 0; bin < safeBins; bin += 1) {
    const start = Math.floor((bin / safeBins) * height);
    const end = Math.max(
      start + 1,
      Math.ceil(((bin + 1) / safeBins) * height)
    );

    let sum = 0;
    let count = 0;
    for (let localY = start; localY < Math.min(height, end); localY += 1) {
      sum += rowRatios[localY];
      count += 1;
    }
    raw[bin] = count > 0 ? sum / count : 0;
  }

  const peak = Math.max(...raw, 0);
  if (peak <= 0) {
    return { bins: raw, median: 0 };
  }

  const normalized = raw.map((value) => clamp01(value / peak));
  const sorted = normalized.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) * 0.5
      : sorted[middle];

  return {
    bins: normalized,
    median: clamp01(median)
  };
}

/** P37 — converts relative structural width into a deliberately narrow depth
 * modulation. It adds regional shape information without becoming a second
 * depth estimator or overriding P36 confidence protection. */
export function structuralDepthScale(
  structuralWidth: number,
  profileMedian: number
): number {
  const width = clamp01(structuralWidth);
  const median = clamp01(profileMedian);
  if (median <= 0) return 1;
  const delta = width - median;
  return Math.max(0.92, Math.min(1.06, 0.94 + delta * 0.30));
}

