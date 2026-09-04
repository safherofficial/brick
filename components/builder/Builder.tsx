"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Canvas, ThreeEvent, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

type Brick = {
  id: number;
  size: [number, number, number];
  position: [number, number, number];
  color: string;
};

type BrickKind = "1x1" | "2x2" | "2x4";

const palette = ["#ef4444", "#f59e0b", "#facc15", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#e5e7eb"];
const sizes: Record<BrickKind, [number, number, number]> = {
  "1x1": [0.9, 0.45, 0.9],
  "2x2": [1.8, 0.45, 1.8],
  "2x4": [3.6, 0.45, 1.8]
};

function GhostBrick({ position, size, color }: { position: [number, number, number]; size: [number, number, number]; color: string }) {
  return <mesh position={position}><boxGeometry args={size} /><meshStandardMaterial color={color} transparent opacity={0.28} depthWrite={false} /></mesh>;
}

function BrickMesh({ brick, selected, onSelect }: { brick: Brick; selected: boolean; onSelect: (id: number) => void }) {
  return <group position={brick.position} onClick={(e) => { e.stopPropagation(); onSelect(brick.id); }}>
    <mesh castShadow receiveShadow>
      <boxGeometry args={brick.size} />
      <meshStandardMaterial color={brick.color} roughness={0.5} metalness={0.02} />
    </mesh>
    {selected && <mesh position={[0, 0.26, 0]}>
      <boxGeometry args={[brick.size[0] + 0.08, 0.04, brick.size[2] + 0.08]} />
      <meshBasicMaterial color="#c084fc" wireframe />
    </mesh>}
  </group>;
}

function CameraCapture({ onReady }: { onReady: (capture: () => string) => void }) {
  const { gl } = useThree();
  useEffect(() => { onReady(() => gl.domElement.toDataURL("image/png")); }, [gl, onReady]);
  return null;
}

function Scene({ bricks, selectedId, ghost, onSelect, onGroundClick, onCaptureReady }: {
  bricks: Brick[]; selectedId: number | null; ghost: Brick | null;
  onSelect: (id: number) => void; onGroundClick: (point: THREE.Vector3) => void;
  onCaptureReady: (capture: () => string) => void;
}) {
  const groundClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onGroundClick(e.point); };
  return <Canvas shadows camera={{ position: [7, 6, 8], fov: 45 }} gl={{ preserveDrawingBuffer: true }}>
    <color attach="background" args={["#080b14"]} />
    <ambientLight intensity={1.15} />
    <directionalLight position={[5, 9, 4]} intensity={3.2} castShadow shadow-mapSize={[2048, 2048]} />
    <hemisphereLight intensity={0.45} />
    <Grid args={[30, 30]} cellSize={1} cellThickness={0.5} cellColor="#252b3a" sectionSize={5} sectionThickness={1} sectionColor="#3d4660" fadeDistance={30} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]} onClick={groundClick} receiveShadow>
      <planeGeometry args={[30, 30]} />
      <shadowMaterial opacity={0.18} />
    </mesh>
    {bricks.map((brick) => <BrickMesh key={brick.id} brick={brick} selected={selectedId === brick.id} onSelect={onSelect} />)}
    {ghost && <GhostBrick position={ghost.position} size={ghost.size} color={ghost.color} />}
    <CameraCapture onReady={onCaptureReady} />
    <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
  </Canvas>;
}

