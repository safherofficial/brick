import { aiCategoryPreset, type AiCategory } from "@/lib/ai/aiCategories";
import type { CatalogItem } from "@/lib/ai/catalog";
import type { ImageMode, ImageVoxelOptions } from "@/lib/imageVoxel";
import { budgetForVolume } from "@/lib/ai/memory";

export function buildImageOptions(input: {
  volumeSize: number;
  heightMax: number;
  maxVoxels: number;
  symmetrize: boolean;
  useLocalAi?: boolean;
  category?: AiCategory;
  mode?: ImageMode;
}): ImageVoxelOptions {
  const preset = input.category ? aiCategoryPreset(input.category) : null;
  const budget = budgetForVolume(input.volumeSize);

  // Category forces model + preset geometry; otherwise respect explicit mode from the UI.
  const mode: ImageMode = input.category
    ? "model"
    : (input.mode ?? "solid");

  return {
    volumeSize: input.volumeSize,
    mode,
    heightMax: input.category ? preset!.heightMax : input.heightMax,
    maxVoxels: Math.min(input.maxVoxels, budget.maxVoxels),
    symmetrize: input.category ? preset!.symmetrize : input.symmetrize,
    useLocalAi: input.useLocalAi ?? true,
    aiCategory: input.category
  };
}

export function presetFromCatalog(item: CatalogItem) {
  return {
    heightMax: item.depth,
    symmetrize: item.symmetrize
  };
}
