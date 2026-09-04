"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, ThreeEvent, useThree } from "@react-three/fiber";
import { Edges, Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

type BrickKind = "1x1" | "1x2" | "2x2" | "2x4" | "2x6";
type ViewMode = "iso" | "top" | "front" | "side";
type Brick = {
  id: number;
  kind: BrickKind;
  size: [number, number, number];
  footprint: [number, number];
  position: [number, number, number];
  rotation: 0 | 90;
  color: string;
};

type Snapshot = Brick[];

const BRICK_H = 0.42;
const STUD_R = 0.12;
const STUD_H = 0.09;
const palette = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#14b8a6", "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#f1f5f9"];
const sizes: Record<BrickKind, [number, number, number]> = {
  "1x1": [0.92, BRICK_H, 0.92],
  "1x2": [0.92, BRICK_H, 1.84],
  "2x2": [1.84, BRICK_H, 1.84],
  "2x4": [3.68, BRICK_H, 1.84],
  "2x6": [5.52, BRICK_H, 1.84]
};
const footprints: Record<BrickKind, [number, number]> = {
  "1x1": [1, 1], "1x2": [1, 2], "2x2": [2, 2], "2x4": [4, 2], "2x6": [6, 2]
};
const starter = 150;

function makeBrick(kind: BrickKind, color: string, x: number, z: number, layer: number, rotation: 0 | 90 = 0, id = Date.now() + Math.floor(Math.random() * 100000)): Brick {
  const fp = rotation === 0 ? footprints[kind] : [footprints[kind][1], footprints[kind][0]] as [number, number];
  const sz = rotation === 0 ? sizes[kind] : [sizes[kind][2], sizes[kind][1], sizes[kind][0]] as [number, number, number];
  return { id, kind, size: sz, footprint: fp, position: [x, BRICK_H / 2 + layer * BRICK_H, z], rotation, color };
}

function cloneBricks(bricks: Brick[]): Brick[] {
  return bricks.map((b) => ({ ...b, position: [...b.position] as [number, number, number], size: [...b.size] as [number, number, number], footprint: [...b.footprint] as [number, number] }));
}

function cellsFor(brick: Brick): Array<[number, number]> {
  const [w, d] = brick.footprint;
  const cells: Array<[number, number]> = [];
  const startX = brick.position[0] - (w - 1) / 2;
  const startZ = brick.position[2] - (d - 1) / 2;
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) cells.push([Math.round(startX + x), Math.round(startZ + z)]);
  return cells;
}

function cellKey(x: number, z: number) { return `${x}:${z}`; }

function layerOf(brick: Brick) { return Math.round((brick.position[1] - BRICK_H / 2) / BRICK_H); }

function occupancy(bricks: Brick[]) {
  const map = new Map<string, number>();
  for (const brick of bricks) {
    const layer = layerOf(brick) + 1;
    for (const [x, z] of cellsFor(brick)) map.set(cellKey(x, z), Math.max(map.get(cellKey(x, z)) ?? 0, layer));
  }
  return map;
}

function placementLayer(kind: BrickKind, x: number, z: number, rotation: 0 | 90, bricks: Brick[]) {
  const fp = rotation === 0 ? footprints[kind] : [footprints[kind][1], footprints[kind][0]] as [number, number];
  const startX = x - (fp[0] - 1) / 2;
  const startZ = z - (fp[1] - 1) / 2;
  const top = occupancy(bricks);
  let support: number | null = null;
  for (let ix = 0; ix < fp[0]; ix++) {
    for (let iz = 0; iz < fp[1]; iz++) {
      const key = cellKey(Math.round(startX + ix), Math.round(startZ + iz));
      const level = top.get(key) ?? 0;
      support = support === null ? level : support === level ? support : -1;
    }
  }
  return support ?? 0;
}

