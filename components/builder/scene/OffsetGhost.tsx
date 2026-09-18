"use client";

import type { Cell, ClipboardVoxel } from "@/lib/voxelEngine";

export function OffsetGhost({ items, origin }: { items: ClipboardVoxel[]; origin: Cell }) {
  return (
    <group raycast={() => {}}>
      {items.slice(0, 800).map((item, i) => (
        <mesh key={i} position={[origin.x + item.dx, origin.y + item.dy, origin.z + item.dz]}>
          <boxGeometry args={[1.02, 1.02, 1.02]} />
          <meshBasicMaterial color="#5b6ef5" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
