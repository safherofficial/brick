import type { BrickShape } from "@/components/builder/BrickVisual";

export type ShowcaseBrick = {
  size: [number, number, number];
  position: [number, number, number];
  color: string;
  shape?: BrickShape;
  rotation?: [number, number, number];
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
  extra?: {
    shape?: BrickShape;
    rotation?: [number, number, number];
    studless?: boolean;
  }
): ShowcaseBrick {
  return { size, position, color, ...extra };
}

const BRICK_H = 0.45;

// Deve combaciare con STUD in components/builder/BrickVisual.tsx,
// così i pezzi tassellati qui si allineano alla stessa griglia
// usata dal Builder.
const STUD = 0.9;

/*
 * Hash deterministico (niente Math.random): stessa scena identica
 * lato server e lato client, senza mismatch di idratazione.
 */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function shade(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16);

  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const bl = num & 255;

  const mix = (channel: number) =>
    Math.round(
      Math.min(255, Math.max(0, channel + amount * 255))
    )
      .toString(16)
      .padStart(2, "0");

  return `#${mix(r)}${mix(g)}${mix(bl)}`;
}

/**
 * Tassella un'area rettangolare (w × d, in world units) con tanti
 * piccoli brick invece di un'unica lastra solida: è il modo in cui
 * aumentiamo la "risoluzione voxel" dei modelli, con una leggera
 * variazione di tono pezzo per pezzo per dare texture.
 */
function tileArea(
  w: number,
  d: number,
  cx: number,
  cz: number,
  y: number,
  height: number,
  baseColor: string,
  opts?: {
    unit?: number;
    gap?: number;
    jitter?: number;
    seed?: number;
    studless?: boolean;
  }
): ShowcaseBrick[] {
  const unit = opts?.unit ?? STUD;
  const gap = opts?.gap ?? 0.06;
  const jitter = opts?.jitter ?? 0.05;
  const seed = opts?.seed ?? 0;

  const cols = Math.max(1, Math.round(w / unit));
  const rows = Math.max(1, Math.round(d / unit));

  const cellW = w / cols;
  const cellD = d / rows;

  const brickW = Math.max(0.1, cellW - gap);
  const brickD = Math.max(0.1, cellD - gap);

  const bricks: ShowcaseBrick[] = [];

  for (let ix = 0; ix < cols; ix++) {
    for (let iz = 0; iz < rows; iz++) {
      const x = cx - w / 2 + cellW / 2 + ix * cellW;
      const z = cz - d / 2 + cellD / 2 + iz * cellD;

      const n = hash(ix * 13.1 + iz * 7.7 + seed * 91.7);
      const color = shade(baseColor, (n - 0.5) * jitter);

      bricks.push(
        b(
          [brickW, height, brickD],
          [x, y, z],
          color,
          opts?.studless ? { studless: true } : undefined
        )
      );
    }
  }

  return bricks;
}

// ------------------------------------------------------------
// Gradiente arcobaleno in stile Solana, usato dall'emblema qui
// sotto. Interpolazione lineare RGB tra alcuni stop di colore.
// ------------------------------------------------------------

