"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import {
  dominantNormal,
  keyOf,
  type Cell,
  type VoxelVolume
} from "@/lib/voxelEngine";

export type VoxelHit =
  | { kind: "voxel"; cell: Cell; place: Cell }
  | { kind: "empty"; cell: Cell };

export type Clip = {
  axis: "x" | "y" | "z" | null;
  value: number;
};

type Props = {
  volume: VoxelVolume;
  palette: string[];
  revision: number;
  selected: Set<string>;
  clip: Clip;
  onHit: (hit: VoxelHit, ev: ThreeEvent<PointerEvent>) => void;
  onHover: (hit: VoxelHit | null) => void;
};

function visible(cell: Cell, clip: Clip) {
  if (!clip.axis) return true;
  return cell[clip.axis] <= clip.value;
}

function shadeHex(hex: string, buried: number) {
  const n = parseInt(hex.replace("#", "").padStart(6, "0").slice(0, 6), 16);
  const k = 1 - buried * 0.09;
  const ch = (shift: number) =>
    Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * k)));
  return `#${[ch(16), ch(8), ch(0)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function VoxelCloud({
  volume,
  palette,
  revision,
  selected,
  clip,
  onHit,
  onHover
}: Props) {
  const groups = useMemo(() => {
    void revision;
    const raw = volume.raw();
    const next = new Map<string, Cell[]>();
    for (const [key, c] of raw) {
      const [x, y, z] = key.split(":").map(Number);
      const cell = { x, y, z };
      if (!visible(cell, clip)) continue;
      let buried = 0;
      if (raw.has(keyOf(x - 1, y, z))) buried++;
      if (raw.has(keyOf(x + 1, y, z))) buried++;
      if (raw.has(keyOf(x, y - 1, z))) buried++;
      if (raw.has(keyOf(x, y + 1, z))) buried++;
      if (raw.has(keyOf(x, y, z - 1))) buried++;
      if (raw.has(keyOf(x, y, z + 1))) buried++;
      const hex = shadeHex(palette[c] ?? "#ffffff", buried);
      const list = next.get(hex) ?? [];
      list.push(cell);
      next.set(hex, list);
    }
    return [...next.entries()];
  }, [clip, palette, revision, volume]);

  return (
    <>
      {groups.map(([color, cells]) => (
        <ColorBatch
          key={color}
          color={color}
          cells={cells}
          capacity={Math.max(cells.length, 64)}
          onHit={onHit}
          onHover={onHover}
        />
      ))}
      {selected.size > 0 && (
        <SelectionBatch keys={selected} revision={revision} clip={clip} />
      )}
    </>
  );
}

function ColorBatch({
  color,
  cells,
  capacity,
  onHit,
  onHover
}: {
  color: string;
  cells: Cell[];
  capacity: number;
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
      args={[undefined, undefined, Math.max(capacity, cells.length, 1)]}
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
      <meshStandardMaterial color={color} roughness={0.42} metalness={0.03} />
    </instancedMesh>
  );
}

function SelectionBatch({
  keys,
  revision,
  clip
}: {
  keys: Set<string>;
  revision: number;
  clip: Clip;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const cells = useMemo(() => {
    void revision;
    return [...keys]
      .map((key) => {
        const [x, y, z] = key.split(":").map(Number);
        return { x, y, z };
      })
      .filter((cell) => visible(cell, clip));
  }, [clip, keys, revision]);

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
