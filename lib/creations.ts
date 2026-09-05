import type { BrickShape } from "@/components/builder/BrickVisual";

export type ShowcaseBrick = {
  size: [number, number, number];
  position: [number, number, number];
  color: string;
  shape?: BrickShape;
  rotation?: [number, number, number];
  /** vero per rifiniture sottili (finestre, occhi, pinne...) che non devono avere lo stud in cima */
  studless?: boolean;
};

export type ShowcaseCreation = {
  slug: string;
  title: string;
  author: string;
  description: string;
  likes: string;
  views: string;
  bricks: ShowcaseBrick[];
  camera: [number, number, number];
  target: [number, number, number];
};

function b(
  size: [number, number, number],
  position: [number, number, number],
  color: string,
  extra?: { shape?: BrickShape; rotation?: [number, number, number]; studless?: boolean }
): ShowcaseBrick {
  return { size, position, color, ...extra };
}

// ---------------------------------------------------------------------------
// MEDIEVAL CASTLE — torre centrale + 4 torri d'angolo con tetti a cono,
// mura merlate collegate e un cancello d'ingresso.
// ---------------------------------------------------------------------------
const stoneGrey = "#aab0c0";
const stoneGreyLight = "#c3c9d6";
const roofRed = "#8a2b3a";
const roofRedDark = "#6d2230";

const towerCorners: Array<[number, number]> = [[-3.6, -3.6], [3.6, -3.6], [3.6, 3.6], [-3.6, 3.6]];
const castleBricks: ShowcaseBrick[] = [
  // torri d'angolo
  ...towerCorners.flatMap(([cx, cz]) => [
    b([1.8, 2.25, 1.8], [cx, 1.125, cz], stoneGrey),
    b([2.0, 1.1, 2.0], [cx, 2.8, cz], roofRed, { shape: "cone" })
  ]),
  // torre/mastio centrale
  b([1.8, 3.15, 2.7], [0, 1.575, 0], stoneGreyLight),
  b([2.2, 1.35, 2.2], [0, 3.825, 0], roofRedDark, { shape: "cone" }),
  b([0.12, 1.0, 0.12], [0, 5.0, 0], "#8a8a8a", { shape: "cylinder", studless: true }),
  b([0.5, 0.35, 0.05], [0.28, 5.35, 0], "#dc2626", { studless: true }),
  // mura perimetrali
  b([5.4, 1.35, 0.6], [0, 0.675, -3.6], stoneGrey),
  b([2.1, 1.35, 0.6], [-1.65, 0.675, 3.6], stoneGrey),
  b([2.1, 1.35, 0.6], [1.65, 0.675, 3.6], stoneGrey),
  b([1.2, 1.35, 0.5], [0, 0.675, 3.6], "#6b4226"),
  b([0.6, 1.35, 5.4], [3.6, 0.675, 0], stoneGrey),
  b([0.6, 1.35, 5.4], [-3.6, 0.675, 0], stoneGrey),
  // merlature
  ...[-2.25, -1.35, -0.45, 0.45, 1.35, 2.25].map((x) => b([0.45, 0.3, 0.6], [x, 1.5, -3.6], stoneGrey)),
  ...[-2.25, -1.35].map((x) => b([0.45, 0.3, 0.6], [x, 1.5, 3.6], stoneGrey)),
  ...[1.35, 2.25].map((x) => b([0.45, 0.3, 0.6], [x, 1.5, 3.6], stoneGrey)),
  ...[-2.25, -1.35, -0.45, 0.45, 1.35, 2.25].map((z) => b([0.6, 0.3, 0.45], [3.6, 1.5, z], stoneGrey)),
  ...[-2.25, -1.35, -0.45, 0.45, 1.35, 2.25].map((z) => b([0.6, 0.3, 0.45], [-3.6, 1.5, z], stoneGrey)),
  // cespugli all'ingresso
  b([0.8, 0.7, 0.8], [-1.0, 0.35, 4.3], "#2f855a", { shape: "cone" }),
  b([0.8, 0.7, 0.8], [1.0, 0.35, 4.3], "#2f855a", { shape: "cone" })
];

// ---------------------------------------------------------------------------
// COZY CABIN — baita in legno con tetto a due spioventi, camino, albero e
// vialetto d'ingresso.
// ---------------------------------------------------------------------------
const cabinBricks: ShowcaseBrick[] = [
  b([5.4, 0.2, 4.5], [0, 0.1, 0], "#4a7c3c"),
  b([2.7, 1.8, 2.25], [0, 1.1, 0], "#8a5a34"),
  b([0.5, 0.9, 0.05], [0, 0.65, 1.15], "#4a2f1c", { studless: true }),
  b([0.5, 0.5, 0.05], [-0.85, 1.3, 1.15], "#bfe3f5", { studless: true }),
  b([0.5, 0.5, 0.05], [0.85, 1.3, 1.15], "#bfe3f5", { studless: true }),
  b([3.3, 0.5, 2.85], [0, 2.25, 0], "#7a2e2e", { studless: true }),
  b([1.8, 0.5, 2.85], [0, 2.75, 0], "#6a2626", { studless: true }),
  b([0.6, 0.3, 2.85], [0, 3.15, 0], "#5c2020", { studless: true }),
  b([0.5, 1.0, 0.5], [1.0, 3.0, 0], "#8a8a8a", { studless: true }),
  b([0.35, 1.2, 0.35], [-2.6, 0.8, 1.4], "#6b4226", { shape: "cylinder" }),
  b([1.6, 1.6, 1.6], [-2.6, 2.2, 1.4], "#2f7a3d", { shape: "cone" }),
  b([0.4, 0.08, 0.4], [0, 0.24, 1.8], "#9a9a9a", { studless: true }),
  b([0.4, 0.08, 0.4], [0, 0.24, 2.4], "#9a9a9a", { studless: true }),
  b([0.6, 0.5, 0.6], [-1.6, 0.45, 1.5], "#3a8a4a", { shape: "cone" }),
  b([0.6, 0.5, 0.6], [1.6, 0.45, 1.5], "#3a8a4a", { shape: "cone" })
];

