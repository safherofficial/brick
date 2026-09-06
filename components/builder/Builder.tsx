"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls
} from "@react-three/drei";
import * as THREE from "three";
import { ChevronLeft, ChevronRight, Redo2, Undo2 } from "lucide-react";
import { BrickVisual } from "@/components/builder/BrickVisual";
import {
  BRICK_HEIGHT,
  HISTORY_LIMIT,
  STARTER_LIMIT,
  STUD_HEIGHT,
  basicKinds,
  brickDefs,
  cloneBricks,
  effectiveFootprint,
  isClear,
  isValid,
  loadDraft,
  makeBrick,
  nextId,
  saveDraft,
  settle,
  sizeFor,
  specialKinds,
  syncIdSeq,
  type Brick,
  type BrickKind,
  type Footprint,
  type Rotation,
  type Vec3,
  palette
} from "@/lib/brickGrid";

type ViewMode = "iso" | "top" | "front" | "side";
type Snapshot = Brick[];

function dragPlanePoint(ray: THREE.Ray) {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const point = new THREE.Vector3();
  return ray.intersectPlane(plane, point);
}

function initialScene(): Brick[] {
  const add = (
    kind: BrickKind,
    color: string,
    x: number,
    z: number,
    layer: number,
    rotation: Rotation = 0,
    idValue = nextId()
  ): Brick => {
    const footprint = effectiveFootprint(kind, rotation);
    return {
      id: idValue,
      kind,
      shape: brickDefs[kind].shape,
      footprint,
      size: sizeFor(footprint, kind),
      position: [x, layer * (kind === "voxel" ? 0.9 : 0.48) + (kind === "voxel" ? 0.45 : 0.24), z],
      rotation,
      color,
      layer
    };
  };

  const scene = [
    add("voxel", "#f4a0c4", -1, 0, 0, 0, 101),
    add("voxel", "#7fe7ff", 0, 0, 0, 0, 102),
    add("voxel", "#f3e07a", 1, 0, 0, 0, 103),
    add("voxel", "#3aa0ff", 0, 0, 1, 0, 104)
  ];
  syncIdSeq(scene);
  return scene;
}

function BrickMesh({
  brick,
  selected,
  dragging,
  onSelect,
  onHover,
  onPlace,
  onDragStart,
  onDragMove,
  onDragEnd
}: {
  brick: Brick;
  selected: boolean;
  dragging: boolean;
  onSelect: (id: number) => void;
  onHover: (point: THREE.Vector3) => void;
  onPlace: (point: THREE.Vector3) => void;
  onDragStart: (id: number, ray: THREE.Ray) => void;
  onDragMove: (ray: THREE.Ray) => void;
  onDragEnd: () => void;
}) {
  const size = sizeFor(brick.footprint, brick.kind);

  return (
    <group
      position={brick.position}
      rotation-y={THREE.MathUtils.degToRad(brick.rotation)}
      onClick={(e) => {
        e.stopPropagation();
        if (dragging) return;
        if (e.shiftKey) onPlace(e.point);
        else onSelect(brick.id);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        onSelect(brick.id);
        onDragStart(brick.id, e.ray);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        if (dragging) onDragMove(e.ray);
        else onHover(e.point);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        onDragEnd();
      }}
      onPointerCancel={(e) => {
        e.stopPropagation();
        onDragEnd();
      }}
    >
      <BrickVisual
        shape={brick.shape}
        size={brick.size}
        footprint={brickDefs[brick.kind].footprint}
        color={brick.color}
        studless={brick.kind === "voxel"}
        detail="editor"
      />
      {selected && (
        <mesh position={[0, size[1] / 2 + STUD_HEIGHT + 0.01, 0]}>
          <boxGeometry args={[size[0] + 0.11, 0.025, size[2] + 0.11]} />
          <meshBasicMaterial color="#8b5cf6" wireframe />
        </mesh>
      )}
    </group>
  );
}

