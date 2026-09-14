// lib/ai/styleProfiles.ts
export type StyleId = "tile" | "weapon" | "pickup" | "prop" | "character";

export type StyleProfile = {
  id: StyleId;
  depth: number;
  symmetrize: boolean;
  minRadius: number;
  edgeRadius: number;
  sdfPower: number;
  paletteSize: number;
  outline: boolean;
  fillHoleRatio: number;
  useSideHull: boolean;
  useDepthHint: boolean;
  islandRatio: number;
  keepRatio: number;
};

export const STYLE_PROFILES: Record<StyleId, StyleProfile> = {
  tile: {
    id: "tile",
    depth: 2,
    symmetrize: false,
    minRadius: 0,
    edgeRadius: 0,
    sdfPower: 1,
    paletteSize: 8,
    outline: true,
    fillHoleRatio: 0.12,
    useSideHull: false,
    useDepthHint: false,
    islandRatio: 0.03,
    keepRatio: 0.04
  },
  weapon: {
    id: "weapon",
    depth: 5,
    symmetrize: false,
    minRadius: 1,
    edgeRadius: 0,
    sdfPower: 1.7,
    paletteSize: 16,
    outline: true,
    fillHoleRatio: 0.04,
    useSideHull: true,
    useDepthHint: false,
    islandRatio: 0.012,
    keepRatio: 0.018
  },
  pickup: {
    id: "pickup",
    depth: 8,
    symmetrize: true,
    minRadius: 2,
    edgeRadius: 1,
    sdfPower: 0.85,
    paletteSize: 16,
    outline: false,
    fillHoleRatio: 0.1,
    useSideHull: false,
    useDepthHint: false,
    islandRatio: 0.02,
    keepRatio: 0.03
  },
  prop: {
    id: "prop",
    depth: 6,
    symmetrize: false,
    minRadius: 1,
    edgeRadius: 1,
    sdfPower: 1.15,
    paletteSize: 16,
    outline: false,
    fillHoleRatio: 0.08,
    useSideHull: false,
    useDepthHint: false,
    islandRatio: 0.02,
    keepRatio: 0.03
  },
  character: {
    id: "character",
    depth: 10,
    symmetrize: true,
    minRadius: 2,
    edgeRadius: 1,
    sdfPower: 1.05,
    paletteSize: 16,
    outline: false,
    fillHoleRatio: 0.06,
    useSideHull: true,
    useDepthHint: false,
    islandRatio: 0.015,
    keepRatio: 0.025
  }
};

export function profileById(id?: string | null): StyleProfile {
  if (id && id in STYLE_PROFILES) return STYLE_PROFILES[id as StyleId];
  return STYLE_PROFILES.prop;
}

export function inferStyle(heightMax: number, symmetrize: boolean): StyleId {
  if (heightMax <= 2) return "tile";
  if (symmetrize && heightMax >= 10) return "character";
  if (symmetrize) return "pickup";
  if (heightMax <= 6) return "weapon";
  return "prop";
}
