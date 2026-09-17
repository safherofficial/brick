/**
 * Game-ready contract for Brick exports.
 * Single source of truth for scale, pivot, materials, sockets, poly budgets.
 * Aligns with Unity / Godot / Unreal static-prop handoff practices.
 */

import type { MeshExportOptions, Pivot, UpAxis } from "@/lib/voxelMesh";
import type { ShapeKind } from "@/lib/ai/recognize";
import type { QualityTier } from "@/lib/ai/memory";
import { GENERATOR_NAME } from "@/lib/limits";

export type EngineId = "unity" | "godot" | "unreal" | "web";

export type EngineProfile = {
  id: EngineId;
  label: string;
  unitMeters: number;
  pivot: Pivot;
  upAxis: UpAxis;
  /** Preferred forward in engine space (documentation only). */
  forward: "+z" | "-z" | "+x";
  /** glTF sampler: NEAREST keeps voxel look. */
  textureFilter: "nearest" | "linear";
  metallicFactor: number;
  roughnessFactor: number;
  doubleSided: boolean;
  notes: string;
};

/** Engine handoff profiles — all share meters + Y-up for glTF interop. */
export const ENGINE_PROFILES: Record<EngineId, EngineProfile> = {
  unity: {
    id: "unity",
    label: "Unity (URP)",
    unitMeters: 0.1,
    pivot: "bottom-center",
    upAxis: "y",
    forward: "+z",
    textureFilter: "nearest",
    metallicFactor: 0,
    roughnessFactor: 1,
    doubleSided: true,
    notes: "1 unit = 1 m after import · pivot at base · Unlit or Lit + atlas NEAREST"
  },
  godot: {
    id: "godot",
    label: "Godot 4",
    unitMeters: 0.1,
    pivot: "bottom-center",
    upAxis: "y",
    forward: "-z",
    textureFilter: "nearest",
    metallicFactor: 0,
    roughnessFactor: 1,
    doubleSided: true,
    notes: "glTF native · StandardMaterial3D · texture filter Nearest"
  },
  unreal: {
    id: "unreal",
    label: "Unreal Engine 5",
    unitMeters: 0.1,
    pivot: "bottom-center",
    upAxis: "y",
    forward: "+x",
    textureFilter: "nearest",
    metallicFactor: 0,
    roughnessFactor: 1,
    doubleSided: true,
    notes: "Import glTF · verify forward · simple BaseColor material"
  },
  web: {
    id: "web",
    label: "Web (Three / Babylon)",
    unitMeters: 0.1,
    pivot: "bottom-center",
    upAxis: "y",
    forward: "+z",
    textureFilter: "nearest",
    metallicFactor: 0,
    roughnessFactor: 1,
    doubleSided: true,
    notes: "GLB drop-in · MeshStandard or unlit · NEAREST sampling"
  }
};

/** Unity 2D / pixel tilemap handoff. Not an EngineId — keeps 3D profiles unchanged. */
export const UNITY_2D_PIXEL = {
  id: "unity-2d-pixel" as const,
  label: "Unity 2D (pixel)",
  unitMeters: 1,
  pixelsPerUnit: 16,
  pivot: "bottom-center" as const,
  upAxis: "y" as const,
  textureFilter: "nearest" as const,
  doubleSided: true,
  notes: "1 voxel = 1 unit · PPU 16 · Unlit + NEAREST · pivot bottom-center of content"
};

/** Default export = Unity-compatible (most common Brick target). */
export const DEFAULT_ENGINE: EngineId = "unity";

export function engineExportOptions(engine: EngineId = DEFAULT_ENGINE): MeshExportOptions {
  const p = ENGINE_PROFILES[engine];
  return {
    unitMeters: p.unitMeters,
    pivot: p.pivot,
    upAxis: p.upAxis
  };
}

/** Triangle / voxel budgets by quality tier (static props). */
export type OutputBudget = {
  tier: QualityTier;
  maxVoxels: number;
  /** Soft guide after greedy mesh (tris ≈ quads * 2). */
  targetTrisMax: number;
  mobileTrisHint: number;
};

export const OUTPUT_BUDGETS: Record<QualityTier, OutputBudget> = {
  32: { tier: 32, maxVoxels: 8_000, targetTrisMax: 6_000, mobileTrisHint: 3_000 },
  64: { tier: 64, maxVoxels: 28_000, targetTrisMax: 18_000, mobileTrisHint: 8_000 },
  128: { tier: 128, maxVoxels: 90_000, targetTrisMax: 45_000, mobileTrisHint: 12_000 },
  256: { tier: 256, maxVoxels: 150_000, targetTrisMax: 90_000, mobileTrisHint: 20_000 }
};

