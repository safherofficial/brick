export function unitHeight(kind?: BrickKind) {
  return kind === "voxel" ? STUD : BRICK_HEIGHT;
}

export function cellKey(x: number, y: number, z: number) {
  return `${x}:${y}:${z}`;
}

export function voxelCell(brick: Pick<Brick, "position" | "layer" | "kind">) {
  return cellKey(
    Math.round(brick.position[0]),
    brick.layer,
    Math.round(brick.position[2])
  );
}

export function occupied3(bricks: Brick[], ignoreId?: number) {
  const map = new Map<string, number>();
  for (const brick of bricks) {
    if (brick.id === ignoreId) continue;
    if (brick.kind === "voxel") {
      map.set(voxelCell(brick), brick.id);
      continue;
    }
    for (const cell of cellsFor(brick)) {
      map.set(`${brick.layer}:${cell}`, brick.id);
    }
  }
  return map;
}

export function isClear(candidate: Brick, bricks: Brick[]) {
  const map = occupied3(bricks, candidate.id);
  if (candidate.kind === "voxel") return !map.has(voxelCell(candidate));
  return cellsFor(candidate).every(
    (cell) => !map.has(`${candidate.layer}:${cell}`)
  );
}

export function settle(bricks: Brick[]) {
  const ordered = [...bricks].sort((a, b) => a.layer - b.layer || a.id - b.id);
  const out: Brick[] = [];
  for (const brick of ordered) {
    if (brick.kind === "voxel") {
      out.push(brick);
      continue;
    }
    out.push(withLayer(brick, highestSupportedLayer(brick, out)));
  }
  return out;
}
