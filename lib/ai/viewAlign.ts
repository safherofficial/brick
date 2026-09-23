/**
 * FRONT / SIDE view quality & vertical alignment helpers for MODEL import.
 * Non-destructive to the hull loop: scores + optional Y shift plus a conservative
 * SIDE-mask recovery pass before the existing visual-hull math consumes the mask.
 *
 * P16 adds a conservative confidence fusion pass to the SIDE silhouette. The
 * FRONT silhouette remains the hard occupancy anchor in the visual hull; only
 * small, well-supported SIDE gaps are recovered before the existing hull pass.
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
function sampleProfile(profile: Float32Array, normalizedY: number) {
  if (!profile.length) return 0;
  const y = Math.max(0, Math.min(1, normalizedY)) * (profile.length - 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(profile.length - 1, y0 + 1);
  const t = y - y0;
  return profile[y0] * (1 - t) + profile[y1] * t;
}


/**
 * P16: recover only high-confidence SIDE pixels that are likely to be small
 * capture/alignment holes rather than genuine silhouette cut-outs.
 *
 * Rules are intentionally conservative:
 * - never write outside the existing SIDE content bounds;
 * - require local SIDE continuity (3+ foreground neighbours or a bridged gap);
 * - require FRONT row support after the same normalized Y alignment;
 * - recover at most one-pixel holes, never broad missing regions.
 *
 * The function mutates the existing SIDE mask because the current engine passes
 * that same mask into the established visual-hull reconstruction. This keeps
 * P16 isolated from the hull loop and preserves the FRONT hard constraint.
 */
export function fuseSideMaskConfidence(
  frontMask: boolean[][],
  frontBounds: BoundsLike,
  sideMask: boolean[][],
  sideBounds: BoundsLike,
  yShiftBins = 0,
  bins = 64,
  alignmentConfidence = 1
): { recovered: number; considered: number } {
  if (!frontMask.length || !sideMask.length || !frontBounds.width || !sideBounds.width) {
    return { recovered: 0, considered: 0 };
  }
  const frontProfile = yProfile(frontMask, frontBounds, bins);
  const next = sideMask.map((row) => row.slice());
  const width = sideMask[0]?.length ?? 0;
  const height = sideMask.length;
  const minX = Math.max(1, sideBounds.minX);
  const maxX = Math.min(width - 2, sideBounds.maxX);
  const minY = Math.max(1, sideBounds.minY);
  const maxY = Math.min(height - 2, sideBounds.maxY);
  const shift = yShiftBins / Math.max(1, bins);
  const alignment = Math.max(0, Math.min(1, alignmentConfidence));
  let recovered = 0;
  let considered = 0;

  const rowSupport = (y: number) => {
    const ny = sideBounds.height <= 1
      ? 0.5
      : (y - sideBounds.minY + 0.5) / Math.max(1, sideBounds.height);
    const alignedNy = Math.max(0, Math.min(1, ny - shift));
    return sampleProfile(frontProfile, alignedNy);
  };

  for (let y = minY; y <= maxY; y += 1) {
    const frontSupport = rowSupport(y);
    if (frontSupport < 0.08) continue;
    for (let x = minX; x <= maxX; x += 1) {
      if (sideMask[y]?.[x]) continue;
      considered += 1;

      const left = Boolean(sideMask[y]?.[x - 1]);
      const right = Boolean(sideMask[y]?.[x + 1]);
      const up = Boolean(sideMask[y - 1]?.[x]);
      const down = Boolean(sideMask[y + 1]?.[x]);
      const neighbours =
        Number(left) + Number(right) + Number(up) + Number(down);
      const bridgedHorizontal = left && right;
      const bridgedVertical = up && down;
      const continuity = neighbours / 4;
      const bridge = bridgedHorizontal || bridgedVertical ? 1 : 0;
      const confidence =
        0.52 * continuity +
        0.26 * frontSupport +
        0.12 * bridge +
        0.10 * alignment;
      if (
        confidence >= 0.70 &&
        neighbours >= 3 &&
        (left || right) &&
        (up || down)
      ) {
        next[y][x] = true;
        recovered += 1;
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    sideMask[y] = next[y];
  }

  return { recovered, considered };
}

/**
 * Best integer bin shift of SIDE profile vs FRONT (tip-aligned search).
 * Positive shift = SIDE content should move down relative to FRONT.
 */
export type SemanticAlignmentAssessment = Readonly<{
  correlation: number;
  axisCompatibility: number;
  scaleAgreement: number;
  score: number;
}>;

/**
 * P34 — semantic FRONT/SIDE alignment confidence. This augments the existing
 * normalized-Y correlation with axis and scale agreement without changing the
 * hull occupancy contract.
 */
export function assessSemanticAlignment(
  frontMask: boolean[][],
  frontBounds: BoundsLike,
  sideMask: boolean[][],
  sideBounds: BoundsLike,
  shiftBins = 0,
  bins = 64
): SemanticAlignmentAssessment {
  const front = yProfile(frontMask, frontBounds, bins);
  const side = yProfile(sideMask, sideBounds, bins);
  const correlation = Math.max(0, Math.min(1, correlate(front, side, shiftBins)));
  const frontVertical = frontBounds.height >= frontBounds.width;
  const sideVertical = sideBounds.height >= sideBounds.width;
  const axisCompatibility = frontVertical === sideVertical ? 1 : 0.42;
  const heightRatio = sideBounds.height / Math.max(1, frontBounds.height);
  const scaleAgreement = Math.max(0, Math.min(1,
    1 - Math.abs(Math.log(Math.max(0.125, heightRatio))) / 1.8
  ));
  const score = Math.max(0, Math.min(1,
    correlation * 0.68 +
    axisCompatibility * 0.18 +
    scaleAgreement * 0.14
  ));
  return { correlation, axisCompatibility, scaleAgreement, score };
}

export function bestSideYShiftBins(
  frontMask: boolean[][],
  frontBounds: BoundsLike,
  sideMask: boolean[][],
  sideBounds: BoundsLike,
  bins = 64
): { shiftBins: number; score: number; semanticScore: number } {
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
  const semantic = assessSemanticAlignment(
    frontMask,
    frontBounds,
    sideMask,
    sideBounds,
    best,
    bins
  );
  fuseSideMaskConfidence(
    frontMask,
    frontBounds,
    sideMask,
    sideBounds,
    best,
    bins,
    semantic.score
  );
  return { shiftBins: best, score: bestScore, semanticScore: semantic.score };
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
