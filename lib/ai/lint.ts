import type { ImageVoxel } from "@/lib/imageVoxel";

function key(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function neighborColor(map: Map<string, ImageVoxel>, x: number, y: number, z: number) {
  const hits = [
    map.get(key(x + 1, y, z)),
    map.get(key(x - 1, y, z)),
    map.get(key(x, y + 1, z)),
    map.get(key(x, y - 1, z)),
    map.get(key(x, y, z + 1)),
    map.get(key(x, y, z - 1))
  ].filter(Boolean) as ImageVoxel[];
  if (!hits.length) return 0;
  const votes = new Map<number, number>();
  for (const hit of hits) votes.set(hit.c, (votes.get(hit.c) ?? 0) + 1);
  let best = hits[0].c;
  let bestN = -1;
  for (const [c, n] of votes) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

export function fillAxisGaps(voxels: ImageVoxel[]): ImageVoxel[] {
  if (voxels.length < 2) return voxels;
  const map = new Map(voxels.map((v) => [key(v.x, v.y, v.z), { ...v }]));

  const fill = (
    groupKey: (v: ImageVoxel) => string,
    axis: "x" | "y" | "z"
  ) => {
    const groups = new Map<string, ImageVoxel[]>();
    for (const v of map.values()) {
      const id = groupKey(v);
      const list = groups.get(id) ?? [];
      list.push(v);
      groups.set(id, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a[axis] - b[axis]);
      for (let i = 0; i < list.length - 1; i += 1) {
        const a = list[i];
        const b = list[i + 1];
        if (b[axis] - a[axis] !== 2) continue;
        const next = { ...a, [axis]: a[axis] + 1 } as ImageVoxel;
        const id = key(next.x, next.y, next.z);
        if (map.has(id)) continue;
        map.set(id, { ...next, c: neighborColor(map, next.x, next.y, next.z) });
      }
    }
  };

  fill((v) => `${v.y}:${v.z}`, "x");
  fill((v) => `${v.x}:${v.z}`, "y");
  fill((v) => `${v.x}:${v.y}`, "z");
  return [...map.values()];
}

export function fillTinyCavities(voxels: ImageVoxel[]): ImageVoxel[] {
  if (voxels.length < 8) return voxels;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const solid = new Set<string>();
  for (const v of voxels) {
    solid.add(key(v.x, v.y, v.z));
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    minZ = Math.min(minZ, v.z);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    maxZ = Math.max(maxZ, v.z);
  }
  minX -= 1;
  minY -= 1;
  minZ -= 1;
  maxX += 1;
  maxY += 1;
  maxZ += 1;

  // Il flood-fill qui sotto scandisce l'intero bounding box paddato per
  // trovare le cavità interne. Se il bounding box è enorme rispetto al
  // numero di voxel (modello sparso su una griglia grande), il costo
  // esplode senza che ci sia una vera cavità "chiusa" da riempire — in
  // casi estremi va persino in crash (RangeError: Set maximum size
  // exceeded, verificato). Meglio saltare la passata che rompere l'import.
  const boxVolume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
  if (boxVolume > 400_000 || boxVolume > voxels.length * 200) return voxels;

  const outside = new Set<string>();
  const stack: [number, number, number][] = [[minX, minY, minZ]];
  outside.add(key(minX, minY, minZ));
  while (stack.length) {
    const [x, y, z] = stack.pop()!;
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1]
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < minX || ny < minY || nz < minZ || nx > maxX || ny > maxY || nz > maxZ) continue;
      const id = key(nx, ny, nz);
      if (solid.has(id) || outside.has(id)) continue;
      outside.add(id);
      stack.push([nx, ny, nz]);
    }
  }

  const map = new Map(voxels.map((v) => [key(v.x, v.y, v.z), v]));
  const holes: [number, number, number][] = [];
  for (let y = minY + 1; y <= maxY - 1; y += 1) {
    for (let z = minZ + 1; z <= maxZ - 1; z += 1) {
      for (let x = minX + 1; x <= maxX - 1; x += 1) {
        const id = key(x, y, z);
        if (solid.has(id) || outside.has(id)) continue;
        holes.push([x, y, z]);
      }
    }
  }
  const limit = Math.max(8, Math.round(voxels.length * 0.03));
  if (!holes.length || holes.length > limit) return voxels;
  for (const [x, y, z] of holes) {
    map.set(key(x, y, z), { x, y, z, c: neighborColor(map, x, y, z) });
  }
  return [...map.values()];
}

export function mergeTinyColorRegions(voxels: ImageVoxel[], minSize = 6): ImageVoxel[] {
  if (voxels.length < minSize) return voxels;
  const byColor = new Map<number, ImageVoxel[]>();
  for (const v of voxels) {
    const list = byColor.get(v.c) ?? [];
    list.push(v);
    byColor.set(v.c, list);
  }
  const occupied = new Map(voxels.map((v) => [key(v.x, v.y, v.z), v]));
  const out = voxels.map((v) => ({ ...v }));
  const index = new Map(out.map((v) => [key(v.x, v.y, v.z), v]));

  for (const [color, list] of byColor) {
    if (list.length >= minSize) continue;
    for (const v of list) {
      const votes = new Map<number, number>();
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1]
      ]) {
        const hit = occupied.get(key(v.x + dx, v.y + dy, v.z + dz));
        if (!hit || hit.c === color) continue;
        votes.set(hit.c, (votes.get(hit.c) ?? 0) + 1);
      }
      let best = color;
      let bestN = 0;
      for (const [c, n] of votes) {
        if (n > bestN) {
          best = c;
          bestN = n;
        }
      }
      const target = index.get(key(v.x, v.y, v.z));
      if (target) target.c = best;
    }
  }
  return out;
}

export function dropSpikes(voxels: ImageVoxel[]): ImageVoxel[] {
  if (voxels.length < 4) return voxels;
  const occupied = new Set(voxels.map((v) => key(v.x, v.y, v.z)));
  const kept = voxels.filter((v) => {
    let face = 0;
    if (occupied.has(key(v.x + 1, v.y, v.z))) face += 1;
    if (occupied.has(key(v.x - 1, v.y, v.z))) face += 1;
    if (occupied.has(key(v.x, v.y + 1, v.z))) face += 1;
    if (occupied.has(key(v.x, v.y - 1, v.z))) face += 1;
    if (occupied.has(key(v.x, v.y, v.z + 1))) face += 1;
    if (occupied.has(key(v.x, v.y, v.z - 1))) face += 1;
    return face >= 1;
  });
  return kept.length ? kept : voxels;
}

export function lintVoxels(voxels: ImageVoxel[]): ImageVoxel[] {
  return mergeTinyColorRegions(dropSpikes(fillTinyCavities(fillAxisGaps(voxels))));
}
