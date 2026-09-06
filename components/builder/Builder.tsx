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
import { VoxelCloud } from "@/components/builder/VoxelCloud";
import {
  HISTORY_LIMIT,
  STARTER_LIMIT,
  STUD_HEIGHT,
  basicKinds,
  brickDefs,
  canPlace,
  cloneBricks,
  effectiveFootprint,
  loadDraft,
  makeBrick,
  nextId,
  previewBrick,
  saveDraft,
  settle,
  sizeFor,
  snapXZ,
  specialKinds,
  syncIdSeq,
  withLayer,
  type Brick,
  type BrickKind,
  type Footprint,
  type Rotation,
  palette
} from "@/lib/brickGrid";
import "./builder.css";

type ViewMode = "iso" | "top" | "front" | "side";
type Snapshot = Brick[];

const DRAG_THRESHOLD = 0.18;

function dragPlanePoint(ray: THREE.Ray, y = 0) {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
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
    idValue: number
  ): Brick => {
    const footprint = effectiveFootprint(kind, 0);
    return withLayer(
      {
        id: idValue,
        kind,
        shape: brickDefs[kind].shape,
        footprint,
        size: sizeFor(footprint, kind),
        position: [x, 0, z],
        rotation: 0,
        color,
        layer
      },
      layer
    );
  };

  const scene = [
    add("voxel", "#f4a0c4", -1, 0, 0, 101),
    add("voxel", "#7fe7ff", 0, 0, 0, 102),
    add("voxel", "#f3e07a", 1, 0, 0, 103),
    add("voxel", "#3aa0ff", 0, 0, 1, 104)
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
  onDragStart,
  onDragMove,
  onDragEnd
}: {
  brick: Brick;
  selected: boolean;
  dragging: boolean;
  onSelect: (id: number) => void;
  onHover: (point: THREE.Vector3) => void;
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
        if (!dragging) onSelect(brick.id);
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
  const voxels = bricks.filter((b) => b.kind === "voxel");
  const solids = bricks.filter((b) => b.kind !== "voxel");
  const draggingVoxel = voxels.find((b) => b.id === draggingId) ?? null;
  const orbiting = useRef(false);

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
      />

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
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (draggingId !== null) onDragMove(e.ray);
          else onPointer(e.point);
        }}
        onClick={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (draggingId !== null) return;
          if (orbiting.current) return;
          if (e.delta > 4) return;
          onPlace(e.point);
        }}
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
        >
          <planeGeometry args={[40, 40]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
        </mesh>
      )}

      <VoxelCloud
        voxels={voxels}
        selectedId={selectedId}
        draggingId={draggingId}
        onSelect={onSelect}
        onHover={onPointer}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      />

      {solids.map((brick) => (
        <BrickMesh
          key={brick.id}
          brick={brick}
          selected={selectedId === brick.id}
          dragging={draggingId === brick.id}
          onSelect={onSelect}
          onHover={onPointer}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      ))}

      {draggingVoxel && (
        <BrickMesh
          key={`drag-${draggingVoxel.id}`}
          brick={draggingVoxel}
          selected
          dragging
          onSelect={onSelect}
          onHover={onPointer}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      )}

      {ghost && draggingId === null && (
        <GhostBrick brick={ghost} valid={ghostValid} />
      )}

      <CameraController viewMode={viewMode} />
      <CaptureBridge onReady={onCaptureReady} />
      <OrbitControls
        enabled={draggingId === null}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={[0, 0.9, 0]}
        minDistance={1.2}
        maxDistance={90}
        zoomSpeed={1.35}
        minPolarAngle={0.08}
        maxPolarAngle={Math.PI / 2.05}
        onStart={() => {
          orbiting.current = true;
        }}
        onEnd={() => {
          window.setTimeout(() => {
            orbiting.current = false;
          }, 220);
        }}
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
    <div
      className="brickThumbPro"
      style={{ aspectRatio: `${w}/${d}`, background: color }}
    >
      <div
        className="thumbStuds"
        style={{ gridTemplateColumns: `repeat(${w}, 1fr)` }}
      >
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
  const [pendingRotation, setPendingRotation] = useState<Rotation>(0);
  const [sculptMode, setSculptMode] = useState(true);
  const [bricks, setBricks] = useState<Brick[]>(initialScene);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const dragOffset = useRef({ x: 0, z: 0 });
  const dragOrigin = useRef<Brick | null>(null);
  const dragActive = useRef(false);
  const ignorePlace = useRef(false);
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
        ? previewBrick(kind, color, ghostPoint, bricks, pendingRotation, {
            sculpt: sculptMode
          })
        : null,
    [ghostPoint, kind, color, bricks, sculptMode, pendingRotation]
  );
  const ghostValid = !!ghost && canPlace(ghost, bricks, sculptMode);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1400);
  }, []);

  const commit = useCallback(
    (next: Brick[]) => {
      setHistory((h) => [...h.slice(-(HISTORY_LIMIT - 1)), cloneBricks(bricks)]);
      setFuture([]);
      setBricks(sculptMode ? next.map(snapXZ) : settle(next));
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
      if (ignorePlace.current) return;
      if (available <= 0) {
        notify("STARTER SET EMPTY");
        return;
      }
      const next = makeBrick(kind, color, point, bricks, pendingRotation, {
        sculpt: sculptMode
      });
      if (!canPlace(next, bricks, sculptMode)) {
        notify(sculptMode ? "CELL OCCUPIED" : "NO STUD SUPPORT HERE");
        return;
      }
      commit([...bricks, next]);
      setSelectedId(next.id);
    },
    [available, bricks, color, commit, kind, notify, pendingRotation, sculptMode]
  );

  const placeGhost = useCallback(() => {
    if (!ghost || !ghostValid) return;
    ignorePlace.current = false;
    addAt(
      new THREE.Vector3(ghost.position[0], ghost.position[1], ghost.position[2])
    );
  }, [addAt, ghost, ghostValid]);

  const selectBrick = useCallback((id: number) => {
    ignorePlace.current = true;
    setSelectedId(id);
    window.setTimeout(() => {
      ignorePlace.current = false;
    }, 180);
  }, []);

  const removeSelected = useCallback(() => {
    if (selectedId === null) return;
    ignorePlace.current = true;
    commit(bricks.filter((b) => b.id !== selectedId));
    setSelectedId(null);
    window.setTimeout(() => {
      ignorePlace.current = false;
    }, 180);
  }, [bricks, commit, selectedId]);

  const rotateSelected = useCallback(() => {
    if (!selected) {
      setPendingRotation((r) => ((r + 90) % 360) as Rotation);
      return;
    }
    const nextRotation = ((selected.rotation + 90) % 360) as Rotation;
    const footprint = effectiveFootprint(selected.kind, nextRotation);
    const others = bricks.filter((b) => b.id !== selected.id);
    const rotated = snapXZ({
      ...selected,
      rotation: nextRotation,
      footprint,
      size: sizeFor(footprint, selected.kind)
    });
    if (!canPlace(rotated, others, sculptMode)) {
      notify("ROTATION BLOCKED");
      return;
    }
    commit([...others, rotated]);
  }, [bricks, commit, notify, sculptMode, selected]);

  const moveSelected = useCallback(
    (dx: number, dz: number) => {
      if (!selected) return;
      const others = bricks.filter((b) => b.id !== selected.id);
      const moved = snapXZ({
        ...selected,
        position: [
          selected.position[0] + dx,
          selected.position[1],
          selected.position[2] + dz
        ]
      });
      if (!canPlace(moved, others, sculptMode)) {
        notify("MOVE BLOCKED");
        return;
      }
      commit([...others, moved]);
    },
    [bricks, commit, notify, sculptMode, selected]
  );

  const nudgeLayer = useCallback(
    (dir: number) => {
      if (!selected) return;
      const others = bricks.filter((b) => b.id !== selected.id);
      const candidate = withLayer(selected, selected.layer + dir);
      if (!canPlace(candidate, others, true)) {
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
    const copy = snapXZ({
      ...cloneBricks([selected])[0],
      id: nextId(),
      position: [
        selected.position[0] + 1,
        selected.position[1],
        selected.position[2]
      ]
    });
    if (!canPlace(copy, bricks, sculptMode)) {
      notify("NO SPACE TO DUPLICATE");
      return;
    }
    commit([...bricks, copy]);
    setSelectedId(copy.id);
  }, [available, bricks, commit, notify, sculptMode, selected]);

  const startDragging = useCallback(
    (idValue: number, ray: THREE.Ray) => {
      const brick = bricks.find((b) => b.id === idValue);
      const point = dragPlanePoint(ray, brick?.position[1] ?? 0);
      if (!brick || !point) return;
      ignorePlace.current = true;
      dragOffset.current = {
        x: brick.position[0] - point.x,
        z: brick.position[2] - point.z
      };
      dragOrigin.current = cloneBricks([brick])[0];
      dragActive.current = false;
      setSelectedId(idValue);
      setDraggingId(idValue);
    },
    [bricks]
  );

  const moveDragging = useCallback(
    (ray: THREE.Ray) => {
      if (draggingId === null) return;
      const origin = dragOrigin.current;
      const point = dragPlanePoint(ray, origin?.position[1] ?? 0);
      if (!point || !origin) return;
      const rawX = point.x + dragOffset.current.x;
      const rawZ = point.z + dragOffset.current.z;
      if (
        !dragActive.current &&
        Math.hypot(rawX - origin.position[0], rawZ - origin.position[2]) <
          DRAG_THRESHOLD
      ) {
        return;
      }
      dragActive.current = true;
      setBricks((current) => {
        const brick = current.find((b) => b.id === draggingId);
        if (!brick) return current;
        const moved = snapXZ({
          ...brick,
          position: [rawX, brick.position[1], rawZ]
        });
        const others = current.filter((b) => b.id !== draggingId);
        if (!canPlace(moved, others, true)) return current;
        return [...others, moved];
      });
    },
    [draggingId]
  );

  const endDragging = useCallback(() => {
    if (draggingId !== null && dragActive.current && dragOrigin.current) {
      const origin = dragOrigin.current;
      setBricks((current) => {
        const brick = current.find((b) => b.id === draggingId);
        if (!brick) return current;
        const others = current.filter((b) => b.id !== draggingId);
        const snapped = snapXZ(brick);
        if (!canPlace(snapped, others, sculptMode)) {
          notify("DROP BLOCKED");
          return current.map((b) => (b.id === origin.id ? origin : b));
        }
        setHistory((h) => [
          ...h.slice(-(HISTORY_LIMIT - 1)),
          cloneBricks(current.map((b) => (b.id === origin.id ? origin : b)))
        ]);
        setFuture([]);
        const next = [...others, snapped];
        return sculptMode ? next : settle(next);
      });
    }
    dragActive.current = false;
    dragOrigin.current = null;
    setDraggingId(null);
    window.setTimeout(() => {
      ignorePlace.current = false;
    }, 180);
  }, [draggingId, notify, sculptMode]);

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

      if (e.key === " ") {
        e.preventDefault();
        placeGhost();
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
  }, [
    duplicateSelected,
    moveSelected,
    nudgeLayer,
    placeGhost,
    redo,
    removeSelected,
    rotateSelected,
    undo
  ]);

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
          <button onClick={undo} disabled={!history.length} aria-label="Undo">
            <Undo2 size={15} />
          </button>
          <button onClick={redo} disabled={!future.length} aria-label="Redo">
            <Redo2 size={15} />
          </button>
          <button className="primaryButton" onClick={openSave}>
            SAVE
          </button>
        </div>
      </header>

      <div
        className="builderBody"
        style={{ gridTemplateColumns: `${panelOpen ? 236 : 52}px 1fr 228px` }}
      >
        <aside className={`brickPanel ${panelOpen ? "" : "panelCollapsed"}`}>
          <div className="panelHeaderRow">
            {panelOpen && <p className="panelLabel">PARTS</p>}
            <button className="collapseBtn" onClick={() => setPanelOpen((v) => !v)}>
              {panelOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
            </button>
          </div>
          {panelOpen && (
            <>
              <p className="category">VOXELS & BRICKS</p>
              <div className="brickPalette">
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
              <div className="brickPalette">
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
            onSelect={selectBrick}
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
          <div className="sceneHud">
            <span className="hudChip">
              {sculptMode ? "SCULPT" : "GRAVITY"} · {kind.toUpperCase()}
            </span>
            <span className="hudHelp">
              CLICK SELECT · GROUND / SPACE PLACE · DEL DELETE
            </span>
          </div>
        </section>

        <aside className="inspector">
          <p className="panelLabel">INSPECTOR</p>
          <button
            className={gridVisible ? "modeOn" : ""}
            onClick={() => setGridVisible((v) => !v)}
          >
            GRID {gridVisible ? "ON" : "OFF"}
          </button>
          <button
            className={sculptMode ? "modeOn" : ""}
            onClick={() => setSculptMode((v) => !v)}
          >
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
            <p className="hint">
              Click a piece to select. Click empty ground or press Space to
              place.
            </p>
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