function GhostBrick({ brick, valid }: { brick: Brick; valid: boolean }) {
  return (
    <group
      position={brick.position}
      rotation-y={THREE.MathUtils.degToRad(brick.rotation)}
    >
      <BrickVisual
        shape={brick.shape}
        size={brick.size}
        footprint={brickDefs[brick.kind].footprint}
        color={valid ? "#37E38B" : "#FF3347"}
        opacity={0.42}
        studless
        detail="editor"
      />
    </group>
  );
}

function CameraController({ viewMode }: { viewMode: ViewMode }) {
  const { camera } = useThree();
  useEffect(() => {
    const target = new THREE.Vector3(0, 0.9, 0);
    if (viewMode === "top") camera.position.set(0, 12, 0.01);
    else if (viewMode === "front") camera.position.set(0, 4.5, 11);
    else if (viewMode === "side") camera.position.set(11, 4.5, 0);
    else camera.position.set(8.5, 6.5, 9);
    camera.lookAt(target);
  }, [camera, viewMode]);
  return null;
}

function CaptureBridge({
  onReady
}: {
  onReady: (capture: () => string) => void;
}) {
  const { gl } = useThree();
  useEffect(() => {
    onReady(() => gl.domElement.toDataURL("image/png"));
  }, [gl, onReady]);
  return null;
}

function Scene({
  bricks,
  selectedId,
  draggingId,
  ghost,
  ghostValid,
  onSelect,
  onPointer,
  onCaptureReady,
  onPlace,
  onDragStart,
  onDragMove,
  onDragEnd,
  viewMode,
  gridVisible
}: {
  bricks: Brick[];
  selectedId: number | null;
  draggingId: number | null;
  ghost: Brick | null;
  ghostValid: boolean;
  onSelect: (id: number) => void;
  onPointer: (point: THREE.Vector3) => void;
  onCaptureReady: (capture: () => string) => void;
  onPlace: (point: THREE.Vector3) => void;
  onDragStart: (id: number, ray: THREE.Ray) => void;
  onDragMove: (ray: THREE.Ray) => void;
  onDragEnd: () => void;
  viewMode: ViewMode;
  gridVisible: boolean;
}) {
  const groundHover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (draggingId !== null) onDragMove(e.ray);
    else onPointer(e.point);
  };

  const groundClick = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (draggingId === null) onPlace(e.point);
  };

  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [8.5, 6.5, 9], fov: 42 }}
      gl={{ preserveDrawingBuffer: true }}
    >
      <color attach="background" args={["#070a11"]} />
      <ambientLight intensity={0.7} />
      <hemisphereLight intensity={0.48} groundColor="#05070c" />
      <directionalLight
        position={[6, 10, 5]}
        intensity={3.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <pointLight position={[-6, 5, -5]} intensity={0.55} color="#5b7cff" />

      {gridVisible && (
        <Grid
          args={[32, 32]}
          cellSize={1}
          cellThickness={0.55}
          cellColor="#273044"
          sectionSize={5}
          sectionThickness={1.1}
          sectionColor="#46516b"
          fadeDistance={30}
        />
      )}

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.035, 0]}
        onPointerMove={groundHover}
        onClick={groundClick}
        receiveShadow
      >
        <planeGeometry args={[32, 32]} />
        <shadowMaterial opacity={0.24} />
      </mesh>

      {draggingId !== null && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={(e) => {
            e.stopPropagation();
            onDragMove(e.ray);
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            onDragEnd();
          }}
          onPointerCancel={(e) => {
            e.stopPropagation();
            onDragEnd();
          }}
        >
          <planeGeometry args={[40, 40]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
        </mesh>
      )}

      {bricks.map((brick) => (
        <BrickMesh
          key={brick.id}
          brick={brick}
          selected={selectedId === brick.id}
          dragging={draggingId === brick.id}
          onSelect={onSelect}
          onHover={onPointer}
          onPlace={onPlace}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      ))}

      {ghost && draggingId === null && (
        <GhostBrick brick={ghost} valid={ghostValid} />
      )}

      <CameraController viewMode={viewMode} />
      <CaptureBridge onReady={onCaptureReady} />
      <OrbitControls
        enabled={draggingId === null}
        makeDefault
        enableDamping
        dampingFactor={0.075}
        target={[0, 0.9, 0]}
        minDistance={4}
        maxDistance={25}
      />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport
          axisColors={["#f87171", "#4ade80", "#60a5fa"]}
          labelColor="#dbe4ff"
          hideNegativeAxes
        />
      </GizmoHelper>
    </Canvas>
  );
}

