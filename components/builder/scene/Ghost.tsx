"use client";

import type { Cell } from "@/lib/voxelEngine";

export function Ghost({ cell, color, valid }: { cell: Cell; color: string; valid: boolean }) {
  return (
    <mesh position={[cell.x, cell.y, cell.z]} raycast={() => {}}>
      <boxGeometry args={[0.98, 0.98, 0.98]} />
      <meshBasicMaterial color={valid ? color : "#ff3347"} transparent opacity={0.38} depthWrite={false} />
    </mesh>
  );
}
