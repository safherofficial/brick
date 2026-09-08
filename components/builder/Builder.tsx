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
  exportObjArchive,
  exportVox,
  importVox
} from "@/lib/voxelExport";
import { exportGlb } from "@/lib/voxelGlb";
import {
  imageToVoxels,
  type ImageImport,
  type ImageMode
} from "@/lib/imageVoxel";
import { VoxelCloud, type Clip, type VoxelHit } from "@/components/builder/VoxelCloud";
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

const FREE_IMAGE_APPLIES = 5;
const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
const ENTITLEMENT_KEY = "brick.entitlement.v1";

type EntitlementState = {
  accountId: string;
  plan: "free" | "monthly";
  applies: { hash: string; at: number }[];
};

type ContentBounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

function emptyEntitlement(): EntitlementState {
  const accountId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `acc_${Date.now().toString(36)}`;
  return { accountId, plan: "free", applies: [] };
}

function readEntitlement(): EntitlementState {
  if (typeof window === "undefined") return emptyEntitlement();
  try {
    const raw = window.localStorage.getItem(ENTITLEMENT_KEY);
    if (!raw) {
      const created = emptyEntitlement();
      window.localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(created));
      return created;
    }
    const parsed = JSON.parse(raw) as EntitlementState;
    if (!parsed.accountId || !Array.isArray(parsed.applies)) return emptyEntitlement();
    parsed.plan = parsed.plan === "monthly" ? "monthly" : "free";
    return parsed;
  } catch {
    return emptyEntitlement();
  }
}

function writeEntitlement(state: EntitlementState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(state));
}

function remainingApplies(state = readEntitlement()) {
  if (state.plan === "monthly") return Number.POSITIVE_INFINITY;
  const used = new Set(state.applies.map((item) => item.hash)).size;
  return Math.max(0, FREE_IMAGE_APPLIES - used);
}

