"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

function InstancedPreview({
  cells,
  color
}: {
  cells: { x: number; y: number; z: number }[];
  color: string;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < cells.length; i += 1) {
      dummy.position.set(cells[i].x, cells[i].y, cells[i].z);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [cells]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, cells.length]}>
      <boxGeometry args={[0.96, 0.96, 0.96]} />
      <meshBasicMaterial color={color} />
    </instancedMesh>
  );
}

export function PendingPreview({
  voxels,
  palette
}: {
  voxels: { x: number; y: number; z: number; c: number }[];
  palette: string[];
}) {
  const groups = useMemo(() => {
    const map = new Map<number, { x: number; y: number; z: number }[]>();
    const step = voxels.length > 16000 ? 2 : 1;
    for (let i = 0; i < voxels.length; i += step) {
      const v = voxels[i];
      const list = map.get(v.c) ?? [];
      list.push(v);
      map.set(v.c, list);
    }
    return [...map.entries()];
  }, [voxels]);
  return (
    <group raycast={() => {}}>
      {groups.map(([c, cells]) => (
        <InstancedPreview key={c} cells={cells} color={palette[c] ?? "#e6e6e6"} />
      ))}
    </group>
  );
}
