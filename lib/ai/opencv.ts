// lib/ai/opencv.ts
type Mask = boolean[][];

function sizeOf(mask: Mask) {
  return { h: mask.length, w: mask[0]?.length ?? 0 };
}

function cloneMask(mask: Mask): Mask {
  return mask.map((row) => row.slice());
}

function dilate(mask: Mask): Mask {
  const { h, w } = sizeOf(mask);
  const out = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          out[ny][nx] = true;
        }
      }
    }
  }
  return out;
}

function erode(mask: Mask): Mask {
  const { h, w } = sizeOf(mask);
  const out = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      let keep = true;
      for (let dy = -1; dy <= 1 && keep; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny][nx]) {
            keep = false;
            break;
          }
        }
      }
      out[y][x] = keep;
    }
  }
  return out;
}

export function morphClose(mask: Mask): Mask {
  if (!mask.length || !mask[0]?.length) return mask;
  return erode(dilate(mask));
}

export function stripHalo(mask: Mask): Mask {
  if (!mask.length || !mask[0]?.length) return mask;
  return dilate(erode(mask));
}

export function refineMask(mask: Mask): Mask {
  return stripHalo(morphClose(cloneMask(mask)));
}

export async function refineMaskWithOpenCv(mask: Mask): Promise<Mask> {
  return refineMask(mask);
}
