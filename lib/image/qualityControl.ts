import type { ImageVoxel } from "@/lib/image/types";

type QualitySeverity = "info" | "warning" | "error";

export type QualityMetric = {
  name: string;
  value: number;
  score: number;
  severity: QualitySeverity;
  message: string;
};

export type QualityStatus = "accept" | "repair" | "reject";

export type QualityControlResult = {
  score: number;
  status: QualityStatus;
  metrics: QualityMetric[];
  silhouetteRetention: number;
  projectionPrecision: number;
  occupancy: number;
  componentCount: number;
  paletteCoverage: number;
  voxelCount: number;
};

function clamp(n: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, n));
}

function voxelKey(v: ImageVoxel) {
  return `${v.x}:${v.y}:${v.z}`;
}

function boundsOf(voxels: ImageVoxel[]) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const v of voxels) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    minZ = Math.min(minZ, v.z);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    maxZ = Math.max(maxZ, v.z);
  }

  if (!Number.isFinite(minX)) return null;
  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    depth: maxZ - minZ + 1
  };
}

function connectedComponents(voxels: ImageVoxel[]) {
  if (!voxels.length) return 0;
  const set = new Set(voxels.map(voxelKey));
  const visited = new Set<string>();
  let count = 0;

  for (const voxel of voxels) {
    const start = voxelKey(voxel);
    if (visited.has(start)) continue;
    count += 1;
    const queue: ImageVoxel[] = [voxel];
    visited.add(start);

    while (queue.length) {
      const current = queue.pop()!;
      const neighbours = [
        [current.x + 1, current.y, current.z],
        [current.x - 1, current.y, current.z],
        [current.x, current.y + 1, current.z],
        [current.x, current.y - 1, current.z],
        [current.x, current.y, current.z + 1],
        [current.x, current.y, current.z - 1]
      ];
      for (const [x, y, z] of neighbours) {
        const key = `${x}:${y}:${z}`;
        if (!set.has(key) || visited.has(key)) continue;
        visited.add(key);
        queue.push({ x, y, z, c: 0 });
      }
    }
  }

  return count;
}

function projectSilhouette(voxels: ImageVoxel[]) {
  const bounds = boundsOf(voxels);
  const projected = new Set<string>();
  if (!bounds) return { projected, bounds: null };
  for (const v of voxels) {
    projected.add(`${v.x}:${v.y}`);
  }
  return { projected, bounds };
}

