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
 * category and the shape evidence already produced by P4/P5.
 *
 * The profile is intentionally bounded so it can only refine the existing
 * category preset; it never invents a new category or replaces a manual one.
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

  if (input.category === "swords") {
    depthScale = 0.78;
    thinFeatures = true;
    useDepthHint = false;
    reasons.push("blade profile");
  } else if (input.category === "guns") {
    depthScale = 0.94;
    thinFeatures = true;
    reasons.push("compact weapon profile");
  } else if (input.category === "rifles") {
    depthScale = 0.92;
    thinFeatures = true;
    budgetScale = 1.03;
    reasons.push("long weapon profile");
  } else {
    depthScale = 1.0;
    reasons.push("general prop profile");
  }

  if (features?.thin || features?.long) {
    depthScale -= features.thin ? 0.04 : 0.02;
    budgetScale += 0.035;
    thinFeatures = true;
    reasons.push("thin/long feature protection");
  }

  if (features?.broadHead) {
    depthScale += 0.03;
    budgetScale += 0.02;
    reasons.push("broad feature protection");
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

  // P18 — detail-preserving budget demand.
  //
  // These signals come from the existing recognizer. They do not change the
  // reconstruction geometry; they only preserve a little more voxel budget
  // for silhouettes where a small number of voxels carries disproportionate
  // visual information (thin edges, long weapons, sparse masks and irregular
  // contours).
  const edgeDetail = clamp(evidence?.edgeThinness ?? 0, 0, 1);
  const slenderDetail = clamp(((evidence?.slenderness ?? 1) - 2) / 2.5, 0, 1);
  const longDetail = features?.long ? 1 : 0;
  const sparseDetail = clamp(1 - (evidence?.fill ?? 1) / 0.5, 0, 1);
  const irregularDetail = features?.irregular ? 1 : 0;
  const broadDetail = features?.broadHead ? 1 : 0;

  const detailDemand = clamp(
    edgeDetail * 0.30 +
      slenderDetail * 0.25 +
      longDetail * 0.15 +
      sparseDetail * 0.15 +
      irregularDetail * 0.08 +
      broadDetail * 0.07,
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
    thinFeatures = input.category === "swords";
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
