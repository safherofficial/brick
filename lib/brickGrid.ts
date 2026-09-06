import type { ShowcaseBrick } from "@/lib/creations";

function b(
  size: [number, number, number],
  position: [number, number, number],
  color: string,
  extra?: { studless?: boolean }
): ShowcaseBrick {
  return { size, position, color, ...extra };
}

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

function lerpColor(a: string, b: string, t: number) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = Math.min(1, Math.max(0, t));
  return rgbToHex([
    ca[0] + (cb[0] - ca[0]) * k,
    ca[1] + (cb[1] - ca[1]) * k,
    ca[2] + (cb[2] - ca[2]) * k
  ]);
}

function worldOrbColor(nx: number, ny: number, nz: number) {
  const u = nx * 0.5 + 0.5;
  const v = ny * 0.5 + 0.5;

  let c = lerpColor("#7fe7ff", "#f6d0a8", v);
  c = lerpColor(c, "#f4a0c4", u * 0.75);
  c = lerpColor(c, "#3aa0ff", (1 - v) * 0.45);
  c = lerpColor(c, "#f3e07a", v * (1 - u) * 0.35);

  const rim = Math.max(0, 1 - Math.abs(nz));
  const spec =
    Math.exp(-((nx + 0.25) ** 2 + (ny - 0.35) ** 2) * 18) +
    Math.exp(-((nx - 0.15) ** 2 + (ny + 0.2) ** 2) * 22);
  const meridian = Math.exp(-(nx * nx) * 28) * Math.max(0, nz);
  const equator = Math.exp(-(ny * ny) * 28) * Math.max(0, nz);
  const cross = Math.max(meridian, equator) * 0.85;
  const lift = Math.min(1, spec * 1.4 + cross + rim * 0.12);

  return lerpColor(c, "#ffffff", lift);
}

const GLYPH: Record<string, string[]> = {
  w: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  o: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  r: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  l: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  d: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"]
};

function voxelText(
  text: string,
  originX: number,
  originY: number,
  originZ: number,
  unit: number,
  color: string
): ShowcaseBrick[] {
  const bricks: ShowcaseBrick[] = [];
  let cursor = 0;

  for (const ch of text.toLowerCase()) {
    const glyph = GLYPH[ch];
    if (!glyph) {
      cursor += 3;
      continue;
    }
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row][col] !== "1") continue;
        bricks.push(
          b(
            [unit * 0.86, unit * 0.86, unit * 0.86],
            [
              originX + (cursor + col) * unit,
              originY + (glyph.length - 1 - row) * unit,
              originZ
            ],
            color,
            { studless: true }
          )
        );
      }
    }
    cursor += glyph[0].length + 1;
  }

  return bricks;
}

export function worldEmblem(): ShowcaseBrick[] {
  const bricks: ShowcaseBrick[] = [];
  const unit = 0.42;
  const radius = 5;
  const cx = -3.2;
  const cy = 2.4;
  const cz = 0;

  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      for (let z = -radius; z <= radius; z++) {
        const d = Math.sqrt(x * x + y * y + z * z);
        if (d > radius + 0.15 || d < radius - 1.05) continue;

        const nx = x / radius;
        const ny = y / radius;
        const nz = z / radius;

        bricks.push(
          b(
            [unit * 0.92, unit * 0.92, unit * 0.92],
            [cx + x * unit, cy + y * unit, cz + z * unit],
            worldOrbColor(nx, ny, nz),
            { studless: true }
          )
        );
      }
    }
  }

  bricks.push(...voxelText("world", 0.35, 1.55, 0.15, 0.38, "#f4f7ff"));
  return bricks;
}
