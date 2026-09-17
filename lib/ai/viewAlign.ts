/**
 * FRONT / SIDE view quality & vertical alignment helpers for MODEL import.
 * Non-destructive: scores + optional Y shift; does not alter the visual-hull math.
 */

export type BoundsLike = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export type SideViewAssessment = {
  /** FRONT width/height of content box */
  aspectWH: number;
  /** SIDE width/height of content box */
  aspectDH: number;
  /** SIDE looks like another front (not a thin profile) */
  sideLooksLikeFront: boolean;
  /** SIDE is a plausible thin profile for 2.5D weapons */
  sideLooksLikeProfile: boolean;
  /** Human-readable hint for the Builder UI */
  message: string;
  /** 0..1 quality (1 = ideal thin side for weapons) */
  score: number;
};

/** Occupancy along normalized Y [0..1] from a binary mask + bounds. */
function yProfile(
  mask: boolean[][],
  bounds: BoundsLike,
  bins = 64
): Float32Array {
  const out = new Float32Array(bins);
  const h = Math.max(1, bounds.height);
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    let row = 0;
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (mask[y]?.[x]) row += 1;
    }
    if (!row) continue;
    const t = (y - bounds.minY + 0.5) / h;
    const i = Math.min(bins - 1, Math.max(0, Math.floor(t * bins)));
    out[i] += row;
  }
  let max = 0;
  for (let i = 0; i < bins; i += 1) max = Math.max(max, out[i]);
  if (max > 0) for (let i = 0; i < bins; i += 1) out[i] /= max;
  return out;
}

function correlate(a: Float32Array, b: Float32Array, shift: number): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 1) {
    const j = i + shift;
    if (j < 0 || j >= b.length) continue;
    sum += a[i] * b[j];
    n += 1;
  }
  return n ? sum / n : 0;
}

/**
 * Best integer bin shift of SIDE profile vs FRONT (tip-aligned search).
 * Positive shift = SIDE content should move down relative to FRONT.
 */
export function bestSideYShiftBins(
  frontMask: boolean[][],
  frontBounds: BoundsLike,
  sideMask: boolean[][],
  sideBounds: BoundsLike,
  bins = 64
): { shiftBins: number; score: number } {
  const front = yProfile(frontMask, frontBounds, bins);
  const side = yProfile(sideMask, sideBounds, bins);
  const maxShift = Math.max(1, Math.round(bins * 0.08));
  let best = 0;
  let bestScore = -1;
  for (let s = -maxShift; s <= maxShift; s += 1) {
    const c = correlate(front, side, s);
    if (c > bestScore) {
      bestScore = c;
      best = s;
    }
  }
  return { shiftBins: best, score: bestScore };
}

/**
 * Convert bin shift to a fractional Y offset in [−0.08, 0.08] of content height.
 * Applied when sampling SIDE along Y in the visual hull.
 */
export function sideYOffsetFromShift(shiftBins: number, bins = 64): number {
  return (shiftBins / Math.max(1, bins)) * 0.08;
}

export function assessSideView(
  frontBounds: BoundsLike,
  sideBounds: BoundsLike
): SideViewAssessment {
  const aspectWH = frontBounds.width / Math.max(1, frontBounds.height);
  const aspectDH = sideBounds.width / Math.max(1, sideBounds.height);
  // Second FRONT: SIDE is wide AND its aspect is close to FRONT (not merely wider).
  const aspectRatio = aspectDH / Math.max(1e-6, aspectWH);
  const sideLooksLikeFront =
    aspectDH >= 0.35 && aspectRatio >= 0.8 && aspectRatio <= 1.25;
  const sideLooksLikeProfile = aspectDH < 0.28 && aspectDH < aspectWH * 0.55;

  let score = 1;
  if (sideLooksLikeFront) score -= 0.55;
  else if (aspectDH > 0.4) score -= 0.2;
  else if (sideLooksLikeProfile) score += 0.1;
  score = Math.max(0, Math.min(1, score));

  let message: string;
  if (sideLooksLikeFront) {
    message =
      "SIDE looks like another FRONT — use an edge-on profile (thin silhouette) for correct depth";
  } else if (sideLooksLikeProfile) {
    message = "SIDE profile looks good · thin depth for visual hull";
  } else {
    message = "SIDE loaded · visual hull active (FRONT ∩ SIDE)";
  }

  return {
    aspectWH,
    aspectDH,
    sideLooksLikeFront,
    sideLooksLikeProfile,
    message,
    score
  };
}
