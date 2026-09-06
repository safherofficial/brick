"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { STUD, type Brick } from "@/lib/brickGrid";

type Props = {
  voxels: Brick[];
  selectedId: number | null;
  draggingId: number | null;
  onSelect: (id: number) => void;
  onHover: (point: THREE.Vector3) => void;
  onDragStart: (id: number, ray: THREE.Ray) => void;
  onDragMove: (ray: THREE.Ray) => void;
  onDragEnd: () => void;
};

export function VoxelCloud({
  voxels,
  selectedId,
  draggingId,
  onSelect,
  onHover,
  onDragStart,
  onDragMove,
  onDragEnd
}: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, Brick[]>();
    for (const voxel of voxels) {
      if (voxel.id === draggingId) continue;
      const list = map.get(voxel.color) ?? [];
      list.push(voxel);
      map.set(voxel.color, list);
    }
    return [...map.entries()];
  }, [voxels, draggingId]);

  return (
    <>
      {groups.map(([color, list]) => (
        <ColorBatch
          key={color}
          color={color}
          list={list}
          selectedId={selectedId}
          onSelect={onSelect}
          onHover={onHover}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      ))}
    </>
  );
}

function ColorBatch({
  color,
  list,
  selectedId,
  onSelect,
  onHover,
  onDragStart,
  onDragMove,
  onDragEnd
}: {
  color: string;
  list: Brick[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onHover: (point: THREE.Vector3) => void;
  onDragStart: (id: number, ray: THREE.Ray) => void;
  onDragMove: (ray: THREE.Ray) => void;
  onDragEnd: () => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const ids = useRef<number[]>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const inst = mesh.current;
    if (!inst) return;
    ids.current = list.map((b) => b.id);
    list.forEach((brick, i) => {
      dummy.position.set(brick.position[0], brick.position[1], brick.position[2]);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.count = list.length;
    inst.instanceMatrix.needsUpdate = true;
  }, [dummy, list]);

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, Math.max(list.length, 1)]}
      castShadow={false}
      receiveShadow={false}
      frustumCulled={false}
      onClick={(e) => {
        e.stopPropagation();
        const id = ids.current[e.instanceId ?? -1];
        if (id != null) onSelect(id);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        const id = ids.current[e.instanceId ?? -1];
        if (id == null) return;
        onSelect(id);
        onDragStart(id, e.ray);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        onHover(e.point);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        onDragEnd();
      }}
    >
      <boxGeometry args={[STUD * 0.96, STUD * 0.96, STUD * 0.96]} />
      <meshStandardMaterial
        color={color}
        roughness={0.42}
        metalness={0.04}
      />
    </instancedMesh>
  );
}
