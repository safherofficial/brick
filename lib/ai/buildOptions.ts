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
  const budget = budgetForVolume(input.volumeSize);
  const output = input.output;

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
    heightMax = Math.max(2, Math.min(categoryHeight, 6));
    symmetrize = false;
  } else {
    mode = input.category ? "model" : (input.mode ?? "solid");
    heightMax = input.category
      ? aiCategoryHeightMax(input.category, input.volumeSize)
      : input.heightMax;
    symmetrize = input.category ? preset!.symmetrize : input.symmetrize;
  }

  return {
    volumeSize: input.volumeSize,
    mode,
    heightMax,
    maxVoxels: Math.min(input.maxVoxels, budget.maxVoxels),
    symmetrize,
    useLocalAi: input.useLocalAi ?? true,
    aiCategory: input.category,
    output,
    outline: output === "2d" ? (input.outline ?? true) : input.outline
  };
}

export function presetFromCatalog(item: CatalogItem) {
  return {
    heightMax: item.depth,
    symmetrize: item.symmetrize
  };
}
