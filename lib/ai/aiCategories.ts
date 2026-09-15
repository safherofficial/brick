import type { StyleId } from "@/lib/ai/styleProfiles";
import { STYLE_PROFILES } from "@/lib/ai/styleProfiles";

export type AiCategory = "swords" | "guns" | "rifles" | "objects";

export type AiCategoryPreset = {
  id: AiCategory;
  label: string;
  style: StyleId;
  heightMax: number;
  symmetrize: boolean;
  description: string;
};

export const AI_CATEGORY_PRESETS: readonly AiCategoryPreset[] = [
  {
    id: "swords",
    label: "SWORDS",
    style: "sword",
    heightMax: STYLE_PROFILES.sword.depth,
    symmetrize: false,
    description: "Lama sottile, outline, poche isole, profondità 4."
  },
  {
    id: "guns",
    label: "GUNS",
    style: "weapon",
    heightMax: STYLE_PROFILES.weapon.depth,
    symmetrize: false,
    description: "Armi corte, corpo più pieno."
  },
  {
    id: "rifles",
    label: "RIFLES",
    style: "weapon",
    heightMax: 8,
    symmetrize: false,
    description: "Armi lunghe, profilo weapon con più profondità."
  },
  {
    id: "objects",
    label: "OBJECTS",
    style: "prop",
    heightMax: STYLE_PROFILES.prop.depth,
    symmetrize: false,
    description: "Prop generico da gioco."
  }
];

export function aiCategoryPreset(id: AiCategory): AiCategoryPreset {
  return AI_CATEGORY_PRESETS.find((preset) => preset.id === id) ?? AI_CATEGORY_PRESETS[3];
}

export function aiCategoryForStyle(style: StyleId): AiCategory {
  if (style === "sword") return "swords";
  if (style === "weapon") return "guns";
  if (style === "prop") return "objects";
  return "objects";
}
