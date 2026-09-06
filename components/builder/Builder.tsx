"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import {
  applyCells,
  boxCells,
  brushCells,
  cellKey,
  clonePalette,
  floodCells,
  hollowCells,
  History,
  loadDraft,
  MAX_SAFE,
  projectFromVolume,
  saveDraft,
  selectionClipboard,
  SIZES,
  volumeCenter,
  VoxelVolume,
  type BoxMode,
  type Cell,
  type ClipboardVoxel,
  type DraftV1,
  type Delta,
  type Mirror,
  type Tool,
  type ViewMode
} from "@/lib/voxelEngine";
import {
  downloadBytes,
  downloadText,
  exportObj,
  exportVox,
  importVox
} from "@/lib/voxelExport";
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

function CameraRig({ view, size }: { view: ViewMode; size: number }) {
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
  onHit,
  onHover
}: {
  size: number;
  onHit: (hit: VoxelHit, ev: ThreeEvent<PointerEvent>) => void;
  onHover: (hit: VoxelHit | null) => void;
}) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[(size - 1) / 2, -0.5, (size - 1) / 2]}
      onPointerDown={(e) => {
        e.stopPropagation();
        onHit(
          {
            kind: "empty",
            cell: {
              x: Math.round(e.point.x),
              y: 0,
              z: Math.round(e.point.z)
            }
          },
          e
        );
      }}
      onPointerMove={(e) => {
        onHover({
          kind: "empty",
          cell: {
            x: Math.round(e.point.x),
            y: 0,
            z: Math.round(e.point.z)
          }
        });
      }}
    >
      <planeGeometry args={[size + 8, size + 8]} />
      <shadowMaterial opacity={0.22} />
    </mesh>
  );
}

