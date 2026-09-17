"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  SIZES,
  volumeCenter,
  VoxelVolume,
  type BoxMode,
  type Cell,
  type ClipboardVoxel,
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
import { imageToVoxels, imagesToVoxels, type ImageImport } from "@/lib/imageVoxel";
import { UNITY_EXPORT } from "@/lib/ai/unity";
import { buildImageOptions } from "@/lib/ai/buildOptions";
import {
  AI_CATEGORIES,
  aiCategoryProfile,
  type AiCategory
} from "@/lib/ai/aiCategories";
import {
  consumeImageApply,
  FREE_IMAGE_APPLIES,
  hashImageFile,
  remainingApplies
} from "@/lib/entitlement";
import { MONTHLY_SOL, restorePlan, subscribeWithSol } from "@/lib/solanaCheckout";
import { connectWallet } from "@/lib/wallet";
import { publishCreation } from "@/lib/creationsApi";
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

type LocalImageMode = "solid" | "flat" | "relief" | "model";
type ContentBounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

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
  const { camera, controls } = useThree();
  // Preset angles only when view or volume size changes — never fight user orbit.
  useEffect(() => {
    const [cx, cy, cz] = focus;
    const dist = Math.max(8, size * 0.88);
    const elev = Math.max(1.5, size * 0.1);
    // Bias look/target upward so the model sits in the upper half of the frame
    const lookY = cy + Math.max(2, size * 0.08);
    if (view === "top") camera.position.set(cx, dist, cz + 0.01);
    else if (view === "front") camera.position.set(cx, lookY + elev, cz + dist);
    else if (view === "side") camera.position.set(cx + dist, lookY + elev, cz);
    else camera.position.set(cx + dist * 0.74, lookY + dist * 0.48, cz + dist * 0.74);
    camera.near = 0.05;
    camera.far = Math.max(2000, size * 12);
    camera.lookAt(cx, lookY, cz);
    camera.updateProjectionMatrix();
    const orbit = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (orbit?.target) {
      orbit.target.set(cx, lookY, cz);
      orbit.update?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: do not re-run on focus alone
  }, [camera, controls, size, view]);

  // When focus moves (APPLY / FRAME), only move the orbit target — keep current camera pose.
  useEffect(() => {
    const [cx, cy, cz] = focus;
    const lookY = cy + Math.max(2, size * 0.08);
    const orbit = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (orbit?.target) {
      orbit.target.set(cx, lookY, cz);
      orbit.update?.();
    }
  }, [controls, focus, size]);

  return null;
}


/** Studio key aimed at the built subject (focus). Toggle with L. */
function SubjectLights({
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
          { kind: "empty", cell: { x: Math.round(e.point.x), y: 0, z: Math.round(e.point.z) } },
          e
        );
      }}
      onPointerMove={(e) => {
        onHover({
          kind: "empty",
          cell: { x: Math.round(e.point.x), y: 0, z: Math.round(e.point.z) }
        });
      }}
    >
      <planeGeometry args={[size + 12, size + 12]} />
      <shadowMaterial opacity={0.32} color="#05060a" />
    </mesh>
  );
}

function Ghost({ cell, color, valid }: { cell: Cell; color: string; valid: boolean }) {
  return (
    <mesh position={[cell.x, cell.y, cell.z]} raycast={() => {}}>
      <boxGeometry args={[0.98, 0.98, 0.98]} />
      <meshBasicMaterial color={valid ? color : "#ff3347"} transparent opacity={0.38} depthWrite={false} />
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
    <mesh position={[x0 + (sx - 1) / 2, y0 + (sy - 1) / 2, z0 + (sz - 1) / 2]} raycast={() => {}}>
      <boxGeometry args={[sx, sy, sz]} />
      <meshBasicMaterial color="#14f195" wireframe transparent opacity={0.85} />
    </mesh>
  );
}

