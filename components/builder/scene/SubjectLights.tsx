"use client";

/** Studio key aimed at the built subject (focus). Toggle with L. */
export function SubjectLights({
  on,
  focus,
  size
}: {
  on: boolean;
  focus: [number, number, number];
  size: number;
}) {
  const [cx, cy, cz] = focus;
  const reach = Math.max(12, size * 0.75);
  // Soft "occhio di bue" always on the subject (diffuse cone)
  const bullHeight = cy + Math.max(10, size * 0.55);
  const bullDist = Math.max(18, size * 1.1);
  const bullAngle = on ? 0.42 : 0.55;
  const bullPenumbra = on ? 0.55 : 0.75;

  if (!on) {
    return (
      <>
        <ambientLight intensity={1.55} color="#e0e6f4" />
        <hemisphereLight intensity={1.0} color="#eef2ff" groundColor="#2a303c" />
        <spotLight
          position={[cx, bullHeight, cz]}
          intensity={3.8}
          color="#fff8f0"
          angle={bullAngle}
          penumbra={bullPenumbra}
          distance={bullDist}
          decay={1.2}
          castShadow={false}
        >
          <object3D attach="target" position={[cx, cy, cz]} />
        </spotLight>
        <pointLight
          position={[cx, cy + Math.max(3, size * 0.18), cz]}
          intensity={1.8}
          distance={Math.max(24, size * 1.15)}
          decay={1.4}
          color="#f2f5ff"
        />
      </>
    );
  }

  return (
    <>
      <ambientLight intensity={0.65} color="#c8d2ea" />
      <hemisphereLight intensity={0.7} color="#e8eeff" groundColor="#18141e" />
      <directionalLight
        position={[cx + reach * 0.55, cy + reach * 0.95, cz + reach * 0.4]}
        intensity={7.5}
        color="#fff6ec"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={reach * 8}
        shadow-camera-left={-reach}
        shadow-camera-right={reach}
        shadow-camera-top={reach}
        shadow-camera-bottom={-reach}
        shadow-bias={-0.00015}
      >
        <object3D attach="target" position={[cx, cy, cz]} />
      </directionalLight>
      <directionalLight
        position={[cx - reach * 0.7, cy + reach * 0.45, cz - reach * 0.25]}
        intensity={2.2}
        color="#a8bcff"
      >
        <object3D attach="target" position={[cx, cy, cz]} />
      </directionalLight>
      <directionalLight
        position={[cx - reach * 0.15, cy + reach * 0.55, cz - reach * 1.0]}
        intensity={3.8}
        color="#ffc9a0"
      >
        <object3D attach="target" position={[cx, cy, cz]} />
      </directionalLight>
      <spotLight
        position={[cx + reach * 0.12, bullHeight, cz + reach * 0.08]}
        intensity={10}
        color="#fffaf4"
        angle={bullAngle}
        penumbra={bullPenumbra}
        distance={bullDist}
        decay={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      >
        <object3D attach="target" position={[cx, cy, cz]} />
      </spotLight>
      <pointLight
        position={[cx, cy + Math.max(5, size * 0.3), cz]}
        intensity={3.4}
        distance={Math.max(28, size * 1.3)}
        decay={1.3}
        color="#ffe9d4"
      />
    </>
  );
}