function Ghost({
  cell,
  color,
  valid
}: {
  cell: Cell;
  color: string;
  valid: boolean;
}) {
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

function BoxPreview({ a, b }: { a: Cell; b: Cell }) {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const z0 = Math.min(a.z, b.z);
  const sx = Math.abs(a.x - b.x) + 1;
  const sy = Math.abs(a.y - b.y) + 1;
  const sz = Math.abs(a.z - b.z) + 1;
  return (
    <mesh
      position={[x0 + (sx - 1) / 2, y0 + (sy - 1) / 2, z0 + (sz - 1) / 2]}
      raycast={() => {}}
    >
      <boxGeometry args={[sx, sy, sz]} />
      <meshBasicMaterial color="#a78bfa" wireframe transparent opacity={0.85} />
    </mesh>
  );
}

function OffsetGhost({
  items,
  origin
}: {
  items: { dx: number; dy: number; dz: number }[];
  origin: Cell;
}) {
  return (
    <group raycast={() => {}}>
      {items.slice(0, 800).map((item, i) => (
        <mesh
          key={i}
          position={[origin.x + item.dx, origin.y + item.dy, origin.z + item.dz]}
        >
          <boxGeometry args={[1.02, 1.02, 1.02]} />
          <meshBasicMaterial color="#e9d5ff" wireframe transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function VolumeFrame({ size }: { size: number }) {
  const points = useMemo(() => {
    const s = size - 1;
    return [
      0, 0, 0, s, 0, 0, s, 0, s, 0, 0, s, 0, 0, 0, 0, s, 0, s, s, 0, s, s, s, 0,
      s, s, 0, s, 0, s, s, 0, s, 0, 0, s, 0, s, s, s, s, 0, s, s, 0, 0, s
    ];
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
  const strokeRef = useRef<{ seen: Set<string>; deltas: Delta[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [rev, setRev] = useState(0);
  const [title, setTitle] = useState("UNTITLED");
  const [tool, setTool] = useState<Tool>("attach");
  const [boxMode, setBoxMode] = useState<BoxMode>("fill");
  const [boxStart, setBoxStart] = useState<Cell | null>(null);
  const [brush, setBrush] = useState(1);
  const [color, setColor] = useState(6);
  const [palette, setPalette] = useState(() => clonePalette());
  const [mirror, setMirror] = useState<Mirror>({ x: false, y: false, z: false });
  const [view, setView] = useState<ViewMode>("iso");
  const [grid, setGrid] = useState(true);
  const [hover, setHover] = useState<VoxelHit | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<ClipboardVoxel[]>([]);
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
      applyCells(v, [{ x: mid, y: 0, z: mid }], 6, {
        x: false,
        y: false,
        z: false
      });
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
      saveDraft(projectFromVolume(title, volumeRef.current, palette));
    }, 250);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [title, palette, rev]);

  const applyNow = useCallback(
    (cells: Cell[], nextColor: number | null, recordStroke: boolean) => {
      if (volumeRef.current.count > MAX_SAFE && nextColor !== null) {
        notify("PERFORMANCE LIMIT");
        return;
      }
      const deltas = applyCells(volumeRef.current, cells, nextColor, mirror);
      if (recordStroke && strokeRef.current) strokeRef.current.deltas.push(...deltas);
      else historyRef.current.push(deltas);
      bump();
    },
    [bump, mirror, notify]
  );

  const beginStroke = useCallback(() => {
    if (!strokeRef.current) strokeRef.current = { seen: new Set(), deltas: [] };
  }, []);

  const endStroke = useCallback(() => {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    if (stroke?.deltas.length) historyRef.current.push(stroke.deltas);
    bump();
  }, [bump]);

  const applyHit = useCallback(
    (hit: VoxelHit, additive: boolean) => {
      const cell = targetCell(hit, tool);

      if (tool === "eyedrop") {
        if (hit.kind === "voxel") {
          setColor(
            volumeRef.current.get(hit.cell.x, hit.cell.y, hit.cell.z) ?? color
          );
        }
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
        if (!boxStart) {
          setBoxStart(cell);
          notify("BOX START");
          return;
        }
        const cells = boxCells(boxStart, cell);
        setBoxStart(null);
        if (boxMode === "select") {
          setSelected(
            new Set(
              cells
                .filter((c) => volumeRef.current.has(c.x, c.y, c.z))
                .map(cellKey)
            )
          );
          return;
        }
        applyNow(cells, boxMode === "erase" ? null : color, false);
        return;
      }

      if (tool === "fill") {
        if (hit.kind !== "voxel") return;
        applyNow(floodCells(volumeRef.current, hit.cell), color, false);
        return;
      }

      beginStroke();
      const patch = brush > 1 ? brushCells(cell, brush) : [cell];
      const fresh = patch.filter((c) => {
        const key = cellKey(c);
        if (strokeRef.current?.seen.has(key)) return false;
        strokeRef.current?.seen.add(key);
        return true;
      });
      if (!fresh.length) return;

      if (tool === "erase") {
        applyNow(fresh, null, true);
        return;
      }
      if (tool === "paint") {
        if (hit.kind !== "voxel") return;
        applyNow(fresh, color, true);
        return;
      }
      applyNow(fresh, color, true);
    },
    [applyNow, beginStroke, boxMode, boxStart, brush, color, notify, tool]
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
      if (tool === "box" || tool === "fill" || tool === "select" || tool === "eyedrop")
        return;
      applyHit(hit, false);
    },
    [applyHit, tool]
  );

  useEffect(() => {
    const up = () => endStroke();
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [endStroke]);

  const undo = useCallback(() => {
    historyRef.current.undo(volumeRef.current);
    bump();
  }, [bump]);

  const redo = useCallback(() => {
    historyRef.current.redo(volumeRef.current);
    bump();
  }, [bump]);

  const clearAll = useCallback(() => {
    applyNow(
      volumeRef.current.voxels().map((v) => ({ x: v.x, y: v.y, z: v.z })),
      null,
      false
    );
    setSelected(new Set());
    setBoxStart(null);
  }, [applyNow]);

  const resize = useCallback(
    (size: number) => {
      volumeRef.current.resize(size);
      historyRef.current.reset();
      setSelected(new Set());
      setBoxStart(null);
      bump();
    },
    [bump]
  );

  const selectedCells = useCallback(
    () =>
      [...selected].map((key) => {
        const [x, y, z] = key.split(":").map(Number);
        return { x, y, z };
      }),
    [selected]
  );

  const deleteSelected = useCallback(() => {
    applyNow(selectedCells(), null, false);
    setSelected(new Set());
  }, [applyNow, selectedCells]);

  const paintSelected = useCallback(() => {
    applyNow(selectedCells(), color, false);
  }, [applyNow, color, selectedCells]);

  const copySelected = useCallback(() => {
    const clip = selectionClipboard(volumeRef.current, selected);
    setClipboard(clip);
    notify(clip.length ? `COPIED ${clip.length}` : "NOTHING SELECTED");
  }, [notify, selected]);

  const pasteClipboard = useCallback(
    (origin?: Cell) => {
      if (!clipboard.length) return;
      const base =
        origin ??
        ghost ?? {
          x: Math.floor(volume.size / 2),
          y: 0,
          z: Math.floor(volume.size / 2)
        };
      const cells = clipboard.map((v) => ({
        x: base.x + v.dx,
        y: base.y + v.dy,
        z: base.z + v.dz
      }));
      const deltas: Delta[] = [];
      clipboard.forEach((v, i) => {
        deltas.push(...applyCells(volumeRef.current, [cells[i]], v.c, mirror));
      });
      historyRef.current.push(deltas);
      setSelected(new Set(cells.map(cellKey)));
      bump();
    },
    [bump, clipboard, ghost, mirror, volume.size]
  );

  const duplicateSelected = useCallback(() => {
    const clip = selectionClipboard(volumeRef.current, selected);
    if (!clip.length) return;
    setClipboard(clip);
    const cells = selectedCells();
    const minX = Math.min(...cells.map((c) => c.x));
    const minY = Math.min(...cells.map((c) => c.y));
    const minZ = Math.min(...cells.map((c) => c.z));
    pasteClipboard({ x: minX + 1, y: minY, z: minZ });
  }, [pasteClipboard, selected, selectedCells]);

  const moveSelected = useCallback(
    (dx: number, dy: number, dz: number) => {
      const v = volumeRef.current;
      const items = selectedCells().map((cell) => ({
        ...cell,
        c: v.get(cell.x, cell.y, cell.z) ?? color
      }));
      const deltas = [
        ...applyCells(v, items, null, { x: false, y: false, z: false }),
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
          items.map((item) =>
            cellKey({ x: item.x + dx, y: item.y + dy, z: item.z + dz })
          )
        )
      );
      bump();
    },
    [bump, color, selectedCells]
  );

  const exportFiles = useCallback(
    (kind: "vox" | "obj" | "json") => {
      const name = (title.trim() || "untitled").toLowerCase().replace(/\s+/g, "-");
      if (kind === "json") {
        downloadText(
          JSON.stringify(projectFromVolume(title, volumeRef.current, palette), null, 2),
          `${name}.json`,
          "application/json"
        );
        return;
      }
      if (kind === "vox") {
        downloadBytes(
          exportVox(volumeRef.current, palette),
          `${name}.vox`,
          "application/octet-stream"
        );
        return;
      }
      const { obj, mtl } = exportObj(volumeRef.current, palette);
      downloadText(obj, `${name}.obj`, "text/plain");
      downloadText(mtl, `${name}.mtl`, "text/plain");
    },
    [palette, title]
  );

  const openProject = useCallback(
    async (file: File) => {
      try {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".vox")) {
          const model = importVox(await file.arrayBuffer());
          volumeRef.current.load({ size: model.size, voxels: model.voxels });
          setPalette(clonePalette(model.palette));
          setTitle(file.name.replace(/\.vox$/i, ""));
        } else {
          const parsed = JSON.parse(await file.text()) as DraftV1;
          if (!Array.isArray(parsed.voxels)) throw new Error("Invalid project");
          volumeRef.current.load(parsed);
          setTitle(parsed.title || file.name.replace(/\.json$/i, ""));
          if (parsed.palette?.length) setPalette(clonePalette(parsed.palette));
        }
        historyRef.current.reset();
        setSelected(new Set());
        setBoxStart(null);
        bump();
        notify("PROJECT LOADED");
      } catch {
        notify("OPEN FAILED");
      }
    },
    [bump, notify]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        e.preventDefault();
        setBoxStart(null);
        setSelected(new Set());
        strokeRef.current = null;
        return;
      }
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && k === "c") {
        e.preventDefault();
        copySelected();
        return;
      }
      if (mod && k === "v") {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (mod && k === "d") {
        e.preventDefault();
        duplicateSelected();
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
      if (k === "y" && !mod) setMirror((m) => ({ ...m, y: !m.y }));
      if (k === "z" && !mod) setMirror((m) => ({ ...m, z: !m.z }));
      if (k === "[" ) setBrush((n) => Math.max(1, n - 1));
      if (k === "]") setBrush((n) => Math.min(5, n + 1));
      if (k === "delete" || k === "backspace") deleteSelected();
      if (e.key === "ArrowLeft") moveSelected(-1, 0, 0);
      if (e.key === "ArrowRight") moveSelected(1, 0, 0);
      if (e.key === "ArrowUp")
        moveSelected(0, e.shiftKey ? 1 : 0, e.shiftKey ? 0 : -1);
      if (e.key === "ArrowDown")
        moveSelected(0, e.shiftKey ? -1 : 0, e.shiftKey ? 0 : 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    copySelected,
    deleteSelected,
    duplicateSelected,
    moveSelected,
    pasteClipboard,
    redo,
    undo
  ]);

  const [cx, , cz] = volumeCenter(volume.size);
  const ghostValid = !ghost
    ? false
    : tool === "erase" ||
        tool === "paint" ||
        tool === "fill" ||
        tool === "select" ||
        tool === "eyedrop"
      ? volume.has(ghost.x, ghost.y, ghost.z)
      : volume.inBounds(ghost.x, ghost.y, ghost.z) &&
        !volume.has(ghost.x, ghost.y, ghost.z);

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
          <button onClick={undo} disabled={!canUndo}>
            UNDO
          </button>
          <button onClick={redo} disabled={!canRedo}>
            REDO
          </button>
          <button onClick={() => fileRef.current?.click()}>OPEN</button>
          <button onClick={() => exportFiles("json")}>PROJECT</button>
          <button onClick={() => exportFiles("vox")}>VOX</button>
          <button onClick={() => exportFiles("obj")}>OBJ</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.vox,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void openProject(file);
              e.target.value = "";
            }}
          />
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
          <p className="category">BRUSH {brush}</p>
          <div className="viewRow">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={brush === n ? "modeOn" : ""}
                onClick={() => setBrush(n)}
              >
                {n}
              </button>
            ))}
          </div>
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
          <button onClick={() => applyNow(hollowCells(volumeRef.current), null, false)}>
            HOLLOW
          </button>
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
            <Ground size={volume.size} onHit={onHit} onHover={onHover} />
            <VolumeFrame size={volume.size} />
            <VoxelCloud
              volume={volume}
              palette={palette}
              revision={rev}
              selected={selected}
              onHit={onHit}
              onHover={onHover}
            />
            {ghost && tool !== "box" && (tool === "attach" || brush > 1) && (
              <Ghost
                cell={ghost}
                color={palette[color]}
                valid={ghostValid || tool !== "attach"}
              />
            )}
            {tool === "box" && boxStart && ghost && (
              <BoxPreview a={boxStart} b={ghost} />
            )}
            {tool !== "box" && clipboard.length > 0 && ghost && (
              <OffsetGhost items={clipboard} origin={ghost} />
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
              {tool.toUpperCase()} · BRUSH {brush} · {count} VX · {volume.size}³
              {boxStart ? " · BOX…" : ""}
            </span>
            <span className="hudHelp">
              LMB STROKE · RMB ORBIT · ESC CANCEL · ⌘C/V/D · OPEN VOX/JSON
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
            {selected.size
              ? `${selected.size} SELECTED`
              : ghost
                ? `${ghost.x},${ghost.y},${ghost.z}`
                : "NO HIT"}
          </p>
          {selected.size > 0 && (
            <>
              <button onClick={copySelected}>COPY</button>
              <button onClick={duplicateSelected}>DUPLICATE</button>
              <button onClick={paintSelected}>PAINT SEL</button>
              <button onClick={deleteSelected}>DELETE SEL</button>
            </>
          )}
          {clipboard.length > 0 && (
            <button onClick={() => pasteClipboard()}>PASTE {clipboard.length}</button>
          )}
        </aside>
      </div>
    </main>
  );
}
