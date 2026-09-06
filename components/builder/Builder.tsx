"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import Link from "next/link";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import {
  applyCells,
  boxCells,
  cellKey,
  clonePalette,
  floodCells,
  hollowCells,
  History,
  loadDraft,
  MAX_SAFE,
  SIZES,
  saveDraft,
  volumeCenter,
  VoxelVolume,
  type BoxMode,
  type Cell,
  type DraftV1,
  type Mirror,
  type Tool,
  type ViewMode
} from "@/lib/voxelEngine";
import { downloadBytes, downloadText, exportObj, exportVox } from "@/lib/voxelExport";
import { VoxelCloud, type VoxelHit } from "@/components/builder/VoxelCloud";
import "./builder.css";

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "attach", label: "ATTACH", key: "B" },
  { id: "erase", label: "ERASE", key: "E" },
  { id: "paint", label: "PAINT", key: "P" },
  { id: "fill", label: "FILL", key: "G" },
  { id: "eyedrop", label: "PICK", key: "I" },
  { id: "select", label: "SELECT", key: "Q" },
  { id: "box", label: "BOX", key: "U" }
];

function CameraRig({
  view,
  size
}: {
  view: ViewMode;
  size: number;
}) {
  const { camera } = useThree();
  useEffect(() => {
    const [cx, cy, cz] = volumeCenter(size);
    const dist = size * 1.35;
    if (view === "top") camera.position.set(cx, dist, cz + 0.01);
    else if (view === "front") camera.position.set(cx, cy + size * 0.2, cz + dist);
    else if (view === "side") camera.position.set(cx + dist, cy + size * 0.2, cz);
    else camera.position.set(cx + dist * 0.7, cy + dist * 0.55, cz + dist * 0.7);
    camera.lookAt(cx, cy, cz);
    camera.updateProjectionMatrix();
  }, [camera, size, view]);
  return null;
}

function Ground({
  size,
  tool,
  onHit,
  onHover
}: {
  size: number;
  tool: Tool;
  onHit: (hit: VoxelHit, ev: ThreeEvent<PointerEvent>) => void;
  onHover: (hit: VoxelHit | null) => void;
}) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[(size - 1) / 2, -0.5, (size - 1) / 2]}
      onPointerDown={(e) => {
        e.stopPropagation();
        const cell = {
          x: Math.round(e.point.x),
          y: 0,
          z: Math.round(e.point.z)
        };
        onHit({ kind: "empty", cell }, e);
      }}
      onPointerMove={(e) => {
        const cell = {
          x: Math.round(e.point.x),
          y: tool === "attach" ? 0 : 0,
          z: Math.round(e.point.z)
        };
        onHover({ kind: "empty", cell });
      }}
    >
      <planeGeometry args={[size + 8, size + 8]} />
      <shadowMaterial opacity={0.22} />
    </mesh>
  );
}

function Ghost({ cell, color, valid }: { cell: Cell; color: string; valid: boolean }) {
  return (
    <mesh position={[cell.x, cell.y, cell.z]} raycast={() => {}}>
      <boxGeometry args={[0.98, 0.98, 0.98]} />
      <meshBasicMaterial
        color={valid ? color : "#ff3347"}
        transparent
        opacity={0.38}
        depthWrite={false}
      />
    </mesh>
  );
}

function VolumeFrame({ size }: { size: number }) {
  const points = useMemo(() => {
    const s = size - 1;
    const p = [
      [0, 0, 0], [s, 0, 0], [s, 0, s], [0, 0, s], [0, 0, 0],
      [0, s, 0], [s, s, 0], [s, s, s], [0, s, s], [0, s, 0],
      [s, s, 0], [s, 0, 0], [s, 0, s], [s, s, s], [0, s, s], [0, 0, s]
    ] as [number, number, number][];
    return p.flat();
  }, [size]);

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[new Float32Array(points), 3]}
        />
      </bufferGeometry>
      <lineBasicMaterial color="#334155" />
    </line>
  );
}

