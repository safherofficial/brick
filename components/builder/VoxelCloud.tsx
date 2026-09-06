"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import {
  dominantNormal,
  type Cell,
  type VoxelVolume
} from "@/lib/voxelEngine";

export type VoxelHit =
  | { kind: "voxel"; cell: Cell; place: Cell }
  | { kind: "empty"; cell: Cell };

type Props = {
  volume: VoxelVolume;
  palette: string[];
  revision: number;
  selected: Set<string>;
  onHit: (hit: VoxelHit, ev: ThreeEvent<PointerEvent>) => void;
  onHover: (hit: VoxelHit | null) => void;
};

export function VoxelCloud({
  volume,
  palette,
  revision,
  selected,
  onHit,
  onHover
}: Props) {
  const groups = useMemo(() => {
    void revision;
    return [...volume.groups().entries()];
  }, [volume, revision]);

  return (
    <>
      {groups.map(([colorIndex, cells]) => (
        <ColorBatch
          key={`${colorIndex}:${cells.length}:${revision}`}
          color={palette[colorIndex] ?? "#ffffff"}
          cells={cells}
          onHit={onHit}
          onHover={onHover}
        />
      ))}
      {selected.size > 0 && (
        <SelectionBatch keys={selected} revision={revision} />
      )}
    </>
  );
}

function ColorBatch({
  color,
  cells,
  onHit,
  onHover
}: {
  color: string;
  cells: Cell[];
  onHit: (hit: VoxelHit, ev: ThreeEvent<PointerEvent>) => void;
  onHover: (hit: VoxelHit | null) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  useLayoutEffect(() => {
    const inst = mesh.current;
    if (!inst) return;
    cells.forEach((cell, i) => {
      dummy.position.set(cell.x, cell.y, cell.z);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.count = cells.length;
    inst.instanceMatrix.needsUpdate = true;
  }, [cells, dummy]);

  const resolve = (e: ThreeEvent<PointerEvent>): VoxelHit | null => {
    const i = e.instanceId;
    if (i == null) return null;
    const cell = cellsRef.current[i];
    if (!cell) return null;
    const n = e.face?.normal ?? new THREE.Vector3(0, 1, 0);
    const dir = dominantNormal(n.x, n.y, n.z);
    return {
      kind: "voxel",
      cell,
      place: { x: cell.x + dir.x, y: cell.y + dir.y, z: cell.z + dir.z }
    };
  };

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, Math.max(cells.length, 1)]}
      castShadow
      receiveShadow
      frustumCulled={false}
      onPointerDown={(e) => {
        const hit = resolve(e);
        if (!hit) return;
        e.stopPropagation();
        onHit(hit, e);
      }}
      onPointerMove={(e) => {
        const hit = resolve(e);
        if (!hit) return;
        e.stopPropagation();
        onHover(hit);
      }}
      onPointerOut={() => onHover(null)}
    >
      <boxGeometry args={[0.96, 0.96, 0.96]} />
      <meshStandardMaterial color={color} roughness={0.38} metalness={0.04} />
    </instancedMesh>
  );
}

function SelectionBatch({
  keys,
  revision
}: {
  keys: Set<string>;
  revision: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const cells = useMemo(() => {
    void revision;
    return [...keys].map((key) => {
      const [x, y, z] = key.split(":").map(Number);
      return { x, y, z };
    });
  }, [keys, revision]);

  useLayoutEffect(() => {
    const inst = mesh.current;
    if (!inst) return;
    cells.forEach((cell, i) => {
      dummy.position.set(cell.x, cell.y, cell.z);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.count = cells.length;
    inst.instanceMatrix.needsUpdate = true;
  }, [cells, dummy]);

  if (!cells.length) return null;

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, Math.max(cells.length, 1)]}
      frustumCulled={false}
      raycast={() => {}}
    >
      <boxGeometry args={[1.04, 1.04, 1.04]} />
      <meshBasicMaterial color="#c4b5fd" wireframe transparent opacity={0.9} />
    </instancedMesh>
  );
}
