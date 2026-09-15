import type { MeshExportOptions } from "@/lib/voxelMesh";

export const UNITY_EXPORT: Required<Pick<MeshExportOptions, "unitMeters" | "pivot" | "upAxis">> = {
  unitMeters: 0.1,
  pivot: "bottom-center",
  upAxis: "y"
};