const SOLANA_STOPS: Array<[number, string]> = [
  [0.0, "#7B3FE4"],
  [0.16, "#4C6FEF"],
  [0.32, "#2FB8E8"],
  [0.48, "#2FE0C0"],
  [0.62, "#8FE457"],
  [0.76, "#F3DE4B"],
  [0.88, "#F5993D"],
  [1.0, "#F35E9E"]
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function solanaGradient(t: number): string {
  const tt = Math.min(1, Math.max(0, t));

  for (let i = 0; i < SOLANA_STOPS.length - 1; i++) {
    const [t0, c0] = SOLANA_STOPS[i];
    const [t1, c1] = SOLANA_STOPS[i + 1];

    if (tt >= t0 && tt <= t1) {
      const localT = (tt - t0) / (t1 - t0);
      const rgb0 = hexToRgb(c0);
      const rgb1 = hexToRgb(c1);

      const mixed: [number, number, number] = [
        rgb0[0] + (rgb1[0] - rgb0[0]) * localT,
        rgb0[1] + (rgb1[1] - rgb0[1]) * localT,
        rgb0[2] + (rgb1[2] - rgb0[2]) * localT
      ];

      return rgbToHex(mixed);
    }
  }

  return SOLANA_STOPS[SOLANA_STOPS.length - 1][1];
}

function tower(
  x: number,
  z: number,
  height: number,
  body: string,
  accent: string,
  roof: string
): ShowcaseBrick[] {
  const bricks: ShowcaseBrick[] = [];

  for (let y = 0; y < height; y += BRICK_H) {
    bricks.push(
      b(
        [1.8, BRICK_H, 1.8],
        [x, y + BRICK_H / 2, z],
        body
      )
    );

    if (y >= 0.9 && Math.round(y / BRICK_H) % 3 === 0) {
      bricks.push(
        b(
          [0.32, 0.24, 0.08],
          [x, y + 0.08, z + 0.94],
          accent,
          { studless: true }
        )
      );
    }
  }

  bricks.push(
    b(
      [2.15, 0.3, 2.15],
      [x, height + 0.15, z],
      accent
    )
  );

  bricks.push(
    b(
      [2.0, 0.9, 2.0],
      [x, height + 0.75, z],
      roof,
      { shape: "cone" }
    )
  );

  return bricks;
}

// ------------------------------------------------------------
// CYBERPUNK MEGACITY
// ------------------------------------------------------------

function cyberpunkCity(): ShowcaseBrick[] {
  const bricks: ShowcaseBrick[] = [];

  const dark = "#182238";
  const dark2 = "#263653";
  const cyan = "#22d3ee";
  const magenta = "#e879f9";
  const glass = "#7dd3fc";
  const road = "#0b1220";

  bricks.push(
    ...tileArea(12.6, 10.8, 0, 0, 0.225, 0.45, road, {
      seed: 1
    })
  );

  bricks.push(
    b(
      [10.8, 0.12, 0.9],
      [0, 0.52, 0],
      "#111827",
      { studless: true }
    )
  );

  bricks.push(
    b(
      [0.9, 0.12, 9.8],
      [0, 0.54, 0],
      "#111827",
      { studless: true }
    )
  );

  const buildings = [
    [-4.2, -3.2, 3.6, 2.5, 2.5],
    [-1.2, -3.2, 5.4, 2.2, 2.2],
    [2.0, -3.2, 3.2, 2.6, 2.2],
    [4.5, -3.0, 6.3, 2.5, 2.5],
    [-4.2, 0.4, 5.0, 2.2, 2.2],
    [4.2, 0.5, 4.5, 2.5, 2.5],
    [-4.0, 3.5, 3.0, 2.6, 2.2],
    [-0.8, 3.2, 7.2, 2.4, 2.4],
    [2.7, 3.4, 4.2, 2.4, 2.2]
  ] as Array<[number, number, number, number, number]>;

  buildings.forEach(([x, z, h, w, d], index) => {
    const levels = Math.round(h / BRICK_H);

    for (let i = 0; i < levels; i++) {
      bricks.push(
        ...tileArea(
          w,
          d,
          x,
          z,
          0.45 + i * BRICK_H,
          BRICK_H,
          index % 2 ? dark2 : dark,
          { seed: index * 97 + i }
        )
      );

      if (i > 0 && i % 2 === 0) {
        bricks.push(
          b(
            [Math.max(0.3, w - 0.35), 0.18, 0.05],
            [x, 0.45 + i * BRICK_H, z + d / 2 + 0.04],
            glass,
            { studless: true }
          )
        );
      }
    }

    bricks.push(
      b(
        [w + 0.18, 0.18, d + 0.18],
        [x, h + 0.54, z],
        index % 2 ? cyan : magenta,
        { studless: true }
      )
    );

    if (index === 3 || index === 7) {
      bricks.push(
        b(
          [0.18, 1.2, 0.18],
          [x, h + 1.2, z],
          cyan,
          { studless: true }
        )
      );

      bricks.push(
        b(
          [0.7, 0.12, 0.12],
          [x, h + 1.8, z],
          magenta,
          { studless: true }
        )
      );
    }
  });

  for (let x = -5.2; x <= 5.2; x += 1.3) {
    bricks.push(
      b(
        [0.12, 0.12, 8.8],
        [x, 0.62, 0],
        cyan,
        { studless: true }
      )
    );
  }

  for (let z = -4.1; z <= 4.1; z += 1.3) {
    bricks.push(
      b(
        [10.8, 0.12, 0.12],
        [0, 0.63, z],
        magenta,
        { studless: true }
      )
    );
  }

  bricks.push(
    b(
      [5.0, 0.16, 0.18],
      [0, 4.2, 0],
      cyan,
      { studless: true }
    )
  );

  bricks.push(
    b(
      [0.18, 0.16, 5.0],
      [0, 4.25, 0],
      magenta,
      { studless: true }
    )
  );

  return bricks;
}

// ------------------------------------------------------------
// ORBITAL COMMAND STATION
// ------------------------------------------------------------

function spaceStation(): ShowcaseBrick[] {
  const bricks: ShowcaseBrick[] = [];

  const white = "#dce5f2";
  const grey = "#66758a";
  const blue = "#3b82f6";
  const orange = "#f97316";
  const glass = "#38bdf8";

  bricks.push(
    ...tileArea(4.8, 4.8, 0, 0, 0.225, 0.45, grey, {
      seed: 2
    })
  );

  let hubLevel = 0;

  for (let y = 0; y < 3.6; y += BRICK_H) {
    bricks.push(
      ...tileArea(
        2.7,
        2.7,
        0,
        0,
        0.45 + y,
        BRICK_H,
        white,
        { seed: 200 + hubLevel }
      )
    );

    hubLevel += 1;
  }

  bricks.push(
    b(
      [3.0, 0.5, 3.0],
      [0, 4.15, 0],
      blue,
      { shape: "cylinder" }
    )
  );

  bricks.push(
    b(
      [2.5, 1.2, 2.5],
      [0, 5.0, 0],
      white,
      { shape: "cone" }
    )
  );

  const wings = [
    [-5.0, 0, 0],
    [5.0, 0, 0],
    [0, 0, -5.0],
    [0, 0, 5.0]
  ] as Array<[number, number, number]>;

  wings.forEach(([x, y, z], index) => {
    const horizontal = x !== 0;

    for (let i = -2; i <= 2; i++) {
      const p: [number, number, number] = horizontal
        ? [x, 0.9, i * 0.75]
        : [i * 0.75, 0.9, z];

      bricks.push(
        b(
          horizontal
            ? [2.8, 0.3, 0.6]
            : [0.6, 0.3, 2.8],
          p,
          white
        )
      );
    }

    const panelX = horizontal
      ? x + (x > 0 ? 1.55 : -1.55)
      : 0;

    const panelZ = horizontal
      ? 0
      : z + (z > 0 ? 1.55 : -1.55);

    bricks.push(
      b(
        horizontal
          ? [2.4, 0.12, 3.8]
          : [3.8, 0.12, 2.4],
        [panelX, 1.08, panelZ],
        blue,
        { studless: true }
      )
    );

    bricks.push(
      b(
        horizontal
          ? [0.12, 0.14, 4.0]
          : [4.0, 0.14, 0.12],
        [panelX, 1.16, panelZ],
        orange,
        { studless: true }
      )
    );

    if (index < 2) {
      bricks.push(
        b(
          [0.55, 0.55, 0.55],
          [
            x > 0 ? x - 1.7 : x + 1.7,
            1.0,
            0
          ],
          glass,
          { shape: "cylinder" }
        )
      );
    }
  });

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;

    const x = Math.cos(angle) * 3.1;
    const z = Math.sin(angle) * 3.1;

    bricks.push(
      b(
        [0.45, 0.9, 0.45],
        [x, 1.0, z],
        orange,
        { shape: "cylinder" }
      )
    );
  }

  return bricks;
}

