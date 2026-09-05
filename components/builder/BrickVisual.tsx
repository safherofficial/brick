"use client";

import { RoundedBox } from "@react-three/drei";

export type BrickShape =
  | "box"
  | "cone"
  | "cylinder";

export const STUD = 0.9;

// Altezza standard del brick.
// La dimensione viene definita anche nel Builder per mantenere
// una singola fonte di verità per la logica di stacking.
export const BRICK_HEIGHT = 1.08;

// Materiale plastico lucido stile LEGO: bassa rugosità + un velo di clearcoat
// per la riflessione tipica dell'ABS stampato a iniezione.
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
      roughness={0.22}
      metalness={0.02}
      clearcoat={0.65}
      clearcoatRoughness={0.18}
      transparent={opacity < 1}
      opacity={opacity}
      depthWrite={opacity >= 1}
    />
  );
}

// Stud cilindrico sopra ogni brick.
export function Stud({
  color,
  radius = 0.14,
  height = 0.09
}: {
  color: string;
  radius?: number;
  height?: number;
}) {
  return (
    <mesh
      position={[0, height / 2, 0]}
      castShadow
    >
      <cylinderGeometry
        args={[
          radius,
          radius,
          height,
          16
        ]}
      />

      <PlasticMaterial color={color} />
    </mesh>
  );
}

/**
 * Corpo di un brick in stile LEGO.
 *
 * STUD = 0.9 world units.
 *
 * Esempi:
 * 1x1 = 0.9 x 0.9
 * 2x2 = 1.8 x 1.8
 * 2x4 = 3.6 x 1.8
 *
 * Altezza standard:
 * 1.08 world units.
 *
 * IMPORTANTE:
 * La rotazione NON viene applicata qui.
 * BrickVisual costruisce sempre la geometria
 * nella sua configurazione canonica.
 *
 * La rotazione viene applicata al group superiore
 * in BrickMesh, così corpo e studs ruotano
 * insieme attorno al centro del brick.
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
  /**
   * Pezzi decorativi sottili non hanno lo stud.
   */
  studless?: boolean;
}) {
  const showStuds =
    opacity >= 1 &&
    !studless;

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
            24
          ]}
        />

        <PlasticMaterial
          color={color}
          opacity={opacity}
        />
      </mesh>
    );
  }

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
              28
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
            <Stud color={color} />
          </group>
        )}
      </group>
    );
  }

  const [w, d] = footprint;

  const studs = [];

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
            key={`${ix}-${iz}`}
            position={[
              x,
              size[1] / 2,
              z
            ]}
          >
            <Stud color={color} />
          </group>
        );
      }
    }
  }

  const minDim = Math.min(
    size[0],
    size[1],
    size[2]
  );

  const rounded =
    minDim > 0.18;

  return (
    <group>
      {rounded ? (
        <RoundedBox
          args={size}
          radius={0.035}
          smoothness={2}
          castShadow
          receiveShadow
        >
          <PlasticMaterial
            color={color}
            opacity={opacity}
          />
        </RoundedBox>
      ) : (
        <mesh
          castShadow
          receiveShadow
        >
          <boxGeometry args={size} />

          <PlasticMaterial
            color={color}
            opacity={opacity}
          />
        </mesh>
      )}

      {studs}
    </group>
  );
}
