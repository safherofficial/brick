"use client";

import { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { BrickVisual } from "@/components/builder/BrickVisual";
import type { ShowcaseCreation } from "@/lib/creations";

const STUD = 0.9;

// Deriva l'impronta (in studs) direttamente dalle dimensioni del pezzo, così
// i dati della vetrina restano semplici da scrivere (basta la size reale).
function footprintOf(size: [number, number, number]): [number, number] {
  return [Math.max(1, Math.round(size[0] / STUD)), Math.max(1, Math.round(size[2] / STUD))];
}

function Spinner({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.3;
  });
  return <group ref={ref}>{children}</group>;
}

function LookAt({ target }: { target: [number, number, number] }) {
  const { camera } = useThree();
  useEffect(() => { camera.lookAt(new THREE.Vector3(...target)); }, [camera, target]);
  return null;
}

export default function ShowcaseThumb({ creation, interactive = false }: { creation: ShowcaseCreation; interactive?: boolean }) {
  return (
    <Canvas shadows camera={{ position: creation.camera, fov: 38 }} dpr={[1, 1.5]}>
      <color attach="background" args={["#0b0f1a"]} />
      <ambientLight intensity={1.05} />
      <directionalLight position={[5, 8, 4]} intensity={2.6} castShadow />
      <hemisphereLight intensity={0.4} />
      <LookAt target={creation.target} />
      <Spinner>
        {creation.bricks.map((brick, i) => (
          <group key={i} position={brick.position} rotation={brick.rotation ?? [0, 0, 0]}>
            <BrickVisual
              shape={brick.shape ?? "box"}
              size={brick.size}
              footprint={footprintOf(brick.size)}
              color={brick.color}
              studless={brick.studless}
            />
          </group>
        ))}
      </Spinner>
      {/* Nelle card della gallery l'orbit manuale resta disattivato: dentro un
          <Link>, un drag per orbitare rischierebbe di essere letto come un
          click e attivare la navigazione. Nella pagina di dettaglio (senza
          Link attorno) l'orbit libero è invece sicuro e viene abilitato. */}
      {interactive && (
        <OrbitControls makeDefault target={creation.target} enableZoom={false} enablePan={false} enableDamping dampingFactor={0.1} />
      )}
    </Canvas>
  );
}
