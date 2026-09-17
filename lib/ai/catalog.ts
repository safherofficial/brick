// lib/ai/catalog.ts
import { STYLE_PROFILES, type StyleId } from "@/lib/ai/styleProfiles";

export type CatalogItem = {
  id: string;
  name: string;
  category: StyleId;
  depth: number;
  symmetrize: boolean;
  promptFront: string;
  promptSide: string;
};

export const CATALOG: CatalogItem[] = [
  {
    id: "tile-block",
    name: "Tile",
    category: "tile",
    depth: STYLE_PROFILES.tile.depth,
    symmetrize: STYLE_PROFILES.tile.symmetrize,
    promptFront: "Orthographic front view, game tile block, white background, flat colors, no shadow.",
    promptSide: "Orthographic side view of the same tile, 1-2 voxels thick, white background, no shadow."
  },
  {
    id: "sword-short",
    name: "Short sword",
    category: "sword",
    depth: STYLE_PROFILES.sword.depth,
    symmetrize: STYLE_PROFILES.sword.symmetrize,
    promptFront:
      "Orthographic front view, short medieval sword, blade up, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same short medieval sword, blade up, thin blade, white background, no shadow."
  },
  {
    id: "axe",
    name: "Axe",
    category: "weapon",
    depth: STYLE_PROFILES.weapon.depth,
    symmetrize: STYLE_PROFILES.weapon.symmetrize,
    promptFront:
      "Orthographic front view, stylized battle axe, head up, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same battle axe, thin head, white background, no shadow."
  },
  {
    id: "potion",
    name: "Potion",
    category: "pickup",
    depth: STYLE_PROFILES.pickup.depth,
    symmetrize: STYLE_PROFILES.pickup.symmetrize,
    promptFront:
      "Orthographic front view, round potion bottle, cork top, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same potion bottle, white background, no shadow."
  },
  {
    id: "shield",
    name: "Shield",
    category: "prop",
    depth: STYLE_PROFILES.prop.depth,
    symmetrize: true,
    promptFront:
      "Orthographic front view, round wooden shield, iron rim, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same shield, thin plate, white background, no shadow."
  },
  {
    id: "key",
    name: "Key",
    category: "weapon",
    depth: STYLE_PROFILES.weapon.depth,
    symmetrize: false,
    promptFront:
      "Orthographic front view, ornate gold key, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same gold key, white background, no shadow."
  },
  {
    id: "crate",
    name: "Crate",
    category: "prop",
    depth: STYLE_PROFILES.prop.depth,
    symmetrize: true,
    promptFront:
      "Orthographic front view, wooden supply crate, iron corners, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same wooden crate, white background, no shadow."
  },
  {
    id: "helmet",
    name: "Helmet",
    category: "prop",
    depth: STYLE_PROFILES.prop.depth,
    symmetrize: true,
    promptFront:
      "Orthographic front view, medieval iron helmet, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same iron helmet, white background, no shadow."
  },
  {
    id: "pistol",
    name: "Pistol",
    category: "weapon",
    depth: STYLE_PROFILES.weapon.depth,
    symmetrize: false,
    promptFront:
      "Orthographic front view, compact sidearm pistol, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same pistol, white background, no shadow."
  },
];

export function catalogById(id: string) {
  return CATALOG.find((item) => item.id === id) ?? null;
}
