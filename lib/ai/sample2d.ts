export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

type Rgb = [number, number, number];

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function sampleRect(
  bounds: Bounds,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const x0 = bounds.minX + (x / width) * bounds.width;
  const x1 = bounds.minX + ((x + 1) / width) * bounds.width;
  const y0 = bounds.minY + (y / height) * bounds.height;
  const y1 = bounds.minY + ((y + 1) / height) * bounds.height;
  return {
    x0: Math.floor(x0),
    x1: Math.ceil(x1),
    y0: Math.floor(y0),
    y1: Math.ceil(y1)
  };
}

export function resampleMaskCoverage(
  mask: boolean[][],
  bounds: Bounds,
  width: number,
  height: number,
  cover: number
) {
  const srcH = mask.length;
  const srcW = mask[0]?.length ?? 0;
  const out = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
  const need = clamp(cover, 0.2, 0.8);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rect = sampleRect(bounds, x, y, width, height);
      let hits = 0;
      let total = 0;
      for (let sy = rect.y0; sy < rect.y1; sy += 1) {
        if (sy < 0 || sy >= srcH) continue;
        for (let sx = rect.x0; sx < rect.x1; sx += 1) {
          if (sx < 0 || sx >= srcW) continue;
          total += 1;
          if (mask[sy][sx]) hits += 1;
        }
      }
      out[y][x] = total > 0 && hits / total >= need;
    }
  }
  return out;
}

export function resampleColorBox(
  colors: (Rgb | null)[][],
  mask: boolean[][],
  bounds: Bounds,
  width: number,
  height: number
) {
  const srcH = colors.length;
  const srcW = colors[0]?.length ?? 0;
  const out: (Rgb | null)[][] = Array.from({ length: height }, () => Array(width).fill(null));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rect = sampleRect(bounds, x, y, width, height);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = rect.y0; sy < rect.y1; sy += 1) {
        if (sy < 0 || sy >= srcH) continue;
        for (let sx = rect.x0; sx < rect.x1; sx += 1) {
          if (sx < 0 || sx >= srcW) continue;
          if (!mask[sy]?.[sx]) continue;
          const rgb = colors[sy][sx];
          if (!rgb) continue;
          r += rgb[0];
          g += rgb[1];
          b += rgb[2];
          n += 1;
        }
      }
      if (n) out[y][x] = [r / n, g / n, b / n];
    }
  }
  return out;
}
