"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { VoxelCloud } from "@/components/builder/VoxelCloud";
import { DEFAULT_PALETTE, VoxelVolume, volumeCenter, type Voxel } from "@/lib/voxelEngine";

const noop = () => {};

function Spinner({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.25;
  });
  return <group ref={ref}>{children}</group>;
}

export default function VoxelThumb({
  size,
  voxels,
  palette,
  interactive = false
}: {
  size: number;
  voxels: Voxel[];
  palette?: string[];
  interactive?: boolean;
}) {
  const volume = useMemo(() => {
    const v = new VoxelVolume(size);
    v.load({ size, voxels });
    return v;
  }, [size, voxels]);

  const center = volumeCenter(size);
  const distance = Math.max(6, size * 0.6);

  return (
    <Canvas
      shadows
      camera={{ position: [center[0] + distance, distance * 0.7, center[2] + distance], fov: 38 }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#0b0f1a"]} />
      <ambientLight intensity={1.05} />
      <directionalLight position={[5, 8, 4]} intensity={2.6} castShadow />
      <hemisphereLight intensity={0.4} />
      <Spinner>
        <VoxelCloud
          volume={volume}
          palette={palette && palette.length ? palette : DEFAULT_PALETTE}
          revision={0}
          selected={EMPTY_SET}
          clip={{ axis: null, value: 0 }}
          onHit={noop}
          onHover={noop}
        />
      </Spinner>
      {interactive && (
        <OrbitControls
          makeDefault
          target={center}
          enableZoom
          enablePan={false}
          enableDamping
          dampingFactor={0.1}
        />
      )}
    </Canvas>
  );
}

const EMPTY_SET = new Set<string>();
