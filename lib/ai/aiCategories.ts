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
 * AI MODE presets intentionally reuse the stable reconstruction profiles.
 * The category only selects the appropriate reconstruction defaults; it does
 * not change the proven imageVoxel material bake or the multi-view pipeline.
 */
export const AI_CATEGORY_PRESETS: readonly AiCategoryPreset[] = [
  {
    id: "swords",
    label: "SWORDS",
    style: "weapon",
    heightMax: 8,
    symmetrize: false,
    description: "Weapon reconstruction optimized for swords and blades.",
  },
  {
    id: "guns",
    label: "GUNS",
    style: "weapon",
    heightMax: 8,
    symmetrize: false,
    description: "Weapon reconstruction optimized for compact firearms.",
  },
  {
    id: "rifles",
    label: "RIFLES",
    style: "weapon",
    heightMax: 12,
    symmetrize: false,
    description: "Weapon reconstruction with extra depth for long firearms.",
  },
  {
    id: "objects",
    label: "OBJECTS",
    style: "prop",
    heightMax: 8,
    symmetrize: false,
    description: "General game-ready prop reconstruction.",
  },
];

export function aiCategoryPreset(id: AiCategory): AiCategoryPreset {
  return AI_CATEGORY_PRESETS.find((preset) => preset.id === id) ?? AI_CATEGORY_PRESETS[3];
}

export function aiCategoryForStyle(style: StyleId): AiCategory {
  if (style === "weapon") return "swords";
  if (style === "prop") return "objects";
  return "objects";
}
