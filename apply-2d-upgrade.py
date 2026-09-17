#!/usr/bin/env python3
from pathlib import Path
from urllib.request import urlopen

BASE = "https://raw.githubusercontent.com/safherofficial/brick"
IMG_SRC = f"{BASE}/77105c73c9aab837343e058a489b07e7bc099846/lib/imageVoxel.ts"
BLD_SRC = f"{BASE}/fb56d901b7dc08b91ca9e2c9cecbdc7cdb64caa2/components/builder/Builder.tsx"

def get(url: str) -> str:
    with urlopen(url) as r:
        return r.read().decode("utf-8")

def must_replace(src: str, old: str, new: str) -> str:
    if old not in src:
        raise SystemExit("PATCH FAILED — marker not found:\n" + old[:120])
    return src.replace(old, new, 1)

img = get(IMG_SRC)
bld = get(BLD_SRC)
if "function buildNonModel" not in img or "export default function Builder" not in bld:
    raise SystemExit("Download incomplete")

img = must_replace(img, '''export type ImageMode =
  | "solid"
  | "flat"
  | "relief"
  | "model";
''', '''export type ImageMode =
  | "solid"
  | "flat"
  | "relief"
  | "model";

/** Locks 2D / 2.5D output. When set, wins over category and solid/model. */
export type OutputLock = "2d" | "25d";
''')

img = must_replace(img, '''export type ImageVoxelOptions = {
  volumeSize?: number;
  mode?: ImageMode;
  heightMax?: number;
  maxVoxels?: number;
  symmetrize?: boolean;
  useLocalAi?: boolean;
  aiCategory?: import("@/lib/ai/aiCategories").AiCategory;
};
''', '''export type ImageVoxelOptions = {
  volumeSize?: number;
  mode?: ImageMode;
  heightMax?: number;
  maxVoxels?: number;
  symmetrize?: boolean;
  useLocalAi?: boolean;
  aiCategory?: import("@/lib/ai/aiCategories").AiCategory;
  output?: OutputLock;
  outline?: boolean;
};
''')

img = must_replace(img, '''type NormalizedImageVoxelOptions = Omit<Required<ImageVoxelOptions>, "aiCategory" | "useLocalAi"> & {
  aiCategory?: ImageVoxelOptions["aiCategory"];
  /** When true, ONNX depth may soft-clamp Z (ambiguous SIDE only). */
  sideAmbiguous?: boolean;
  /** (C) Per-row depth thickness bias for guns/rifles/objects. */
  useDepthThickness?: boolean;
};
''', '''type NormalizedImageVoxelOptions = Omit<Required<ImageVoxelOptions>, "aiCategory" | "useLocalAi" | "output" | "outline"> & {
  aiCategory?: ImageVoxelOptions["aiCategory"];
  output?: OutputLock;
  outline?: boolean;
  sideAmbiguous?: boolean;
  useDepthThickness?: boolean;
};

function applyOutputLock(normalized: NormalizedImageVoxelOptions) {
  if (normalized.output === "2d") {
    normalized.mode = "flat";
    normalized.heightMax = 1;
    normalized.symmetrize = false;
    normalized.useDepthThickness = false;
    normalized.sideAmbiguous = false;
    if (normalized.outline === undefined) normalized.outline = true;
    return;
  }
  if (normalized.output === "25d") {
    if (normalized.mode === "flat" || normalized.mode === "solid" || normalized.mode === "model") {
      normalized.mode = "relief";
    }
    normalized.heightMax = Math.max(2, Math.min(normalized.heightMax, 6));
    normalized.symmetrize = false;
  }
}
''')

