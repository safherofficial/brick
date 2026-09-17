/**
 * AI category profiles — single source of truth for 2.5D voxel props.
 *
 * Target: Unity / Godot / Unreal static props (Y-up, bottom-center pivot,
 * ~0.1 m per unit after export). Depth is intentionally capped for 2.5D
 * readability; full 3D characters are out of scope here.
 *
 * ONNX synergy: segment (U2Net) always for silhouette; depth (MiDaS) only
 * when the category benefits from volumetric cues (preferDepthMap).
 */

export type AiCategory = "swords" | "guns" | "rifles" | "objects";

/** Geometry + mask cleanup consumed by buildImageOptions / imageVoxel. */
export type AiCategoryPreset = {
  /** Max extrusion in Z (voxels). Kept thin for 2.5D game read. */
  heightMax: number;
  symmetrize: boolean;
};

/** Post-ONNX matte cleanup — preserves blades vs kills noise on props. */
export type AiCategoryPrecision = {
  minComponentPixels: number;
  minComponentRatio: number;
  preserveThinContour: boolean;
};

/**
 * Full professional profile (geometry + ONNX + engine handoff hints).
 * heightMax / symmetrize stay the public preset surface for buildOptions.
 */
export type AiCategoryProfile = AiCategoryPreset & {
  label: string;
  description: string;
  /** Run MiDaS depth when mode is relief/model. Thin blades skip depth. */
  preferDepthMap: boolean;
  /** Palette contrast multiplier (>1 = sharper game-readable edges). */
  colorSharpness: number;
  /** Default style id used by memory / catalog (sword | weapon | prop). */
  defaultStyle: "sword" | "weapon" | "pickup" | "prop";
  /** Soft cap: heightMax should stay ≤ volumeSize * maxDepthRatio. */
  maxDepthRatio: number;
  /** Prefer 1-voxel features (edges, barrels, triggers). */
  thinFeatures: boolean;
  /** Suggested sockets for engine hierarchy (documentation + export hints). */
  sockets: readonly ("grip" | "muzzle" | "mount" | "ground" | "center")[];
  precision: AiCategoryPrecision;
};

const PROFILES: Record<AiCategory, AiCategoryProfile> = {
  swords: {
    label: "Swords / blades",
    description:
      "Melee edges · thin Z · sharp silhouette · no depth map (flat blade read)",
    heightMax: 5,
    symmetrize: false,
    preferDepthMap: false,
    colorSharpness: 1.18,
    defaultStyle: "sword",
    maxDepthRatio: 0.12,
    thinFeatures: true,
    sockets: ["grip", "muzzle"],
    precision: {
      // Keep tip / guard fragments; aggressive contour preservation.
      minComponentPixels: 8,
      minComponentRatio: 0.0006,
      preserveThinContour: true
    }
  },
  guns: {
    label: "Handguns",
    description:
      "Compact sidearms · grip + slide/barrel · light depth for body mass",
    heightMax: 6,
    symmetrize: false,
    preferDepthMap: true,
    colorSharpness: 1.08,
    defaultStyle: "weapon",
    maxDepthRatio: 0.16,
    thinFeatures: true,
    sockets: ["grip", "muzzle"],
    precision: {
      minComponentPixels: 9,
      minComponentRatio: 0.0008,
      preserveThinContour: true
    }
  },
  rifles: {
    label: "Rifles / long arms",
    description:
      "Stock–receiver–barrel · more Z budget · depth for stock thickness",
    heightMax: 9,
    symmetrize: false,
    preferDepthMap: true,
    colorSharpness: 1.06,
    defaultStyle: "weapon",
    maxDepthRatio: 0.2,
    thinFeatures: true,
    sockets: ["grip", "muzzle", "mount"],
    precision: {
      // Long thin barrels survive lower ratio thresholds.
      minComponentPixels: 8,
      minComponentRatio: 0.00055,
      preserveThinContour: true
    }
  },
  objects: {
    label: "Props / pickups",
    description:
      "Crates, bottles, tools · balanced depth · slightly stricter noise cut",
    heightMax: 8,
    symmetrize: false,
    preferDepthMap: true,
    colorSharpness: 1.02,
    defaultStyle: "prop",
    maxDepthRatio: 0.22,
    thinFeatures: false,
    sockets: ["ground", "center"],
    precision: {
      minComponentPixels: 12,
      minComponentRatio: 0.001,
      preserveThinContour: true
    }
  }
};

export const AI_CATEGORIES: readonly AiCategory[] = [
  "swords",
  "guns",
  "rifles",
  "objects"
];

export function aiCategoryProfile(category: AiCategory): AiCategoryProfile {
  return PROFILES[category];
}

/** Geometry preset for buildImageOptions (stable public shape). */
export function aiCategoryPreset(category: AiCategory): AiCategoryPreset {
  const p = PROFILES[category];
  return { heightMax: p.heightMax, symmetrize: p.symmetrize };
}

/** Mask cleanup profile for cleanModelMask / aiPrecisionProfile. */
export function aiCategoryPrecision(
  category: AiCategory
): AiCategoryPrecision {
  return PROFILES[category].precision;
}

/**
 * Whether ONNX depth (MiDaS) should run for this category + mode.
 * Segment always runs when local AI is on; depth is the expensive path.
 */
export function aiCategoryWantsDepth(
  category: AiCategory | undefined,
  mode: "solid" | "flat" | "relief" | "model"
): boolean {
  if (mode === "flat") return false;
  if (!category) return mode === "relief" || mode === "model" || mode === "solid";
  return PROFILES[category].preferDepthMap;
}

export function styleFromCategory(category: AiCategory): "sword" | "weapon" | "prop" | "pickup" {
  if (category === "swords") return "sword";
  if (category === "guns" || category === "rifles") return "weapon";
  return "prop";
}

/** Clamp heightMax to category 2.5D budget for a given volume size. */
export function aiCategoryHeightMax(
  category: AiCategory,
  volumeSize: number
): number {
  const p = PROFILES[category];
  const cap = Math.max(2, Math.floor(volumeSize * p.maxDepthRatio));
  return Math.min(p.heightMax, cap);
}