// ---------------------------------------------------------------------------
// SPACE ROCKET — tre stadi impilati, ogiva, alette e oblò.
// ---------------------------------------------------------------------------
const rocketWhite = "#e8ebf1";
const rocketRed = "#c23b3b";
const rocketBricks: ShowcaseBrick[] = [
  b([3.0, 0.3, 3.0], [0, 0.15, 0], "#5a6270"),
  b([1.6, 1.8, 1.6], [0, 1.2, 0], rocketWhite, { shape: "cylinder" }),
  b([1.6, 1.0, 1.6], [0, 2.6, 0], rocketRed, { shape: "cylinder" }),
  b([1.4, 1.4, 1.4], [0, 3.8, 0], rocketWhite, { shape: "cylinder" }),
  b([1.4, 1.2, 1.4], [0, 5.1, 0], rocketRed, { shape: "cone" }),
  b([0.15, 1.0, 0.7], [0.75, 0.8, 0], rocketRed, { studless: true }),
  b([0.15, 1.0, 0.7], [-0.75, 0.8, 0], rocketRed, { studless: true }),
  b([0.7, 1.0, 0.15], [0, 0.8, 0.75], rocketRed, { studless: true }),
  b([0.7, 1.0, 0.15], [0, 0.8, -0.75], rocketRed, { studless: true }),
  b([0.4, 0.08, 0.4], [0.63, 3.8, 0], "#1e293b", { shape: "cylinder", rotation: [0, 0, Math.PI / 2], studless: true }),
  b([0.4, 0.08, 0.4], [0, 3.8, 0.63], "#1e293b", { shape: "cylinder", rotation: [Math.PI / 2, 0, 0], studless: true })
];

// ---------------------------------------------------------------------------
// PIXEL ROBOT — mascotte da vetrina: gambe, corpo, braccia, testa e antenna.
// ---------------------------------------------------------------------------
const robotBlue = "#3b6ecb";
const robotBricks: ShowcaseBrick[] = [
  b([2.2, 0.15, 1.4], [0, 0.075, 0], "#2b3040"),
  b([0.5, 0.9, 0.5], [-0.4, 0.6, 0], "#8a92a6"),
  b([0.5, 0.9, 0.5], [0.4, 0.6, 0], "#8a92a6"),
  b([1.1, 1.2, 0.7], [0, 1.65, 0], robotBlue),
  b([0.3, 0.1, 0.3], [0, 1.65, 0.36], "#facc15", { shape: "cylinder", rotation: [Math.PI / 2, 0, 0], studless: true }),
  b([0.35, 0.9, 0.35], [-0.85, 1.8, 0], robotBlue, { rotation: [0, 0, 0.15] }),
  b([0.35, 0.9, 0.35], [0.85, 1.8, 0], robotBlue, { rotation: [0, 0, -0.15] }),
  b([0.8, 0.7, 0.7], [0, 2.6, 0], "#c7ccdb", { studless: true }),
  b([0.12, 0.12, 0.05], [-0.18, 2.65, 0.36], "#0f1420", { studless: true }),
  b([0.12, 0.12, 0.05], [0.18, 2.65, 0.36], "#0f1420", { studless: true }),
  b([0.4, 0.08, 0.05], [0, 2.4, 0.36], "#0f1420", { studless: true }),
  b([0.15, 0.4, 0.15], [0, 3.15, 0], "#8a92a6", { shape: "cylinder" }),
  b([0.2, 0.2, 0.2], [0, 3.45, 0], "#ef4444", { shape: "cone" })
];

export const creations: ShowcaseCreation[] = [
  {
    slug: "medieval-castle",
    title: "Medieval Castle",
    author: "@brick_king",
    description: "A mighty castle built one brick at a time, complete with corner towers and a flying flag.",
    likes: "4.6K",
    views: "22.1K",
    bricks: castleBricks,
    camera: [9, 7, 10],
    target: [0, 1.6, 0]
  },
  {
    slug: "cozy-cabin",
    title: "Cozy Cabin",
    author: "@forest_builder",
    description: "A little wooden cabin in the woods, with a warm chimney and a tree out front.",
    likes: "1.6K",
    views: "7.8K",
    bricks: cabinBricks,
    camera: [6, 4.5, 6.5],
    target: [0, 1.2, 0]
  },
  {
    slug: "space-rocket",
    title: "Space Rocket",
    author: "@galactic",
    description: "A three-stage rocket ready for launch, fins and all.",
    likes: "2.9K",
    views: "15.3K",
    bricks: rocketBricks,
    camera: [5, 4, 6],
    target: [0, 2.2, 0]
  },
  {
    slug: "pixel-robot",
    title: "Samurai Mech",
    author: "@mech_legend",
    description: "A friendly blocky mech, built brick by brick as a builder mascot.",
    likes: "1.8K",
    views: "9.3K",
    bricks: robotBricks,
    camera: [3.6, 2.6, 4.2],
    target: [0, 1.4, 0]
  }
];

export function findCreation(slug: string) {
  return creations.find((c) => c.slug === slug) ?? null;
}
