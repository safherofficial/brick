"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Canvas, ThreeEvent, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

type Brick = {
  id: number;
  size: [number, number, number];
  footprint: [number, number];
  position: [number, number, number];
  color: string;
};

type BrickKind = "1x1" | "2x2" | "2x4";

type HistoryState = Brick[];

const palette = ["#ef4444", "#f59e0b", "#facc15", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#e5e7eb"];
const heights = 0.45;
const sizes: Record<BrickKind, [number, number, number]> = {
  "1x1": [0.9, heights, 0.9],
  "2x2": [1.8, heights, 1.8],
  "2x4": [3.6, heights, 1.8]
};
const footprints: Record<BrickKind, [number, number]> = {
  "1x1": [1, 1],
  "2x2": [2, 2],
  "2x4": [4, 2]
};

function getFootprint(brick: Brick) {
  return brick.footprint;
}

function overlaps(a: Brick, b: Brick) {
  const [aw, ad] = getFootprint(a);
  const [bw, bd] = getFootprint(b);
  const ax = Math.abs(a.position[0] - b.position[0]);
  const az = Math.abs(a.position[2] - b.position[2]);
  return ax < (aw + bw) / 2 && az < (ad + bd) / 2;
}

function sameLayer(a: Brick, b: Brick) {
  return Math.abs(a.position[1] - b.position[1]) < 0.01;
}

function validPlacement(candidate: Brick, bricks: Brick[]) {
  return !bricks.some((brick) => sameLayer(candidate, brick) && overlaps(candidate, brick));
}

function supportedLayer(candidate: Brick, bricks: Brick[]) {
  const [cw, cd] = candidate.footprint;
  const minX = candidate.position[0] - cw / 2 + 0.5;
  const maxX = candidate.position[0] + cw / 2 - 0.5;
  const minZ = candidate.position[2] - cd / 2 + 0.5;
  const maxZ = candidate.position[2] + cd / 2 - 0.5;
  const cells: Array<[number, number]> = [];
  for (let x = minX; x <= maxX; x += 1) for (let z = minZ; z <= maxZ; z += 1) cells.push([x, z]);
  if (!cells.length) return 0;

  let bestLayer = 0;
  for (const brick of bricks) {
    const layer = Math.round((brick.position[1] - heights / 2) / heights);
    if (layer < 0) continue;
    const [bw, bd] = brick.footprint;
    const bMinX = brick.position[0] - bw / 2 + 0.5;
    const bMaxX = brick.position[0] + bw / 2 - 0.5;
    const bMinZ = brick.position[2] - bd / 2 + 0.5;
    const bMaxZ = brick.position[2] + bd / 2 - 0.5;
    const covers = cells.every(([x, z]) => x >= bMinX && x <= bMaxX && z >= bMinZ && z <= bMaxZ);
    if (covers) bestLayer = Math.max(bestLayer, layer + 1);
  }
  return bestLayer;
}

function buildCandidate(kind: BrickKind, color: string, point: THREE.Vector3, bricks: Brick[], forcedLayer?: number): Brick {
  const x = Math.round(point.x);
  const z = Math.round(point.z);
  const layer = forcedLayer ?? supportedLayer({ id: -1, size: sizes[kind], footprint: footprints[kind], position: [x, 0, z], color }, bricks);
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    size: sizes[kind],
    footprint: footprints[kind],
    position: [x, heights / 2 + layer * heights, z],
    color
  };
}

function GhostBrick({ position, size, color, valid }: { position: [number, number, number]; size: [number, number, number]; color: string; valid: boolean }) {
  return <mesh position={position}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={valid ? color : "#ef4444"} transparent opacity={0.28} depthWrite={false} />
  </mesh>;
}

function BrickMesh({ brick, selected, onSelect, onHover, onPlace }: { brick: Brick; selected: boolean; onSelect: (id: number) => void; onHover: (point: THREE.Vector3) => void; onPlace: (point: THREE.Vector3) => void }) {
  return <group position={brick.position}
    onClick={(e) => { e.stopPropagation(); if (e.shiftKey) onPlace(e.point); else onSelect(brick.id); }}
    onPointerMove={(e) => { e.stopPropagation(); onHover(e.point); }}>
    <mesh castShadow receiveShadow>
      <boxGeometry args={brick.size} />
      <meshStandardMaterial color={brick.color} roughness={0.48} metalness={0.02} />
    </mesh>
    {selected && <mesh position={[0, 0.26, 0]}>
      <boxGeometry args={[brick.size[0] + 0.08, 0.04, brick.size[2] + 0.08]} />
      <meshBasicMaterial color="#c084fc" wireframe />
    </mesh>}
  </group>;
}

