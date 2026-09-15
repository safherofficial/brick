export type Rgb = [number, number, number];

function dist2(a: Rgb, b: Rgb) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function hexOf(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function collectMaskedColors(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  mask: boolean[][],
  minAlpha: number
): Rgb[] {
  const out: Rgb[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y]?.[x]) continue;
      const i = (y * width + x) * 4;
      if (rgba[i + 3] < minAlpha) continue;
      out.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
    }
  }
  return out;
}

export function paletteFromSubject(colors: Rgb[], size = 24): string[] {
  const buckets = new Map<string, { rgb: Rgb; n: number }>();
  for (const rgb of colors) {
    const q: Rgb = [
      Math.round(rgb[0] / 8) * 8,
      Math.round(rgb[1] / 8) * 8,
      Math.round(rgb[2] / 8) * 8
    ];
    const id = q.join(":");
    const hit = buckets.get(id);
    if (hit) hit.n += 1;
    else buckets.set(id, { rgb: q, n: 1 });
  }
  const chosen: Rgb[] = [];
  for (const item of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    if (chosen.every((c) => dist2(c, item.rgb) > 420)) chosen.push(item.rgb);
    if (chosen.length >= size) break;
  }
  if (!chosen.length) chosen.push([242, 240, 232]);
  return chosen.map((c) => hexOf(c[0], c[1], c[2]));
}

export function pickFaceColor(
  image: (Rgb | null)[][],
  regions: (Rgb | null)[][],
  x: number,
  y: number
): Rgb {
  return image[y]?.[x] ?? regions[y]?.[x] ?? [214, 214, 214];
}
