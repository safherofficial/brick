"use client";

import type { RefObject } from "react";
import {
  AI_CATEGORIES,
  aiCategoryProfile,
  type AiCategory
} from "@/lib/ai/aiCategories";
import type { OutputLock } from "@/lib/imageVoxel";
import type { ImageImport } from "@/lib/imageVoxel";
import {
  SIZES,
  type BoxMode,
  type Mirror,
  type Tool,
  type ViewMode
} from "@/lib/voxelEngine";
import type { Clip } from "@/components/builder/VoxelCloud";
import { TOOLS, type LocalImageMode } from "@/components/builder/builderHelpers";

export type BuilderPanelProps = {
  tool: Tool;
  setTool: (tool: Tool) => void;
  boxMode: BoxMode;
  setBoxMode: (mode: BoxMode) => void;
  brush: number;
  setBrush: (n: number) => void;
  color: number;
  setColor: (n: number) => void;
  palette: string[];
  mirror: Mirror;
  setMirror: React.Dispatch<React.SetStateAction<Mirror>>;
  view: ViewMode;
  setView: (view: ViewMode) => void;
  grid: boolean;
  setGrid: React.Dispatch<React.SetStateAction<boolean>>;
  studioLight: boolean;
  setStudioLight: React.Dispatch<React.SetStateAction<boolean>>;
  clip: Clip;
  setClip: React.Dispatch<React.SetStateAction<Clip>>;
  volumeSize: number;
  count: number;
  creditLabel: string;
  busy: boolean;
  pendingImage: ImageImport | null;
  sideFile: File | null;
  frontFile: File | null;
  imageMode: LocalImageMode;
  setImageMode: (mode: LocalImageMode) => void;
  outputLock: OutputLock | null;
  setOutputLock: (lock: OutputLock | null) => void;
  imageHeight: number;
  setImageHeight: (n: number) => void;
  symmetrize: boolean;
  setSymmetrize: React.Dispatch<React.SetStateAction<boolean>>;
  imageCategory: AiCategory | null;
  setImageCategory: (c: AiCategory | null) => void;
  sideMetricsLabel: string;
  sideMetricsWarn: string | null;
  notify: (msg: string) => void;
  resize: (size: number) => void;
  packVolume: () => void;
  clearAll: () => void;
  frameContent: () => void;
  syncPlan: () => void | Promise<void>;
  rebuildMultiView: () => void | Promise<void>;
  commitHollow: () => void;
  frontRef: RefObject<HTMLInputElement | null>;
  sideRef: RefObject<HTMLInputElement | null>;
};

export function BuilderPanel({
  tool,
  setTool,
  boxMode,
  setBoxMode,
  brush,
  setBrush,
  color,
  setColor,
  palette,
  mirror,
  setMirror,
  view,
  setView,
  grid,
  setGrid,
  studioLight,
  setStudioLight,
  clip,
  setClip,
  volumeSize,
  count,
  creditLabel,
  busy,
  pendingImage,
  sideFile,
  frontFile,
  imageMode,
  setImageMode,
  outputLock,
  setOutputLock,
  imageHeight,
  setImageHeight,
  symmetrize,
  setSymmetrize,
  imageCategory,
  setImageCategory,
  sideMetricsLabel,
  sideMetricsWarn,
  notify,
  resize,
  packVolume,
  clearAll,
  frameContent,
  syncPlan,
  rebuildMultiView,
  commitHollow,
  frontRef,
  sideRef
}: BuilderPanelProps) {
  return (
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
            {tool.toUpperCase()} · {count} VX · {volumeSize}³
            {pendingImage ? " · PREVIEW" : ""}
            {sideFile ? " · SIDE" : ""}
            {busy ? " · BUSY" : ""}
          </p>
          <button onClick={() => void syncPlan()} disabled={busy}>
            SYNC WALLET
          </button>
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
            className={volumeSize === size ? "modeOn" : ""}
            onClick={() => resize(size)}
          >
            {size}
          </button>
        ))}
      </div>
      <button onClick={packVolume} disabled={!count}>
        FIT
      </button>
      <button onClick={commitHollow}>HOLLOW</button>
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
                value: axis ? Math.floor(volumeSize / 2) : volumeSize - 1
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
          max={volumeSize - 1}
          value={clip.value}
          onChange={(e) => setClip((current) => ({ ...current, value: Number(e.target.value) }))}
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
      {pendingImage?.aiStatus && (
        <p className="foldHint" title="Local ONNX diagnostics">
          AI · {pendingImage.aiStatus}
        </p>
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
      <p className="foldHint">Output lock (wins over category / solid)</p>
      <div className="viewRow">
        {([["2d", "2D"], ["25d", "2.5D"]] as const).map(([id, label]) => (
          <button
            key={id}
            className={outputLock === id ? "modeOn" : ""}
            disabled={busy}
            onClick={() => {
              setOutputLock(id);
              setImageMode(id === "2d" ? "flat" : "relief");
              if (id === "2d") setImageCategory(null);
              setSymmetrize(false);
              if (frontFile) window.setTimeout(() => void rebuildMultiView(), 0);
            }}
          >
            {label}
          </button>
        ))}
        <button
          className={outputLock === null ? "modeOn" : ""}
          disabled={busy}
          onClick={() => {
            setOutputLock(null);
            if (frontFile) window.setTimeout(() => void rebuildMultiView(), 0);
          }}
        >
          FREE
        </button>
      </div>
      <div className="viewRow">
        {(["solid", "flat", "relief", "model"] as LocalImageMode[]).map((mode) => (
          <button
            key={mode}
            className={imageMode === mode ? "modeOn" : ""}
            disabled={busy}
            onClick={() => {
              setImageMode(mode);
              setOutputLock(mode === "flat" ? "2d" : mode === "relief" ? "25d" : null);
              if (mode !== "model") setImageCategory(null);
              setSymmetrize(mode === "model" ? symmetrize : false);
              if (mode === "model" && frontFile && !sideFile) notify("MODEL · ADD SIDE PNG FOR FULL 3D HULL");
              if (frontFile) window.setTimeout(() => void rebuildMultiView(), 0);
            }}
          >
            {mode.toUpperCase()}
          </button>
        ))}
      </div>
      {(imageMode === "relief" || outputLock === "25d") && (
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
  );
}
