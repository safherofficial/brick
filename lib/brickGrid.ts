export type BrickKind =
  | "1x1"
  | "1x2"
  | "2x2"
  | "2x4"
  | "2x6"
  | "round"
  | "cone"
  | "voxel";

export type BrickShape = "box" | "cylinder" | "cone";

export type Vec3 = [number, number, number];
export type Footprint = [number, number];
export type Rotation = 0 | 90 | 180 | 270;

export type Brick = {
  id: number;
  kind: BrickKind;
  shape: BrickShape;
  footprint: Footprint;
  size: Vec3;
  position: Vec3;
  rotation: Rotation;
  color: string;
  layer: number;
};

export const STUD = 0.9;
export const BRICK_HEIGHT = 0.48;
export const STUD_RADIUS = 0.145;
export const STUD_HEIGHT = 0.1;
export const MAX_LAYER = 48;
export const STARTER_LIMIT = 500;
export const HISTORY_LIMIT = 40;
export const DRAFT_KEY = "brick-builder-draft-v2";
export const DRAFT_KEY_LEGACY = "brick-builder-draft-state";

export const palette: string[] = [
  "#C91F2D",
  "#E35B19",
  "#F6B800",
  "#F2D64B",
  "#168B4B",
  "#53B84A",
  "#0877B9",
  "#2E58B8",
  "#6B42A8",
  "#D84C9B",
  "#111827",
  "#F2F0E8"
];

export const brickDefs: Record<
  BrickKind,
  { footprint: Footprint; shape: BrickShape; label: string }
> = {
  voxel: { footprint: [1, 1], shape: "box", label: "VOXEL" },
  "1x1": { footprint: [1, 1], shape: "box", label: "1×1" },
  "1x2": { footprint: [2, 1], shape: "box", label: "1×2" },
  "2x2": { footprint: [2, 2], shape: "box", label: "2×2" },
  "2x4": { footprint: [4, 2], shape: "box", label: "2×4" },
  "2x6": { footprint: [6, 2], shape: "box", label: "2×6" },
  round: { footprint: [1, 1], shape: "cylinder", label: "ROUND" },
  cone: { footprint: [1, 1], shape: "cone", label: "CONE" }
};

export const basicKinds: BrickKind[] = [
  "voxel",
  "1x1",
  "1x2",
  "2x2",
  "2x4",
  "2x6"
];
export const specialKinds: BrickKind[] = ["round", "cone"];

let idSeq = 1;

export function nextId() {
  idSeq += 1;
  return idSeq;
}

export function syncIdSeq(bricks: Brick[]) {
  const maxId = bricks.reduce((max, b) => Math.max(max, b.id), 0);
  idSeq = Math.max(idSeq, maxId);
}

export function unitHeight(kind?: BrickKind) {
  return kind === "voxel" ? STUD : BRICK_HEIGHT;
}

export function sizeFor(footprint: Footprint, kind?: BrickKind): Vec3 {
  return [footprint[0] * STUD, unitHeight(kind), footprint[1] * STUD];
}

export function effectiveFootprint(
  kind: BrickKind,
  rotation: Rotation
): Footprint {
  const [w, d] = brickDefs[kind].footprint;
  return rotation % 180 === 0 ? [w, d] : [d, w];
}

export function cellAnchor(
  position: Vec3,
  footprint: Footprint
): [number, number] {
  return [
    Math.round(position[0] - (footprint[0] - 1) / 2),
    Math.round(position[2] - (footprint[1] - 1) / 2)
  ];
}

export function cellsFor(brick: Pick<Brick, "position" | "footprint">) {
  const [w, d] = brick.footprint;
  const [ax, az] = cellAnchor(brick.position, brick.footprint);
  const cells: string[] = [];
  for (let x = ax; x < ax + w; x++) {
    for (let z = az; z < az + d; z++) {
      cells.push(`${x}:${z}`);
    }
  }
  return cells;
}

export function yFromLayer(layer: number, kind?: BrickKind) {
  const h = unitHeight(kind);
  return layer * h + h / 2;
}

export function withLayer(brick: Brick, layer: number): Brick {
  return {
    ...brick,
    layer,
    position: [
      brick.position[0],
      yFromLayer(layer, brick.kind),
      brick.position[2]
    ],
    size: sizeFor(brick.footprint, brick.kind)
  };
}