function CameraController({ viewMode }: { viewMode: "iso" | "top" }) {
  const { camera } = useThree();
  useEffect(() => {
    const target = new THREE.Vector3(0, 0.8, 0);
    if (viewMode === "top") camera.position.set(0.01, 11, 0.01);
    else camera.position.set(8, 7, 9);
    camera.lookAt(target);
  }, [camera, viewMode]);
  return null;
}

function CameraCapture({ onReady }: { onReady: (capture: () => string) => void }) {
  const { gl } = useThree();
  useEffect(() => { onReady(() => gl.domElement.toDataURL("image/png")); }, [gl, onReady]);
  return null;
}

function Scene({ bricks, selectedId, ghost, ghostValid, onSelect, onPointer, onCaptureReady, onPlace, viewMode }: {
  bricks: Brick[]; selectedId: number | null; ghost: Brick | null; ghostValid: boolean;
  onSelect: (id: number) => void; onPointer: (point: THREE.Vector3) => void;
  onCaptureReady: (capture: () => string) => void;
  onPlace: (point: THREE.Vector3) => void;
  viewMode: "iso" | "top";
}) {
  const groundPointer = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onPointer(e.point); };
  return <Canvas shadows camera={{ position: [8, 7, 9], fov: 45 }} gl={{ preserveDrawingBuffer: true }}>
    <color attach="background" args={["#080b14"]} />
    <ambientLight intensity={1.1} />
    <directionalLight position={[5, 9, 4]} intensity={3.1} castShadow shadow-mapSize={[2048, 2048]} />
    <hemisphereLight intensity={0.42} />
    <Grid args={[30, 30]} cellSize={1} cellThickness={0.5} cellColor="#252b3a" sectionSize={5} sectionThickness={1} sectionColor="#3d4660" fadeDistance={30} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]} onPointerMove={groundPointer} onClick={groundPointer} receiveShadow>
      <planeGeometry args={[30, 30]} />
      <shadowMaterial opacity={0.18} />
    </mesh>
    {bricks.map((brick) => <BrickMesh key={brick.id} brick={brick} selected={selectedId === brick.id} onSelect={onSelect} onHover={onPointer} onPlace={onPlace} />)}
    {ghost && <GhostBrick position={ghost.position} size={ghost.size} color={ghost.color} valid={ghostValid} />}
    <CameraController viewMode={viewMode} />
    <CameraCapture onReady={onCaptureReady} />
    <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
  </Canvas>;
}

const cloneBricks = (bricks: Brick[]): Brick[] => bricks.map((b) => ({ ...b, position: [...b.position] as [number, number, number], size: [...b.size] as [number, number, number], footprint: [...b.footprint] as [number, number] }));

