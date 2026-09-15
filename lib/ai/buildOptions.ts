import { aiCategoryPreset, type AiCategory } from "@/lib/ai/aiCategories";
import type { CatalogItem } from "@/lib/ai/catalog";
import type { ImageVoxelOptions } from "@/lib/imageVoxel";

export function buildImageOptions(input: {
  volumeSize: number;
  heightMax: number;
  maxVoxels: number;
  symmetrize: boolean;
  useLocalAi?: boolean;
  category?: AiCategory;
}): ImageVoxelOptions {
  const preset = input.category ? aiCategoryPreset(input.category) : null;
  const aiEnabled = Boolean(input.category) && (input.useLocalAi ?? true);

  return {
    volumeSize: input.volumeSize,
    mode: aiEnabled ? "model" : "solid",
    heightMax: input.category ? preset!.heightMax : input.heightMax,
    maxVoxels: input.maxVoxels,
    symmetrize: input.category ? preset!.symmetrize : input.symmetrize,
    useLocalAi: aiEnabled,
    aiCategory: input.category
  };
}

export function presetFromCatalog(item: CatalogItem) {
  return {
    heightMax: item.depth,
    symmetrize: item.symmetrize
  };
}
