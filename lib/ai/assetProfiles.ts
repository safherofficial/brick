import type { AiCategory } from "@/lib/ai/aiCategories";
import type { RecognitionEvidence, RecognitionFeatures } from "@/lib/ai/recognize";
import type { ImageMode } from "@/lib/image/types";

export type AdaptiveAssetProfileInput = {
  category: AiCategory;
  features?: RecognitionFeatures;
  evidence?: RecognitionEvidence;
  width: number;
  height: number;
  volumeSize: number;
  mode: ImageMode;
  hasSide: boolean;
  hasDepth: boolean;
};
export type AdaptiveAssetProfile = {
  category: AiCategory;
  depthScale: number;
  budgetScale: number;
  thinFeatures: boolean;
  useDepthHint: boolean;
  shell: boolean;
  reason: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
/**
 * Derives a narrow, deterministic profile from the selected/recognized
 * category and the shape evidence already produced by the recognizer.
 *
 * P25 makes the category differences explicit while keeping the existing
 * bounded-profile contract: no new category is invented and manual category
 * selection still remains authoritative upstream.
 */
export function adaptiveAssetProfile(
  input: AdaptiveAssetProfileInput
): AdaptiveAssetProfile {
  const features = input.features;
  const evidence = input.evidence;
  let depthScale = 1;
  let budgetScale = 1;
  let thinFeatures = false;
  let useDepthHint = input.category !== "swords" && input.hasDepth;
  const shell = input.category === "swords";
  const reasons: string[] = [];

  // P25 — category-specific reconstruction baseline.
  // Swords stay shallow, guns keep compact body mass, rifles get the highest
  // detail budget for long thin structures, while generic props stay balanced.
  if (input.category === "swords") {
    depthScale = 0.76;
    budgetScale = 1.0;
    thinFeatures = true;
    useDepthHint = false;
    reasons.push("blade profile");
  } else if (input.category === "guns") {
    depthScale = 0.92;
    budgetScale = 1.02;
    thinFeatures = true;
    reasons.push("compact weapon profile");
  } else if (input.category === "rifles") {
    depthScale = 0.90;
    budgetScale = 1.055;
    thinFeatures = true;
    reasons.push("long weapon profile");
  } else {
    depthScale = 1.0;
    budgetScale = 0.99;
    reasons.push("general prop profile");
  }

  if (features?.thin || features?.long) {
    depthScale -= features.thin ? 0.04 : 0.02;
    budgetScale += 0.035;
    thinFeatures = true;
    reasons.push("thin/long feature protection");
  }

  // P26 — the explicit thin-feature detector carries more weight than the
  // legacy boolean alone. This protects one-voxel edges, barrels, blades and
  // tips without changing the historical category caps.
  const thinFeatureScore = clamp(features?.thinFeatureScore ?? evidence?.thinFeatureScore ?? 0, 0, 1);
  if (thinFeatureScore >= 0.44) {
    thinFeatures = true;
    budgetScale += 0.055 * thinFeatureScore;
    if (input.category !== "swords") depthScale -= 0.01 * thinFeatureScore;
    reasons.push("thin-feature detector");
  }

  if (features?.tipLike || (evidence?.tipSharpness ?? 0) >= 0.58) {
    budgetScale += 0.018;
    reasons.push("terminal detail protection");
  }

  if (features?.broadHead) {
    depthScale += 0.03;
    budgetScale += 0.02;
    reasons.push("broad feature protection");
  }

  // P25 — category-specific mass/detail refinements. These are deliberately
  // small so existing geometry and depth limits remain the hard safety caps.
  if (input.category === "guns") {
    if ((evidence?.fill ?? 0) >= 0.34 && (evidence?.bulge ?? 0) >= 1.16) {
      depthScale += 0.025;
      reasons.push("handgun body mass");
    }
    if ((evidence?.fill ?? 1) <= 0.2) {
      depthScale -= 0.018;
      reasons.push("sparse handgun silhouette");
    }
  } else if (input.category === "rifles") {
    if ((evidence?.slenderness ?? 1) >= 3.1 || (evidence?.widthCv ?? 0) >= 0.16) {
      budgetScale += 0.025;
      reasons.push("rifle component preservation");
    }
    if ((evidence?.fill ?? 1) <= 0.2) {
      depthScale -= 0.012;
      reasons.push("sparse rifle silhouette");
    }
  } else if (input.category === "swords") {
    if ((evidence?.taper ?? 1) <= 0.58 || (evidence?.tipSharpness ?? 0) >= 0.58) {
      budgetScale += 0.025;
      reasons.push("blade tip/edge preservation");
    }
  } else if (input.category === "objects") {
    if ((evidence?.bulge ?? 0) >= 1.28 && (evidence?.fill ?? 0) >= 0.42) {
      depthScale += 0.04;
      budgetScale += 0.015;
      reasons.push("prop body mass");
    }
  }

  if ((evidence?.bulge ?? 0) >= 1.28) {
    depthScale += 0.025;
    reasons.push("body mass evidence");
  }
  if ((evidence?.fill ?? 1) <= 0.22 && input.category !== "swords") {
    depthScale -= 0.02;
    reasons.push("sparse silhouette");
  }

  if (input.hasSide && input.category !== "swords") {
    // A real second view supports slightly more depth, but never enough to
    // exceed the existing category cap later in the engine.
    depthScale += 0.035;
    budgetScale += 0.02;
    reasons.push("dual-view support");
  }

  // P18 — detail-preserving budget demand. P25/P26 only refine this demand;
  // they do not replace the established budget allocator.
  const edgeDetail = clamp(evidence?.edgeThinness ?? 0, 0, 1);
  const slenderDetail = clamp(((evidence?.slenderness ?? 1) - 2) / 2.5, 0, 1);
  const longDetail = features?.long ? 1 : 0;
  const sparseDetail = clamp(1 - (evidence?.fill ?? 1) / 0.5, 0, 1);
  const irregularDetail = features?.irregular ? 1 : 0;
  const broadDetail = features?.broadHead ? 1 : 0;
  const detailDemand = clamp(
    edgeDetail * 0.26 +
      slenderDetail * 0.21 +
      longDetail * 0.13 +
      sparseDetail * 0.13 +
      irregularDetail * 0.07 +
      broadDetail * 0.06 +
      thinFeatureScore * 0.14,
    0,
    1
  );

  if (detailDemand > 0.08) {
    budgetScale += 0.06 * detailDemand;
    reasons.push("detail-preserving voxel budget");
  }

  if (input.mode === "flat") {
    depthScale = 1;
    budgetScale = 1;
    useDepthHint = false;
    thinFeatures = input.category === "swords" || thinFeatureScore >= 0.44;
    reasons.push("flat output lock");
  } else if (input.mode === "relief") {
    depthScale = clamp(depthScale, 0.82, 1.04);
  }

  if (!input.hasDepth && input.category !== "swords") {
    useDepthHint = false;
    reasons.push("no depth map");
  }

  // Keep adaptation deliberately narrow. Existing category presets remain the
  // hard safety boundary; this profile only nudges them.
  depthScale = clamp(depthScale, 0.72, 1.08);
  budgetScale = clamp(budgetScale, 0.96, 1.10);

  return {
    category: input.category,
    depthScale,
    budgetScale,
    thinFeatures,
    useDepthHint,
    shell,
    reason: reasons.join(" · ")
  };
}
export function adaptiveHeightMax(
  currentHeightMax: number,
  volumeSize: number,
  profile: AdaptiveAssetProfile
) {
  const maxAllowed = Math.max(2, volumeSize - 1);
  return Math.max(
    2,
    Math.min(maxAllowed, Math.round(currentHeightMax * profile.depthScale))
  );
}