function BrickThumb({
  footprint,
  color
}: {
  footprint: Footprint;
  color: string;
}) {
  const [w, d] = footprint;
  return (
    <div className="brickThumbPro" style={{ aspectRatio: `${w}/${d}`, background: color }}>
      <div className="thumbStuds" style={{ gridTemplateColumns: `repeat(${w},1fr)` }}>
        {Array.from({ length: w * d }).map((_, i) => (
          <i key={i} />
        ))}
      </div>
    </div>
  );
}

export default function Builder() {
  const [color, setColor] = useState<string>(palette[0]);
  const [kind, setKind] = useState<BrickKind>("voxel");
  const [sculptMode, setSculptMode] = useState(true);
  const [bricks, setBricks] = useState<Brick[]>(initialScene);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const dragOffset = useRef({ x: 0, z: 0 });
  const dragHistoryCommitted = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [ghostPoint, setGhostPoint] = useState<THREE.Vector3 | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("iso");
  const [gridVisible, setGridVisible] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [capture, setCapture] = useState<(() => string) | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [creator, setCreator] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [toast, setToast] = useState("");

  const available = Math.max(0, STARTER_LIMIT - bricks.length);
  const selected = useMemo(
    () => bricks.find((b) => b.id === selectedId) ?? null,
    [bricks, selectedId]
  );

  const ghost = useMemo(
    () =>
      ghostPoint
        ? makeBrick(kind, color, ghostPoint, bricks, 0, { sculpt: sculptMode })
        : null,
    [ghostPoint, kind, color, bricks, sculptMode]
  );
  const ghostValid = !!ghost && (sculptMode ? isClear(ghost, bricks) : isValid(ghost, bricks));

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1400);
  }, []);

  const commit = useCallback(
    (next: Brick[]) => {
      setHistory((h) => [...h.slice(-(HISTORY_LIMIT - 1)), cloneBricks(bricks)]);
      setFuture([]);
      setBricks(sculptMode ? next : settle(next));
    },
    [bricks, sculptMode]
  );

  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;
    setBricks(draft.bricks);
    if (draft.title) setTitle(draft.title);
    if (draft.creator) setCreator(draft.creator);
  }, []);

  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveDraft({ v: 2, bricks, title, creator });
    }, 200);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [bricks, title, creator]);

  const addAt = useCallback(
    (point: THREE.Vector3) => {
      if (available <= 0) {
        notify("STARTER SET EMPTY");
        return;
      }
      const next = makeBrick(kind, color, point, bricks, 0, { sculpt: sculptMode });
      if (sculptMode ? !isClear(next, bricks) : !isValid(next, bricks)) {
        notify(sculptMode ? "CELL OCCUPIED" : "NO STUD SUPPORT HERE");
        return;
      }
      commit([...bricks, next]);
      setSelectedId(next.id);
    },
    [available, bricks, color, commit, kind, notify, sculptMode]
  );

  const removeSelected = useCallback(() => {
    if (selectedId === null) return;
    commit(bricks.filter((b) => b.id !== selectedId));
    setSelectedId(null);
  }, [bricks, commit, selectedId]);

  const rotateSelected = useCallback(() => {
    if (!selected) return;
    const nextRotation = ((selected.rotation + 90) % 360) as Rotation;
    const footprint = effectiveFootprint(selected.kind, nextRotation);
    const others = bricks.filter((b) => b.id !== selected.id);
    const rotated: Brick = {
      ...selected,
      rotation: nextRotation,
      footprint,
      size: sizeFor(footprint, selected.kind)
    };
    const candidate = sculptMode ? rotated : settle([...others, rotated]).find((b) => b.id === selected.id);
    if (!candidate || !(sculptMode ? isClear(candidate, others) : isValid(candidate, others))) {
      notify("ROTATION BLOCKED");
      return;
    }
    commit([...others, candidate]);
  }, [bricks, commit, notify, sculptMode, selected]);

  const moveSelected = useCallback(
    (dx: number, dz: number) => {
      if (!selected) return;
      const others = bricks.filter((b) => b.id !== selected.id);
      const moved: Brick = {
        ...selected,
        position: [
          selected.position[0] + dx,
          selected.position[1],
          selected.position[2] + dz
        ]
      };
      const next = sculptMode ? [...others, moved] : settle([...others, moved]);
      commit(next);
    },
    [bricks, commit, sculptMode, selected]
  );

  const nudgeLayer = useCallback(
    (dir: number) => {
      if (!selected) return;
      const others = bricks.filter((b) => b.id !== selected.id);
      const candidate = {
        ...selected,
        layer: Math.max(0, selected.layer + dir)
      };
      candidate.position = [
        selected.position[0],
        (candidate.kind === "voxel" ? 0.9 : 0.48) * candidate.layer +
          (candidate.kind === "voxel" ? 0.45 : 0.24),
        selected.position[2]
      ];
      if (!isClear(candidate, others)) {
        notify("CELL OCCUPIED");
        return;
      }
      commit([...others, candidate]);
    },
    [bricks, commit, notify, selected]
  );

  const duplicateSelected = useCallback(() => {
    if (!selected || available <= 0) {
      if (available <= 0) notify("STARTER SET EMPTY");
      return;
    }
    const copy: Brick = {
      ...cloneBricks([selected])[0],
      id: nextId(),
      position: [
        selected.position[0] + 1,
        selected.position[1],
        selected.position[2]
      ]
    };
    commit(sculptMode ? [...bricks, copy] : settle([...bricks, copy]));
    setSelectedId(copy.id);
  }, [available, bricks, commit, notify, sculptMode, selected]);

  const startDragging = useCallback(
    (idValue: number, ray: THREE.Ray) => {
      const brick = bricks.find((b) => b.id === idValue);
      const point = dragPlanePoint(ray);
      if (!brick || !point) return;
      dragOffset.current = {
        x: brick.position[0] - point.x,
        z: brick.position[2] - point.z
      };
      dragHistoryCommitted.current = false;
      setSelectedId(idValue);
      setDraggingId(idValue);
    },
    [bricks]
  );

  const moveDragging = useCallback(
    (ray: THREE.Ray) => {
      if (draggingId === null) return;
      const point = dragPlanePoint(ray);
      if (!point) return;
      const x = point.x + dragOffset.current.x;
      const z = point.z + dragOffset.current.z;
      setBricks((current) => {
        const brick = current.find((b) => b.id === draggingId);
        if (!brick) return current;
        const moved = { ...brick, position: [x, brick.position[1], z] as Vec3 };
        const others = current.filter((b) => b.id !== draggingId);
        const next = sculptMode ? [...others, moved] : settle([...others, moved]);
        if (!dragHistoryCommitted.current) {
          dragHistoryCommitted.current = true;
          setHistory((h) => [...h.slice(-(HISTORY_LIMIT - 1)), cloneBricks(current)]);
          setFuture([]);
        }
        return next;
      });
    },
    [draggingId, sculptMode]
  );

  const endDragging = useCallback(() => {
    setDraggingId(null);
  }, []);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((f) => [...f, cloneBricks(bricks)]);
    setHistory((h) => h.slice(0, -1));
    setBricks(cloneBricks(previous));
  }, [bricks, history]);

  const redo = useCallback(() => {
    const next = future.at(-1);
    if (!next) return;
    setHistory((h) => [...h, cloneBricks(bricks)]);
    setFuture((f) => f.slice(0, -1));
    setBricks(cloneBricks(next));
  }, [bricks, future]);

  const openSave = useCallback(() => {
    setPreviewSrc(capture?.() ?? null);
    setSaved(false);
    setShowSave(true);
  }, [capture]);

  const confirmSave = useCallback(() => {
    saveDraft({ v: 2, bricks, title, creator });
    setSaved(true);
  }, [bricks, creator, title]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;

      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
      }

      if (e.key === "Delete" || e.key === "Backspace") removeSelected();
      if (e.key.toLowerCase() === "r") rotateSelected();
      if (e.key === "Escape") setSelectedId(null);
      if (e.key === "ArrowLeft") moveSelected(-1, 0);
      if (e.key === "ArrowRight") moveSelected(1, 0);
      if (e.key === "ArrowUp") moveSelected(0, -1);
      if (e.key === "ArrowDown") moveSelected(0, 1);
      if (e.key === "PageUp") nudgeLayer(1);
      if (e.key === "PageDown") nudgeLayer(-1);
      if (e.key === "1") setKind("voxel");
      if (e.key === "2") setKind("1x1");
      if (e.key === "3") setKind("1x2");
      if (e.key === "4") setKind("2x2");
      if (e.key === "5") setKind("2x4");

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [duplicateSelected, moveSelected, nudgeLayer, redo, removeSelected, rotateSelected, undo]);

  return (
    <main className="builderShell">
      <header className="builderHeader">
        <div className="headerLeft">
          <Link href="/" className="brand">
            <span className="brandMark">◆</span> BRICK
          </Link>
          <Link href="/gallery" className="backLink">
            <ChevronLeft size={14} />
            GALLERY
          </Link>
        </div>
        <div className="creationTitle">
          {editingTitle ? (
            <input
              autoFocus
              className="titleInput"
              value={title}
              placeholder="UNTITLED CREATION"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setEditingTitle(false);
              }}
            />
          ) : (
            <>
              <span>{title.trim() || "UNTITLED CREATION"}</span>
              <button className="titleEditBtn" onClick={() => setEditingTitle(true)}>
                EDIT
              </button>
            </>
          )}
        </div>
        <div className="builderActions">
          <button onClick={undo} disabled={!history.length}>
            <Undo2 size={15} />
          </button>
          <button onClick={redo} disabled={!future.length}>
            <Redo2 size={15} />
          </button>
          <button className="primaryButton" onClick={openSave}>
            SAVE
          </button>
        </div>
      </header>

      <div
        className="builderBody"
        style={{ gridTemplateColumns: `${panelOpen ? 246 : 58}px 1fr 232px` }}
      >
        <aside className={`brickPanel ${panelOpen ? "" : "panelCollapsed"}`}>
          <div className="panelHeaderRow">
            {panelOpen && <p className="panelLabel">PARTS LIBRARY</p>}
            <button className="collapseBtn" onClick={() => setPanelOpen((v) => !v)}>
              {panelOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
            </button>
          </div>
          {panelOpen && (
            <>
              <p className="category">VOXELS & BRICKS</p>
              <div className="brickPalette proPalette">
                {basicKinds.map((k) => (
                  <button
                    key={k}
                    className={`brickOption ${kind === k ? "selectedOption" : ""}`}
                    onClick={() => setKind(k)}
                  >
                    <BrickThumb footprint={brickDefs[k].footprint} color={color} />
                    <span>{brickDefs[k].label}</span>
                  </button>
                ))}
              </div>
              <p className="category">SPECIAL</p>
              <div className="brickPalette proPalette">
                {specialKinds.map((k) => (
                  <button
                    key={k}
                    className={`brickOption ${kind === k ? "selectedOption" : ""}`}
                    onClick={() => setKind(k)}
                  >
                    <BrickThumb footprint={brickDefs[k].footprint} color={color} />
                    <span>{brickDefs[k].label}</span>
                  </button>
                ))}
              </div>
              <p className="category">COLOR</p>
              <div className="colorRow">
                {palette.map((c) => (
                  <button
                    key={c}
                    className={`swatch ${color === c ? "swatchOn" : ""}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#C91F2D"}
                onChange={(e) => setColor(e.target.value)}
              />
              <p className="hint">
                {available} / {STARTER_LIMIT} LEFT
              </p>
            </>
          )}
        </aside>

        <section className="viewport">
          <Scene
            bricks={bricks}
            selectedId={selectedId}
            draggingId={draggingId}
            ghost={ghost}
            ghostValid={ghostValid}
            onSelect={setSelectedId}
            onPointer={setGhostPoint}
            onCaptureReady={setCapture}
            onPlace={addAt}
            onDragStart={startDragging}
            onDragMove={moveDragging}
            onDragEnd={endDragging}
            viewMode={viewMode}
            gridVisible={gridVisible}
          />
          {toast && <div className="toast">{toast}</div>}
        </section>

        <aside className="inspector">
          <p className="panelLabel">INSPECTOR</p>
          <button onClick={() => setGridVisible((v) => !v)}>
            GRID {gridVisible ? "ON" : "OFF"}
          </button>
          <button onClick={() => setSculptMode((v) => !v)}>
            SCULPT {sculptMode ? "ON" : "OFF"}
          </button>
          <div className="viewRow">
            {(["iso", "top", "front", "side"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                className={viewMode === mode ? "selectedOption" : ""}
                onClick={() => setViewMode(mode)}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
          {selected ? (
            <>
              <p className="category">{brickDefs[selected.kind].label}</p>
              <button onClick={rotateSelected}>ROTATE (R)</button>
              <button onClick={() => nudgeLayer(1)}>LAYER + (PgUp)</button>
              <button onClick={() => nudgeLayer(-1)}>LAYER − (PgDn)</button>
              <button onClick={duplicateSelected}>DUPLICATE (⌘D)</button>
              <button onClick={removeSelected}>DELETE</button>
            </>
          ) : (
            <p className="hint">SCULPT ON: stack with PageUp / PageDown.</p>
          )}
        </aside>
      </div>

      {showSave && (
        <div className="modalScrim">
          <div className="modal">
            {!saved ? (
              <>
                <p className="eyebrow">SAVE CREATION</p>
                <input
                  className="titleInput"
                  value={title}
                  placeholder="Title"
                  onChange={(e) => setTitle(e.target.value)}
                />
                <input
                  className="titleInput"
                  value={creator}
                  placeholder="Creator"
                  onChange={(e) => setCreator(e.target.value)}
                />
                {previewSrc && (
                  <img className="savePreview" src={previewSrc} alt="Preview" />
                )}
                <div className="modalActions">
                  <button className="secondaryButton" onClick={() => setShowSave(false)}>
                    CANCEL
                  </button>
                  <button
                    className="primaryButton"
                    disabled={!title.trim() || !previewSrc}
                    onClick={confirmSave}
                  >
                    SAVE CREATION →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="saveSuccess">✓</div>
                <p className="eyebrow">SAVED</p>
                <h2>READY FOR THE SHOWCASE</h2>
                <div className="modalActions">
                  <Link href="/gallery" className="primaryButton">
                    OPEN GALLERY →
                  </Link>
                  <button className="secondaryButton" onClick={() => setShowSave(false)}>
                    KEEP BUILDING
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
