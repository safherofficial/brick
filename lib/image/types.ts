import type { AiCategory } from "@/lib/ai/aiCategories";

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
  category?: AiCategory;
  /** P9 automatic quality-control result for the final voxel asset. */
  qualityControl?: import("@/lib/image/qualityControl").QualityControlResult;
};

export type ImageVoxelOptions = {
  volumeSize?: number;
  mode?: ImageMode;
  heightMax?: number;
  maxVoxels?: number;
  symmetrize?: boolean;
  useLocalAi?: boolean;
  aiCategory?: AiCategory;
  output?: OutputLock;
  outline?: boolean;
};

export type ImageViews = {
  front: File;
  side?: File;
};

export type NormalizedImageVoxelOptions = Omit<
  Required<ImageVoxelOptions>,
  "aiCategory" | "useLocalAi" | "output" | "outline"
> & {
  aiCategory?: ImageVoxelOptions["aiCategory"];
  output?: OutputLock;
  outline?: boolean;
  sideAmbiguous?: boolean;
  useDepthThickness?: boolean;
  maxVoxelsExplicit?: boolean;
  adaptiveBudgetScale?: number;
};

export type Raster = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

export type Sample = {
  r: number;
  g: number;
  b: number;
  a: number;
  visible: boolean;
};

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export type Dimensions = {
  width: number;
  height: number;
  depth: number;
};

export type AiPrecisionProfile = {
  minComponentPixels: number;
  minComponentRatio: number;
  preserveThinContour: boolean;
};

export type LocalAiResult = {
  raster: Raster;
  depth: Float32Array | null;
  diagnostics?: {
    segment: string;
    depth: string;
    segmentSize: string;
  };
};