export default function Builder() {
  const [color, setColor] = useState(palette[3]);
  const [kind, setKind] = useState<BrickKind>("2x2");
  const [bricks, setBricks] = useState<Brick[]>([
    { id: 1, size: sizes["2x4"], footprint: footprints["2x4"], position: [0, 0.225, 0], color: "#22c55e" },
    { id: 2, size: sizes["2x2"], footprint: footprints["2x2"], position: [0, 0.675, 0], color: "#3b82f6" },
    { id: 3, size: sizes["1x1"], footprint: footprints["1x1"], position: [0, 1.125, 0], color: "#facc15" }
  ]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [capture, setCapture] = useState<(() => string) | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [title, setTitle] = useState("");
  const [creator, setCreator] = useState("");
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [future, setFuture] = useState<HistoryState[]>([]);
  const [ghostPoint, setGhostPoint] = useState<THREE.Vector3 | null>(null);
  const [viewMode, setViewMode] = useState<"iso" | "top">("iso");

  const available = 100 - bricks.length;
  const selected = useMemo(() => bricks.find((b) => b.id === selectedId) ?? null, [bricks, selectedId]);
  const ghost = useMemo(() => ghostPoint ? buildCandidate(kind, color, ghostPoint, bricks) : null, [ghostPoint, kind, color, bricks]);
  const ghostValid = !!ghost && validPlacement(ghost, bricks);

  const commit = useCallback((next: Brick[]) => {
    setHistory((h) => [...h.slice(-39), cloneBricks(bricks)]);
    setFuture([]);
    setBricks(next);
  }, [bricks]);

  const addAt = useCallback((point: THREE.Vector3) => {
    if (available <= 0) return;
    const next = buildCandidate(kind, color, point, bricks);
    if (!validPlacement(next, bricks)) return;
    commit([...bricks, next]);
    setSelectedId(next.id);
  }, [available, bricks, color, commit, kind]);

  const removeSelected = useCallback(() => {
    if (selectedId === null) return;
    commit(bricks.filter((b) => b.id !== selectedId));
    setSelectedId(null);
  }, [bricks, commit, selectedId]);

  const rotateSelected = useCallback(() => {
    if (selectedId === null) return;
    const next = bricks.map((b) => b.id === selectedId ? { ...b, size: [b.size[2], b.size[1], b.size[0]] as [number, number, number], footprint: [b.footprint[1], b.footprint[0]] as [number, number] } : b);
    const changed = next.find((b) => b.id === selectedId)!;
    if (!validPlacement(changed, next.filter((b) => b.id !== selectedId))) commit(next);
  }, [bricks, commit, selectedId]);

  const moveSelected = useCallback((dx: number, dz: number) => {
    if (selectedId === null) return;
    const next = bricks.map((b) => b.id === selectedId ? { ...b, position: [b.position[0] + dx, b.position[1], b.position[2] + dz] as [number, number, number] } : b);
    const moved = next.find((b) => b.id === selectedId)!;
    if (validPlacement(moved, next.filter((b) => b.id !== selectedId))) commit(next);
  }, [bricks, commit, selectedId]);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((f) => [...f, cloneBricks(bricks)]);
    setHistory((h) => h.slice(0, -1));
    setBricks(cloneBricks(previous));
    setSelectedId(null);
  }, [bricks, history]);

  const redo = useCallback(() => {
    const next = future.at(-1);
    if (!next) return;
    setHistory((h) => [...h, cloneBricks(bricks)]);
    setFuture((f) => f.slice(0, -1));
    setBricks(cloneBricks(next));
    setSelectedId(null);
  }, [bricks, future]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Delete" || e.key === "Backspace") removeSelected();
      if (e.key.toLowerCase() === "r") rotateSelected();
      if (e.key === "ArrowLeft") moveSelected(-1, 0);
      if (e.key === "ArrowRight") moveSelected(1, 0);
      if (e.key === "ArrowUp") moveSelected(0, -1);
      if (e.key === "ArrowDown") moveSelected(0, 1);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [moveSelected, redo, removeSelected, rotateSelected, undo]);

  useEffect(() => {
    const savedDraft = localStorage.getItem("brick-builder-draft-state");
    if (!savedDraft) return;
    try { setBricks(JSON.parse(savedDraft)); } catch { /* ignore malformed local draft */ }
  }, []);

  useEffect(() => {
    localStorage.setItem("brick-builder-draft-state", JSON.stringify(bricks));
  }, [bricks]);

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
      <div className="creationTitle">{title.trim() || "UNTITLED CREATION"}</div>
      <div className="builderActions"><button aria-label="undo" onClick={undo} disabled={!history.length}>↶</button><button aria-label="redo" onClick={redo} disabled={!future.length}>↷</button><button className="primaryButton" onClick={openSave}>SAVE</button><Link href="/gallery" className="secondaryButton">GALLERY</Link><button aria-label="menu">☰</button></div>
    </header>

    <div className="builderBody">
      <aside className="brickPanel">
        <p className="panelLabel">BRICKS</p><p className="category">BASIC</p>
        <div className="brickPalette">{(Object.keys(sizes) as BrickKind[]).map((k) => <button key={k} className={`brickOption ${kind === k ? "selectedOption" : ""}`} onClick={() => setKind(k)}>{k}</button>)}</div>
        <p className="category">COLORS</p><div className="colorPalette">{palette.map((c) => <button key={c} aria-label={`Color ${c}`} className={`colorDot ${color === c ? "selectedColor" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
        <p className="category">STARTER SET</p><div className="available"><span>AVAILABLE</span><b>{available} / 100</b></div><div className="progress"><i style={{ width: `${available}%` }} /></div>
        <p className="panelHelp">Move the cursor over the grid or a brick to preview placement. Green is valid, red is blocked. Click to place.</p>
      </aside>

      <section className="scene">
        <Scene bricks={bricks} selectedId={selectedId} ghost={ghost} ghostValid={ghostValid} onSelect={setSelectedId} onPointer={setGhostPoint} onPlace={addAt} onCaptureReady={setCapture} viewMode={viewMode} />
        <div className="sceneHud"><span>{bricks.length} PIECES</span><span>GRID 1×1</span><span>{ghost ? (ghostValid ? "PLACEMENT READY" : "BLOCKED") : selected ? "BRICK SELECTED" : "READY TO BUILD"}</span></div>
        <div className="sceneHint">HOVER TO PREVIEW · CLICK TO PLACE · CLICK BRICK TO SELECT · ARROWS MOVE · R ROTATE · CTRL/CMD+Z UNDO</div>
        <div className="bottomTools"><button onClick={() => addAt(new THREE.Vector3(0, 0, 0))}>＋ ADD BRICK</button><button onClick={removeSelected}>⌫ REMOVE</button><span /><button onClick={() => moveSelected(-1, 0)}>←</button><button onClick={() => moveSelected(1, 0)}>→</button><button onClick={() => moveSelected(0, -1)}>↑</button><button onClick={() => moveSelected(0, 1)}>↓</button><button onClick={rotateSelected}>↻ ROTATE</button></div>
      </section>

      <aside className="toolsPanel">
        <p className="panelLabel">TOOLS</p><button className="toolActive">◈ SELECT / PLACE</button><button onClick={() => moveSelected(-1, 0)}>✣ MOVE</button><button onClick={rotateSelected}>⟳ ROTATE</button><button onClick={removeSelected}>⌫ DELETE</button>
        <p className="category">VIEW</p><label><span>GRID</span><input type="checkbox" defaultChecked /></label><label><span>SNAP</span><input type="checkbox" defaultChecked /></label>
        <button className={`viewButton ${viewMode === "iso" ? "viewSelected" : ""}`} onClick={() => setViewMode("iso")}>ISOMETRIC</button><button className={`viewButton ${viewMode === "top" ? "viewSelected" : ""}`} onClick={() => setViewMode("top")}>TOP VIEW</button>
        <div className="pieceCount"><span>PIECE COUNT</span><b>{bricks.length} / 100</b></div><div className="selectedInfo"><span>SELECTED</span><b>{selected ? selected.id : "—"}</b></div>
      </aside>
    </div>

    {showSave && <div className="modalBackdrop" onClick={() => setShowSave(false)}><div className="saveModal" onClick={(e) => e.stopPropagation()}>
      {!saved ? <><p className="eyebrow">FINALIZE CREATION</p><h2>SAVE YOUR MASTERPIECE</h2><p className="modalText">The current camera view becomes the public thumbnail. Adjust the camera before saving.</p>
        <label>CREATION NAME<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My masterpiece" /></label><label>CREATOR NAME<input value={creator} onChange={(e) => setCreator(e.target.value)} placeholder="Your name or handle" /></label>
        <div className="modalPreview">{capture ? <img src={capture()} alt="Current preview" /> : <span>PREVIEW</span>}</div><div className="modalActions"><button className="secondaryButton" onClick={() => setShowSave(false)}>CANCEL</button><button className="primaryButton" disabled={!title.trim()} onClick={confirmSave}>SAVE CREATION →</button></div>
      </> : <><div className="saveSuccess">✓</div><p className="eyebrow">CREATION SAVED</p><h2>READY FOR THE SHOWCASE</h2><p className="modalText">Saved locally for this prototype. PostgreSQL, permanent thumbnails and public gallery publishing come next.</p><div className="modalActions"><Link href="/gallery" className="primaryButton">OPEN GALLERY →</Link><button className="secondaryButton" onClick={() => setShowSave(false)}>KEEP BUILDING</button></div></>}
    </div></div>}
  </main>;
}