function collides(candidate: Brick, bricks: Brick[]) {
  const candidateLayer = layerOf(candidate);
  const occupied = new Set(cellsFor(candidate).map(([x, z]) => cellKey(x, z)));
  return bricks.some((brick) => {
    if (layerOf(brick) !== candidateLayer) return false;
    return cellsFor(brick).some(([x, z]) => occupied.has(cellKey(x, z)));
  });
}

function validCandidate(candidate: Brick, bricks: Brick[]) {
  if (collides(candidate, bricks)) return false;
  const layer = layerOf(candidate);
  if (layer === 0) return true;
  const support = occupancy(bricks);
  return cellsFor(candidate).every(([x, z]) => (support.get(cellKey(x, z)) ?? 0) === layer);
}

function candidateAt(kind: BrickKind, color: string, point: THREE.Vector3, bricks: Brick[], rotation: 0 | 90) {
  const x = Math.round(point.x);
  const z = Math.round(point.z);
  const layer = placementLayer(kind, x, z, rotation, bricks);
  return makeBrick(kind, color, x, z, layer, rotation, -1);
}

function Studs({ size, color, ghost = false }: { size: [number, number, number]; color: string; ghost?: boolean }) {
  const cols = Math.max(1, Math.round(size[0] / 0.92));
  const rows = Math.max(1, Math.round(size[2] / 0.92));
  const x0 = -(cols - 1) * 0.46;
  const z0 = -(rows - 1) * 0.46;
  return <>
    {Array.from({ length: cols * rows }).map((_, i) => {
      const x = x0 + (i % cols) * 0.92;
      const z = z0 + Math.floor(i / cols) * 0.92;
      return <mesh key={i} position={[x, size[1] / 2 + STUD_H / 2 - 0.01, z]} castShadow={!ghost}>
        <cylinderGeometry args={[STUD_R, STUD_R, STUD_H, 16]} />
        <meshStandardMaterial color={color} transparent={ghost} opacity={ghost ? 0.32 : 1} roughness={0.34} />
      </mesh>;
    })}
  </>;
}

function BrickMesh({ brick, selected, ghost, valid, onSelect, onHover, onPlace }: {
  brick: Brick; selected?: boolean; ghost?: boolean; valid?: boolean;
  onSelect?: (id: number) => void; onHover?: (point: THREE.Vector3) => void; onPlace?: (point: THREE.Vector3) => void;
}) {
  const color = ghost && !valid ? "#ef4444" : brick.color;
  return <group position={brick.position} rotation={[0, brick.rotation === 90 ? Math.PI / 2 : 0, 0]}
    onClick={(e) => { e.stopPropagation(); if (ghost) return; if (e.shiftKey && onPlace) onPlace(e.point); else onSelect?.(brick.id); }}
    onPointerMove={(e) => { e.stopPropagation(); onHover?.(e.point); }}>
    <mesh castShadow={!ghost} receiveShadow={!ghost}>
      <boxGeometry args={brick.size} />
      <meshStandardMaterial color={color} transparent={ghost} opacity={ghost ? 0.3 : 1} roughness={0.38} metalness={0.02} />
      {!ghost && <Edges threshold={18} color={selected ? "#d8b4fe" : "#000000"} linewidth={selected ? 2 : 0.7} />}
    </mesh>
    <Studs size={brick.size} color={color} ghost={ghost} />
    {selected && !ghost && <mesh position={[0, brick.size[1] / 2 + 0.03, 0]}>
      <boxGeometry args={[brick.size[0] + 0.1, 0.025, brick.size[2] + 0.1]} />
      <meshBasicMaterial color="#c084fc" transparent opacity={0.35} wireframe />
    </mesh>}
  </group>;
}