img = must_replace(img, '''function applyCategoryProfile(normalized: NormalizedImageVoxelOptions) {
  const category = normalized.aiCategory;
  if (!category) return;
  const style = styleFromCategory(category);
  const profile = profileById(style);
  normalized.heightMax = aiCategoryHeightMax(category, normalized.volumeSize);
  normalized.useDepthThickness = profile.useDepthHint && category !== "swords";
  if (profile.symmetrize && normalized.mode === "model") {
    normalized.symmetrize = true;
  }
}
''', '''function applyCategoryProfile(normalized: NormalizedImageVoxelOptions) {
  const category = normalized.aiCategory;
  if (!category) {
    applyOutputLock(normalized);
    return;
  }
  const style = styleFromCategory(category);
  const profile = profileById(style);
  if (!normalized.output) {
    normalized.heightMax = aiCategoryHeightMax(category, normalized.volumeSize);
    normalized.useDepthThickness = profile.useDepthHint && category !== "swords";
    if (profile.symmetrize && normalized.mode === "model") {
      normalized.symmetrize = true;
    }
  } else if (normalized.output === "25d") {
    normalized.useDepthThickness = profile.useDepthHint && category !== "swords";
  }
  applyOutputLock(normalized);
}
''')

img = must_replace(img, '''  if (category === "swords") depthMap = null;
  const want =
    useLocalAi &&
    category !== "swords" &&
    (aiCategoryWantsDepth(category, normalized.mode) || normalized.useDepthThickness === true);
''', '''  if (category === "swords" || normalized.output === "2d") depthMap = null;
  const want =
    useLocalAi &&
    normalized.output !== "2d" &&
    category !== "swords" &&
    (aiCategoryWantsDepth(category, normalized.mode) || normalized.useDepthThickness === true);
''')

img = must_replace(img, '''    aiCategory: options.aiCategory
  };

  let raster = await loadImage(file);
''', '''    aiCategory: options.aiCategory,
    output: options.output,
    outline: options.outline
  };
  applyOutputLock(normalized);

  let raster = await loadImage(file);
''')

img = must_replace(img, '''    aiCategory: options.aiCategory
  };

  if (normalized.mode === "model" && !views.side) {
''', '''    aiCategory: options.aiCategory,
    output: options.output,
    outline: options.outline
  };
  applyOutputLock(normalized);

  if (normalized.mode === "model" && !views.side) {
''')

