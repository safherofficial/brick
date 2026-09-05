"use client";

import { RoundedBox } from "@react-three/drei";
import type { ReactNode } from "react";

export type BrickShape =
  | "box"
  | "cone"
  | "cylinder";

export const STUD = 0.9;

// Altezza standard del brick.
export const BRICK_HEIGHT = 1.08;

/**
 * Materiale plastico ABS.
 */
function PlasticMaterial({
  color,
  opacity = 1
}: {
  color: string;
  opacity?: number;
}) {
  return (
    <meshPhysicalMaterial
      color={color}
      roughness={0.2}
      metalness={0}
      clearcoat={0.7}
      clearcoatRoughness={0.14}
      transparent={opacity < 1}
      opacity={opacity}
      depthWrite={opacity >= 1}
    />
  );
}

/**
 * Stud superiore.
 */
export function Stud({
  color,
  radius = 0.145,
  height = 0.105
}: {
  color: string;
  radius?: number;
  height?: number;
}) {
  return (
    <mesh
      position={[0, height / 2, 0]}
      castShadow
      receiveShadow
    >
      <cylinderGeometry
        args={[
          radius,
          radius,
          height,
          20
        ]}
      />

      <PlasticMaterial color={color} />
    </mesh>
  );
}

/**
 * Anello/tubo inferiore.
 *
 * Il dettaglio rimane completamente all'interno
 * del volume del brick e quindi non modifica
 * collisioni, footprint o snapping.
 */
function BottomTube({
  color,
  position,
  radius = 0.255,
  height = 0.72
}: {
  color: string;
  position: [number, number, number];
  radius?: number;
  height?: number;
}) {
  return (
    <mesh
      position={position}
      castShadow
      receiveShadow
    >
      <cylinderGeometry
        args={[
          radius,
          radius,
          height,
          20,
          1,
          true
        ]}
      />

      <PlasticMaterial color={color} />
    </mesh>
  );
}

/**
 * Struttura interna inferiore.
 *
 * Per brick 1x1 e 2x2 viene mantenuta una geometria
 * semplice e centrata. Per brick più grandi vengono
 * distribuiti più tubi interni.
 */
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

  const tubeHeight =
    Math.min(
      0.72,
      Math.max(
        0.45,
        height - 0.25
      )
    );

  const tubes: ReactNode[] = [];

  /**
   * Un tubo centrale per i piccoli brick.
   */
  if (w === 1 || d === 1) {
    tubes.push(
      <BottomTube
        key="center"
        color={color}
        position={[
          0,
          -height / 2 +
            tubeHeight / 2 +
            0.035,
          0
        ]}
        height={tubeHeight}
      />
    );
  } else {
    /**
     * Per brick più grandi:
     * un tubo tra ogni coppia di file.
     */
    for (
      let ix = 0;
      ix < w - 1;
      ix++
    ) {
      for (
        let iz = 0;
        iz < d - 1;
        iz++
      ) {
        const x =
          -((w - 1) * STUD) / 2 +
          (ix + 0.5) * STUD;

        const z =
          -((d - 1) * STUD) / 2 +
          (iz + 0.5) * STUD;

        tubes.push(
          <BottomTube
            key={`${ix}-${iz}`}
            color={color}
            position={[
              x,
              -height / 2 +
                tubeHeight / 2 +
                0.035,
              z
            ]}
            height={tubeHeight}
          />
        );
      }
    }
  }

  return (
    <group>
      {tubes}
    </group>
  );
}

/**
 * Corpo principale del brick.
 */
function BoxBrick({
  size,
  color,
  opacity,
  footprint,
  children
}: {
  size: [number, number, number];
  color: string;
  opacity: number;
  footprint: [number, number];
  children?: ReactNode;
}) {
  const minDim =
    Math.min(
      size[0],
      size[1],
      size[2]
    );

  const radius =
    Math.min(
      0.055,
      minDim * 0.055
    );

  const showUnderside =
    opacity >= 1;

  return (
    <group>
      {/* Corpo principale */}
      <RoundedBox
        args={size}
        radius={radius}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <PlasticMaterial
          color={color}
          opacity={opacity}
        />
      </RoundedBox>

      {/* Stud superiori */}
      {children}

      {/* Dettaglio inferiore */}
      {showUnderside && (
        <BrickUnderside
          color={color}
          footprint={footprint}
          height={size[1]}
        />
      )}
    </group>
  );
}

/**
 * Corpo di un brick in stile LEGO.
 *
 * STUD = 0.9 world units.
 *
 * 1x1 = 0.9 × 0.9
 * 2x2 = 1.8 × 1.8
 * 2x4 = 3.6 × 1.8
 *
 * Altezza standard:
 * 1.08 world units.
 */
export function BrickVisual({
  shape,
  size,
  footprint,
  color,
  opacity = 1,
  studless = false
}: {
  shape: BrickShape;
  size: [number, number, number];
  footprint: [number, number];
  color: string;
  opacity?: number;
  studless?: boolean;
}) {
  const showStuds =
    opacity >= 1 &&
    !studless;

  /**
   * CONE
   */
  if (shape === "cone") {
    return (
      <mesh
        castShadow
        receiveShadow
      >
        <coneGeometry
          args={[
            size[0] * 0.42,
            size[1],
            28
          ]}
        />

        <PlasticMaterial
          color={color}
          opacity={opacity}
        />
      </mesh>
    );
  }

  /**
   * CYLINDER / ROUND
   */
  if (shape === "cylinder") {
    return (
      <group>
        <mesh
          castShadow
          receiveShadow
        >
          <cylinderGeometry
            args={[
              size[0] * 0.42,
              size[0] * 0.42,
              size[1],
              32
            ]}
          />

          <PlasticMaterial
            color={color}
            opacity={opacity}
          />
        </mesh>

        {showStuds && (
          <group
            position={[
              0,
              size[1] / 2,
              0
            ]}
          >
            <Stud
              color={color}
              radius={0.145}
              height={0.105}
            />
          </group>
        )}
      </group>
    );
  }

  /**
   * BOX BRICK
   */
  const [w, d] =
    footprint;

  const studs: ReactNode[] = [];

  if (showStuds) {
    for (
      let ix = 0;
      ix < w;
      ix++
    ) {
      for (
        let iz = 0;
        iz < d;
        iz++
      ) {
        const x =
          -size[0] / 2 +
          STUD / 2 +
          ix * STUD;

        const z =
          -size[2] / 2 +
          STUD / 2 +
          iz * STUD;

        studs.push(
          <group
            key={`stud-${ix}-${iz}`}
            position={[
              x,
              size[1] / 2,
              z
            ]}
          >
            <Stud
              color={color}
              radius={0.145}
              height={0.105}
            />
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
    >
      {studs}
    </BoxBrick>
  );
}
