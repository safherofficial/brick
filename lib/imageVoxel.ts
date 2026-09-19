/**
 * Public API for image → voxel. Implementation: ./image/engine.ts
 * Types also available from ./image/types.ts
 * P10 wraps the engine entry points with input guards + failure recovery.
 */
export type {
  ImageMode,
  OutputLock,
  ImageVoxel,
  ImageImport,
  ImageVoxelOptions,
  ImageViews
} from "@/lib/image/engine";

import {
  imageToVoxels as engineImageToVoxels,
  imagesToVoxels as engineImagesToVoxels
} from "@/lib/image/engine";
import type { ImageImport, ImageViews, ImageVoxelOptions } from "@/lib/image/engine";
import { assertImportableFile } from "@/lib/prod/inputGuard";
import { recoverImport } from "@/lib/prod/recover";

export async function imageToVoxels(
  file: File,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  assertImportableFile(file, "FRONT");
  return recoverImport((opts) => engineImageToVoxels(file, opts), options);
}

export async function imagesToVoxels(
  views: ImageViews,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  if (!views.front) throw new Error("FRONT IMAGE REQUIRED");
  assertImportableFile(views.front, "FRONT");
  if (views.side) assertImportableFile(views.side, "SIDE");
  return recoverImport((opts) => engineImagesToVoxels(views, opts), options);
}
