"use client";

import { useState } from "react";
import Link from "next/link";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";

type Brick = { id: number; size: [number, number, number]; position: [number, number, number]; color: string };

const palette = ["#ef4444","#f59e0b","#facc15","#22c55e","#3b82f6","#a855f7","#ec4899","#e5e7eb"];

function BrickMesh({ brick }: { brick: Brick }) {
  return (
    <mesh position={brick.position} castShadow>
      <boxGeometry args={brick.size} />
      <meshStandardMaterial color={brick.color} roughness={0.55} />
    </mesh>
  );
}

function Scene({ bricks }: { bricks: Brick[] }) {
  return (
    <Canvas shadows camera={{ position: [7, 6, 8], fov: 45 }}>
      <color attach="background" args={["#080b14"]} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[5, 9, 4]} intensity={3} castShadow />
      <Grid args={[30,30]} cellSize={1} cellThickness={0.5} cellColor="#252b3a" sectionSize={5} sectionThickness={1} sectionColor="#3d4660" fadeDistance={30} />
      {bricks.map((brick) => <BrickMesh key={brick.id} brick={brick} />)}
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  );
}

export default function Builder() {
  const [color, setColor] = useState(palette[3]);
  const [bricks, setBricks] = useState<Brick[]>([
    { id: 1, size: [3.6,.45,1.8], position: [0,.25,0], color: "#22c55e" },
    { id: 2, size: [1.8,.45,1.8], position: [.5,.72,0], color: "#3b82f6" },
    { id: 3, size: [.9,.45,.9], position: [0,1.18,0], color: "#facc15" }
  ]);

  function addBrick(size: Brick["size"]) {
    const n = bricks.length;
    setBricks((current) => [...current, { id: Date.now(), size, position: [(n % 5) - 2, .25, Math.floor(n / 5)], color }]);
  }

  return (
    <main className="builderShell">
      <header className="builderHeader">
        <Link href="/" className="brand"><span className="brandMark">◆</span> BRICK BUILDER</Link>
        <div className="creationTitle">UNTITLED CREATION</div>
        <div className="builderActions"><button>↶</button><button>↷</button><button className="primaryButton">SAVE</button><button>☰</button></div>
      </header>
      <div className="builderBody">
        <aside className="brickPanel">
          <p className="panelLabel">BRICKS</p><p className="category">BASIC</p>
          <div className="brickPalette">
            <button className="brickOption" onClick={() => addBrick([.9,.45,.9])}>1×1</button>
            <button className="brickOption" onClick={() => addBrick([1.8,.45,1.8])}>2×2</button>
            <button className="brickOption" onClick={() => addBrick([3.6,.45,1.8])}>2×4</button>
          </div>
          <p className="category">COLORS</p>
          <div className="colorPalette">
            {palette.map((c) => <button key={c} aria-label={c} className="colorDot" style={{background:c}} onClick={() => setColor(c)} />)}
          </div>
          <div className="available"><span>STARTER SET</span><b>{100 - bricks.length} / 100</b></div>
        </aside>
        <section className="scene">
          <Scene bricks={bricks} />
          <div className="sceneHint">DRAG TO ORBIT · SCROLL TO ZOOM · CLICK TO BUILD</div>
          <div className="bottomTools"><button>＋ ADD BRICK</button><button>⌫ REMOVE</button><span /><button>↶</button><button>↷</button><button>↻ ROTATE</button></div>
        </section>
        <aside className="toolsPanel">
          <p className="panelLabel">TOOLS</p>
          <button className="toolActive">◈ SELECT</button><button>✣ MOVE</button><button>⟳ ROTATE</button><button>⌫ DELETE</button>
          <p className="category">VIEW</p><label><span>GRID</span><input type="checkbox" defaultChecked /></label><label><span>SNAP</span><input type="checkbox" defaultChecked /></label>
          <div className="pieceCount"><span>PIECE COUNT</span><b>{bricks.length} / 100</b></div>
        </aside>
      </div>
    </main>
  );
}
