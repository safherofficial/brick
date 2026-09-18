"use client";

import { useMemo } from "react";

export function VolumeFrame({ size }: { size: number }) {
  const points = useMemo(() => {
    const s = size - 1;
    return [
      0, 0, 0, s, 0, 0, s, 0, s, 0, 0, s, 0, 0, 0, 0, s, 0, s, s, 0, s, 0, 0, s, 0, s,
      s, s, s, s, s, 0, s, 0, 0, s, s, 0, 0, s, 0, 0, 0, 0, 0, 0, s, 0, s, s, 0, s, 0,
      s, s, 0, s, s, s, 0, s, s, s, s, s, s, 0, s
    ];
  }, [size]);
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[new Float32Array(points), 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#9945FF" />
    </line>
  );
}
