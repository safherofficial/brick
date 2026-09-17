/**
 * Import-time metrics for FRONT/SIDE MODEL path (UI warnings + regression).
 */
import type { BoundsLike, SideViewAssessment } from "@/lib/ai/viewAlign";
import { assessSideView } from "@/lib/ai/viewAlign";

export type HullMetrics = {
  assessment: SideViewAssessment;
  frontAspect: number;
  sideAspect: number;
  /** Estimated depth/height from SIDE box */
  depthOverHeight: number;
  /** True when depth soft-clamp from ONNX should engage */
  sideAmbiguous: boolean;
  warning: string | null;
  label: string;
};

/** SIDE is neither thin profile nor second-front — depth soft-clamp is useful. */
export function isSideAmbiguous(assessment: SideViewAssessment): boolean {
  if (assessment.sideLooksLikeFront) return false;
  if (assessment.sideLooksLikeProfile) return false;
  // Mid band: somewhat wide but not a full front duplicate.
  return assessment.aspectDH >= 0.22 && assessment.aspectDH < 0.45;
}

export function computeHullMetrics(
  frontBounds: BoundsLike,
  sideBounds: BoundsLike
): HullMetrics {
  const assessment = assessSideView(frontBounds, sideBounds);
  const sideAmbiguous = isSideAmbiguous(assessment);
  let warning: string | null = null;
  if (assessment.sideLooksLikeFront) {
    warning =
      "SIDE resembles FRONT — prefer a thin edge-on profile for correct depth";
  } else if (assessment.aspectDH > 0.35 && !assessment.sideLooksLikeProfile) {
    warning = "SIDE is fairly wide — mesh may be thicker than expected";
  }

  const label = assessment.sideLooksLikeProfile
    ? `SIDE OK · score ${(assessment.score * 100).toFixed(0)}%`
    : assessment.sideLooksLikeFront
      ? `SIDE WARN · score ${(assessment.score * 100).toFixed(0)}%`
      : `SIDE · score ${(assessment.score * 100).toFixed(0)}% · D/H ${assessment.aspectDH.toFixed(2)}`;

  return {
    assessment,
    frontAspect: assessment.aspectWH,
    sideAspect: assessment.aspectDH,
    depthOverHeight: assessment.aspectDH,
    sideAmbiguous,
    warning,
    label
  };
}

/** Bounding box of voxels for regression snapshots. */
export function voxelBounds(voxels: { x: number; y: number; z: number }[]) {
  if (!voxels.length) {
    return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, w: 0, h: 0, d: 0, count: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of voxels) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    minZ = Math.min(minZ, v.z);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    maxZ = Math.max(maxZ, v.z);
  }
  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    d: maxZ - minZ + 1,
    count: voxels.length
  };
}