// ------------------------------------------------------------
// IMPERIAL JAPANESE CASTLE
// ------------------------------------------------------------

function japaneseCastle(): ShowcaseBrick[] {
  const bricks: ShowcaseBrick[] = [];

  const stone = "#b7bec9";
  const stone2 = "#d5dae2";
  const roof = "#26364a";
  const roof2 = "#334a62";
  const wood = "#70452d";
  const gold = "#d4a72c";

  bricks.push(
    ...tileArea(11, 9, 0, 0, 0.225, 0.45, stone, {
      seed: 3
    })
  );

  const levels = [
    { y: 0.45, w: 8.4, d: 6.4, h: 1.8 },
    { y: 2.25, w: 6.6, d: 5.0, h: 1.35 },
    { y: 3.6, w: 5.0, d: 3.8, h: 1.2 },
    { y: 4.8, w: 3.5, d: 2.8, h: 1.05 }
  ];

  levels.forEach((level, li) => {
    const count = Math.round(level.h / BRICK_H);

    for (let i = 0; i < count; i++) {
      bricks.push(
        ...tileArea(
          level.w,
          level.d,
          0,
          0,
          level.y + i * BRICK_H + BRICK_H / 2,
          BRICK_H,
          li % 2 ? stone2 : stone,
          { seed: li * 61 + i }
        )
      );
    }

    bricks.push(
      b(
        [level.w + 0.25, 0.22, level.d + 0.25],
        [0, level.y + level.h + 0.11, 0],
        roof
      )
    );

    bricks.push(
      b(
        [level.w * 0.72, 0.32, level.d * 0.72],
        [0, level.y + level.h + 0.38, 0],
        roof2,
        { shape: "cone" }
      )
    );
  });

  tower(-4.3, -3.3, 2.25, stone, stone2, roof);
  tower(4.3, -3.3, 2.25, stone, stone2, roof);
  tower(-4.3, 3.3, 2.25, stone, stone2, roof);
  tower(4.3, 3.3, 2.25, stone, stone2, roof);

  bricks.push(
    b(
      [1.2, 1.8, 0.25],
      [0, 1.0, 3.25],
      wood,
      { studless: true }
    )
  );

  bricks.push(
    b(
      [1.5, 0.16, 0.12],
      [0, 1.9, 3.38],
      gold,
      { studless: true }
    )
  );

  for (const x of [-2.4, -1.2, 1.2, 2.4]) {
    bricks.push(
      b(
        [0.45, 0.55, 0.08],
        [x, 3.15, 2.54],
        wood,
        { studless: true }
      )
    );

    bricks.push(
      b(
        [0.45, 0.55, 0.08],
        [x, 4.4, 1.94],
        wood,
        { studless: true }
      )
    );
  }

  bricks.push(
    b(
      [0.16, 2.4, 0.16],
      [0, 6.6, 0],
      gold,
      { studless: true }
    )
  );

  bricks.push(
    b(
      [0.5, 0.25, 0.5],
      [0, 7.85, 0],
      gold,
      { shape: "cone", studless: true }
    )
  );

  return bricks;
}