HELPERS = r'''
function dropMaskSpurs(mask: boolean[][]) {
  const h = mask.length;
  const w = mask[0]?.length ?? 0;
  const next = mask.map((row) => row.slice());
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      const n =
        (y > 0 && mask[y - 1][x] ? 1 : 0) +
        (y + 1 < h && mask[y + 1][x] ? 1 : 0) +
        (x > 0 && mask[y][x - 1] ? 1 : 0) +
        (x + 1 < w && mask[y][x + 1] ? 1 : 0);
      if (n === 0) next[y][x] = false;
    }
  }
  return next;
}

function outlineFront1px(voxels: ImageVoxel[], ink: number) {
  const face = new Map<string, ImageVoxel>();
  for (const v of voxels) if (v.z === 0) face.set(`${v.x}:${v.y}`, v);
  for (const v of face.values()) {
    const open =
      !face.has(`${v.x + 1}:${v.y}`) ||
      !face.has(`${v.x - 1}:${v.y}`) ||
      !face.has(`${v.x}:${v.y + 1}`) ||
      !face.has(`${v.x}:${v.y - 1}`);
    if (open) v.c = ink;
  }
  return voxels;
}

function pickOutlineIndex(palette: string[]) {
  let best = 0, bestL = 256;
  for (let i = 0; i < palette.length; i += 1) {
    const hex = palette[i].replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (l < bestL) { bestL = l; best = i; }
  }
  return best;
}

function buildFlatSprite(
  raster: Raster,
  mask: boolean[][],
  bounds: Bounds,
  options: NormalizedImageVoxelOptions,
  paletteValues: [number, number, number][],
  palette: string[]
): ImageImport {
  const maxAxis = Math.max(4, options.volumeSize - 8);
  const scale = Math.min(1, maxAxis / Math.max(bounds.width, bounds.height));
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const sourceMask = dropMaskSpurs(resampleMaskToBounds(mask, bounds, width, height));
  const voxels: ImageVoxel[] = [];
  for (let y = 0; y < height; y += 1) {
    const ny = height <= 1 ? 0.5 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      if (!sourceMask[y]?.[x]) continue;
      const nx = width <= 1 ? 0.5 : x / (width - 1);
      const frontColor = sampleMapped(raster, bounds, nx, ny);
      voxels.push({
        x, y, z: 0,
        c: nearestColor(applySharpness([frontColor.r, frontColor.g, frontColor.b], options.aiCategory === "swords" ? 1.18 : 1.12), paletteValues)
      });
    }
  }
  if (!voxels.length) throw new Error("No voxels reconstructed");
  if (options.outline !== false) outlineFront1px(voxels, pickOutlineIndex(palette));
  const budget = effectiveBudget(options.volumeSize, options.maxVoxels, "flat");
  const limited = voxels.length <= budget ? voxels : spatialBudget(voxels, budget);
  const packed = normalizeToVolume(limited, options.volumeSize);
  return { width: raster.width, height: raster.height, voxels: packed, palette, count: packed.length };
}

function quantizeUnit(value: number, levels: number) {
  const l = Math.max(2, levels);
  return Math.round(Math.max(0, Math.min(1, value)) * (l - 1)) / (l - 1);
}

function medianFilterZ(grid: number[][], mask: boolean[][]) {
  const h = grid.length, w = grid[0]?.length ?? 0;
  const out = grid.map((row) => row.slice());
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y]?.[x]) continue;
      const vals: number[] = [];
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= h || xx >= w || !mask[yy][xx]) continue;
        vals.push(grid[yy][xx]);
      }
      if (!vals.length) continue;
      vals.sort((a, b) => a - b);
      out[y][x] = vals[Math.floor(vals.length / 2)];
    }
  }
  return out;
}

function componentMedianZ(mask: boolean[][], zGrid: number[][], minZ: number, maxZ: number) {
  const h = mask.length, w = mask[0]?.length ?? 0;
  const seen = Array.from({ length: h }, () => Array(w).fill(false));
  const out = zGrid.map((row) => row.slice());
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x] || seen[y][x]) continue;
      const stack = [[x, y]], cells: [number, number][] = [], zs: number[] = [];
      seen[y][x] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        cells.push([cx, cy]); zs.push(zGrid[cy][cx]);
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (ny < 0 || nx < 0 || ny >= h || nx >= w || !mask[ny][nx] || seen[ny][nx]) continue;
          seen[ny][nx] = true; stack.push([nx, ny]);
        }
      }
      zs.sort((a, b) => a - b);
      const z = Math.max(minZ, Math.min(maxZ, Math.round(zs[Math.floor(zs.length / 2)])));
      for (const [cx, cy] of cells) out[cy][cx] = z;
    }
  }
  return out;
}

'''

img = must_replace(img, "function buildNonModel(", HELPERS + "function buildNonModel(")

