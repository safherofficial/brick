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