// ------------------------------------------------------------
// STEAMPUNK AIRSHIP
// ------------------------------------------------------------

function airship(): ShowcaseBrick[] {
  const bricks: ShowcaseBrick[] = [];

  const bronze = "#8b5a2b";
  const dark = "#3f2d1f";
  const brass = "#d4a72c";
  const red = "#a63d2f";
  const cream = "#ead9b6";

  bricks.push(
    ...tileArea(7.2, 3.0, 0, 0, 2.0, 0.45, dark, {
      seed: 4
    })
  );

  for (let x = -3; x <= 3; x += 1) {
    bricks.push(
      b(
        [0.75, 0.55, 3.4],
        [x, 2.45, 0],
        bronze
      )
    );
  }

  bricks.push(
    b(
      [8.0, 0.3, 2.7],
      [0, 2.85, 0],
      brass,
      { studless: true }
    )
  );

  bricks.push(
    b(
      [5.8, 0.5, 2.2],
      [0, 3.25, 0],
      cream,
      { shape: "cone", studless: true }
    )
  );

  for (const x of [-2.8, -1.4, 0, 1.4, 2.8]) {
    bricks.push(
      b(
        [0.25, 2.1, 0.25],
        [x, 0.85, 0],
        bronze,
        { studless: true }
      )
    );

    bricks.push(
      b(
        [0.25, 0.25, 2.8],
        [x, 0.55, 0],
        brass,
        { studless: true }
      )
    );
  }

  bricks.push(
    ...tileArea(2.8, 1.8, 0, 0, 0.1, 0.4, dark, {
      seed: 5
    })
  );

  bricks.push(
    b(
      [1.9, 0.8, 1.5],
      [0, -0.45, 0],
      red,
      { shape: "cone" }
    )
  );

  for (const x of [-2.7, 2.7]) {
    bricks.push(
      b(
        [0.45, 1.8, 0.45],
        [x, 3.8, 0],
        bronze,
        { shape: "cylinder" }
      )
    );

    bricks.push(
      b(
        [0.8, 0.2, 0.8],
        [x, 4.75, 0],
        brass
      )
    );

    bricks.push(
      b(
        [0.15, 2.2, 0.15],
        [x, 5.85, 0],
        dark,
        { studless: true }
      )
    );
  }

  bricks.push(
    b(
      [0.3, 0.3, 0.3],
      [0, 5.9, 0],
      brass,
      { shape: "cone", studless: true }
    )
  );

  return bricks;
}

