type Mask = boolean[][];

function sizeOf(mask: Mask) {
  return { h: mask.length, w: mask[0]?.length ?? 0 };
}

function cloneMask(mask: Mask): Mask {
  return mask.map((row) => row.slice());
}

function neighbors8(mask: Mask, x: number, y: number) {
  const { h, w } = sizeOf(mask);
  let n = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (mask[ny][nx]) n += 1;
    }
  }
  return n;
}

function neighbors4(mask: Mask, x: number, y: number) {
  const { h, w } = sizeOf(mask);
  let n = 0;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (mask[ny][nx]) n += 1;
  }
  return n;
}

function majority(mask: Mask): Mask {
  const { h, w } = sizeOf(mask);
  const out = cloneMask(mask);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const n = neighbors8(mask, x, y);
      if (mask[y][x] && n <= 1) out[y][x] = false;
      else if (!mask[y][x] && n >= 6) out[y][x] = true;
    }
  }
  return out;
}

function dropSpurs(mask: Mask): Mask {
  const { h, w } = sizeOf(mask);
  const out = cloneMask(mask);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      if (neighbors4(mask, x, y) === 0) out[y][x] = false;
    }
  }
  return out;
}

function fillStairs(mask: Mask): Mask {
  const { h, w } = sizeOf(mask);
  const out = cloneMask(mask);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (out[y][x]) continue;
      const n = mask[y - 1][x];
      const s = mask[y + 1][x];
      const e = mask[y][x + 1];
      const west = mask[y][x - 1];
      const ne = mask[y - 1][x + 1];
      const nw = mask[y - 1][x - 1];
      const se = mask[y + 1][x + 1];
      const sw = mask[y + 1][x - 1];
      if ((n && e && ne) || (n && west && nw) || (s && e && se) || (s && west && sw)) {
        out[y][x] = true;
      }
    }
  }
  return out;
}

export function smoothSilhouette(mask: Mask): Mask {
  if (!mask.length || !mask[0]?.length) return mask;
  return dropSpurs(fillStairs(majority(mask)));
}