function targetCell(hit: VoxelHit, tool: Tool): Cell {
  if (hit.kind === "empty") return hit.cell;
  if (tool === "attach") return hit.place;
  return hit.cell;
}

export default function Builder() {
  const volumeRef = useRef(new VoxelVolume(64));
  const historyRef = useRef(new History());
  const strokeRef = useRef<{ cells: Set<string> } | null>(null);
  const boxStartRef = useRef<Cell | null>(null);

  const [rev, setRev] = useState(0);
  const [title, setTitle] = useState("UNTITLED");
  const [tool, setTool] = useState<Tool>("attach");
  const [boxMode, setBoxMode] = useState<BoxMode>("fill");
  const [color, setColor] = useState(6);
  const [palette, setPalette] = useState(() => clonePalette());
  const [mirror, setMirror] = useState<Mirror>({ x: false, y: false, z: false });
  const [view, setView] = useState<ViewMode>("iso");
  const [grid, setGrid] = useState(true);
  const [hover, setHover] = useState<VoxelHit | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const bump = useCallback(() => {
    setRev((n) => n + 1);
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
  }, []);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1400);
  }, []);

  const volume = volumeRef.current;
  const count = volume.count;
  const ghost = hover ? targetCell(hover, tool) : null;

  useEffect(() => {
    const draft = loadDraft();
    if (!draft) {
      const v = volumeRef.current;
      const mid = Math.floor(v.size / 2);
      applyCells(v, [{ x: mid, y: 0, z: mid }], 6, { x: false, y: false, z: false });
      bump();
      return;
    }
    volumeRef.current.load(draft);
    setTitle(draft.title || "UNTITLED");
    if (draft.palette?.length) setPalette(clonePalette(draft.palette));
    bump();
  }, [bump]);

  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const draft: DraftV1 = {
        v: 1,
        title,
        size: volumeRef.current.size,
        palette,
        voxels: volumeRef.current.voxels()
      };
      saveDraft(draft);
    }, 250);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [title, palette, rev]);

  const commitStroke = useCallback(
    (cells: Cell[], nextColor: number | null) => {
      if (volumeRef.current.count > MAX_SAFE && nextColor !== null) {
        notify("PERFORMANCE LIMIT");
        return;
      }
      const deltas = applyCells(volumeRef.current, cells, nextColor, mirror);
      historyRef.current.push(deltas);
      bump();
    },
    [bump, mirror, notify]
  );

  const applyHit = useCallback(
    (hit: VoxelHit, additive: boolean) => {
      const cell = targetCell(hit, tool);

      if (tool === "eyedrop") {
        if (hit.kind === "voxel") setColor(volumeRef.current.get(hit.cell.x, hit.cell.y, hit.cell.z) ?? color);
        return;
      }

      if (tool === "select") {
        const key = cellKey(hit.kind === "voxel" ? hit.cell : cell);
        setSelected((cur) => {
          const next = new Set(additive ? cur : []);
          if (next.has(key)) next.delete(key);
          else if (hit.kind === "voxel") next.add(key);
          return next;
        });
        return;
      }

      if (tool === "box") {
        if (!boxStartRef.current) {
          boxStartRef.current = cell;
          notify("BOX START");
          return;
        }
        const cells = boxCells(boxStartRef.current, cell);
        boxStartRef.current = null;
        if (boxMode === "select") {
          setSelected(new Set(cells.filter((c) => volumeRef.current.has(c.x, c.y, c.z)).map(cellKey)));
          return;
        }
        commitStroke(cells, boxMode === "erase" ? null : color);
        return;
      }

      if (tool === "fill") {
        if (hit.kind !== "voxel") return;
        commitStroke(floodCells(volumeRef.current, hit.cell), color);
        return;
      }

      const key = cellKey(cell);
      if (strokeRef.current?.cells.has(key)) return;
      if (!strokeRef.current) strokeRef.current = { cells: new Set() };
      strokeRef.current.cells.add(key);

      if (tool === "erase") {
        if (hit.kind !== "voxel" && !volumeRef.current.has(cell.x, cell.y, cell.z)) return;
        commitStroke([hit.kind === "voxel" ? hit.cell : cell], null);
        return;
      }
      if (tool === "paint") {
        if (hit.kind !== "voxel") return;
        commitStroke([hit.cell], color);
        return;
      }
      commitStroke([cell], color);
    },
    [boxMode, color, commitStroke, notify, tool]
  );

  const onHit = useCallback(
    (hit: VoxelHit, ev: ThreeEvent<PointerEvent>) => {
      if (ev.button !== 0) return;
      applyHit(hit, ev.shiftKey);
    },
    [applyHit]
  );

  const onHover = useCallback(
    (hit: VoxelHit | null) => {
      setHover(hit);
      if (!hit || !strokeRef.current) return;
      if (tool === "box" || tool === "fill" || tool === "select" || tool === "eyedrop") return;
      applyHit(hit, false);
    },
    [applyHit, tool]
  );

  useEffect(() => {
    const up = () => {
      strokeRef.current = null;
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const undo = useCallback(() => {
    historyRef.current.undo(volumeRef.current);
    bump();
  }, [bump]);

  const redo = useCallback(() => {
    historyRef.current.redo(volumeRef.current);
    bump();
  }, [bump]);

  const clearAll = useCallback(() => {
    const cells = volumeRef.current.voxels().map((v) => ({ x: v.x, y: v.y, z: v.z }));
    commitStroke(cells, null);
    setSelected(new Set());
  }, [commitStroke]);

  const resize = useCallback(
    (size: number) => {
      volumeRef.current.resize(size);
      historyRef.current.reset();
      setSelected(new Set());
      bump();
    },
    [bump]
  );

  const hollow = useCallback(() => {
    commitStroke(hollowCells(volumeRef.current), null);
  }, [commitStroke]);

  const deleteSelected = useCallback(() => {
    const cells = [...selected].map((key) => {
      const [x, y, z] = key.split(":").map(Number);
      return { x, y, z };
    });
    commitStroke(cells, null);
    setSelected(new Set());
  }, [commitStroke, selected]);

  const paintSelected = useCallback(() => {
    const cells = [...selected].map((key) => {
      const [x, y, z] = key.split(":").map(Number);
      return { x, y, z };
    });
    commitStroke(cells, color);
  }, [color, commitStroke, selected]);

  const moveSelected = useCallback(
    (dx: number, dy: number, dz: number) => {
      const v = volumeRef.current;
      const items = [...selected].map((key) => {
        const [x, y, z] = key.split(":").map(Number);
        return { x, y, z, c: v.get(x, y, z) ?? color };
      });
      const deltas = [
        ...applyCells(
          v,
          items.map(({ x, y, z }) => ({ x, y, z })),
          null,
          { x: false, y: false, z: false }
        ),
        ...items.flatMap((item) =>
          applyCells(
            v,
            [{ x: item.x + dx, y: item.y + dy, z: item.z + dz }],
            item.c,
            { x: false, y: false, z: false }
          )
        )
      ];
      historyRef.current.push(deltas);
      setSelected(
        new Set(
          items.map((item) => cellKey({ x: item.x + dx, y: item.y + dy, z: item.z + dz }))
        )
      );
      bump();
    },
    [bump, color, selected]
  );

  const exportFiles = useCallback(
    (kind: "vox" | "obj") => {
      const name = (title.trim() || "untitled").toLowerCase().replace(/\s+/g, "-");
      if (kind === "vox") {
        downloadBytes(exportVox(volumeRef.current, palette), `${name}.vox`, "application/octet-stream");
        return;
      }
      const { obj, mtl } = exportObj(volumeRef.current, palette);
      downloadText(obj, `${name}.obj`, "text/plain");
      downloadText(mtl, `${name}.mtl`, "text/plain");
    },
    [palette, title]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (k === "b") setTool("attach");
      if (k === "e") setTool("erase");
      if (k === "p") setTool("paint");
      if (k === "g") setTool("fill");
      if (k === "i") setTool("eyedrop");
      if (k === "q") setTool("select");
      if (k === "u") setTool("box");
      if (k === "x") setMirror((m) => ({ ...m, x: !m.x }));
      if (k === "y" && !(e.ctrlKey || e.metaKey)) setMirror((m) => ({ ...m, y: !m.y }));
      if (k === "z" && !(e.ctrlKey || e.metaKey)) setMirror((m) => ({ ...m, z: !m.z }));
      if (k === "delete" || k === "backspace") deleteSelected();
      if (e.key === "ArrowLeft") moveSelected(-1, 0, 0);
      if (e.key === "ArrowRight") moveSelected(1, 0, 0);
      if (e.key === "ArrowUp") moveSelected(e.shiftKey ? 0 : 0, e.shiftKey ? 1 : 0, e.shiftKey ? 0 : -1);
      if (e.key === "ArrowDown") moveSelected(0, e.shiftKey ? -1 : 0, e.shiftKey ? 0 : 1);
      if (k === "[") setColor((c) => (c + palette.length - 1) % 64);
      if (k === "]") setColor((c) => (c + 1) % 64);
      if (e.altKey) setTool("eyedrop");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deleteSelected, moveSelected, palette.length, redo, undo]);

  const [cx, , cz] = volumeCenter(volume.size);
  const ghostValid = !ghost
    ? false
    : tool === "erase" || tool === "paint" || tool === "fill" || tool === "select" || tool === "eyedrop"
      ? volume.has(ghost.x, ghost.y, ghost.z)
      : volume.inBounds(ghost.x, ghost.y, ghost.z) && !volume.has(ghost.x, ghost.y, ghost.z);

  return (
    <main className="builderShell">
      <header className="builderHeader">
        <div className="headerLeft">
          <Link href="/" className="brand">
            <span className="brandMark">◆</span> VOXEL
          </Link>
        </div>
        <div className="creationTitle">
          {editingTitle ? (
            <input
              autoFocus
              className="titleInput"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setEditingTitle(false);
              }}
            />
          ) : (
            <>
              <span>{title}</span>
              <button className="titleEditBtn" onClick={() => setEditingTitle(true)}>
                EDIT
              </button>
            </>
          )}
        </div>
        <div className="builderActions">
          <button onClick={undo} disabled={!canUndo}>UNDO</button>
          <button onClick={redo} disabled={!canRedo}>REDO</button>
          <button onClick={() => exportFiles("vox")}>VOX</button>
          <button onClick={() => exportFiles("obj")}>OBJ</button>
        </div>
      </header>

      <div className="builderBody voxelBody">
        <aside className="brickPanel">
          <p className="panelLabel">TOOLS</p>
          <div className="toolStack">
            {TOOLS.map((item) => (
              <button
                key={item.id}
                className={tool === item.id ? "modeOn" : ""}
                onClick={() => setTool(item.id)}
              >
                {item.label}
                <small>{item.key}</small>
              </button>
            ))}
          </div>
          {tool === "box" && (
            <div className="viewRow">
              {(["fill", "erase", "select"] as BoxMode[]).map((mode) => (
                <button
                  key={mode}
                  className={boxMode === mode ? "modeOn" : ""}
                  onClick={() => setBoxMode(mode)}
                >
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <p className="category">MIRROR</p>
          <div className="viewRow">
            {(["x", "y", "z"] as const).map((axis) => (
              <button
                key={axis}
                className={mirror[axis] ? "modeOn" : ""}
                onClick={() => setMirror((m) => ({ ...m, [axis]: !m[axis] }))}
              >
                {axis.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="category">VOLUME</p>
          <div className="viewRow">
            {SIZES.map((size) => (
              <button
                key={size}
                className={volume.size === size ? "modeOn" : ""}
                onClick={() => resize(size)}
              >
                {size}
              </button>
            ))}
          </div>
          <button onClick={hollow}>HOLLOW</button>
          <button onClick={clearAll}>CLEAR</button>
        </aside>

        <section className="viewport">
          <Canvas
            key={view === "iso" ? "persp" : `ortho-${view}`}
            shadows
            dpr={[1, 1.75]}
            orthographic={view !== "iso"}
            camera={
              view === "iso"
                ? { position: [40, 28, 40], fov: 42, near: 0.1, far: 2000 }
                : { position: [40, 80, 40], zoom: 14, near: -2000, far: 2000 }
            }
          >
            <color attach="background" args={["#070a11"]} />
            <ambientLight intensity={0.72} />
            <hemisphereLight intensity={0.42} groundColor="#05070c" />
            <directionalLight position={[18, 32, 14]} intensity={2.6} castShadow />
            {grid && (
              <Grid
                args={[volume.size, volume.size]}
                position={[cx, -0.49, cz]}
                cellSize={1}
                cellThickness={0.55}
                cellColor="#273044"
                sectionSize={8}
                sectionThickness={1.1}
                sectionColor="#46516b"
                fadeDistance={volume.size * 2}
              />
            )}
            <Ground size={volume.size} tool={tool} onHit={onHit} onHover={onHover} />
            <VolumeFrame size={volume.size} />
            <VoxelCloud
              volume={volume}
              palette={palette}
              revision={rev}
              selected={selected}
              onHit={onHit}
              onHover={onHover}
            />
            {ghost && (tool === "attach" || tool === "box") && (
              <Ghost cell={ghost} color={palette[color]} valid={ghostValid || tool === "box"} />
            )}
            <CameraRig view={view} size={volume.size} />
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              target={volumeCenter(volume.size)}
              mouseButtons={{
                LEFT: undefined,
                MIDDLE: THREE.MOUSE.PAN,
                RIGHT: THREE.MOUSE.ROTATE
              }}
              enableRotate={view === "iso"}
              minDistance={4}
              maxDistance={volume.size * 4}
            />
          </Canvas>
          <div className="sceneHud">
            <span className="hudChip">
              {tool.toUpperCase()} · {count} VX · {volume.size}³
              {mirror.x || mirror.y || mirror.z
                ? ` · M ${[mirror.x ? "X" : "", mirror.y ? "Y" : "", mirror.z ? "Z" : ""].join("")}`
                : ""}
            </span>
            <span className="hudHelp">
              LMB SCULPT · RMB ORBIT · MMB PAN · ALT PICK · X/Y/Z MIRROR
            </span>
          </div>
          {toast && <div className="toast">{toast}</div>}
        </section>

        <aside className="inspector">
          <p className="panelLabel">INSPECTOR</p>
          <div className="viewRow">
            {(["iso", "top", "front", "side"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                className={view === mode ? "modeOn" : ""}
                onClick={() => setView(mode)}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
          <button className={grid ? "modeOn" : ""} onClick={() => setGrid((g) => !g)}>
            GRID {grid ? "ON" : "OFF"}
          </button>
          <p className="category">PALETTE</p>
          <div className="colorRow dense">
            {palette.slice(0, 64).map((hex, i) => (
              <button
                key={`${hex}-${i}`}
                className={`swatch ${color === i ? "swatchOn" : ""}`}
                style={{ background: hex }}
                onClick={() => setColor(i)}
              />
            ))}
          </div>
          <input
            type="color"
            value={palette[color]}
            onChange={(e) => {
              const next = palette.slice();
              next[color] = e.target.value;
              setPalette(next);
            }}
          />
          <p className="hint">
            {selected.size ? `${selected.size} SELECTED` : ghost ? `${ghost.x},${ghost.y},${ghost.z}` : "NO HIT"}
          </p>
          {selected.size > 0 && (
            <>
              <button onClick={paintSelected}>PAINT SEL</button>
              <button onClick={deleteSelected}>DELETE SEL</button>
            </>
          )}
          {count > 80_000 && <p className="hint">Heavy mesh. Export still ok.</p>}
        </aside>
      </div>
    </main>
  );
}