function CameraRig({ viewMode, resetSignal }: { viewMode: ViewMode; resetSignal: number }) {
  const { camera } = useThree();
  const controls = useRef<any>(null);
  useEffect(() => {
    const target = new THREE.Vector3(0, 1, 0);
    const presets: Record<ViewMode, [number, number, number]> = {
      iso: [9, 7.5, 10], top: [0.01, 14, 0.01], front: [0, 5.5, 13], side: [13, 5.5, 0]
    };
    camera.position.set(...presets[viewMode]);
    if (controls.current) { controls.current.target.copy(target); controls.current.update(); }
    else camera.lookAt(target);
  }, [camera, viewMode, resetSignal]);
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.07} minDistance={4} maxDistance={28} maxPolarAngle={Math.PI / 2 - 0.04} target={[0, 1, 0]} />;
}

function CaptureBridge({ onReady }: { onReady: (fn: () => string) => void }) {
  const { gl } = useThree();
  useEffect(() => { onReady(() => gl.domElement.toDataURL("image/png")); }, [gl, onReady]);
  return null;
}

function Scene({ bricks, selectedId, ghost, ghostValid, onSelect, onHover, onPlace, onCapture, viewMode, gridVisible, resetSignal }: {
  bricks: Brick[]; selectedId: number | null; ghost: Brick | null; ghostValid: boolean;
  onSelect: (id: number) => void; onHover: (p: THREE.Vector3) => void; onPlace: (p: THREE.Vector3) => void;
  onCapture: (fn: () => string) => void; viewMode: ViewMode; gridVisible: boolean; resetSignal: number;
}) {
  return <Canvas shadows dpr={[1, 1.7]} camera={{ position: [9, 7.5, 10], fov: 42 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
    <color attach="background" args={["#070a12"]} />
    <fog attach="fog" args={["#070a12", 18, 34]} />
    <ambientLight intensity={0.72} />
    <hemisphereLight intensity={0.58} groundColor="#080b14" skyColor="#9aa8ff" />
    <directionalLight position={[7, 12, 5]} intensity={3.3} castShadow shadow-mapSize={[2048, 2048]} />
    <directionalLight position={[-5, 6, -4]} intensity={0.55} color="#8b5cf6" />
    {gridVisible && <Grid args={[30, 30]} cellSize={1} cellThickness={0.55} cellColor="#252c3c" sectionSize={5} sectionThickness={1.1} sectionColor="#4a5571" fadeDistance={25} infiniteGrid />}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow onPointerMove={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(e.point); }} onClick={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onPlace(e.point); }}>
      <planeGeometry args={[34, 34]} />
      <meshStandardMaterial color="#0b101b" roughness={0.95} />
    </mesh>
    {bricks.map((brick) => <BrickMesh key={brick.id} brick={brick} selected={selectedId === brick.id} onSelect={onSelect} onHover={onHover} onPlace={onPlace} />)}
    {ghost && <BrickMesh brick={ghost} ghost valid={ghostValid} />}
    <CameraRig viewMode={viewMode} resetSignal={resetSignal} />
    <CaptureBridge onReady={onCapture} />
  </Canvas>;
}

const initialBricks: Brick[] = [
  makeBrick("2x4", "#22c55e", -1, 0, 0, 0, 1), makeBrick("2x4", "#22c55e", 3, 0, 0, 0, 2),
  makeBrick("2x2", "#3b82f6", 0, 0, 1, 0, 3), makeBrick("2x2", "#3b82f6", 2, 0, 1, 0, 4),
  makeBrick("2x2", "#facc15", 1, 0, 2, 0, 5), makeBrick("1x2", "#ec4899", 1, 1, 3, 90, 6)
];

