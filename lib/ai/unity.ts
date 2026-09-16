import type { MeshExportOptions } from "@/lib/voxelMesh";
import { engineExportOptions, ENGINE_PROFILES } from "@/lib/ai/gameReady";

/** @deprecated Prefer engineExportOptions("unity") — kept for existing imports. */
export const UNITY_EXPORT: Required<Pick<MeshExportOptions, "unitMeters" | "pivot" | "upAxis">> = {
  unitMeters: ENGINE_PROFILES.unity.unitMeters,
  pivot: ENGINE_PROFILES.unity.pivot,
  upAxis: ENGINE_PROFILES.unity.upAxis
};

export function unityExportOptions(): MeshExportOptions {
  return engineExportOptions("unity");
}