img = must_replace(img, '''  const sourceMask = resampleMaskToBounds(mask, bounds, width, height);

  const depthBase =
    options.mode === "flat"
      ? 1
      : options.mode === "relief"
        ? Math.max(2, Math.round(options.heightMax * 0.30))
        : Math.max(2, Math.round(options.heightMax * 0.62));

  const useDepthRelief =
    Boolean(depthMap) && (options.mode === "relief" || options.mode === "solid");

  const voxels: ImageVoxel[] = [];
''', '''  const sourceMask = resampleMaskToBounds(mask, bounds, width, height);

  if (options.output === "2d" || options.mode === "flat") {
    return buildFlatSprite(raster, mask, bounds, options, paletteValues, palette);
  }

  const depthBase =
    options.mode === "relief" || options.output === "25d"
      ? Math.max(2, Math.round(options.heightMax * 0.30))
      : Math.max(2, Math.round(options.heightMax * 0.62));

  const useQuantizedRelief = options.output === "25d" || options.mode === "relief";
  const useDepthRelief =
    Boolean(depthMap) && (options.mode === "relief" || options.mode === "solid" || options.output === "25d");

  const voxels: ImageVoxel[] = [];

  if (useQuantizedRelief) {
    const levels = Math.max(3, Math.min(5, Math.round(options.heightMax)));
    const raw: number[][] = Array.from({ length: height }, () => Array(width).fill(1));
    for (let y = 0; y < height; y += 1) {
      const ny = height <= 1 ? 0.5 : y / (height - 1);
      for (let x = 0; x < width; x += 1) {
        if (!sourceMask[y]?.[x]) continue;
        const nx = width <= 1 ? 0.5 : x / (width - 1);
        const px = bounds.minX + nx * (bounds.maxX - bounds.minX);
        const py = bounds.minY + ny * (bounds.maxY - bounds.minY);
        const d = useDepthRelief ? depthAt(depthMap, raster, px, py) : 0.55;
        raw[y][x] = 1 + Math.round(quantizeUnit(d, levels) * (levels - 1));
      }
    }
    const zGrid = componentMedianZ(sourceMask, medianFilterZ(raw, sourceMask), 2, Math.max(2, options.heightMax));
    for (let y = 0; y < height; y += 1) {
      const ny = height <= 1 ? 0.5 : y / (height - 1);
      for (let x = 0; x < width; x += 1) {
        if (!sourceMask[y]?.[x]) continue;
        const nx = width <= 1 ? 0.5 : x / (width - 1);
        const frontColor = sampleMapped(raster, bounds, nx, ny);
        const finalDepth = zGrid[y][x];
        const colorIndex = nearestColor(
          ditheredColor(
            applySharpness([frontColor.r, frontColor.g, frontColor.b], options.aiCategory === "swords" ? 1.18 : options.aiCategory === "guns" ? 1.08 : 1),
            x, y,
            options.aiCategory === "swords" || options.aiCategory === "guns" ? 4 : 8
          ),
          paletteValues
        );
        for (let z = 0; z < finalDepth; z += 1) voxels.push({ x, y, z, c: colorIndex });
      }
    }
    if (!voxels.length) throw new Error("No voxels reconstructed");
    const budgetQ = effectiveBudget(options.volumeSize, options.maxVoxels, options.mode);
    const limitedQ = voxels.length <= budgetQ ? voxels : spatialBudget(voxels, budgetQ);
    const packedQ = normalizeToVolume(limitedQ, options.volumeSize);
    return { width: raster.width, height: raster.height, voxels: packedQ, palette, count: packedQ.length };
  }
''')

bld = must_replace(bld, '''import { UNITY_EXPORT } from "@/lib/ai/unity";
import { buildImageOptions } from "@/lib/ai/buildOptions";
''', '''import { UNITY_EXPORT, unity2dPixelExportOptions } from "@/lib/ai/unity";
import { buildImageOptions } from "@/lib/ai/buildOptions";
import { exportVolumePngOrtho } from "@/lib/exportPngOrtho";
import type { OutputLock } from "@/lib/imageVoxel";
''')

bld = must_replace(bld, '''  const [imageMode, setImageMode] = useState<LocalImageMode>("solid");
  const [imageHeight, setImageHeight] = useState(6);
''', '''  const [imageMode, setImageMode] = useState<LocalImageMode>("solid");
  const [outputLock, setOutputLock] = useState<OutputLock | null>(null);
  const [imageHeight, setImageHeight] = useState(6);
''')

bld = must_replace(bld, '''        category: imageCategory ?? undefined
      }),
    [imageCategory, imageHeight, imageMode, symmetrize]
''', '''        category: imageCategory ?? undefined,
        output: outputLock ?? undefined,
        outline: outputLock === "2d" ? true : undefined
      }),
    [imageCategory, imageHeight, imageMode, outputLock, symmetrize]
''')

bld = must_replace(bld, '''    async (kind: "json" | "vox" | "glb" | "obj") => {
''', '''    async (kind: "json" | "vox" | "glb" | "obj" | "png") => {
''')

