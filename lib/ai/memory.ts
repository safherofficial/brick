/**
 * Brick AI Memory — in-browser knowledge base for professional voxel assets.
 * No external APIs. Used by the local ONNX + heuristic pipeline.
 */

import type { StyleId } from "@/lib/ai/styleProfiles";
import type { ShapeKind } from "@/lib/ai/recognize";
import type { AiCategory } from "@/lib/ai/aiCategories";

export type QualityTier = 32 | 64 | 128 | 256;

export type DetailBudget = {
  volumeSize: QualityTier;
  maxVoxels: number;
  paletteSize: number;
  minFeature: number;
  edgePreserve: number;
  depthBoost: number;
  textureWeight: number;
  lintPasses: number;
};

/** Resolution budgets for engine-ready props (Unity / Godot / Unreal-friendly). */
export const QUALITY_BUDGETS: Record<QualityTier, DetailBudget> = {
  32: {
    volumeSize: 32,
    maxVoxels: 8_000,
    paletteSize: 16,
    minFeature: 1,
    edgePreserve: 0.55,
    depthBoost: 0.9,
    textureWeight: 0.35,
    lintPasses: 1
  },
  64: {
    volumeSize: 64,
    maxVoxels: 28_000,
    paletteSize: 24,
    minFeature: 1,
    edgePreserve: 0.7,
    depthBoost: 1,
    textureWeight: 0.5,
    lintPasses: 1
  },
  128: {
    volumeSize: 128,
    maxVoxels: 90_000,
    paletteSize: 40,
    minFeature: 1,
    edgePreserve: 0.85,
    depthBoost: 1.05,
    textureWeight: 0.7,
    lintPasses: 2
  },
  256: {
    volumeSize: 256,
    maxVoxels: 220_000,
    paletteSize: 64,
    minFeature: 2,
    edgePreserve: 0.95,
    depthBoost: 1.12,
    textureWeight: 0.85,
    lintPasses: 2
  }
};

export type ShapeMemory = {
  kind: ShapeKind;
  style: StyleId;
  /** Preferred orthographic depth ratio (Z vs XY). */
  depthRatio: number;
  symmetrize: boolean;
  /** Keep thin features (guards, barrels, handles). */
  thinFeatures: boolean;
  segmentThreshold: number;
  notes: string;
};

/** Shape priors used after silhouette detection / recognition. */
export const SHAPE_MEMORY: readonly ShapeMemory[] = [
  {
    kind: "sword",
    style: "sword",
    depthRatio: 0.12,
    symmetrize: false,
    thinFeatures: true,
    segmentThreshold: 0.32,
    notes: "Long thin blade · preserve tip and guard · low Z depth"
  },
  {
    kind: "axe",
    style: "weapon",
    depthRatio: 0.22,
    symmetrize: false,
    thinFeatures: true,
    segmentThreshold: 0.34,
    notes: "Wide head · narrow haft · keep edge silhouette"
  },
  {
    kind: "bottle",
    style: "pickup",
    depthRatio: 0.45,
    symmetrize: true,
    thinFeatures: false,
    segmentThreshold: 0.38,
    notes: "Rounded body · optional cork · vertical symmetry"
  },
  {
    kind: "tile",
    style: "tile",
    depthRatio: 0.08,
    symmetrize: false,
    thinFeatures: false,
    segmentThreshold: 0.4,
    notes: "Flat prop / floor piece · minimal depth"
  },
  {
    kind: "character",
    style: "character",
    depthRatio: 0.35,
    symmetrize: true,
    thinFeatures: true,
    segmentThreshold: 0.36,
    notes: "Biped silhouette · limbs · moderate depth"
  },
  {
    kind: "prop",
    style: "prop",
    depthRatio: 0.4,
    symmetrize: false,
    thinFeatures: true,
    segmentThreshold: 0.35,
    notes: "General game object · balanced detail retention"
  }
];

export type CategoryMemory = {
  category: AiCategory;
  defaultStyle: StyleId;
  heightMax: number;
  preferDepthMap: boolean;
  colorSharpness: number;
  description: string;
};

export const CATEGORY_MEMORY: readonly CategoryMemory[] = [
  {
    category: "swords",
    defaultStyle: "sword",
    heightMax: 5,
    preferDepthMap: false,
    colorSharpness: 1.15,
    description: "Blades and melee edges · thin Z · sharp outline"
  },
  {
    category: "guns",
    defaultStyle: "weapon",
    heightMax: 6,
    preferDepthMap: true,
    colorSharpness: 1.05,
    description: "Handguns · compact body · grip and barrel cues"
  },
  {
    category: "rifles",
    defaultStyle: "weapon",
    heightMax: 9,
    preferDepthMap: true,
    colorSharpness: 1.05,
    description: "Long arms · stock/barrel depth budget"
  },
  {
    category: "objects",
    defaultStyle: "prop",
    heightMax: 8,
    preferDepthMap: true,
    colorSharpness: 1,
    description: "Props, crates, pickups · preserve small protrusions"
  }
];

/** Unity / common engines: fixed scale and pivot (matches existing UNITY_EXPORT). */
export const ENGINE_MEMORY = {
  unitMeters: 0.1,
  pivot: "bottom-center" as const,
  upAxis: "y" as const,
  /** Prefer manifold-ish solids for collision proxies. */
  solidBias: true,
  /** Max recommended poly after GLB export for mobile engines. */
  mobilePolyHint: 12_000
};

export function qualityFromVolumeSize(size: number): QualityTier {
  if (size <= 32) return 32;
  if (size <= 64) return 64;
  if (size <= 128) return 128;
  return 256;
}

export function budgetForVolume(size: number): DetailBudget {
  return QUALITY_BUDGETS[qualityFromVolumeSize(size)];
}

export function shapeMemoryOf(kind: ShapeKind): ShapeMemory {
  return SHAPE_MEMORY.find((s) => s.kind === kind) ?? SHAPE_MEMORY[SHAPE_MEMORY.length - 1];
}

export function categoryMemoryOf(id: AiCategory | undefined): CategoryMemory {
  return CATEGORY_MEMORY.find((c) => c.category === id) ?? CATEGORY_MEMORY[3];
}

/**
 * Texture / material hints for palette baking (deterministic, no network).
 * Higher contrast → fewer muddy mid-tones for game read.
 */
export function textureContrastFor(kind: ShapeKind, tier: QualityTier): number {
  const base = shapeMemoryOf(kind).thinFeatures ? 1.12 : 1.0;
  const tierBoost = tier >= 128 ? 1.05 : 1;
  return base * tierBoost;
}

/** Soft poly guide after greedy meshing (pairs with gameReady OUTPUT_BUDGETS). */
export function polyBudgetForVolume(size: number): { maxVoxels: number; targetTrisMax: number; mobileTrisHint: number } {
  const tier = qualityFromVolumeSize(size);
  const map = {
    32: { maxVoxels: 8_000, targetTrisMax: 6_000, mobileTrisHint: 3_000 },
    64: { maxVoxels: 28_000, targetTrisMax: 18_000, mobileTrisHint: 8_000 },
    128: { maxVoxels: 90_000, targetTrisMax: 45_000, mobileTrisHint: 12_000 },
    256: { maxVoxels: 150_000, targetTrisMax: 90_000, mobileTrisHint: 20_000 }
  } as const;
  return map[tier];
}

/** Height max bias from shape memory for single-view relief fallback. */
export function heightMaxFromShape(kind: ShapeKind, volumeSize: number): number {
  const ratio = shapeMemoryOf(kind).depthRatio;
  return Math.max(2, Math.round(volumeSize * ratio * 0.35));
}