function OffsetGhost({ items, origin }: { items: ClipboardVoxel[]; origin: Cell }) {
  return (
    <group raycast={() => {}}>
      {items.slice(0, 800).map((item, i) => (
        <mesh key={i} position={[origin.x + item.dx, origin.y + item.dy, origin.z + item.dz]}>
          <boxGeometry args={[1.02, 1.02, 1.02]} />
          <meshBasicMaterial color="#9945ff" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function VolumeFrame({ size }: { size: number }) {
  const points = useMemo(() => {
    const s = size - 1;
    return [
      0, 0, 0, s, 0, 0, s, 0, s, 0, 0, s, 0, 0, 0, 0, s, 0, s, s, 0, s, 0, 0, s, 0, s,
      s, s, s, s, s, 0, s, 0, 0, s, s, 0, 0, s, 0, 0, 0, 0, 0, 0, s, 0, s, s, 0, s, 0,
      s, s, 0, s, s, s, 0, s, s, s, s, s, s, 0, s
    ];
  }, [size]);
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[new Float32Array(points), 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#9945FF" />
    </line>
  );
}

function InstancedPreview({
  cells,
  color
}: {
  cells: { x: number; y: number; z: number }[];
  color: string;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < cells.length; i += 1) {
      dummy.position.set(cells[i].x, cells[i].y, cells[i].z);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [cells]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, cells.length]}>
      <boxGeometry args={[0.96, 0.96, 0.96]} />
      <meshBasicMaterial color={color} />
    </instancedMesh>
  );
}

function PendingPreview({
  voxels,
  palette
}: {
  voxels: { x: number; y: number; z: number; c: number }[];
  palette: string[];
}) {
  const groups = useMemo(() => {
    const map = new Map<number, { x: number; y: number; z: number }[]>();
    const step = voxels.length > 16000 ? 2 : 1;
    for (let i = 0; i < voxels.length; i += step) {
      const v = voxels[i];
      const list = map.get(v.c) ?? [];
      list.push(v);
      map.set(v.c, list);
    }
    return [...map.entries()];
  }, [voxels]);
  return (
    <group raycast={() => {}}>
      {groups.map(([c, cells]) => (
        <InstancedPreview key={c} cells={cells} color={palette[c] ?? "#e6e6e6"} />
      ))}
    </group>
  );
}

export default function Builder() {
  const volumeRef = useRef(new VoxelVolume(128));
  const historyRef = useRef(new History());
  const fileRef = useRef<HTMLInputElement>(null);
  const frontRef = useRef<HTMLInputElement>(null);
  const sideRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const imageJobRef = useRef(0);

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
  const [studioLight, setStudioLight] = useState(true);
  const [hover, setHover] = useState<VoxelHit | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard] = useState<ClipboardVoxel[]>([]);
  const [clip, setClip] = useState<Clip>({ axis: null, value: 127 });
  const [focus, setFocus] = useState<[number, number, number]>(() => volumeCenter(128));
  const [imageMode, setImageMode] = useState<LocalImageMode>("solid");
  const [imageHeight, setImageHeight] = useState(6);
  const [symmetrize, setSymmetrize] = useState(false);
  /** Optional AI category — drives ONNX depth, matte, 2.5D height presets. */
  const [imageCategory, setImageCategory] = useState<AiCategory | null>(null);
  const [sideMetricsLabel, setSideMetricsLabel] = useState<string>("");
  const [sideMetricsWarn, setSideMetricsWarn] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<ImageImport | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [pendingHash, setPendingHash] = useState("");
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [sideFile, setSideFile] = useState<File | null>(null);
  const [creditsLeft, setCreditsLeft] = useState(FREE_IMAGE_APPLIES);
  const [paywall, setPaywall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const volume = volumeRef.current;
  const count = volume.count;
  const cx = (volume.size - 1) / 2;
  const cz = (volume.size - 1) / 2;
  const creditLabel = creditsLeft < 0 ? "PRO" : `${creditsLeft} LEFT`;

  const bump = useCallback(() => {
    setRev((n) => n + 1);
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
  }, []);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1800);
  }, []);

  const refreshCredits = useCallback(() => setCreditsLeft(remainingApplies()), []);

  const imageOptions = useCallback(
    () =>
      buildImageOptions({
        volumeSize: volumeRef.current.size,
        heightMax: imageMode === "flat" ? 2 : imageMode === "solid" ? 1 : imageHeight,
        maxVoxels: MAX_SAFE,
        symmetrize: imageMode === "model" ? symmetrize : false,
        useLocalAi: true,
        mode: imageMode,
        category: imageCategory ?? undefined
      }),
    [imageCategory, imageHeight, imageMode, symmetrize]
  );

  const commit = useCallback(
    (deltas: Delta[]) => {
      if (!deltas.length) return;
      historyRef.current.push(deltas);
      bump();
    },
    [bump]
  );

  const persist = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveDraft(projectFromVolume(title, volumeRef.current, palette));
    }, 400);
  }, [palette, title]);

  useEffect(() => {
    persist();
  }, [persist, rev]);

  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;
    volumeRef.current.load(draft);
    setTitle(draft.title);
    setPalette(clonePalette(draft.palette));
    setFocus(volumeCenter(draft.size));
    setClip({ axis: null, value: draft.size - 1 });
    bump();
  }, [bump]);

  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        setStudioLight((v) => {
          const next = !v;
          notify(next ? "STUDIO LIGHT · ON" : "STUDIO LIGHT · OFF");
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notify]);

  const regenerateMultiView = useCallback(
    async (views: { front: File; side?: File }) => {
      const job = ++imageJobRef.current;
      setBusy(true);
      try {
        const opts = imageOptions();
        if (opts.mode === "model" && !views.side) {
          notify("MODEL · ADD SIDE PNG FOR FULL 3D");
        } else {
          notify(views.side ? "REBUILD FRONT + SIDE" : "REBUILD FRONT");
        }
        const result = views.side
          ? await imagesToVoxels(views, opts)
          : await imageToVoxels(views.front, opts);
        if (job !== imageJobRef.current) return;
        if (!result.voxels.length) throw new Error("Empty image");
        setPendingImage(result);
        const tag =
          opts.mode === "model" && views.side
            ? "MODEL hull"
            : opts.mode === "model"
              ? "MODEL preview (needs SIDE)"
              : "Preview";
        notify(`${tag} · ${result.count ?? result.voxels.length} vx`);
        setPaywall(false);
      } catch (error) {
        notify(error instanceof Error ? error.message.toUpperCase() : "IMAGE REBUILD FAILED");
      } finally {
        if (job === imageJobRef.current) setBusy(false);
      }
    },
    [imageOptions, notify]
  );

  const rebuildMultiView = useCallback(async () => {
    if (!frontFile) {
      notify("Add a front image first");
      return;
    }
    await regenerateMultiView({ front: frontFile, side: sideFile ?? undefined });
  }, [frontFile, notify, regenerateMultiView, sideFile]);


  const attachFront = useCallback(
    async (file: File) => {
      const job = ++imageJobRef.current;
      setBusy(true);
      try {
        notify("IMPORTING FRONT");
        const lower = file.name.toLowerCase();
        if (
          !(
            lower.endsWith(".png") ||
            lower.endsWith(".jpg") ||
            lower.endsWith(".jpeg") ||
            lower.endsWith(".webp")
          )
        ) {
          throw new Error("Unsupported image");
        }
        setFrontFile(file);
        setPendingName(file.name.replace(/\.(png|jpe?g|webp)$/i, ""));
        setPendingHash(await hashImageFile(file));
        if (job !== imageJobRef.current) return;
        const opts = imageOptions();
        if (opts.mode === "model" && !sideFile) {
          notify("MODEL · ADD SIDE PNG FOR FULL 3D");
        }
        const result = sideFile
          ? await imagesToVoxels({ front: file, side: sideFile }, opts)
          : await imageToVoxels(file, opts);
        if (job !== imageJobRef.current) return;
        if (!result.voxels.length) throw new Error("Empty image");
        setPendingImage(result);
        const tag =
          opts.mode === "model" && sideFile
            ? "MODEL hull"
            : opts.mode === "model"
              ? "MODEL preview (needs SIDE)"
              : "Preview";
        notify(`${tag} · ${result.count ?? result.voxels.length} vx`);
        setPaywall(false);
      } catch (error) {
        notify(error instanceof Error ? error.message.toUpperCase() : "FRONT IMPORT FAILED");
      } finally {
        if (job === imageJobRef.current) setBusy(false);
      }
    },
    [imageOptions, notify, sideFile]
  );

  const refreshSideMetrics = useCallback(async (front: File, side: File) => {
    try {
      const { computeHullMetrics } = await import("@/lib/ai/importMetrics");
      // Lightweight bounds from decoded images (alpha/luma threshold).
      const loadBounds = (file: File) =>
        new Promise<{ width: number; height: number; minX: number; minY: number; maxX: number; maxY: number }>(
          (resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
              const c = document.createElement("canvas");
              c.width = img.width;
              c.height = img.height;
              const ctx = c.getContext("2d");
              if (!ctx) {
                URL.revokeObjectURL(url);
                reject(new Error("canvas"));
                return;
              }
              ctx.drawImage(img, 0, 0);
              const data = ctx.getImageData(0, 0, c.width, c.height).data;
              let minX = c.width;
              let minY = c.height;
              let maxX = 0;
              let maxY = 0;
              for (let y = 0; y < c.height; y += 2) {
                for (let x = 0; x < c.width; x += 2) {
                  const i = (y * c.width + x) * 4;
                  const a = data[i + 3];
                  const lum = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
                  if (a < 20 || lum > 245) continue;
                  minX = Math.min(minX, x);
                  minY = Math.min(minY, y);
                  maxX = Math.max(maxX, x);
                  maxY = Math.max(maxY, y);
                }
              }
              URL.revokeObjectURL(url);
              if (maxX < minX) {
                resolve({
                  width: c.width,
                  height: c.height,
                  minX: 0,
                  minY: 0,
                  maxX: c.width - 1,
                  maxY: c.height - 1
                });
              } else {
                resolve({
                  minX,
                  minY,
                  maxX,
                  maxY,
                  width: maxX - minX + 1,
                  height: maxY - minY + 1
                });
              }
            };
            img.onerror = () => {
              URL.revokeObjectURL(url);
              reject(new Error("image"));
            };
            img.src = url;
          }
        );
      const [fb, sb] = await Promise.all([loadBounds(front), loadBounds(side)]);
      const m = computeHullMetrics(fb, sb);
      setSideMetricsLabel(m.label);
      setSideMetricsWarn(m.warning);
      if (m.warning) notify(m.warning.toUpperCase());
    } catch {
      setSideMetricsLabel("");
      setSideMetricsWarn(null);
    }
  }, [notify]);

  const attachSide = useCallback(
    async (file: File) => {
      if (!frontFile) {
        notify("Add a front image first");
        return;
      }
      setSideFile(file);
      void refreshSideMetrics(frontFile, file);
      await regenerateMultiView({ front: frontFile, side: file });
    },
    [frontFile, notify, regenerateMultiView, refreshSideMetrics]
  );

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
    if (!bounds) return;
    const nextSize = fitSizeFor(bounds);
    if (nextSize !== volumeRef.current.size) {
      volumeRef.current.resize(nextSize);
      setClip({ axis: null, value: nextSize - 1 });
    }
    // Orbit target = content centroid (fixes “always looking at the floor”).
    {
      const midY = (bounds.minY + bounds.maxY) * 0.5;
      const height = Math.max(1, bounds.maxY - bounds.minY);
      setFocus([
        (bounds.minX + bounds.maxX) * 0.5,
        midY + height * 0.12,
        (bounds.minZ + bounds.maxZ) * 0.5
      ]);
    }
    if (result.palette.length) setPalette(clonePalette(result.palette));
    volumeRef.current.clear();
    historyRef.current.reset();
    const deltas: Delta[] = [];
    for (const v of result.voxels) {
      const delta = volumeRef.current.apply(v.x, v.y, v.z, v.c);
      if (delta) deltas.push(delta);
    }
    historyRef.current.push(deltas);
    setPendingImage(null);
    if (pendingName) setTitle(pendingName.toUpperCase());
    bump();
    notify(`APPLIED · ${result.count ?? result.voxels.length} VX`);
  }, [bump, notify, pendingHash, pendingImage, pendingName, refreshCredits]);

  const frameContent = useCallback(() => {
    const cells: { x: number; y: number; z: number }[] = volumeRef.current
      .voxels()
      .map((v) => ({ x: v.x, y: v.y, z: v.z }));
    if (pendingImage?.voxels?.length) {
      for (const v of pendingImage.voxels) cells.push({ x: v.x, y: v.y, z: v.z });
    }
    const bounds = boundsOfCells(cells);
    if (!bounds) {
      setFocus(volumeCenter(volumeRef.current.size));
      notify("FRAME · VOLUME CENTER");
      return;
    }
    {
      const midY = (bounds.minY + bounds.maxY) * 0.5;
      const height = Math.max(1, bounds.maxY - bounds.minY);
      setFocus([
        (bounds.minX + bounds.maxX) * 0.5,
        midY + height * 0.12,
        (bounds.minZ + bounds.maxZ) * 0.5
      ]);
    }
    notify("FRAME · CONTENT");
  }, [notify, pendingImage]);

  const undo = useCallback(() => {
    historyRef.current.undo(volumeRef.current);
    bump();
  }, [bump]);

  const redo = useCallback(() => {
    historyRef.current.redo(volumeRef.current);
    bump();
  }, [bump]);

  const resize = useCallback(
    (size: number) => {
      if (size === volumeRef.current.size) return;
      volumeRef.current.resize(size);
      historyRef.current.reset();
      setFocus(volumeCenter(size));
      setClip({ axis: null, value: size - 1 });
      bump();
    },
    [bump]
  );

  const packVolume = useCallback(() => {
    const bounds = boundsOfCells(volumeRef.current.voxels());
    if (!bounds) return;
    resize(fitSizeFor(bounds));
  }, [resize]);

  const clearAll = useCallback(() => {
    const deltas = applyCells(volumeRef.current, volumeRef.current.voxels(), null, {
      x: false,
      y: false,
      z: false
    });
    commit(deltas);
  }, [commit]);

  const onHit = useCallback(
    (hit: VoxelHit, ev: ThreeEvent<PointerEvent>) => {
      ev.stopPropagation();
      const target = tool === "attach" && hit.kind === "voxel" ? hit.place : hit.cell;
      if (tool === "eyedrop") {
        const picked = volumeRef.current.get(hit.cell.x, hit.cell.y, hit.cell.z);
        if (picked !== undefined) setColor(picked);
        return;
      }
      if (tool === "select") {
        const id = cellKey(target);
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        return;
      }
      if (tool === "box") {
        if (!boxStart) {
          setBoxStart(target);
          return;
        }
        const cells = boxCells(boxStart, target);
        if (boxMode === "select") {
          setSelected(new Set(cells.map(cellKey)));
        } else {
          commit(
            applyCells(volumeRef.current, cells, boxMode === "erase" ? null : color, mirror)
          );
        }
        setBoxStart(null);
        return;
      }
      if (tool === "fill" && hit.kind === "voxel") {
        commit(applyCells(volumeRef.current, floodCells(volumeRef.current, hit.cell), color, mirror));
        return;
      }
      commit(
        applyCells(
          volumeRef.current,
          brushCells(target, brush),
          tool === "erase" ? null : color,
          mirror
        )
      );
    },
    [boxMode, boxStart, brush, color, commit, mirror, tool]
  );

  const onHover = useCallback((hit: VoxelHit | null) => setHover(hit), []);
  const ghost = hover?.kind === "voxel" && tool === "attach" ? hover.place : hover?.cell ?? null;
  const ghostValid = Boolean(ghost && !volumeRef.current.has(ghost.x, ghost.y, ghost.z));

  const openProject = useCallback(
    async (file: File) => {
      const name = file.name.toLowerCase();
      if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp")) {
        await attachFront(file);
        return;
      }
      const buffer = await file.arrayBuffer();
      if (name.endsWith(".vox")) {
        const model = importVox(buffer);
        volumeRef.current.load({ size: model.size, voxels: model.voxels });
        if (model.palette.length) setPalette(clonePalette(model.palette));
        setFocus(volumeCenter(volumeRef.current.size));
        historyRef.current.reset();
        bump();
        notify("VOX LOADED");
        return;
      }
      const draft = JSON.parse(new TextDecoder().decode(buffer)) as {
        title?: string;
        size?: number;
        palette?: string[];
        voxels?: { x: number; y: number; z: number; c: number }[];
      };
      volumeRef.current.load({
        size: draft.size ?? 128,
        voxels: draft.voxels ?? []
      });
      setTitle(draft.title ?? file.name);
      if (draft.palette) setPalette(clonePalette(draft.palette));
      setFocus(volumeCenter(volumeRef.current.size));
      historyRef.current.reset();
      bump();
      notify("PROJECT LOADED");
    },
    [attachFront, bump, notify]
  );

  const exportFiles = useCallback(
    async (kind: "json" | "vox" | "glb" | "obj") => {
      const name = title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "brick";
      if (kind === "json") {
        downloadText(
          JSON.stringify(projectFromVolume(title, volumeRef.current, palette), null, 2),
          `${name}.json`,
          "application/json"
        );
        return;
      }
      if (kind === "vox") {
        downloadBytes(exportVox(volumeRef.current, palette), `${name}.vox`, "application/octet-stream");
        return;
      }
      if (kind === "glb") {
        const bytes = await exportGlb(volumeRef.current, palette, UNITY_EXPORT);
        downloadBytes(new Uint8Array(bytes), `${name}.glb`, "model/gltf-binary");
        return;
      }
      const archive = await exportObjArchive(volumeRef.current, palette, UNITY_EXPORT);
      downloadBytes(archive, `${name}-obj.zip`, "application/zip");
    },
    [palette, title]
  );

  const publish = useCallback(async () => {
    setBusy(true);
    try {
      const wallet = await connectWallet();
      await publishCreation({
        wallet,
        title,
        size: volumeRef.current.size,
        palette,
        voxels: volumeRef.current.voxels()
      });
      notify("PUBLISHED");
    } catch (error) {
      notify(error instanceof Error ? error.message.toUpperCase() : "PUBLISH FAILED");
    } finally {
      setBusy(false);
    }
  }, [notify, palette, title]);

  const syncPlan = useCallback(async () => {
    try {
      await restorePlan();
      refreshCredits();
      notify("WALLET SYNCED");
    } catch (error) {
      notify(error instanceof Error ? error.message.toUpperCase() : "WALLET FAILED");
    }
  }, [notify, refreshCredits]);

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
          <button onClick={undo} disabled={!canUndo || busy}>UNDO</button>
          <button onClick={redo} disabled={!canRedo || busy}>REDO</button>
          <button onClick={() => fileRef.current?.click()} disabled={busy}>OPEN</button>
          <button onClick={() => void exportFiles("json")} disabled={busy}>PROJECT</button>
          <button onClick={() => void exportFiles("vox")} disabled={busy}>VOX</button>
          <button onClick={() => void exportFiles("glb")} disabled={busy}>GLB</button>
          <button onClick={() => void exportFiles("obj")} disabled={busy}>OBJ</button>
          <button className="primaryButton" onClick={() => void publish()} disabled={busy}>PUBLISH</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.vox,.png,.jpg,.jpeg,.webp,application/json,image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void openProject(file);
              e.target.value = "";
            }}
          />
          <input
            ref={frontRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void attachFront(file);
              e.target.value = "";
            }}
          />
          <input
            ref={sideRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void attachSide(file);
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
          <details className="fold">
            <summary>STATUS · {creditLabel}</summary>
            <div className="foldBody">
              <p className="foldHint">
                {tool.toUpperCase()} · {count} VX · {volume.size}³
                {pendingImage ? " · PREVIEW" : ""}
                {sideFile ? " · SIDE" : ""}
                {busy ? " · BUSY" : ""}
              </p>
              <button onClick={() => void syncPlan()} disabled={busy}>SYNC WALLET</button>
            </div>
          </details>
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
          <button onClick={packVolume} disabled={!count}>FIT</button>
          <button
            onClick={() =>
              commit(applyCells(volumeRef.current, hollowCells(volumeRef.current), null, mirror))
            }
          >
            HOLLOW
          </button>
          <button onClick={clearAll}>CLEAR</button>
          <p className="category">VIEW</p>
          <div className="viewRow">
            {(["iso", "top", "front", "side"] as ViewMode[]).map((mode) => (
              <button key={mode} className={view === mode ? "modeOn" : ""} onClick={() => setView(mode)}>
                {mode.toUpperCase()}
              </button>
            ))}
            <button type="button" onClick={frameContent} title="Frame content center">
              FRAME
            </button>
          </div>
          <p className="foldHint">RMB orbit · MMB pan · scroll zoom · L studio light · FRAME centers model</p>
          <button className={grid ? "modeOn" : ""} onClick={() => setGrid((g) => !g)}>
            GRID {grid ? "ON" : "OFF"}
          </button>
          <button
            className={studioLight ? "modeOn" : ""}
            onClick={() => {
              setStudioLight((v) => {
                const next = !v;
                notify(next ? "STUDIO LIGHT · ON" : "STUDIO LIGHT · OFF");
                return next;
              });
            }}
            title="Toggle studio light (L)"
          >
            LIGHT {studioLight ? "ON" : "OFF"} · L
          </button>
          <p className="category">CLIP</p>
          <div className="viewRow">
            {([null, "x", "y", "z"] as const).map((axis) => (
              <button
                key={String(axis)}
                className={clip.axis === axis ? "modeOn" : ""}
                onClick={() =>
                  setClip({
                    axis,
                    value: axis ? Math.floor(volume.size / 2) : volume.size - 1
                  })
                }
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
                setClip((current) => ({ ...current, value: Number(e.target.value) }))
              }
            />
          )}
          <p className="category">IMAGE IMPORT</p>
          <p className="foldHint">
            {frontFile ? "Front image ready" : "Front image required"}
            <br />
            {imageMode === "model"
              ? sideFile
                ? "Side image ready · MODEL hull active"
                : "Side image required for MODEL (visual hull)"
              : sideFile
                ? "Side image ready"
                : "Side image optional"}
          </p>
          <p className="foldHint">
            SIDE guide · edge-on profile (thin), white bg, tip up, same height as FRONT — not a second front view
          </p>
          {imageMode === "model" && sideFile && frontFile && (
            <>
              {sideMetricsLabel && <p className="foldHint">{sideMetricsLabel}</p>}
              {sideMetricsWarn ? (
                <p className="foldHint" style={{ color: "#f0a0a0" }}>
                  {sideMetricsWarn}
                </p>
              ) : (
                <p className="foldHint">
                  Tip: if the mesh is fat or short, re-export SIDE as a true side silhouette
                </p>
              )}
            </>
          )}
          <p className="foldHint">
            AI category · ONNX matte + depth presets
            {imageCategory ? ` · ${aiCategoryProfile(imageCategory).label}` : " · auto"}
          </p>
          <div className="viewRow">
            <button
              className={imageCategory === null ? "modeOn" : ""}
              disabled={busy}
              onClick={() => {
                setImageCategory(null);
                if (frontFile) window.setTimeout(() => void rebuildMultiView(), 0);
              }}
            >
              AUTO
            </button>
            {AI_CATEGORIES.map((id) => (
              <button
                key={id}
                className={imageCategory === id ? "modeOn" : ""}
                disabled={busy}
                title={aiCategoryProfile(id).description}
                onClick={() => {
                  setImageCategory(id);
                  setImageMode("model");
                  setSymmetrize(aiCategoryProfile(id).symmetrize);
                  if (frontFile && !sideFile) {
                    notify(`${id.toUpperCase()} · ADD SIDE PNG FOR FULL HULL`);
                  }
                  if (frontFile) window.setTimeout(() => void rebuildMultiView(), 0);
                }}
              >
                {id.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="viewRow">
            {(["solid", "flat", "relief", "model"] as LocalImageMode[]).map((mode) => (
              <button
                key={mode}
                className={imageMode === mode ? "modeOn" : ""}
                disabled={busy}
                onClick={() => {
                  setImageMode(mode);
                  // Manual mode overrides category-forced model unless staying on model.
                  if (mode !== "model") setImageCategory(null);
                  setSymmetrize(mode === "model" ? symmetrize : false);
                  if (mode === "model" && frontFile && !sideFile) {
                    notify("MODEL · ADD SIDE PNG FOR FULL 3D HULL");
                  }
                  if (frontFile) window.setTimeout(() => void rebuildMultiView(), 0);
                }}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
          {imageMode === "relief" && (
            <>
              <p className="foldHint">Relief depth</p>
              <div className="viewRow">
                {[4, 8, 12, 16].map((n) => (
                  <button
                    key={n}
                    className={imageHeight === n ? "modeOn" : ""}
                    onClick={() => {
                      setImageHeight(n);
                      if (frontFile) void rebuildMultiView();
                    }}
                    disabled={busy}
                  >
                    D{n}
                  </button>
                ))}
              </div>
            </>
          )}
          {imageMode === "model" && !sideFile && (
            <>
              <p className="foldHint">Preview depth until SIDE is added</p>
              <div className="viewRow">
                {[4, 8, 12, 16].map((n) => (
                  <button
                    key={n}
                    className={imageHeight === n ? "modeOn" : ""}
                    onClick={() => {
                      setImageHeight(n);
                      if (frontFile) void rebuildMultiView();
                    }}
                    disabled={busy}
                  >
                    D{n}
                  </button>
                ))}
              </div>
            </>
          )}
          {imageMode === "model" && sideFile && (
            <p className="foldHint">Depth comes from FRONT + SIDE silhouettes</p>
          )}
          <button
            className={symmetrize ? "modeOn" : ""}
            onClick={() => {
              setSymmetrize((value) => !value);
              if (frontFile && imageMode === "model") {
                window.setTimeout(() => void rebuildMultiView(), 0);
              }
            }}
            disabled={imageMode !== "model" || busy}
          >
            SYMMETRY {symmetrize ? "ON" : "OFF"}
          </button>
          <button onClick={() => frontRef.current?.click()} disabled={busy}>
            FRONT PNG
          </button>
          <button
            className={imageMode === "model" && !sideFile && frontFile ? "primaryButton" : ""}
            onClick={() => sideRef.current?.click()}
            disabled={busy || !frontFile}
          >
            {imageMode === "model" && !sideFile ? "SIDE PNG (REQUIRED)" : "SIDE PNG"}
          </button>
          <p className="foldHint">
            LOCAL AI · ONNX segment/depth when models are present · falls back to heuristics · 32–256
          </p>
          <p className="category">PALETTE</p>
          <div className="viewRow">
            {palette.slice(0, 16).map((hex, i) => (
              <button
                key={`${hex}-${i}`}
                className={color === i ? "modeOn" : ""}
                style={{ background: hex, minWidth: 18, minHeight: 18 }}
                onClick={() => setColor(i)}
              />
            ))}
          </div>
        </aside>

        <section className="viewport">
          <Canvas
            shadows
            dpr={[1, 2]}
            camera={{ position: [48, 36, 48], fov: 40, near: 0.05, far: 4000 }}
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
          >
            <color attach="background" args={["#0d1018"]} />
            <fog attach="fog" args={["#0d1018", volume.size * 1.35, volume.size * 4.2]} />
            <SubjectLights on={studioLight} focus={focus} size={volume.size} />
            {grid && (
              <Grid
                args={[volume.size, volume.size]}
                position={[cx, -0.49, cz]}
                cellSize={1}
                cellThickness={0.55}
                cellColor="#3c3457"
                sectionSize={8}
                sectionThickness={1.1}
                sectionColor="#a678ff"
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
              <Ghost cell={ghost} color={palette[color]} valid={ghostValid || tool !== "attach"} />
            )}
            {tool === "box" && boxStart && ghost && <BoxPreview a={boxStart} b={ghost} />}
            {tool !== "box" && clipboard.length > 0 && ghost && (
              <OffsetGhost items={clipboard} origin={ghost} />
            )}
            <CameraRig view={view} size={volume.size} focus={focus} />
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              target={focus}
              mouseButtons={{ LEFT: undefined, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }}
              enablePan
              screenSpacePanning
              enableRotate={view === "iso"}
              minDistance={4}
              maxDistance={volume.size * 4}
            />
          </Canvas>
          {toast && <div className="toast">{toast}</div>}
          {pendingImage && !paywall && (
            <div className="toast" style={{ bottom: 24, minWidth: 300 }}>
              <div style={{ marginBottom: 8 }}>
                APPLY IMAGE · {pendingImage.count ?? pendingImage.voxels.length} VX
              </div>
              <button className="primaryButton" onClick={applyImage} disabled={busy}>
                APPLY
              </button>
            </div>
          )}
          {paywall && (
            <div className="toast" style={{ bottom: 24, minWidth: 300 }}>
              <div style={{ marginBottom: 8 }}>PRO · {MONTHLY_SOL} SOL / month</div>
              <button className="primaryButton" onClick={() => void subscribeWithSol()} disabled={busy}>
                SUBSCRIBE
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
