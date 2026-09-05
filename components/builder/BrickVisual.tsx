"use client";

import { RoundedBox } from "@react-three/drei";

export type BrickShape = "box" | "cone" | "cylinder";

const STUD = 0.9;

// Materiale plastico lucido stile LEGO: bassa rugosità + un velo di clearcoat
// per la riflessione "a specchio" tipica dell'ABS stampato a iniezione.
function PlasticMaterial({ color, opacity = 1 }: { color: string; opacity?: number }) {
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

// Il tipico "stud" cilindrico sopra ogni brick — con lo stesso materiale
// plastico del corpo, per un aspetto coerente da qualunque angolazione.
export function Stud({ color, radius = 0.14, height = 0.09 }: { color: string; radius?: number; height?: number }) {
  return (
    <mesh position={[0, height / 2, 0]} castShadow>
      <cylinderGeometry args={[radius, radius, height, 16]} />
      <PlasticMaterial color={color} />
    </mesh>
  );
}

/**
 * Corpo di un brick "in stile LEGO": spigoli leggermente smussati (RoundedBox)
 * più una griglia di studs proporzionata alla vera impronta (footprint) del
 * pezzo. I pezzi rotondi (cono/cilindro) seguono le convenzioni reali dei set
 * LEGO: il cilindro ha uno stud singolo in cima (impilabile), il cono no
 * (termina a punta).
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
  /** Pezzi decorativi sottili (finestre, occhi, pinne...) non hanno lo stud: non sono pensati per essere impilati. */
  studless?: boolean;
}) {
  const showStuds = opacity >= 1 && !studless;

  if (shape === "cone") {
    return (
      <mesh castShadow receiveShadow>
        <coneGeometry args={[size[0] * 0.42, size[1], 24]} />
        <PlasticMaterial color={color} opacity={opacity} />
      </mesh>
    );
  }

  if (shape === "cylinder") {
    return (
      <group>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[size[0] * 0.42, size[0] * 0.42, size[1], 28]} />
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
  const studs = [];
  if (showStuds) {
    for (let ix = 0; ix < w; ix++) {
      for (let iz = 0; iz < d; iz++) {
        const x = -size[0] / 2 + STUD / 2 + ix * STUD;
        const z = -size[2] / 2 + STUD / 2 + iz * STUD;
        studs.push(
          <group key={`${ix}-${iz}`} position={[x, size[1] / 2, z]}>
            <Stud color={color} />
          </group>
        );
      }
    }
  }

  // Sotto una certa soglia lo smusso del RoundedBox degenererebbe (pannelli
  // sottili come finestre o gradini di un tetto): in quel caso si usa un box
  // normale, a spigolo vivo.
  const minDim = Math.min(size[0], size[1], size[2]);
  const rounded = minDim > 0.18;

  return (
    <group>
      {rounded ? (
        <RoundedBox args={size} radius={0.035} smoothness={2} castShadow receiveShadow>
          <PlasticMaterial color={color} opacity={opacity} />
        </RoundedBox>
      ) : (
        <mesh castShadow receiveShadow>
          <boxGeometry args={size} />
          <PlasticMaterial color={color} opacity={opacity} />
        </mesh>
      )}
      {studs}
    </group>
  );
}