export type SocketSpec = {
  name: string;
  /** Normalized offset hint relative to bounds (0–1), applied at export if possible. */
  role: "grip" | "mount" | "center" | "muzzle" | "ground";
  description: string;
};

/** Socket suggestions by recognized shape (nodes in GLB hierarchy). */
export const SHAPE_SOCKETS: Record<ShapeKind, SocketSpec[]> = {
  sphere: [
    { name: "Socket_Ground", role: "ground", description: "Floor contact" },
    { name: "Socket_Center", role: "center", description: "Sphere center" }
  ],
  cylinder: [
    { name: "Socket_Ground", role: "ground", description: "Base of cylinder" },
    { name: "Socket_Center", role: "center", description: "Axis midpoint" }
  ],
  cone: [
    { name: "Socket_Ground", role: "ground", description: "Cone base" },
    { name: "Socket_Tip", role: "muzzle", description: "Cone tip" }
  ],
  barrel: [
    { name: "Socket_Ground", role: "ground", description: "Barrel base" },
    { name: "Socket_Center", role: "center", description: "Bulge center" }
  ],
  capsule: [
    { name: "Socket_Ground", role: "ground", description: "Rear cap" },
    { name: "Socket_Tip", role: "muzzle", description: "Front tip" }
  ],
  sword: [
    { name: "Socket_Grip", role: "grip", description: "Hand / weapon attach at base" },
    { name: "Socket_Tip", role: "muzzle", description: "Blade tip reference" }
  ],
  axe: [
    { name: "Socket_Grip", role: "grip", description: "Haft grip" },
    { name: "Socket_Head", role: "mount", description: "Head center" }
  ],
  bottle: [
    { name: "Socket_Ground", role: "ground", description: "Floor contact" },
    { name: "Socket_Cap", role: "mount", description: "Cork / lid" }
  ],
  tile: [{ name: "Socket_Ground", role: "ground", description: "Floor snap" }],
  character: [
    { name: "Socket_Ground", role: "ground", description: "Feet / root" },
    { name: "Socket_Center", role: "center", description: "Body center" }
  ],
  prop: [
    { name: "Socket_Ground", role: "ground", description: "Base pivot" },
    { name: "Socket_Grip", role: "grip", description: "Optional interact" }
  ]
};

export type MaterialContract = {
  name: string;
  metallicFactor: number;
  roughnessFactor: number;
  doubleSided: boolean;
  /** MagFilter / MinFilter: 9728 = NEAREST */
  nearestFilter: boolean;
  unlitPreferred: boolean;
};

export const VOXEL_MATERIAL_CONTRACT: MaterialContract = {
  name: "voxel-atlas",
  metallicFactor: 0,
  roughnessFactor: 1,
  doubleSided: true,
  nearestFilter: true,
  unlitPreferred: true
};

/**
 * glTF extras embedded in asset for engine tooling / importers.
 */
export function buildGlbExtras(input: {
  name: string;
  voxelCount: number;
  volumeSize: number;
  engine?: EngineId;
  shape?: ShapeKind;
  output?: "2d" | "25d";
  pixelsPerUnit?: number;
}) {
  const twoD = input.output === "2d";
  const engine = input.engine ?? DEFAULT_ENGINE;
  const profile = twoD ? UNITY_2D_PIXEL : ENGINE_PROFILES[engine];
  return {
    brick: {
      generator: GENERATOR_NAME,
      gameReady: true,
      engine: twoD ? UNITY_2D_PIXEL.id : profile.id,
      unitMeters: profile.unitMeters,
      pivot: profile.pivot,
      upAxis: profile.upAxis,
      voxelCount: input.voxelCount,
      volumeSize: input.volumeSize,
      shape: input.shape ?? null,
      material: VOXEL_MATERIAL_CONTRACT.name,
      textureFilter: "nearest",
      sockets: input.shape ? SHAPE_SOCKETS[input.shape].map((s) => s.name) : ["Socket_Grip"],
      output: input.output ?? null,
      pixelsPerUnit: twoD ? (input.pixelsPerUnit ?? UNITY_2D_PIXEL.pixelsPerUnit) : null
    }
  };
}

export function gameReadyChecklist(): string[] {
  return [
    "Scale: 0.1 m per voxel (1 unit = 1 m in engine after import)",
    "Pivot: bottom-center (floor props / weapon base)",
    "Up axis: Y (glTF / Unity / Godot)",
    "Mesh: greedy quads (not one cube = one mesh)",
    "Material: single atlas, metallic 0, roughness 1, NEAREST filter",
    "Hierarchy: mesh root + Socket_* empty nodes",
    "Formats: GLB textured (primary), VOX, OBJ archive, PNG ortho for 2D",
    "No editor-only lights baked into the file"
  ];
}
