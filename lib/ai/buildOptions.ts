import type { CatalogItem } from "@/lib/ai/catalog";
import type { StyleId } from "@/lib/ai/styleProfiles";
import { inferStyle, profileById } from "@/lib/ai/styleProfiles";
import type { ImageVoxelOptions } from "@/lib/imageVoxel";

export function buildImageOptions(input: {
  volumeSize: number;
  heightMax: number;
  maxVoxels: number;
  symmetrize: boolean;
  useLocalAi: boolean;
  style?: StyleId;
  outline?: boolean;
}): ImageVoxelOptions {
  const style = input.style ?? inferStyle(input.heightMax, input.symmetrize);
  const profile = profileById(style);
  return {
    volumeSize: input.volumeSize,
    heightMax: input.heightMax,
    maxVoxels: input.maxVoxels,
    symmetrize: input.symmetrize,
    useLocalAi: input.useLocalAi,
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
