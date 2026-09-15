import { aiCategoryPreset, type AiCategory } from "@/lib/ai/aiCategories";
import type { CatalogItem } from "@/lib/ai/catalog";
import { inferStyle, profileById, type StyleId } from "@/lib/ai/styleProfiles";
import type { ImageVoxelOptions } from "@/lib/imageVoxel";

export function buildImageOptions(input: {
  volumeSize: number;
  heightMax: number;
  maxVoxels: number;
  symmetrize: boolean;
  useLocalAi?: boolean;
  style?: StyleId;
  outline?: boolean;
  category?: AiCategory;
}): ImageVoxelOptions {
  const fromCategory = input.category ? aiCategoryPreset(input.category) : null;
  const style =
    input.style ??
    fromCategory?.style ??
    inferStyle(input.heightMax, input.symmetrize);
  const profile = profileById(style);
  return {
    volumeSize: input.volumeSize,
    heightMax: input.heightMax,
    maxVoxels: input.maxVoxels,
    symmetrize: input.symmetrize,
    useLocalAi: input.useLocalAi ?? true,
    style,
    outline: input.outline ?? profile.outline
  };
}

export function presetFromCatalog(item: CatalogItem) {
  return {
    style: item.category,
    heightMax: item.depth,
    symmetrize: item.symmetrize,
    outline: profileById(item.category).outline
  };
}
