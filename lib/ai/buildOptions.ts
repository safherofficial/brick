import {
  aiCategoryHeightMax,
  aiCategoryPreset,
  type AiCategory
} from "@/lib/ai/aiCategories";
import type { CatalogItem } from "@/lib/ai/catalog";
import type { ImageMode, ImageVoxelOptions, OutputLock } from "@/lib/imageVoxel";
import { budgetForVolume } from "@/lib/ai/memory";

export function buildImageOptions(input: {
  volumeSize: number;
  heightMax: number;
  maxVoxels: number;
  symmetrize: boolean;
  useLocalAi?: boolean;
  category?: AiCategory;
  mode?: ImageMode;
  output?: OutputLock;
  outline?: boolean;
}): ImageVoxelOptions {
  const preset = input.category ? aiCategoryPreset(input.category) : null;
  // Premium raster outputs use a larger working canvas so the final game asset does not lose source contour detail simply because the editor volume starts at 128³.
  const output = input.output;
  const outputVolumeSize = output === "2d" || output === "25d"
    ? Math.max(input.volumeSize, 256)
    : input.volumeSize;
  const budget = budgetForVolume(outputVolumeSize);

  // output lock wins over category-forced model and over solid.
  let mode: ImageMode;
  let heightMax: number;
  let symmetrize: boolean;

  if (output === "2d") {
    mode = "flat";
    heightMax = 1;
    symmetrize = false;
  } else if (output === "25d") {
    mode = "relief";
    const categoryHeight = input.category
      ? aiCategoryHeightMax(input.category, input.volumeSize)
      : input.heightMax;
    // More depth planes produce a smoother, more deliberate relief instead of a visibly stepped extrusion.
    heightMax = Math.max(4, Math.min(categoryHeight, 8));
    symmetrize = false;
  } else {
    mode = input.category ? "model" : (input.mode ?? "solid");
    heightMax = input.category
      ? aiCategoryHeightMax(input.category, input.volumeSize)
      : input.heightMax;
    symmetrize = input.category ? preset!.symmetrize : input.symmetrize;
  }

  return {
    volumeSize: outputVolumeSize,
    mode,
    heightMax,
    maxVoxels: Math.min(input.maxVoxels, budget.maxVoxels),
    symmetrize,
    useLocalAi: input.useLocalAi ?? true,
    aiCategory: input.category,
    output,
    outline: output === "2d" ? (input.outline ?? false) : input.outline
  };
}

export function presetFromCatalog(item: CatalogItem) {
  return {
    heightMax: item.depth,
    symmetrize: item.symmetrize
  };
}
