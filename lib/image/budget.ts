export type VoxelBudgetMode = "solid" | "flat" | "relief" | "model";
export type VoxelBudgetCategory = "swords" | "guns" | "rifles" | "objects";

export type DynamicVoxelBudgetOptions = {
  volumeSize: number;
  mode: VoxelBudgetMode;
  /** Explicit user cap. When set, dynamic allocation is disabled. */
  requested?: number;
  /** Default cap used by Brick when the user does not provide maxVoxels. */
  defaultCap: number;
  width: number;
  height: number;
  depth: number;
  projectedFill?: number;
  category?: VoxelBudgetCategory;
  /** Narrow adaptive profile nudge; ignored when requested is explicit. */
  profileScale?: number;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function roundBudget(value: number, minimum: number, maximum: number) {
  return clamp(Math.floor(value), minimum, maximum);
}

/**
 * Allocate the voxel budget from actual projected complexity rather than
 * volume size alone. The allocator is intentionally conservative:
 * - explicit maxVoxels remains authoritative;
 * - the dynamic path never exceeds Brick's historical default cap;
 * - simple/thin assets can use fewer voxels, while dense volumetric props
 *   retain most of the available budget.
 */
export function dynamicVoxelBudget(options: DynamicVoxelBudgetOptions) {
  const volumeSize = Math.max(1, Math.floor(options.volumeSize));
  const physical = volumeSize ** 3;
  const hardCap = Math.max(4096, Math.min(physical, Math.floor(options.defaultCap)));
  const dynamicMinimum = Math.min(hardCap, Math.max(4096, Math.floor(physical * 0.02)));

  if (options.requested !== undefined) {
    // An explicit user cap keeps the historical semantics: it may be lower
    // than the dynamic quality floor, but never below the engine's 4096 floor.
    return roundBudget(options.requested, Math.min(4096, hardCap), hardCap);
  }

  const width = clamp(Math.floor(options.width), 1, volumeSize);
  const height = clamp(Math.floor(options.height), 1, volumeSize);
  const depth = clamp(Math.floor(options.depth), 1, volumeSize);
  const fill = clamp(options.projectedFill ?? 0.5, 0, 1);
  const projectedAreaRatio = clamp(
    (width * height) / Math.max(1, volumeSize * volumeSize),
    0,
    1
  );
  const depthRatio = clamp(depth / volumeSize, 0, 1);
  const shortAxis = Math.max(1, Math.min(width, height));
  const longAxis = Math.max(width, height);
  const aspect = longAxis / shortAxis;
  const thinness = clamp((aspect - 1) / 7, 0, 1);

  const baseRatio =
    options.mode === "model"
      ? 0.30
      : options.mode === "relief"
        ? 0.12
        : options.mode === "flat"
          ? 0.06
          : 0.16;

  let qualityRatio = 0.84;
  qualityRatio += projectedAreaRatio * 0.08;
  qualityRatio += fill * 0.06;
  qualityRatio += depthRatio * 0.08;

  // P18 — protect high-information shapes from becoming under-budgeted.
  // Thinness, sparse coverage and long axes are exactly the cases where a
  // modest voxel increase preserves visible features instead of wasting voxels
  // on uniform interior volume.
  const sparsity = clamp(1 - fill, 0, 1);
  const detailDemand = clamp(
    thinness * 0.46 +
      sparsity * 0.24 +
      depthRatio * 0.14 +
      (options.category === "rifles" ? 0.10 : 0) +
      (options.category === "guns" ? 0.06 : 0) +
      (options.category === "swords" ? 0.04 : 0),
    0,
    1
  );
  qualityRatio += detailDemand * 0.08;

  // Thin assets were previously slightly penalized for their aspect ratio.
  // P18 removes most of that penalty and replaces it with the bounded detail
  // demand above, so long weapons do not lose resolution simply for being long.
  qualityRatio -= thinness * 0.018;

  if (options.category === "swords") {
    qualityRatio = Math.max(qualityRatio, 0.91);
  } else if (options.category === "guns") {
    qualityRatio = Math.max(qualityRatio, 0.94);
  } else if (options.category === "rifles") {
    qualityRatio = Math.max(qualityRatio, 0.97);
  } else if (options.category === "objects") {
    qualityRatio = Math.max(qualityRatio, 0.86);
  }

  const baseBudget = Math.min(hardCap, physical * baseRatio);
  const profileScale = clamp(options.profileScale ?? 1, 0.96, 1.10);

  return roundBudget(
    baseBudget * clamp(qualityRatio, 0.84, 1) * profileScale,
    dynamicMinimum,
    hardCap
  );
}