// ------------------------------------------------------------
// SOLANA EMBLEM
// ------------------------------------------------------------

/**
 * Una singola barra a parallelogramma: righe impilate lungo Y,
 * ognuna traslata un po' lungo X rispetto a quella sotto — è
 * questo shear per-riga che produce il profilo a parallelogramma
 * (i lati obliqui) invece di un semplice rettangolo, restando
 * comunque costruito da soli cubetti allineati alla griglia.
 */
function solanaBar(
  columns: number,
  rows: number,
  xOffset: number,
  yBase: number,
  shearPerRow: number,
  depth: number
): ShowcaseBrick[] {
  const unit = STUD;
  const cell = unit - 0.06;

  const bricks: ShowcaseBrick[] = [];

  for (let r = 0; r < rows; r++) {
    const rowShift = xOffset + r * shearPerRow;

    for (let c = 0; c < columns; c++) {
      const x = rowShift + (c - (columns - 1) / 2) * unit;
      const y = yBase + r * unit + unit / 2;

      const t = c / (columns - 1);
      const color = solanaGradient(t);

      bricks.push(
        b([cell, cell, depth], [x, y, 0], color)
      );
    }
  }

  return bricks;
}

function solanaEmblem(): ShowcaseBrick[] {
  const bricks: ShowcaseBrick[] = [];

  const columns = 24;
  const rows = 4;
  const gapBetweenBars = 1.0;
  const depth = 1.6;
  const shearPerRow = 0.32;

  const barPitch = rows * STUD + gapBetweenBars;

  for (let barIndex = 0; barIndex < 3; barIndex++) {
    bricks.push(
      ...solanaBar(
        columns,
        rows,
        0,
        barIndex * barPitch,
        shearPerRow,
        depth
      )
    );
  }

  const totalWidth = columns * STUD + shearPerRow * rows + 2.4;

  bricks.push(
    ...tileArea(
      totalWidth,
      depth + 2.0,
      shearPerRow * rows * 0.5,
      0,
      -0.75,
      0.55,
      "#090b12",
      { seed: 11, studless: true, jitter: 0.03 }
    )
  );

  return bricks;
}

export const creations: ShowcaseCreation[] = [
  {
    slug: "cyberpunk-megacity",
    title: "Cyberpunk Megacity",
    author: "@future_builder",
    description:
      "A dense neon metropolis with layered towers, illuminated facades, elevated streets and a full city grid.",
    likes: "8.9K",
    views: "41.7K",
    bricks: cyberpunkCity(),
    camera: [14, 10, 15],
    target: [0, 2.2, 0]
  },
  {
    slug: "orbital-command-station",
    title: "Orbital Command Station",
    author: "@orbitalworks",
    description:
      "A high-detail orbital station with a central command core, four docking wings, solar arrays and antenna modules.",
    likes: "7.4K",
    views: "36.8K",
    bricks: spaceStation(),
    camera: [13, 9, 14],
    target: [0, 2.0, 0]
  },
  {
    slug: "imperial-japanese-castle",
    title: "Imperial Japanese Castle",
    author: "@heritage_builder",
    description:
      "A multi-tiered fortress with layered roofs, corner towers, timber details, windows and a ceremonial entrance.",
    likes: "10.2K",
    views: "52.4K",
    bricks: japaneseCastle(),
    camera: [13, 9, 14],
    target: [0, 3.0, 0]
  },
  {
    slug: "steampunk-airship",
    title: "Steampunk Airship",
    author: "@clockworklab",
    description:
      "A complex airship with a reinforced hull, engine assembly, observation towers, propeller housing and brass detailing.",
    likes: "6.8K",
    views: "31.5K",
    bricks: airship(),
    camera: [12, 7, 14],
    target: [0, 2.5, 0]
  },
  {
    slug: "solana-emblem",
    title: "Solana Emblem",
    author: "@onchain_builder",
    description:
      "A high-resolution voxel sculpture of three sheared, gradient-lit bars — a brick tribute to the Solana mark.",
    likes: "9.1K",
    views: "44.3K",
    bricks: solanaEmblem(),
    camera: [26, 14, 28],
    target: [0.6, 6.0, 0]
  }
];

export function findCreation(slug: string) {
  return creations.find((c) => c.slug === slug) ?? null;
}
