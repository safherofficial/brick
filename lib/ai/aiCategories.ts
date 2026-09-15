import type { StyleId } from "@/lib/ai/styleProfiles";

export type AiCategory = "swords" | "guns" | "rifles" | "objects";

export type AiCategoryPreset = {
  id: AiCategory;
  label: string;
  style: StyleId;
  heightMax: number;
  symmetrize: boolean;
  description: string;
};

/**
 * AI MODE is deliberately deterministic at the voxel stage: the selected
 * category controls the reconstruction budget/geometry defaults, while the
 * actual image understanding step is local ONNX segmentation in imageVoxel.
 */
export const AI_CATEGORY_PRESETS: readonly AiCategoryPreset[] = [
  {
    id: "swords",
    label: "SWORDS",
    style: "sword",
    heightMax: 5,
    symmetrize: false,
    description: "Thin blade profile · preserves guards and tapered edges."
  },
  {
    id: "guns",
    label: "GUNS",
    style: "weapon",
    heightMax: 6,
    symmetrize: false,
    description: "Compact firearm profile · balanced body depth."
  },
  {
    id: "rifles",
    label: "RIFLES",
    style: "weapon",
    heightMax: 9,
    symmetrize: false,
    description: "Long firearm profile · extra depth budget for stocks/barrels."
  },
  {
    id: "objects",
    label: "OBJECTS",
    style: "prop",
    heightMax: 8,
    symmetrize: false,
    description: "General game-object profile · keeps small protrusions and details."
  }
];

export function aiCategoryPreset(id: AiCategory): AiCategoryPreset {
  return AI_CATEGORY_PRESETS.find((preset) => preset.id === id) ?? AI_CATEGORY_PRESETS[3];
}
