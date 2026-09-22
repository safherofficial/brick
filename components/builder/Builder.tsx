"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
  importVox,
  zipStore
} from "@/lib/voxelExport";
import { exportGlbTextured } from "@/lib/voxelGlb";
import { imageToVoxels, imagesToVoxels, type ImageImport } from "@/lib/imageVoxel";
import { unityExportOptions, unityVoxelSpanY } from "@/lib/ai/unity";
import { buildImageOptions } from "@/lib/ai/buildOptions";
import { exportVolumePngOrtho } from "@/lib/exportPngOrtho";
import { buildUnityPack } from "@/lib/ai/unityPack";
import type { OutputLock } from "@/lib/imageVoxel";
import { type AiCategory } from "@/lib/ai/aiCategories";
import {
  consumeImageApplyRemote,
  FREE_IMAGE_APPLIES,
  hashImageFile,
  readEntitlement,
  remainingApplies
} from "@/lib/entitlement";
import { restorePlan } from "@/lib/solanaCheckout";
import { connectWallet } from "@/lib/wallet";
import { publishCreation } from "@/lib/creationsApi";
import { type Clip, type VoxelHit } from "@/components/builder/VoxelCloud";
import { boundsOfCells, fitSizeFor, type ExportMotion, type LocalImageMode } from "@/components/builder/builderHelpers";
import { BuilderHeader } from "@/components/builder/BuilderHeader";
import { BuilderPanel } from "@/components/builder/BuilderPanel";
import { BuilderViewport } from "@/components/builder/BuilderViewport";
import "./builder.css";

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
  const [outputLock, setOutputLock] = useState<OutputLock | null>(null);
  const [exportMotion, setExportMotion] = useState<ExportMotion>("static");
  const [imageHeight, setImageHeight] = useState(6);
  const [symmetrize, setSymmetrize] = useState(false);
  /** Optional AI category — drives ONNX depth, matte, 2.5D height presets. */
  const [imageCategory, setImageCategory] = useState<AiCategory | null>(null);
  const [sideMetricsLabel, setSideMetricsLabel] = useState<string>("");
  const [sideMetricsWarn, setSideMetricsWarn] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<ImageImport | null>(null);
  const [lastShape, setLastShape] = useState<string | undefined>(undefined);
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
        category: imageCategory ?? undefined,
        output: outputLock ?? undefined,
        outline: outputLock === "2d" ? true : undefined
      }),
    [imageCategory, imageHeight, imageMode, outputLock, symmetrize]
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
          notify("MODEL · FRONT-ONLY 3D ESTIMATE");
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
              ? "MODEL front"
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
          notify("MODEL · FRONT-ONLY 3D ESTIMATE");
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
              ? "MODEL front"
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
  const refreshSideMetrics = useCallback(
    async (front: File, side: File) => {
      try {
        const { computeHullMetrics } = await import("@/lib/ai/importMetrics");
        const loadBounds = (file: File) =>
          new Promise<{
            width: number;
            height: number;
            minX: number;
            minY: number;
            maxX: number;
            maxY: number;
          }>((resolve, reject) => {
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
          });
        const [fb, sb] = await Promise.all([loadBounds(front), loadBounds(side)]);
        const m = computeHullMetrics(fb, sb);
        setSideMetricsLabel(m.label);
        setSideMetricsWarn(m.warning);
        if (m.warning) notify(m.warning.toUpperCase());
      } catch {
        setSideMetricsLabel("");
        setSideMetricsWarn(null);
      }
    },
    [notify]
  );
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
  const applyImage = useCallback(async () => {
    if (!pendingImage) return;
    const gate = await consumeImageApplyRemote(
      pendingHash || pendingName || "unknown",
      readEntitlement().wallet
    );
    refreshCredits();
    if (!gate.ok) {
      setPaywall(true);
      notify(gate.message);
      return;
    }
    const result = pendingImage;
    setLastShape(result.shape);
    const bounds = boundsOfCells(result.voxels);
    if (!bounds) return;
    const nextSize = fitSizeFor(bounds);
    if (nextSize !== volumeRef.current.size) {
      volumeRef.current.resize(nextSize);
      setClip({ axis: null, value: nextSize - 1 });
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
    imageJobRef.current += 1;

    const deltas = applyCells(volumeRef.current, volumeRef.current.voxels(), null, {
      x: false,
      y: false,
      z: false
    });
    commit(deltas);
    setPendingImage(null);
    setPendingName("");
    setPendingHash("");
    setFrontFile(null);
    setSideFile(null);
    setSideMetricsLabel("");
    setSideMetricsWarn(null);
    setPaywall(false);
    setBusy(false);
    setSelected(new Set());
    setBoxStart(null);
    setHover(null);
    setFocus(volumeCenter(volumeRef.current.size));

    if (frontRef.current) frontRef.current.value = "";
    if (sideRef.current) sideRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
    historyRef.current = new History();
    setCanUndo(false);
    setCanRedo(false);
    notify("CLEARED");
  }, [commit, notify]);
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
  const ghost = hover?.kind === "voxel" && tool === "attach" ? hover.place : (hover?.cell ?? null);
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
    async (kind: "json" | "vox" | "glb" | "obj" | "png" | "unity-pack") => {
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
      if (kind === "png") {
        const { png, unityMeta } = exportVolumePngOrtho(volumeRef.current, palette, 16);
        const metaBytes = new TextEncoder().encode(unityMeta);
        const unity2dZip = zipStore([
          { name: `${name}.png`, data: png },
          { name: `${name}.png.meta`, data: metaBytes }
        ]);
        downloadBytes(unity2dZip, `${name}-unity2d.zip`, "application/zip");
        return;
      }
      const animated = exportMotion === "dynamic";
      if (kind === "glb") {
        const options = {
          ...unityExportOptions({
            voxelSpanY: unityVoxelSpanY(volumeRef.current),
            output: outputLock === "2d" || outputLock === "25d" ? outputLock : undefined,
            name: title,
            shape: lastShape,
            animated
          })
        };
        const bytes = await exportGlbTextured(volumeRef.current, palette, options);
        const fileName = animated ? `${name}-anim.glb` : `${name}.glb`;
        downloadBytes(new Uint8Array(bytes), fileName, "model/gltf-binary");
        notify(animated ? "GLB · DYNAMIC" : "GLB · STATIC");
        return;
      }
      if (kind === "unity-pack") {
        const options = {
          ...unityExportOptions({
            voxelSpanY: unityVoxelSpanY(volumeRef.current),
            output: outputLock === "2d" || outputLock === "25d" ? outputLock : undefined,
            name: title,
            shape: lastShape,
            animated
          })
        };
        const glbBytes = await exportGlbTextured(volumeRef.current, palette, options);
        const sprite =
          outputLock === "2d"
            ? exportVolumePngOrtho(volumeRef.current, palette, 16)
            : undefined;
        const pack = buildUnityPack({
          name,
          glb: new Uint8Array(glbBytes),
          sprite: sprite
            ? { png: sprite.png, meta: sprite.unityMeta }
            : undefined
        });
        downloadBytes(pack, animated ? `${name}-unity-anim.zip` : `${name}-unity.zip`, "application/zip");
        notify(animated ? "UNITY PACK · DYNAMIC" : "UNITY PACK · STATIC");
        return;
      }
      const archive = await exportObjArchive(
        volumeRef.current,
        palette,
        unityExportOptions({
          voxelSpanY: unityVoxelSpanY(volumeRef.current),
          output: outputLock === "2d" || outputLock === "25d" ? outputLock : undefined,
          name: title,
          shape: lastShape
        })
      );
      downloadBytes(archive, `${name}-obj.zip`, "application/zip");
    },
    [exportMotion, lastShape, notify, outputLock, palette, title]
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

  const commitHollow = useCallback(() => {
    commit(applyCells(volumeRef.current, hollowCells(volumeRef.current), null, mirror));
  }, [commit, mirror]);
  return (
    <main className="builderShell">
      <BuilderHeader
        title={title}
        editingTitle={editingTitle}
        setTitle={setTitle}
        setEditingTitle={setEditingTitle}
        canUndo={canUndo}
        canRedo={canRedo}
        busy={busy}
        undo={undo}
        redo={redo}
        exportFiles={exportFiles}
        publish={publish}
        openProject={openProject}
        attachFront={attachFront}
        attachSide={attachSide}
        fileRef={fileRef}
        frontRef={frontRef}
        sideRef={sideRef}
        exportMotion={exportMotion}
        setExportMotion={setExportMotion}
      />
      <div className="builderBody voxelBody">
        <BuilderPanel
          tool={tool}
          setTool={setTool}
          boxMode={boxMode}
          setBoxMode={setBoxMode}
          brush={brush}
          setBrush={setBrush}
          color={color}
          setColor={setColor}
          palette={palette}
          mirror={mirror}
          setMirror={setMirror}
          view={view}
          setView={setView}
          grid={grid}
          setGrid={setGrid}
          studioLight={studioLight}
          setStudioLight={setStudioLight}
          clip={clip}
          setClip={setClip}
          volumeSize={volume.size}
          count={count}
          creditLabel={creditLabel}
          busy={busy}
          pendingImage={pendingImage}
          sideFile={sideFile}
          frontFile={frontFile}
          imageMode={imageMode}
          setImageMode={setImageMode}
          outputLock={outputLock}
          setOutputLock={setOutputLock}
          exportMotion={exportMotion}
          setExportMotion={setExportMotion}
          imageHeight={imageHeight}
          setImageHeight={setImageHeight}
          symmetrize={symmetrize}
          setSymmetrize={setSymmetrize}
          imageCategory={imageCategory}
          setImageCategory={setImageCategory}
          sideMetricsLabel={sideMetricsLabel}
          sideMetricsWarn={sideMetricsWarn}
          notify={notify}
          resize={resize}
          packVolume={packVolume}
          clearAll={clearAll}
          frameContent={frameContent}
          syncPlan={syncPlan}
          rebuildMultiView={rebuildMultiView}
          commitHollow={commitHollow}
          frontRef={frontRef}
          sideRef={sideRef}
        />
        <BuilderViewport
          volume={volume}
          palette={palette}
          rev={rev}
          selected={selected}
          clip={clip}
          focus={focus}
          view={view}
          grid={grid}
          studioLight={studioLight}
          tool={tool}
          brush={brush}
          color={color}
          boxStart={boxStart}
          clipboard={clipboard}
          ghost={ghost}
          ghostValid={ghostValid}
          pendingImage={pendingImage}
          paywall={paywall}
          busy={busy}
          toast={toast}
          onHit={onHit}
          onHover={onHover}
          applyImage={applyImage}
        />
      </div>
    </main>
  );
}
