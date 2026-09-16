import type { CatalogItem } from "@/lib/ai/catalog";
import { profileById } from "@/lib/ai/styleProfiles";
import type { ImageVoxelOptions } from "@/lib/imageVoxel";

export function buildImageOptions(input: {
  volumeSize: number;
  heightMax: number;
  maxVoxels: number;
  symmetrize: boolean;
  useLocalAi?: boolean;
  catalog?: CatalogItem | null;
  outline?: boolean;
}): ImageVoxelOptions {
  const style = input.catalog?.style ?? "prop";
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
    style: item.style,
    heightMax: item.depth,
    symmetrize: item.symmetrize,
    outline: profileById(item.style).outline
  };
}
