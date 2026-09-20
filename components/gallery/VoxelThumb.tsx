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
    if (ref.current) ref.current.rotation.y += delta * 0.18;
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
  const fov = 40;
  const distance = useMemo(() => {
    if (!voxels.length) return 10;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const voxel of voxels) {
      minX = Math.min(minX, voxel.x);
      minY = Math.min(minY, voxel.y);
      minZ = Math.min(minZ, voxel.z);
      maxX = Math.max(maxX, voxel.x);
      maxY = Math.max(maxY, voxel.y);
      maxZ = Math.max(maxZ, voxel.z);
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const depth = maxZ - minZ + 1;
    const radius = Math.sqrt(width * width + height * height + depth * depth) * 0.5;
    const requiredActualDistance = (radius / Math.tan(THREE.MathUtils.degToRad(fov * 0.5))) * 1.28;
    const cameraDirectionLength = Math.sqrt(2.49);

    return Math.max(10, requiredActualDistance / cameraDirectionLength);
  }, [voxels]);

  return (
    <Canvas
      shadows
      camera={{ position: [distance, distance * 0.7, distance], fov }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#0b0f1a"]} />
      <ambientLight intensity={1.05} />
      <directionalLight position={[5, 8, 4]} intensity={2.6} castShadow />
      <hemisphereLight intensity={0.4} />
      <Spinner>
        <group position={[-center[0], -center[1], -center[2]]}>
          <VoxelCloud
            volume={volume}
            palette={palette && palette.length ? palette : DEFAULT_PALETTE}
            revision={0}
            selected={EMPTY_SET}
            clip={{ axis: null, value: 0 }}
            onHit={noop}
            onHover={noop}
          />
        </group>
      </Spinner>
      {interactive && (
        <OrbitControls
          makeDefault
          target={[0, 0, 0]}
          enableZoom
          enablePan={false}
          enableDamping
          dampingFactor={0.1}
          minDistance={distance * 0.45}
          maxDistance={distance}
        />
      )}
    </Canvas>
  );
}
const EMPTY_SET = new Set<string>();
