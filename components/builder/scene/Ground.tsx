"use client";

import type { ThreeEvent } from "@react-three/fiber";
import type { VoxelHit } from "@/components/builder/VoxelCloud";

export function Ground({
  size,
  onHit,
  onHover
}: {
  size: number;
  onHit: (hit: VoxelHit, ev: ThreeEvent<PointerEvent>) => void;
  onHover: (hit: VoxelHit | null) => void;
}) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[(size - 1) / 2, -0.5, (size - 1) / 2]}
      onPointerDown={(e) => {
        e.stopPropagation();
        onHit(
          { kind: "empty", cell: { x: Math.round(e.point.x), y: 0, z: Math.round(e.point.z) } },
          e
        );
      }}
      onPointerMove={(e) => {
        onHover({
          kind: "empty",
          cell: { x: Math.round(e.point.x), y: 0, z: Math.round(e.point.z) }
        });
      }}
    >
      <planeGeometry args={[size + 12, size + 12]} />
      <shadowMaterial opacity={0.32} color="#05060a" />
    </mesh>
  );
}
