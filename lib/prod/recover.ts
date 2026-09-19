import type { ImageImport, ImageVoxelOptions } from "@/lib/image/types";
import { IMPORT_TIMEOUT_MS, withTimeout } from "@/lib/prod/timeout";

function isEmptyImport(result: ImageImport) {
  return !result || !result.voxels || result.voxels.length === 0;
}

function isRecoverable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no visible subject|unable to read image|timed out/i.test(message);
}

/**
 * Run the existing pipeline first. Only on hard failure / empty mesh,
 * retry once with local AI off and a flat 2D lock.
 */
export async function recoverImport(
  run: (options: ImageVoxelOptions) => Promise<ImageImport>,
  options: ImageVoxelOptions
): Promise<ImageImport> {
  try {
    const first = await withTimeout(run(options), IMPORT_TIMEOUT_MS, "image-import");
    if (!isEmptyImport(first)) return first;
  } catch (error) {
    if (!isRecoverable(error)) throw error;
    if (options.output === "2d" && options.useLocalAi === false) throw error;
  }

  if (options.output === "2d" && options.useLocalAi === false) {
    throw new Error("No visible subject found");
  }

  const fallback: ImageVoxelOptions = {
    ...options,
    useLocalAi: false,
    output: "2d",
    mode: "flat",
    heightMax: 1
  };
  const second = await withTimeout(run(fallback), IMPORT_TIMEOUT_MS, "image-import-fallback");
  if (isEmptyImport(second)) throw new Error("No visible subject found");
  return {
    ...second,
    aiStatus: second.aiStatus
      ? `${second.aiStatus} · recovered-2d`
      : "recovered-2d"
  };
}
