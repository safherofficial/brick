"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ViewMode } from "@/lib/voxelEngine";

export function CameraRig({
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
