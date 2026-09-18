"use client";

import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { Cell, ClipboardVoxel, Tool, ViewMode } from "@/lib/voxelEngine";
import type { VoxelVolume } from "@/lib/voxelEngine";
import type { ImageImport } from "@/lib/imageVoxel";
import { MONTHLY_SOL, subscribeWithSol } from "@/lib/solanaCheckout";
import { VoxelCloud, type Clip, type VoxelHit } from "@/components/builder/VoxelCloud";
import { CameraRig } from "@/components/builder/scene/CameraRig";
import { SubjectLights } from "@/components/builder/scene/SubjectLights";
import { Ground } from "@/components/builder/scene/Ground";
import { Ghost } from "@/components/builder/scene/Ghost";
import { BoxPreview } from "@/components/builder/scene/BoxPreview";
import { OffsetGhost } from "@/components/builder/scene/OffsetGhost";
import { VolumeFrame } from "@/components/builder/scene/VolumeFrame";
import { PendingPreview } from "@/components/builder/scene/PendingPreview";

export type BuilderViewportProps = {
  volume: VoxelVolume;
  palette: string[];
  rev: number;
  selected: Set<string>;
  clip: Clip;
  focus: [number, number, number];
  view: ViewMode;
  grid: boolean;
  studioLight: boolean;
  tool: Tool;
  brush: number;
  color: number;
  boxStart: Cell | null;
  clipboard: ClipboardVoxel[];
  ghost: Cell | null;
  ghostValid: boolean;
  pendingImage: ImageImport | null;
  paywall: boolean;
  busy: boolean;
  toast: string;
  onHit: (hit: VoxelHit, ev: ThreeEvent<PointerEvent>) => void;
  onHover: (hit: VoxelHit | null) => void;
  applyImage: () => void | Promise<void>;
};

export function BuilderViewport({
  volume,
  palette,
  rev,
  selected,
  clip,
  focus,
  view,
  grid,
  studioLight,
  tool,
  brush,
  color,
  boxStart,
  clipboard,
  ghost,
  ghostValid,
  pendingImage,
  paywall,
  busy,
  toast,
  onHit,
  onHover,
  applyImage
}: BuilderViewportProps) {
  const cx = (volume.size - 1) / 2;
  const cz = (volume.size - 1) / 2;

  return (
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
  );
}
