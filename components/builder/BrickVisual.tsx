"use client";

import { RoundedBox } from "@react-three/drei";
import type { ReactNode } from "react";
import {
  BRICK_HEIGHT,
  STUD,
  STUD_HEIGHT,
  STUD_RADIUS,
  type BrickShape
} from "@/lib/brickGrid";

export type { BrickShape };
export { STUD, BRICK_HEIGHT };

function PlasticMaterial({
  color,
  opacity = 1
}: {
  color: string;
  opacity?: number;
}) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={0.28}
      metalness={0.02}
      transparent={opacity < 1}
      opacity={opacity}
      depthWrite={opacity >= 1}
    />
  );
}

export function Stud({
  color,
  radius = STUD_RADIUS,
  height = STUD_HEIGHT,
  castShadow = false
}: {
  color: string;
  radius?: number;
  height?: number;
  castShadow?: boolean;
}) {
  return (
    <mesh position={[0, height / 2, 0]} castShadow={castShadow}>
      <cylinderGeometry args={[radius, radius, height, 12]} />
      <PlasticMaterial color={color} />
    </mesh>
  );
}

function BottomTube({
  color,
  position,
  radius = 0.255,
  height = 0.32
}: {
  color: string;
  position: [number, number, number];
  radius?: number;
  height?: number;
}) {
  return (
    <mesh position={position}>
      <cylinderGeometry args={[radius, radius, height, 12, 1, true]} />
      <PlasticMaterial color={color} />
    </mesh>
  );
}

function BrickUnderside({
  color,
  footprint,
  height
}: {
  color: string;
  footprint: [number, number];
  height: number;
}) {
  const [w, d] = footprint;
  const tubeHeight = Math.min(0.32, Math.max(0.2, height - 0.16));
  const tubes: ReactNode[] = [];

  if (w === 1 || d === 1) {
    tubes.push(
      <BottomTube
        key="center"
        color={color}
        position={[0, -height / 2 + tubeHeight / 2 + 0.02, 0]}
        height={tubeHeight}
      />
    );
  } else {
    for (let ix = 0; ix < w - 1; ix++) {
      for (let iz = 0; iz < d - 1; iz++) {
        const x = -((w - 1) * STUD) / 2 + (ix + 0.5) * STUD;
        const z = -((d - 1) * STUD) / 2 + (iz + 0.5) * STUD;
        tubes.push(
          <BottomTube
            key={`${ix}-${iz}`}
            color={color}
            position={[x, -height / 2 + tubeHeight / 2 + 0.02, z]}
            height={tubeHeight}
          />
        );
      }
    }
  }

  return <group>{tubes}</group>;
}

function BoxBrick({
  size,
  color,
  opacity,
  footprint,
  detail,
  children
}: {
  size: [number, number, number];
  color: string;
  opacity: number;
  footprint: [number, number];
  detail: "editor" | "hero";
  children?: ReactNode;
}) {
  const minDim = Math.min(size[0], size[1], size[2]);
  const radius = Math.min(0.055, minDim * 0.055);

  return (
    <group>
      <RoundedBox
        args={size}
        radius={radius}
        smoothness={2}
        castShadow={opacity >= 1}
        receiveShadow={opacity >= 1}
      >
        <PlasticMaterial color={color} opacity={opacity} />
      </RoundedBox>
      {children}
      {detail === "hero" && opacity >= 1 && (
        <BrickUnderside
          color={color}
          footprint={footprint}
          height={size[1]}
        />
      )}
    </group>
  );
}

export function BrickVisual({
  shape,
  size,
  footprint,
  color,
  opacity = 1,
  studless = false,
  detail = "hero"
}: {
  shape: BrickShape;
  size: [number, number, number];
  footprint: [number, number];
  color: string;
  opacity?: number;
  studless?: boolean;
  detail?: "editor" | "hero";
}) {
  const showStuds = opacity >= 1 && !studless;

  if (shape === "cone") {
    return (
      <mesh castShadow={opacity >= 1} receiveShadow={opacity >= 1}>
        <coneGeometry args={[size[0] * 0.42, size[1], 20]} />
        <PlasticMaterial color={color} opacity={opacity} />
      </mesh>
    );
  }

  if (shape === "cylinder") {
    return (
      <group>
        <mesh castShadow={opacity >= 1} receiveShadow={opacity >= 1}>
          <cylinderGeometry
            args={[size[0] * 0.42, size[0] * 0.42, size[1], 24]}
          />
          <PlasticMaterial color={color} opacity={opacity} />
        </mesh>
        {showStuds && (
          <group position={[0, size[1] / 2, 0]}>
            <Stud color={color} />
          </group>
        )}
      </group>
    );
  }

  const [w, d] = footprint;
  const studs: ReactNode[] = [];

  if (showStuds) {
    for (let ix = 0; ix < w; ix++) {
      for (let iz = 0; iz < d; iz++) {
        const x = -size[0] / 2 + STUD / 2 + ix * STUD;
        const z = -size[2] / 2 + STUD / 2 + iz * STUD;
        studs.push(
          <group key={`stud-${ix}-${iz}`} position={[x, size[1] / 2, z]}>
            <Stud color={color} />
          </group>
        );
      }
    }
  }

  return (
    <BoxBrick
      size={size}
      color={color}
      opacity={opacity}
      footprint={footprint}
      detail={detail}
    >
      {studs}
    </BoxBrick>
  );
}