async function hashImageFile(file: File) {
  const buffer = await file.arrayBuffer();
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function consumeImageApply(hash: string) {
  const state = readEntitlement();
  const now = Date.now();
  if (state.plan === "monthly") {
    return { ok: true, reason: "subscribed" as const, remaining: Infinity, message: "SUBSCRIBED" };
  }
  const recent = state.applies.find(
    (item) => item.hash === hash && now - item.at < REPEAT_WINDOW_MS
  );
  if (recent) {
    return {
      ok: true,
      reason: "repeat" as const,
      remaining: remainingApplies(state),
      message: "SAME IMAGE"
    };
  }
  const left = remainingApplies(state);
  if (left <= 0) {
    return { ok: false, reason: "blocked" as const, remaining: 0, message: "SUBSCRIBE TO APPLY" };
  }
  state.applies.push({ hash, at: now });
  writeEntitlement(state);
  return {
    ok: true,
    reason: "quota" as const,
    remaining: left - 1,
    message: `${left - 1} LEFT`
  };
}

function boundsOfCells(list: { x: number; y: number; z: number }[]): ContentBounds | null {
  if (!list.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of list) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    minZ = Math.min(minZ, v.z);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    maxZ = Math.max(maxZ, v.z);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function fitSizeFor(bounds: ContentBounds) {
  const span = Math.max(
    bounds.maxX - bounds.minX + 1,
    bounds.maxY - bounds.minY + 1,
    bounds.maxZ - bounds.minZ + 1
  );
  return (SIZES.find((n) => n >= span + 2) ?? 256) as number;
}

function CameraRig({
  view,
  size,
  focus
}: {
  view: ViewMode;
  size: number;
  focus: [number, number, number];
}) {
  const { camera } = useThree();
  useEffect(() => {
    const dist = Math.max(8, size * 0.9);
    const [cx, cy, cz] = focus;
    if (view === "top") camera.position.set(cx, dist, cz + 0.01);
    else if (view === "front") camera.position.set(cx, cy + size * 0.2, cz + dist);
    else if (view === "side") camera.position.set(cx + dist, cy + size * 0.2, cz);
    else camera.position.set(cx + dist * 0.75, cy + dist * 0.5, cz + dist * 0.75);
    camera.lookAt(cx, cy, cz);
    camera.updateProjectionMatrix();
  }, [camera, focus, size, view]);
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

function PendingPreview({
  voxels,
  palette
}: {
  voxels: { x: number; y: number; z: number; c: number }[];
  palette: string[];
}) {
  const shown = voxels.length > 2500 ? voxels.filter((_, i) => i % 3 === 0) : voxels;
  return (
    <group raycast={() => {}}>
      {shown.slice(0, 4000).map((v, i) => (
        <mesh key={i} position={[v.x, v.y, v.z]}>
          <boxGeometry args={[0.96, 0.96, 0.96]} />
          <meshBasicMaterial
            color={palette[v.c] ?? "#ffffff"}
            transparent
            opacity={0.55}
            depthWrite={false}
          />
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
  const [clip, setClip] = useState<Clip>({ axis: null, value: 63 });
  const [focus, setFocus] = useState<[number, number, number]>(() => volumeCenter(64));
  const [imageMode, setImageMode] = useState<ImageMode>("flat");
  const [imageHeight, setImageHeight] = useState(8);
  const [pendingImage, setPendingImage] = useState<ImageImport | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [pendingHash, setPendingHash] = useState("");
  const [creditsLeft, setCreditsLeft] = useState(FREE_IMAGE_APPLIES);
  const [paywall, setPaywall] = useState(false);
  const [busy, setBusy] = useState(false);
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
    window.setTimeout(() => setToast(""), 1600);
  }, []);

  const refreshCredits = useCallback(() => {
    setCreditsLeft(remainingApplies());
  }, []);

  const volume = volumeRef.current;
  const count = volume.count;
  const ghost = hover ? targetCell(hover, tool) : null;
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

  useEffect(() => {
    refreshCredits();
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
    setFocus(volumeCenter(draft.size || 64));
    bump();
  }, [bump, refreshCredits]);

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

  const packVolume = useCallback(() => {
    const v = volumeRef.current;
    const items = v.voxels();
    const bounds = boundsOfCells(items);
    if (!bounds) {
      setFocus(volumeCenter(v.size));
      return;
    }
    const next = fitSizeFor(bounds);
    const dx = 1 - bounds.minX;
    const dy = 0 - bounds.minY;
    const dz = 1 - bounds.minZ;
    const shifted = items.map((item) => ({
      x: item.x + dx,
      y: item.y + dy,
      z: item.z + dz,
      c: item.c
    }));
    v.resize(next);
    v.load({ size: next, voxels: shifted });
    const packed = boundsOfCells(shifted);
    setClip((c) => ({ ...c, value: Math.min(c.value, next - 1) }));
    if (packed) {
      setFocus([
        (packed.minX + packed.maxX) / 2,
        Math.max(0.5, (packed.minY + packed.maxY) / 2),
        (packed.minZ + packed.maxZ) / 2
      ]);
    } else {
      setFocus(volumeCenter(next));
    }
    bump();
  }, [bump]);

  const clearAll = useCallback(() => {
    applyNow(
      volumeRef.current.voxels().map((vx) => ({ x: vx.x, y: vx.y, z: vx.z })),
      null,
      false
    );
    setSelected(new Set());
    setBoxStart(null);
  }, [applyNow]);

  const resize = useCallback(
    (size: number) => {
      const v = volumeRef.current;
      if (size === v.size) return;
      const doomed = v
        .voxels()
        .filter((vx) => vx.x >= size || vx.y >= size || vx.z >= size)
        .map((vx) => ({ x: vx.x, y: vx.y, z: vx.z }));
      if (doomed.length) applyNow(doomed, null, false);
      v.resize(size);
      setClip((c) => ({ ...c, value: Math.min(c.value, size - 1) }));
      setFocus(volumeCenter(size));
      bump();
    },
    [applyNow, bump]
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
    const clipSel = selectionClipboard(volumeRef.current, selected);
    setClipboard(clipSel);
    notify(clipSel.length ? `COPIED ${clipSel.length}` : "NOTHING SELECTED");
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
      const cells = clipboard.map((item) => ({
        x: base.x + item.dx,
        y: base.y + item.dy,
        z: base.z + item.dz
      }));
      const deltas: Delta[] = [];
      clipboard.forEach((item, i) => {
        deltas.push(...applyCells(volumeRef.current, [cells[i]], item.c, mirror));
      });
      historyRef.current.push(deltas);
      setSelected(new Set(cells.map(cellKey)));
      bump();
    },
    [bump, clipboard, ghost, mirror, volume.size]
  );

  const duplicateSelected = useCallback(() => {
    const clipSel = selectionClipboard(volumeRef.current, selected);
    if (!clipSel.length) return;
    setClipboard(clipSel);
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
    async (kind: "vox" | "obj" | "json" | "glb") => {
      const name =
        (title.trim() || "untitled")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "untitled";
      const options = {
        name,
        unitMeters: 0.1,
        pivot: "bottom-center" as const,
        upAxis: "y" as const
      };
      try {
        if (kind === "json") {
          downloadText(
            JSON.stringify(projectFromVolume(title, volumeRef.current, palette), null, 2),
            `${name}.json`,
            "application/json"
          );
          notify("PROJECT READY");
          return;
        }
        if (kind === "vox") {
          downloadBytes(
            exportVox(volumeRef.current, palette),
            `${name}.vox`,
            "application/octet-stream"
          );
          notify("VOX READY");
          return;
        }
        if (kind === "glb") {
          notify("EXPORTING GLB");
          await new Promise((resolve) => window.setTimeout(resolve, 40));
          const bytes = await exportGlb(volumeRef.current, palette, options);
          downloadBytes(new Uint8Array(bytes), `${name}.glb`, "model/gltf-binary");
          notify("GLB READY");
          return;
        }
        notify("EXPORTING OBJ");
        await new Promise((resolve) => window.setTimeout(resolve, 40));
        downloadBytes(
          exportObjArchive(volumeRef.current, palette, options),
          `${name}-obj.zip`,
          "application/zip"
        );
        notify("OBJ READY");
      } catch (error) {
        notify(error instanceof Error ? error.message.toUpperCase() : "EXPORT FAILED");
      }
    },
    [notify, palette, title]
  );

  const cancelImage = useCallback(() => {
    setPendingImage(null);
    setPendingName("");
    setPendingHash("");
    setPaywall(false);
    notify("IMPORT CANCELED");
  }, [notify]);

  const applyImage = useCallback(() => {
    if (!pendingImage) return;
    const gate = consumeImageApply(pendingHash || pendingName || "unknown");
    refreshCredits();
    if (!gate.ok) {
      setPaywall(true);
      notify(gate.message);
      return;
    }
    const result = pendingImage;
    const bounds = boundsOfCells(result.voxels);
    const dx = bounds ? 1 - bounds.minX : 0;
    const dy = bounds ? 0 - bounds.minY : 0;
    const dz = bounds ? 1 - bounds.minZ : 0;
    const packed = result.voxels.map((vox) => ({
      x: vox.x + dx,
      y: vox.y + dy,
      z: vox.z + dz,
      c: vox.c
    }));
    const packedBounds = boundsOfCells(packed);
    const next = packedBounds ? fitSizeFor(packedBounds) : volumeRef.current.size;
    if (next !== volumeRef.current.size) volumeRef.current.resize(next);

    setPendingImage(null);
    setPendingHash("");
    setPaywall(false);
    setPalette(result.palette);
    const deltas: Delta[] = [];
    const existing = volumeRef.current.voxels().map((vx) => ({ x: vx.x, y: vx.y, z: vx.z }));
    if (existing.length) {
      deltas.push(
        ...applyCells(volumeRef.current, existing, null, {
          x: false,
          y: false,
          z: false
        })
      );
    }
    const byColor = new Map<number, Cell[]>();
    for (const vox of packed) {
      if (
        vox.x < 0 ||
        vox.y < 0 ||
        vox.z < 0 ||
        vox.x >= volumeRef.current.size ||
        vox.y >= volumeRef.current.size ||
        vox.z >= volumeRef.current.size
      ) {
        continue;
      }
      const list = byColor.get(vox.c) ?? [];
      list.push({ x: vox.x, y: vox.y, z: vox.z });
      byColor.set(vox.c, list);
    }
    for (const [c, cells] of byColor) {
      deltas.push(
        ...applyCells(volumeRef.current, cells, c, {
          x: false,
          y: false,
          z: false
        })
      );
    }
    historyRef.current.push(deltas);
    if (pendingName) setTitle(pendingName);
    setPendingName("");
    setSelected(new Set());
    setBoxStart(null);
    setClip((c) => ({ ...c, value: Math.min(c.value, next - 1) }));
    if (packedBounds) {
      setFocus([
        (packedBounds.minX + packedBounds.maxX) / 2,
        Math.max(0.5, (packedBounds.minY + packedBounds.maxY) / 2),
        (packedBounds.minZ + packedBounds.maxZ) / 2
      ]);
    } else {
      setFocus(volumeCenter(next));
    }
    bump();
    notify(
      gate.reason === "repeat"
        ? `IMAGE ${result.count ?? result.voxels.length} VX`
        : `IMAGE APPLIED · ${gate.message}`
    );
  }, [bump, notify, pendingHash, pendingImage, pendingName, refreshCredits]);

  const openProject = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const lower = file.name.toLowerCase();
        if (
          lower.endsWith(".png") ||
          lower.endsWith(".jpg") ||
          lower.endsWith(".jpeg") ||
          lower.endsWith(".webp")
        ) {
          notify("IMPORTING IMAGE");
          await new Promise((resolve) => window.setTimeout(resolve, 40));
          const result = await imageToVoxels(file, {
            volumeSize: volumeRef.current.size,
            mode: imageMode,
            heightMax: imageHeight,
            maxVoxels: MAX_SAFE
          });
          if (!result.voxels.length) throw new Error("Empty image");
          setPendingName(file.name.replace(/\.(png|jpe?g|webp)$/i, ""));
          setPendingHash(await hashImageFile(file));
          setPendingImage(result);
          setPaywall(false);
          notify(`${result.count ?? result.voxels.length} VX READY`);
          return;
        }
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
        setPendingImage(null);
        setPendingHash("");
        packVolume();
        notify("PROJECT LOADED");
      } catch (error) {
        notify(error instanceof Error ? error.message.toUpperCase() : "OPEN FAILED");
      } finally {
        setBusy(false);
      }
    },
    [imageHeight, imageMode, notify, packVolume]
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
        setPendingImage(null);
        setPendingName("");
        setPendingHash("");
        setPaywall(false);
        strokeRef.current = null;
        return;
      }
      if (e.key === "Enter" && pendingImage) {
        e.preventDefault();
        applyImage();
        return;
      }
      if (k === "f" && !mod && !pendingImage) {
        e.preventDefault();
        packVolume();
        notify("FIT");
        return;
      }
      if (k === "f") {
        e.preventDefault();
        const cells = selected.size
          ? [...selected].map((key) => {
              const [x, y, z] = key.split(":").map(Number);
              return { x, y, z };
            })
          : ghost
            ? [ghost]
            : [];
        if (cells[0]) setFocus([cells[0].x, cells[0].y, cells[0].z]);
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
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }
      const toolMatch = TOOLS.find((item) => item.key.toLowerCase() === k);
      if (toolMatch && !mod) setTool(toolMatch.id);
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
    applyImage,
    copySelected,
    deleteSelected,
    duplicateSelected,
    ghost,
    moveSelected,
    notify,
    packVolume,
    pasteClipboard,
    pendingImage,
    redo,
    selected,
    undo
  ]);

  const creditLabel =
    creditsLeft === Number.POSITIVE_INFINITY ? "PRO" : `${creditsLeft}/${FREE_IMAGE_APPLIES}`;

  return (
    <main className="builderShell">
      <header className="builderHeader">
        <div className="headerLeft">
          <Link href="/" className="brandMark">
            VOXEL
          </Link>
          {editingTitle ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setEditingTitle(false);
              }}
            />
          ) : (
            <button className="titleBtn" onClick={() => setEditingTitle(true)}>
              {title} <span>EDIT</span>
            </button>
          )}
        </div>
        <div className="headerRight">
          <button onClick={undo} disabled={!canUndo}>
            UNDO
          </button>
          <button onClick={redo} disabled={!canRedo}>
            REDO
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={busy}>
            OPEN
          </button>
          <button onClick={() => exportFiles("json")}>PROJECT</button>
          <button onClick={() => exportFiles("vox")}>VOX</button>
          <button onClick={() => exportFiles("glb")}>GLB</button>
          <button onClick={() => exportFiles("obj")}>OBJ</button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".png,.jpg,.jpeg,.webp,.vox,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void openProject(file);
            }}
          />
        </div>
      </header>

      <aside className="toolRail">
        <p className="category">TOOLS</p>
        {TOOLS.map((item) => (
          <button
            key={item.id}
            className={tool === item.id ? "modeOn" : ""}
            onClick={() => setTool(item.id)}
          >
            {item.label} <span>{item.key}</span>
          </button>
        ))}
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
            <button key={n} className={brush === n ? "modeOn" : ""} onClick={() => setBrush(n)}>
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
        <button onClick={packVolume} disabled={!count}>
          FIT
        </button>
        <button onClick={() => applyNow(hollowCells(volumeRef.current), null, false)}>
          HOLLOW
        </button>
        <button onClick={clearAll}>CLEAR</button>
      </aside>

      <section className="viewport">
        <Canvas
          shadows
          dpr={[1, 1.75]}
          camera={{ position: [40, 28, 40], fov: 42, near: 0.1, far: 4000 }}
        >
          <color attach="background" args={["#070b14"]} />
          <ambientLight intensity={0.55} />
          <directionalLight position={[30, 50, 20]} intensity={1.1} castShadow />
          <CameraRig view={view} size={volume.size} focus={focus} />
          {grid && (
            <Grid
              args={[volume.size, volume.size]}
              position={[(volume.size - 1) / 2, -0.49, (volume.size - 1) / 2]}
              cellSize={1}
              cellColor="#1e293b"
              sectionSize={8}
              sectionColor="#334155"
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
            clip={clip}
            onHit={onHit}
            onHover={onHover}
          />
          {pendingImage && (
            <PendingPreview voxels={pendingImage.voxels} palette={pendingImage.palette} />
          )}
          {ghost && tool !== "box" && (tool === "attach" || brush > 1) && (
            <Ghost
              cell={ghost}
              color={palette[color]}
              valid={ghostValid || tool !== "attach"}
            />
          )}
          {tool === "box" && boxStart && ghost && <BoxPreview a={boxStart} b={ghost} />}
          {tool === "select" && clipboard.length > 0 && ghost && (
            <OffsetGhost items={clipboard} origin={ghost} />
          )}
          <OrbitControls
            makeDefault
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
            {tool.toUpperCase()} · {imageMode.toUpperCase()} · {count} VX · {volume.size}³ ·{" "}
            {creditLabel}
            {boxStart ? " · BOX…" : ""}
            {clip.axis ? ` · CLIP ${clip.axis.toUpperCase()}=${clip.value}` : ""}
            {busy ? " · BUSY" : ""}
            {pendingImage ? " · PREVIEW" : ""}
          </span>
          <span className="hudHelp">
            OPEN PNG · ENTER APPLY · ESC CANCEL · F FIT · GLB / VOX / OBJ ZIP
          </span>
        </div>
        {toast && <div className="toast">{toast}</div>}
        {pendingImage && !paywall && (
          <div className="toast" style={{ bottom: 72, minWidth: 280 }}>
            <div style={{ marginBottom: 8 }}>
              APPLY IMAGE · {pendingImage.count ?? pendingImage.voxels.length} VX ·{" "}
              {pendingImage.width}×{pendingImage.height} · {imageMode.toUpperCase()}
            </div>
            <div className="viewRow">
              <button onClick={applyImage} disabled={busy}>
                APPLY
              </button>
              <button onClick={cancelImage} disabled={busy}>
                CANCEL
              </button>
            </div>
            <div style={{ marginTop: 6, opacity: 0.7 }}>
              ENTER apply · ESC cancel · {creditLabel} free applies · same photo 24h free
            </div>
          </div>
        )}
        {paywall && (
          <div className="toast" style={{ bottom: 72, minWidth: 300 }}>
            <div style={{ marginBottom: 8 }}>
              FREE LIMIT REACHED · subscribe with SOL or USDC on Solana
            </div>
            <div className="viewRow">
              <button onClick={() => notify("SOLANA CHECKOUT NEXT")} disabled={busy}>
                SUBSCRIBE
              </button>
              <button onClick={cancelImage} disabled={busy}>
                CANCEL
              </button>
            </div>
            <div style={{ marginTop: 6, opacity: 0.7 }}>
              Preview stays. Editor and exports of applied models stay free.
            </div>
          </div>
        )}
      </section>

      <aside className="inspector">
        <p className="category">VIEW</p>
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
          GRID
        </button>
        {selected.size > 0 && (
          <>
            <p className="category">SELECTION {selected.size}</p>
            <div className="viewRow">
              <button onClick={paintSelected}>PAINT</button>
              <button onClick={deleteSelected}>DEL</button>
              <button onClick={copySelected}>COPY</button>
              <button onClick={() => pasteClipboard()}>PASTE</button>
            </div>
          </>
        )}
        <p className="category">CLIP</p>
        <div className="viewRow">
          {([null, "x", "y", "z"] as const).map((axis) => (
            <button
              key={String(axis)}
              className={clip.axis === axis ? "modeOn" : ""}
              onClick={() => setClip((c) => ({ ...c, axis }))}
            >
              {axis ? axis.toUpperCase() : "OFF"}
            </button>
          ))}
        </div>
        {clip.axis && (
          <input
            type="range"
            min={0}
            max={volume.size - 1}
            value={clip.value}
            onChange={(e) =>
              setClip((c) => ({ ...c, value: Number(e.target.value) }))
            }
          />
        )}
        <p className="category">IMAGE IMPORT</p>
        <div className="viewRow">
          {(["solid", "flat", "relief", "model"] as ImageMode[]).map((mode) => (
            <button
              key={mode}
              className={imageMode === mode ? "modeOn" : ""}
              onClick={() => setImageMode(mode)}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>
        {(imageMode === "solid" || imageMode === "relief" || imageMode === "model") && (
          <div className="viewRow">
            {[4, 8, 12, 16].map((n) => (
              <button
                key={n}
                className={imageHeight === n ? "modeOn" : ""}
                onClick={() => setImageHeight(n)}
              >
                H{n}
              </button>
            ))}
          </div>
        )}
        <p className="category">PALETTE</p>
        <div className="paletteGrid">
          {palette.slice(0, 64).map((hex, i) => (
            <button
              key={i}
              className={color === i ? "swatchOn" : "swatch"}
              style={{ background: hex }}
              onClick={() => setColor(i)}
            />
          ))}
        </div>
        <input
          type="color"
          value={palette[color] ?? "#ffffff"}
          onChange={(e) => {
            const next = [...palette];
            next[color] = e.target.value;
            setPalette(next);
          }}
        />
        <p className="muted">
          {color}, {palette[color]}
        </p>
      </aside>
    </main>
  );
}