export function occupied(bricks: Brick[], ignoreId?: number) {
  const map = new Map<string, number>();
  for (const brick of bricks) {
    if (brick.id === ignoreId) continue;
    for (const cell of cellsFor(brick)) {
      map.set(`${brick.layer}:${cell}`, brick.id);
    }
  }
  return map;
}

export function isClear(candidate: Brick, bricks: Brick[]) {
  const map = occupied(bricks, candidate.id);
  return cellsFor(candidate).every(
    (cell) => !map.has(`${candidate.layer}:${cell}`)
  );
}

export function supportCount(
  candidate: Pick<Brick, "layer" | "position" | "footprint" | "id">,
  map: Map<string, number>
) {
  if (candidate.layer === 0) return cellsFor(candidate).length;
  return cellsFor(candidate).filter((cell) =>
    map.has(`${candidate.layer - 1}:${cell}`)
  ).length;
}

export function isValid(candidate: Brick, bricks: Brick[]) {
  const map = occupied(bricks, candidate.id);
  const cells = cellsFor(candidate);
  const clear = cells.every((cell) => !map.has(`${candidate.layer}:${cell}`));
  const supported =
    candidate.layer === 0 || supportCount(candidate, map) >= 1;
  return clear && supported;
}

export function highestSupportedLayer(candidate: Brick, bricks: Brick[]) {
  const cells = cellsFor(candidate);
  const map = occupied(bricks, candidate.id);
  let layer = 0;

  for (let test = 0; test <= MAX_LAYER; test++) {
    const supported =
      test === 0 || cells.some((cell) => map.has(`${test - 1}:${cell}`));
    const clear = cells.every((cell) => !map.has(`${test}:${cell}`));
    if (supported && clear) layer = test;
    else if (test > layer + 1) break;
  }

  return layer;
}

export function settle(bricks: Brick[]) {
  const ordered = [...bricks].sort(
    (a, b) => a.layer - b.layer || a.id - b.id
  );
  const out: Brick[] = [];
  for (const brick of ordered) {
    out.push(withLayer(brick, highestSupportedLayer(brick, out)));
  }
  return out;
}

export function snapCenter(value: number, span: number) {
  const offset = (span - 1) / 2;
  return Math.round(value - offset) + offset;
}

export function cloneBricks(bricks: Brick[]): Brick[] {
  return bricks.map((b) => ({
    ...b,
    position: [...b.position] as Vec3,
    footprint: [...b.footprint] as Footprint,
    size: [...b.size] as Vec3
  }));
}

export type DraftV2 = {
  v: 2;
  bricks: Brick[];
  title?: string;
  creator?: string;
};

export function loadDraft(): {
  bricks: Brick[];
  title: string;
  creator: string;
} | null {
  if (typeof window === "undefined") return null;

  const rawV2 = localStorage.getItem(DRAFT_KEY);
  const rawLegacy = localStorage.getItem(DRAFT_KEY_LEGACY);
  const raw = rawV2 ?? rawLegacy;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as DraftV2 | Brick[];
    const bricks = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.bricks)
        ? parsed.bricks
        : [];
    const valid = bricks.filter((b) => b && brickDefs[b.kind]);
    if (!valid.length) return null;
    syncIdSeq(valid);
    return {
      bricks: valid,
      title: Array.isArray(parsed) ? "" : parsed.title ?? "",
      creator: Array.isArray(parsed) ? "" : parsed.creator ?? ""
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: DraftV2) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    localStorage.removeItem(DRAFT_KEY_LEGACY);
  } catch {
    // quota
  }
}

export function makeBrick(
  kind: BrickKind,
  color: string,
  point: { x: number; z: number },
  bricks: Brick[],
  rotation: Rotation = 0,
  opts?: { sculpt?: boolean; layer?: number }
): Brick {
  const footprint = effectiveFootprint(kind, rotation);
  const [w, d] = footprint;
  const ax = Math.round(point.x - (w - 1) / 2);
  const az = Math.round(point.z - (d - 1) / 2);
  const center: Vec3 = [ax + (w - 1) / 2, 0, az + (d - 1) / 2];

  const provisional: Brick = {
    id: nextId(),
    kind,
    shape: brickDefs[kind].shape,
    footprint,
    size: sizeFor(footprint, kind),
    position: center,
    rotation,
    color,
    layer: 0
  };

  const layer =
    opts?.layer ??
    (opts?.sculpt ? 0 : highestSupportedLayer(provisional, bricks));

  return withLayer({ ...provisional, position: center }, layer);
}
