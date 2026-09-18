/**
 * Public API for image → voxel. Implementation: ./image/engine.ts
 * Types also available from ./image/types.ts
 */
export type {
  ImageMode,
  OutputLock,
  ImageVoxel,
  ImageImport,
  ImageVoxelOptions,
  ImageViews
} from "@/lib/image/engine";

export { imageToVoxels, imagesToVoxels } from "@/lib/image/engine";