export default function Builder() {
  const [color, setColor] = useState(palette[3]);
  const [kind, setKind] = useState<BrickKind>("2x2");
  const [bricks, setBricks] = useState<Brick[]>([
    { id: 1, size: sizes["2x4"], position: [0, 0.225, 0], color: "#22c55e" },
    { id: 2, size: sizes["2x2"], position: [0.5, 0.675, 0], color: "#3b82f6" },
    { id: 3, size: sizes["1x1"], position: [0, 1.125, 0], color: "#facc15" }
  ]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [capture, setCapture] = useState<(() => string) | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [title, setTitle] = useState("");
  const [creator, setCreator] = useState("");
  const [saved, setSaved] = useState(false);

  const available = 100 - bricks.length;
  const selected = useMemo(() => bricks.find((b) => b.id === selectedId) ?? null, [bricks, selectedId]);
  const ghost: Brick | null = selectedId === null ? null : null;

  const addAt = useCallback((point: THREE.Vector3) => {
    if (available <= 0) return;
    const x = Math.round(point.x);
    const z = Math.round(point.z);
    const next: Brick = { id: Date.now(), size: sizes[kind], position: [x, 0.225, z], color };
    setBricks((current) => [...current, next]);
    setSelectedId(next.id);
  }, [available, color, kind]);

  const removeSelected = () => {
    if (selectedId === null) return;
    setBricks((current) => current.filter((b) => b.id !== selectedId));
    setSelectedId(null);
  };

  const rotateSelected = () => {
    if (!selectedId) return;
    setBricks((current) => current.map((b) => b.id === selectedId ? { ...b, size: [b.size[2], b.size[1], b.size[0]] } : b));
  };

  const moveSelected = (dx: number, dz: number) => {
    if (!selectedId) return;
    setBricks((current) => current.map((b) => b.id === selectedId ? { ...b, position: [b.position[0] + dx, b.position[1], b.position[2] + dz] } : b));
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Delete" || e.key === "Backspace") removeSelected();
      if (e.key.toLowerCase() === "r") rotateSelected();
      if (e.key === "ArrowLeft") moveSelected(-1, 0);
      if (e.key === "ArrowRight") moveSelected(1, 0);
      if (e.key === "ArrowUp") moveSelected(0, -1);
      if (e.key === "ArrowDown") moveSelected(0, 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const openSave = () => { setSaved(false); setShowSave(true); };
  const confirmSave = () => {
    if (!title.trim() || !capture) return;
    const preview = capture();
    localStorage.setItem("brick-builder-draft", JSON.stringify({ title: title.trim(), creator: creator.trim() || "Anonymous", bricks, preview, savedAt: Date.now() }));
    setSaved(true);
  };

  return <main className="builderShell">
    <header className="builderHeader">
      <Link href="/" className="brand"><span className="brandMark">◆</span> BRICK BUILDER</Link>
      <div className="creationTitle">UNTITLED CREATION</div>
      <div className="builderActions"><button aria-label="undo">↶</button><button aria-label="redo">↷</button><button className="primaryButton" onClick={openSave}>SAVE</button><button aria-label="menu">☰</button></div>
    </header>

    <div className="builderBody">
      <aside className="brickPanel">
        <p className="panelLabel">BRICKS</p><p className="category">BASIC</p>
        <div className="brickPalette">
          {(Object.keys(sizes) as BrickKind[]).map((k) => <button key={k} className={`brickOption ${kind === k ? "selectedOption" : ""}`} onClick={() => setKind(k)}>{k}</button>)}
        </div>
        <p className="category">COLORS</p>
        <div className="colorPalette">{palette.map((c) => <button key={c} className={`colorDot ${color === c ? "selectedColor" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
        <p className="category">STARTER SET</p>
        <div className="available"><span>AVAILABLE</span><b>{available} / 100</b></div>
        <div className="progress"><i style={{ width: `${available}%` }} /></div>
        <p className="panelHelp">Select a brick, then click the grid to place it.</p>
      </aside>

      <section className="scene">
        <Scene bricks={bricks} selectedId={selectedId} ghost={ghost} onSelect={setSelectedId} onGroundClick={addAt} onCaptureReady={setCapture} />
        <div className="sceneHud"><span>{bricks.length} PIECES</span><span>GRID 1×1</span><span>{selected ? "BRICK SELECTED" : "READY TO BUILD"}</span></div>
        <div className="sceneHint">CLICK GRID TO PLACE · CLICK BRICK TO SELECT · ARROWS MOVE · R ROTATE · DELETE REMOVE</div>
        <div className="bottomTools"><button onClick={() => addAt(new THREE.Vector3(0, 0, 0))}>＋ ADD BRICK</button><button onClick={removeSelected}>⌫ REMOVE</button><span /><button onClick={() => moveSelected(-1, 0)}>←</button><button onClick={() => moveSelected(1, 0)}>→</button><button onClick={rotateSelected}>↻ ROTATE</button></div>
      </section>

      <aside className="toolsPanel">
        <p className="panelLabel">TOOLS</p>
        <button className="toolActive">◈ SELECT</button><button onClick={() => moveSelected(-1, 0)}>✣ MOVE</button><button onClick={rotateSelected}>⟳ ROTATE</button><button onClick={removeSelected}>⌫ DELETE</button>
        <p className="category">VIEW</p><label><span>GRID</span><input type="checkbox" defaultChecked /></label><label><span>SNAP</span><input type="checkbox" defaultChecked /></label>
        <div className="pieceCount"><span>PIECE COUNT</span><b>{bricks.length} / 100</b></div>
        <div className="selectedInfo"><span>SELECTED</span><b>{selected ? selected.id : "—"}</b></div>
      </aside>
    </div>

    {showSave && <div className="modalBackdrop" onClick={() => setShowSave(false)}>
      <div className="saveModal" onClick={(e) => e.stopPropagation()}>
        {!saved ? <>
          <p className="eyebrow">FINALIZE CREATION</p><h2>SAVE YOUR MASTERPIECE</h2>
          <p className="modalText">Your current camera view will become the public thumbnail. Make sure the composition is exactly how you want it.</p>
          <label>CREATION NAME<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My masterpiece" /></label>
          <label>CREATOR NAME<input value={creator} onChange={(e) => setCreator(e.target.value)} placeholder="Your name or handle" /></label>
          <div className="modalPreview">{capture ? <img src={capture()} alt="Current preview" /> : <span>PREVIEW</span>}</div>
          <div className="modalActions"><button className="secondaryButton" onClick={() => setShowSave(false)}>CANCEL</button><button className="primaryButton" disabled={!title.trim()} onClick={confirmSave}>SAVE CREATION →</button></div>
        </> : <>
          <div className="saveSuccess">✓</div><p className="eyebrow">CREATION SAVED</p><h2>READY FOR THE SHOWCASE</h2><p className="modalText">The creation has been stored locally for this prototype. The next phase will publish it to PostgreSQL and the public gallery.</p><div className="modalActions"><Link href="/gallery" className="primaryButton">OPEN GALLERY →</Link><button className="secondaryButton" onClick={() => setShowSave(false)}>KEEP BUILDING</button></div>
        </>}
      </div>
    </div>}
  </main>;
}