export default function Builder() {
  const [bricks, setBricks] = useState<Brick[]>(initialBricks);
  const [kind, setKind] = useState<BrickKind>("2x4");
  const [color, setColor] = useState(palette[3]);
  const [rotation, setRotation] = useState<0 | 90>(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoverPoint, setHoverPoint] = useState<THREE.Vector3 | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("iso");
  const [gridVisible, setGridVisible] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const [capture, setCapture] = useState<(() => string) | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [title, setTitle] = useState("");
  const [creator, setCreator] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const selected = useMemo(() => bricks.find((b) => b.id === selectedId) ?? null, [bricks, selectedId]);
  const ghost = useMemo(() => hoverPoint ? candidateAt(kind, color, hoverPoint, bricks, rotation) : null, [hoverPoint, kind, color, bricks, rotation]);
  const ghostValid = !!ghost && validCandidate(ghost, bricks);
  const available = Math.max(0, starter - bricks.length);

  const commit = useCallback((next: Brick[]) => {
    setHistory((h) => [...h.slice(-49), cloneBricks(bricks)]);
    setFuture([]);
    setBricks(next);
  }, [bricks]);

  const addAt = useCallback((point: THREE.Vector3) => {
    if (available <= 0) return;
    const next = candidateAt(kind, color, point, bricks, rotation);
    if (!validCandidate(next, bricks)) { setToast("Position blocked — move to an open cell"); return; }
    const placed = { ...next, id: Date.now() + Math.floor(Math.random() * 100000) };
    commit([...bricks, placed]); setSelectedId(placed.id); setToast("Brick placed");
  }, [available, bricks, color, commit, kind, rotation]);

  const remove = useCallback(() => {
    if (selectedId === null) return;
    commit(bricks.filter((b) => b.id !== selectedId)); setSelectedId(null); setToast("Brick removed");
  }, [bricks, commit, selectedId]);

  const move = useCallback((dx: number, dz: number) => {
    if (!selected) return;
    const next = bricks.map((b) => b.id === selected.id ? { ...b, position: [b.position[0] + dx, b.position[1], b.position[2] + dz] as [number, number, number] } : b);
    const moved = next.find((b) => b.id === selected.id)!;
    if (!validCandidate(moved, next.filter((b) => b.id !== selected.id))) commit(next); else setToast("Cannot move there");
  }, [bricks, commit, selected]);

  const rotate = useCallback(() => {
    if (!selected) return;
    const r: 0 | 90 = selected.rotation === 0 ? 90 : 0;
    const next = bricks.map((b) => b.id === selected.id ? makeBrick(b.kind, b.color, b.position[0], b.position[2], layerOf(b), r, b.id) : b);
    const rotated = next.find((b) => b.id === selected.id)!;
    if (validCandidate(rotated, next.filter((b) => b.id !== selected.id))) commit(next); else setToast("Cannot rotate — occupied cells detected");
  }, [bricks, commit, selected]);

  const undo = useCallback(() => { const prev = history.at(-1); if (!prev) return; setFuture((f) => [...f, cloneBricks(bricks)]); setHistory((h) => h.slice(0, -1)); setBricks(cloneBricks(prev)); setSelectedId(null); }, [bricks, history]);
  const redo = useCallback(() => { const next = future.at(-1); if (!next) return; setHistory((h) => [...h, cloneBricks(bricks)]); setFuture((f) => f.slice(0, -1)); setBricks(cloneBricks(next)); setSelectedId(null); }, [bricks, future]);

  useEffect(() => {
    try { const raw = localStorage.getItem("brick-builder-draft-state"); if (raw) setBricks(JSON.parse(raw)); } catch {}
  }, []);
  useEffect(() => { localStorage.setItem("brick-builder-draft-state", JSON.stringify(bricks)); }, [bricks]);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(""), 1700); return () => window.clearTimeout(t); }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (e.key === "Delete" || e.key === "Backspace") remove();
      else if (e.key.toLowerCase() === "r") rotate();
      else if (e.key === "ArrowLeft") move(-1, 0);
      else if (e.key === "ArrowRight") move(1, 0);
      else if (e.key === "ArrowUp") move(0, -1);
      else if (e.key === "ArrowDown") move(0, 1);
      else if (e.key.toLowerCase() === "escape") setSelectedId(null);
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [move, redo, remove, rotate, undo]);

  const newBuild = () => { setHistory([]); setFuture([]); setBricks([]); setSelectedId(null); setToast("New build"); };
  const openSave = () => { setSaved(false); setPreview(capture ? capture() : null); setSaveOpen(true); };
  const confirmSave = () => {
    if (!title.trim() || !preview) return;
    localStorage.setItem("brick-builder-draft", JSON.stringify({ title: title.trim(), creator: creator.trim() || "Anonymous", bricks, preview, savedAt: Date.now(), views: 0, likes: 0 }));
    setSaved(true);
  };

  return <main className="builderShell">
    <header className="builderHeader">
      <Link href="/" className="brand"><span className="brandMark">◆</span><span>BRICK BUILDER</span></Link>
      <div className="builderCenter"><span className="statusDot" /> <span>{bricks.length} PIECES</span><span className="headerDivider" /> <span>{title.trim() || "UNTITLED BUILD"}</span></div>
      <div className="builderActions"><button onClick={undo} disabled={!history.length} title="Undo (Ctrl/Cmd+Z)">↶</button><button onClick={redo} disabled={!future.length} title="Redo (Ctrl/Cmd+Y)">↷</button><button className="ghostButton" onClick={newBuild}>NEW</button><button className="primaryButton" onClick={openSave}>SAVE</button><Link href="/gallery" className="secondaryButton">GALLERY</Link></div>
    </header>

    <div className="builderBody">
      <aside className="brickPanel">
        <div className="panelTitle"><span>PARTS</span><small>{available} LEFT</small></div>
        <p className="category">BRICKS</p>
        <div className="partGrid">{(Object.keys(sizes) as BrickKind[]).map((k) => <button key={k} className={`partCard ${kind === k ? "selectedOption" : ""}`} onClick={() => setKind(k)}><span className={`miniBrick mini-${k.replace("x", "-")}`} /><b>{k}</b><small>STANDARD</small></button>)}</div>
        <div className="panelRule" />
        <p className="category">COLOR</p>
        <div className="colorPalette">{palette.map((c) => <button key={c} className={`colorDot ${color === c ? "selectedColor" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Choose ${c}`} />)}</div>
        <div className="panelRule" />
        <p className="category">ORIENTATION</p>
        <button className="wideControl" onClick={() => setRotation(rotation === 0 ? 90 : 0)}><span>↻</span> ROTATE PIECE <b>{rotation}°</b></button>
        <div className="inventory"><div><span>STARTER SET</span><b>{starter}</b></div><div><span>USED</span><b>{bricks.length}</b></div><div><span>REMAINING</span><b>{available}</b></div></div>
        <div className="inventoryBar"><i style={{ width: `${Math.min(100, bricks.length / starter * 100)}%` }} /></div>
      </aside>

      <section className="scene">
        <Scene bricks={bricks} selectedId={selectedId} ghost={ghost} ghostValid={ghostValid} onSelect={setSelectedId} onHover={setHoverPoint} onPlace={addAt} onCapture={setCapture} viewMode={viewMode} gridVisible={gridVisible} resetSignal={resetSignal} />
        <div className="sceneTopbar"><div className="scenePill"><span className="liveDot" /> EDITOR</div><div className="scenePill">{ghost ? ghostValid ? "READY TO PLACE" : "BLOCKED" : "HOVER GRID TO BUILD"}</div></div>
        <div className="cameraBar"><button className={viewMode === "iso" ? "activeCam" : ""} onClick={() => setViewMode("iso")}>ISO</button><button className={viewMode === "top" ? "activeCam" : ""} onClick={() => setViewMode("top")}>TOP</button><button className={viewMode === "front" ? "activeCam" : ""} onClick={() => setViewMode("front")}>FRONT</button><button className={viewMode === "side" ? "activeCam" : ""} onClick={() => setViewMode("side")}>SIDE</button><span /><button onClick={() => setResetSignal((n) => n + 1)}>RESET VIEW</button></div>
        <div className="sceneHint">CLICK EMPTY GRID TO PLACE · CLICK BRICK TO SELECT · SHIFT+CLICK TO STACK · ARROWS MOVE · R ROTATE</div>
        {selected && <div className="selectionCard"><span>SELECTED</span><strong>{selected.kind}</strong><small>Layer {layerOf(selected) + 1} · {selected.color.toUpperCase()}</small></div>}
        <div className="bottomTools"><button className="addTool" onClick={() => addAt(hoverPoint ?? new THREE.Vector3(0, 0, 0))}>＋ ADD</button><button onClick={remove}>DELETE</button><span className="toolSep" /><button onClick={() => move(-1, 0)}>←</button><button onClick={() => move(1, 0)}>→</button><button onClick={() => move(0, -1)}>↑</button><button onClick={() => move(0, 1)}>↓</button><button onClick={rotate}>↻</button></div>
        {toast && <div className="toast">{toast}</div>}
      </section>

      <aside className="toolsPanel">
        <div className="panelTitle"><span>INSPECTOR</span><small>{selected ? "SELECTED" : "NONE"}</small></div>
        {selected ? <>
          <div className="inspectorPreview"><span className="inspectorBrick" style={{ background: selected.color }} /></div>
          <div className="inspectorRow"><span>TYPE</span><b>{selected.kind}</b></div><div className="inspectorRow"><span>POSITION</span><b>{selected.position[0]}, {layerOf(selected) + 1}, {selected.position[2]}</b></div><div className="inspectorRow"><span>ROTATION</span><b>{selected.rotation}°</b></div>
          <div className="inspectorActions"><button onClick={rotate}>ROTATE</button><button onClick={remove}>DELETE</button></div>
          <p className="category">MOVE</p><div className="nudgeGrid"><button onClick={() => move(0, -1)}>↑</button><button onClick={() => move(-1, 0)}>←</button><button onClick={() => move(1, 0)}>→</button><button onClick={() => move(0, 1)}>↓</button></div>
        </> : <div className="emptyInspector"><div>＋</div><p>Select a brick to inspect and move it.</p></div>}
        <div className="panelRule" />
        <p className="category">VIEW</p>
        <label className="toggleRow"><span>GRID</span><input type="checkbox" checked={gridVisible} onChange={(e) => setGridVisible(e.target.checked)} /></label>
        <div className="buildTips"><b>SHORTCUTS</b><span>R <em>Rotate</em></span><span>DEL <em>Delete</em></span><span>⌘Z <em>Undo</em></span><span>SHIFT+CLICK <em>Stack</em></span></div>
      </aside>
    </div>

    {saveOpen && <div className="modalBackdrop" onClick={() => setSaveOpen(false)}><div className="saveModal" onClick={(e) => e.stopPropagation()}>{!saved ? <>
      <p className="eyebrow">PUBLISH CREATION</p><h2>MAKE IT OFFICIAL.</h2><p className="modalText">Your current camera angle becomes the showcase thumbnail.</p>
      <div className="modalSaveGrid"><div><label>CREATION NAME<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled masterpiece" /></label><label>CREATOR<input value={creator} onChange={(e) => setCreator(e.target.value)} placeholder="Your name or handle" /></label></div><div className="modalPreview">{preview && <img src={preview} alt="Creation preview" />}</div></div>
      <div className="modalActions"><button className="secondaryButton" onClick={() => setSaveOpen(false)}>CANCEL</button><button className="primaryButton" disabled={!title.trim() || !preview} onClick={confirmSave}>SAVE CREATION →</button></div>
    </> : <><div className="saveSuccess">✓</div><p className="eyebrow">CREATION SAVED</p><h2>READY FOR THE SHOWCASE.</h2><p className="modalText">This prototype stores the creation locally. The next persistence layer will publish it to PostgreSQL and permanent object storage.</p><div className="modalActions"><Link href="/gallery" className="primaryButton">OPEN GALLERY →</Link><button className="secondaryButton" onClick={() => setSaveOpen(false)}>KEEP BUILDING</button></div></>}</div></div>}
  </main>;
}