bld = must_replace(bld, '''      if (kind === "glb") {
        const bytes = await exportGlb(volumeRef.current, palette, UNITY_EXPORT);
        downloadBytes(new Uint8Array(bytes), `${name}.glb`, "model/gltf-binary");
        return;
      }
      const archive = await exportObjArchive(volumeRef.current, palette, UNITY_EXPORT);
      downloadBytes(archive, `${name}-obj.zip`, "application/zip");
    },
    [lastShape, palette, title]
''', '''      if (kind === "png") {
        const { png, pivot } = exportVolumePngOrtho(volumeRef.current, palette, 16);
        downloadBytes(png, `${name}.png`, "image/png");
        downloadText(JSON.stringify({
          schema: "brick.unity-2d-pixel.v1",
          engine: "unity-2d-pixel",
          pixelsPerUnit: pivot.pixelsPerUnit,
          pivot: { x: pivot.x, y: pivot.y },
          width: pivot.width,
          height: pivot.height
        }, null, 2), `${name}.png.json`, "application/json");
        return;
      }
      if (kind === "glb") {
        const options = outputLock === "2d" ? unity2dPixelExportOptions() : UNITY_EXPORT;
        const bytes = await exportGlb(volumeRef.current, palette, options);
        downloadBytes(new Uint8Array(bytes), `${name}.glb`, "model/gltf-binary");
        return;
      }
      const archive = await exportObjArchive(
        volumeRef.current, palette,
        outputLock === "2d" ? unity2dPixelExportOptions() : UNITY_EXPORT
      );
      downloadBytes(archive, `${name}-obj.zip`, "application/zip");
    },
    [lastShape, outputLock, palette, title]
''')

bld = must_replace(bld, '''          <button onClick={() => void exportFiles("glb")} disabled={busy}>GLB</button>''',
'''          <button onClick={() => void exportFiles("glb")} disabled={busy}>GLB</button>
          <button onClick={() => void exportFiles("png")} disabled={busy}>PNG</button>''')

bld = must_replace(bld, '''          <div className="viewRow">
            {(["solid", "flat", "relief", "model"] as LocalImageMode[]).map((mode) => (
              <button
                key={mode}
                className={imageMode === mode ? "modeOn" : ""}
                disabled={busy}
                onClick={() => {
                  setImageMode(mode);
                  // Manual mode overrides category-forced model unless staying on model.
                  if (mode !== "model") setImageCategory(null);
                  setSymmetrize(mode === "model" ? symmetrize : false);
                  if (mode === "model" && frontFile && !sideFile) {
                    notify("MODEL · ADD SIDE PNG FOR FULL 3D HULL");
                  }
                  if (frontFile) window.setTimeout(() => void rebuildMultiView(), 0);
                }}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
''', '''          <p className="foldHint">Output lock (wins over category / solid)</p>
          <div className="viewRow">
            {([["2d", "2D"], ["25d", "2.5D"]] as const).map(([id, label]) => (
              <button key={id} className={outputLock === id ? "modeOn" : ""} disabled={busy}
                onClick={() => {
                  setOutputLock(id);
                  setImageMode(id === "2d" ? "flat" : "relief");
                  if (id === "2d") setImageCategory(null);
                  setSymmetrize(false);
                  if (frontFile) window.setTimeout(() => void rebuildMultiView(), 0);
                }}>{label}</button>
            ))}
            <button className={outputLock === null ? "modeOn" : ""} disabled={busy}
              onClick={() => {
                setOutputLock(null);
                if (frontFile) window.setTimeout(() => void rebuildMultiView(), 0);
              }}>FREE</button>
          </div>
          <div className="viewRow">
            {(["solid", "flat", "relief", "model"] as LocalImageMode[]).map((mode) => (
              <button key={mode} className={imageMode === mode ? "modeOn" : ""} disabled={busy}
                onClick={() => {
                  setImageMode(mode);
                  setOutputLock(mode === "flat" ? "2d" : mode === "relief" ? "25d" : null);
                  if (mode !== "model") setImageCategory(null);
                  setSymmetrize(mode === "model" ? symmetrize : false);
                  if (mode === "model" && frontFile && !sideFile) notify("MODEL · ADD SIDE PNG FOR FULL 3D HULL");
                  if (frontFile) window.setTimeout(() => void rebuildMultiView(), 0);
                }}>{mode.toUpperCase()}</button>
            ))}
          </div>
''')

bld = bld.replace('{imageMode === "relief" && (', '{(imageMode === "relief" || outputLock === "25d") && (', 1)

if "function buildFlatSprite" not in img or "outputLock" not in bld:
    raise SystemExit("Upgrade incomplete")

Path("lib/imageVoxel.ts").write_text(img)
Path("components/builder/Builder.tsx").write_text(bld)
print("OK wrote lib/imageVoxel.ts", len(img.splitlines()), "lines")
print("OK wrote components/builder/Builder.tsx", len(bld.splitlines()), "lines")
