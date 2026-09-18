"use client";

import type { Cell } from "@/lib/voxelEngine";

export function BoxPreview({ a, b }: { a: Cell; b: Cell }) {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const z0 = Math.min(a.z, b.z);
  const sx = Math.abs(a.x - b.x) + 1;
  const sy = Math.abs(a.y - b.y) + 1;
  const sz = Math.abs(a.z - b.z) + 1;
  return (
    <mesh position={[x0 + (sx - 1) / 2, y0 + (sy - 1) / 2, z0 + (sz - 1) / 2]} raycast={() => {}}>
      <boxGeometry args={[sx, sy, sz]} />
      <meshBasicMaterial color="#5b6ef5" wireframe transparent opacity={0.85} />
    </mesh>
  );
}
