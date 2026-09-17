import {
  aiCategoryHeightMax,
  aiCategoryPrecision,
  aiCategoryWantsDepth,
  styleFromCategory
} from "@/lib/ai/aiCategories";
import { profileById } from "@/lib/ai/styleProfiles";

export type ImageMode =
  | "solid"
  | "flat"
  | "relief"
  | "model";

/** Locks 2D / 2.5D output. When set, wins over category and solid/model. */
export type OutputLock = "2d" | "25d";

export type ImageVoxel = {
  x: number;
  y: number;
  z: number;
  c: number;
};

export type ImageImport = {
  width: number;
  height: number;
  voxels: ImageVoxel[];
  palette: string[];
  count: number;
  /** (D) Compact local-AI status for UI, e.g. "segment OK · depth skip · 48×96×8" */
  aiStatus?: string;
  shape?: string;
  category?: import("@/lib/ai/aiCategories").AiCategory;
};

export type ImageVoxelOptions = {
  volumeSize?: number;
  mode?: ImageMode;
  heightMax?: number;
  maxVoxels?: number;
  symmetrize?: boolean;
  useLocalAi?: boolean;
  aiCategory?: import("@/lib/ai/aiCategories").AiCategory;
  /** When set, forces 2D sprite or 2.5D relief and wins over category/solid. */
  output?: OutputLock;
  /** 1px silhouette ink. Defaults on for output "2d". */
  outline?: boolean;
};

export type ImageViews = {
  front: File;
  side?: File;
};

type NormalizedImageVoxelOptions = Omit<Required<ImageVoxelOptions>, "aiCategory" | "useLocalAi" | "output" | "outline"> & {
  aiCategory?: ImageVoxelOptions["aiCategory"];
  output?: OutputLock;
  outline?: boolean;
  /** When true, ONNX depth may soft-clamp Z (ambiguous SIDE only). */
  sideAmbiguous?: boolean;
  /** (C) Per-row depth thickness bias for guns/rifles/objects. */
  useDepthThickness?: boolean;
};

function applyOutputLock(normalized: NormalizedImageVoxelOptions) {
  if (normalized.output === "2d") {
    normalized.mode = "flat";
    normalized.heightMax = 1;
    normalized.symmetrize = false;
    normalized.useDepthThickness = false;
    normalized.sideAmbiguous = false;
    if (normalized.outline === undefined) normalized.outline = true;
    return;
  }
  if (normalized.output === "25d") {
    if (normalized.mode === "flat" || normalized.mode === "solid" || normalized.mode === "model") {
      normalized.mode = "relief";
    }
    normalized.heightMax = Math.max(2, Math.min(normalized.heightMax, 6));
    normalized.symmetrize = false;
  }
}
