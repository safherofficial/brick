export type CatalogItem = {
  id: string;
  name: string;
  category: "weapon" | "prop" | "pickup";
  depth: 8 | 12;
  promptFront: string;
  promptSide: string;
};

export const CATALOG: CatalogItem[] = [
  {
    id: "sword-short",
    name: "Short sword",
    category: "weapon",
    depth: 8,
    promptFront:
      "Orthographic front view, short medieval sword, blade up, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same short medieval sword, blade up, thin blade, white background, no shadow."
  },
  {
    id: "axe",
    name: "Axe",
    category: "weapon",
    depth: 8,
    promptFront:
      "Orthographic front view, stylized battle axe, head up, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same battle axe, thin head, white background, no shadow."
  },
  {
    id: "potion",
    name: "Potion",
    category: "pickup",
    depth: 12,
    promptFront:
      "Orthographic front view, round potion bottle, cork top, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same potion bottle, white background, no shadow."
  },
  {
    id: "shield",
    name: "Shield",
    category: "prop",
    depth: 8,
    promptFront:
      "Orthographic front view, round wooden shield, iron rim, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same shield, thin plate, white background, no shadow."
  },
  {
    id: "key",
    name: "Key",
    category: "pickup",
    depth: 8,
    promptFront:
      "Orthographic front view, ornate gold key, white background, flat colors, no shadow.",
    promptSide:
      "Orthographic side view of the same gold key, white background, no shadow."
  }
];

export function catalogById(id: string) {
  return CATALOG.find((item) => item.id === id) ?? null;
}
