/**
 * Unity handoff helpers. P12: per-shape meters-per-voxel (unityUnitMeters).
 * Pivot stays bottom-center. 2D tile path stays 1 voxel = 1 unit.
 */

import { engineExportOptions, UNITY_2D_PIXEL, unityUnitMeters } from "@/lib/ai/gameReady";

export { unityUnitMeters } from "@/lib/ai/gameReady";

export const UNITY_EXPORT = engineExportOptions("unity");

export function unity2dPixelExportOptions() {
  return {
    unitMeters: UNITY_2D_PIXEL.unitMeters,
    pivot: UNITY_2D_PIXEL.pivot,
    upAxis: UNITY_2D_PIXEL.upAxis,
    output: "2d" as const
  };
}

export function unityVoxelSpanY(volume: {
  voxels: () => Iterable<{ y: number }>;
}): number {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of volume.voxels()) {
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  if (!Number.isFinite(minY)) return 1;
  return Math.max(1, maxY - minY + 1);
}

export function unityExportOptions(input: {
  name?: string;
  shape?: string;
  voxelSpanY: number;
  output?: "2d" | "25d";
}) {
  if (input.output === "2d") {
    return {
      ...unity2dPixelExportOptions(),
      name: input.name,
      shape: input.shape
    };
  }
  return {
    ...UNITY_EXPORT,
    unitMeters: unityUnitMeters(input.shape, input.voxelSpanY, input.output),
    name: input.name,
    shape: input.shape
  };
}