function maskBounds(mask: boolean[][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let area = 0;

  for (let y = 0; y < mask.length; y += 1) {
    for (let x = 0; x < (mask[y]?.length ?? 0); x += 1) {
      if (!mask[y][x]) continue;
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!area || !Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, area };
}

function silhouetteMetrics(voxels: ImageVoxel[], mask: boolean[][]) {
  const maskBox = maskBounds(mask);
  const { projected, bounds } = projectSilhouette(voxels);
  if (!maskBox || !bounds || !projected.size) {
    return { retention: 0, precision: 0 };
  }

  let maskHits = 0;
  let projectedHits = 0;
  const sourceWidth = Math.max(1, maskBox.maxX - maskBox.minX + 1);
  const sourceHeight = Math.max(1, maskBox.maxY - maskBox.minY + 1);
  const targetWidth = Math.max(1, bounds.width);
  const targetHeight = Math.max(1, bounds.height);

  for (let y = maskBox.minY; y <= maskBox.maxY; y += 1) {
    for (let x = maskBox.minX; x <= maskBox.maxX; x += 1) {
      if (!mask[y]?.[x]) continue;
      const nx = sourceWidth <= 1 ? 0 : (x - maskBox.minX) / (sourceWidth - 1);
      const ny = sourceHeight <= 1 ? 0 : (y - maskBox.minY) / (sourceHeight - 1);
      const tx = Math.round(bounds.minX + nx * (targetWidth - 1));
      const ty = Math.round(bounds.minY + ny * (targetHeight - 1));
      if (projected.has(`${tx}:${ty}`)) maskHits += 1;
    }
  }
  const retention = maskHits / Math.max(1, maskBox.area);

  for (const key of projected) {
    const [sx, sy] = key.split(":").map(Number);
    const nx = targetWidth <= 1 ? 0 : (sx - bounds.minX) / (targetWidth - 1);
    const ny = targetHeight <= 1 ? 0 : (sy - bounds.minY) / (targetHeight - 1);
    const x = Math.round(maskBox.minX + nx * (sourceWidth - 1));
    const y = Math.round(maskBox.minY + ny * (sourceHeight - 1));
    if (mask[y]?.[x]) projectedHits += 1;
  }
  const precision = projectedHits / Math.max(1, projected.size);
  return { retention, precision };
}

export function repairVoxelIntegrity(voxels: ImageVoxel[]): ImageVoxel[] {
  if (!voxels.length) return voxels;
  const seen = new Set<string>();
  const repaired: ImageVoxel[] = [];
  for (const voxel of voxels) {
    if (
      !Number.isFinite(voxel.x) ||
      !Number.isFinite(voxel.y) ||
      !Number.isFinite(voxel.z) ||
      !Number.isFinite(voxel.c)
    ) {
      continue;
    }
    const x = Math.round(voxel.x);
    const y = Math.round(voxel.y);
    const z = Math.round(voxel.z);
    const c = Math.max(0, Math.round(voxel.c));
    const key = `${x}:${y}:${z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    repaired.push({ x, y, z, c });
  }
  return repaired.length === voxels.length ? voxels : repaired;
}

export function evaluateVoxelQuality(
  voxels: ImageVoxel[],
  mask: boolean[][],
  palette: string[] = [],
  category?: string
): QualityControlResult {
  const bounds = boundsOf(voxels);
  if (!bounds) {
    return {
      score: 0,
      status: "reject",
      metrics: [
        {
          name: "voxel-count",
          value: 0,
          score: 0,
          severity: "error",
          message: "No voxels were produced"
        }
      ],
      silhouetteRetention: 0,
      projectionPrecision: 0,
      occupancy: 0,
      componentCount: 0,
      paletteCoverage: 0,
      voxelCount: 0
    };
  }

  const volume = Math.max(1, bounds.width * bounds.height * bounds.depth);
  const occupancy = voxels.length / volume;
  const componentCount = connectedComponents(voxels);
  const { retention, precision } = silhouetteMetrics(voxels, mask);
  const usedPalette = new Set(voxels.map((v) => v.c)).size;
  const paletteCoverage = usedPalette / Math.max(1, palette.length);

  const componentTolerance = category === "swords" || category === "guns" || category === "rifles" ? 2 : 3;
  const componentScore = componentCount <= componentTolerance
    ? 1
    : clamp(1 - (componentCount - componentTolerance) * 0.18, 0, 1);
  const occupancyScore = occupancy >= 0.02 && occupancy <= 0.95
    ? 1
    : clamp(occupancy < 0.02 ? occupancy / 0.02 : 1 - (occupancy - 0.95) / 0.05, 0, 1);
  const paletteScore = palette.length <= 1 ? 1 : clamp(paletteCoverage * 2.5, 0, 1);
  const retentionScore = clamp(retention, 0, 1);
  const precisionScore = clamp(precision, 0, 1);

  const metrics: QualityMetric[] = [
    {
      name: "silhouette-retention",
      value: retention,
      score: retentionScore,
      severity: retention < 0.55 ? "error" : retention < 0.7 ? "warning" : "info",
      message: `${Math.round(retention * 100)}% of the input silhouette is represented`
    },
    {
      name: "projection-precision",
      value: precision,
      score: precisionScore,
      severity: precision < 0.5 ? "error" : precision < 0.68 ? "warning" : "info",
      message: `${Math.round(precision * 100)}% of projected voxels map inside the input silhouette`
    },
    {
      name: "occupancy",
      value: occupancy,
      score: occupancyScore,
      severity: occupancyScore < 0.45 ? "warning" : "info",
      message: `Voxel occupancy is ${(occupancy * 100).toFixed(1)}% of the bounding volume`
    },
    {
      name: "components",
      value: componentCount,
      score: componentScore,
      severity: componentScore < 0.45 ? "error" : componentScore < 0.8 ? "warning" : "info",
      message: `${componentCount} connected voxel component${componentCount === 1 ? "" : "s"}`
    },
    {
      name: "palette-coverage",
      value: paletteCoverage,
      score: paletteScore,
      severity: paletteScore < 0.35 ? "warning" : "info",
      message: `${usedPalette}/${Math.max(1, palette.length)} palette colors are used`
    }
  ];

  const score = Math.round(
    (retentionScore * 0.36 +
      precisionScore * 0.26 +
      occupancyScore * 0.12 +
      componentScore * 0.18 +
      paletteScore * 0.08) *
      100
  );

  const hardFailure = retention < 0.42 || precision < 0.38 || componentScore < 0.35;
  const repairable = !hardFailure && (retention < 0.65 || precision < 0.58 || componentScore < 0.65);
  const status: QualityStatus = hardFailure || score < 48
    ? "reject"
    : repairable || score < 68
      ? "repair"
      : "accept";

  return {
    score,
    status,
    metrics,
    silhouetteRetention: retention,
    projectionPrecision: precision,
    occupancy,
    componentCount,
    paletteCoverage,
    voxelCount: voxels.length
  };
}
