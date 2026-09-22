// lib/voxelAnim.ts
//
// Procedural glTF node-transform animation clips for a rigid voxel prop.
// These are plain TRS keyframes on the mesh node — no skeleton, no skinning
// needed, since every exported prop is a single rigid mesh. Sockets, the
// collider and the root node are never targeted, so grip/ground attachment
// and physics stay correct no matter which clip (or none) is played.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type AnimTrack = {
  times: number[];
  translation?: Vec3[];
  rotation?: Quat[];
};

export type WeaponAnimClip = {
  name: string;
  loop: boolean;
  track: AnimTrack;
};

function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const half = angleRad / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/**
 * Build the standard weapon clip set for a prop of the given height (in the
 * export's own units — meters once unitMeters is applied upstream). Bob and
 * sway amplitudes scale off height so a tiny dagger and a tall greatsword
 * both read as subtle rather than either static or wildly overdone.
 */
export function buildWeaponAnimClips(height: number): WeaponAnimClip[] {
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const clips: WeaponAnimClip[] = [];

  // --- Pickup_Idle: floor pickup — bob + full slow spin, loops ---
  {
    const steps = 32;
    const duration = 2.4;
    const amp = Math.max(0.01, safeHeight * 0.06);
    const times: number[] = [];
    const translation: Vec3[] = [];
    const rotation: Quat[] = [];
    for (let i = 0; i < steps; i += 1) {
      const u = i / (steps - 1);
      const phase = u * Math.PI * 2;
      times.push(duration * u);
      translation.push([0, Math.sin(phase) * amp, 0]);
      rotation.push(quatFromAxisAngle([0, 1, 0], phase));
    }
    clips.push({ name: "Pickup_Idle", loop: true, track: { times, translation, rotation } });
  }

  // --- Showcase_Idle: inventory / preview turntable — slower spin, gentler bob, loops ---
  {
    const steps = 40;
    const duration = 4.5;
    const amp = Math.max(0.008, safeHeight * 0.035);
    const times: number[] = [];
    const translation: Vec3[] = [];
    const rotation: Quat[] = [];
    for (let i = 0; i < steps; i += 1) {
      const u = i / (steps - 1);
      const phase = u * Math.PI * 2;
      times.push(duration * u);
      translation.push([0, Math.sin(phase) * amp, 0]);
      rotation.push(quatFromAxisAngle([0, 1, 0], phase));
    }
    clips.push({ name: "Showcase_Idle", loop: true, track: { times, translation, rotation } });
  }

  // --- Equipped_Idle: subtle in-hand breathing sway, no spin, loops ---
  {
    const steps = 24;
    const duration = 2.8;
    const bobAmp = Math.max(0.004, safeHeight * 0.012);
    const swayDeg = 2.5;
    const times: number[] = [];
    const translation: Vec3[] = [];
    const rotation: Quat[] = [];
    for (let i = 0; i < steps; i += 1) {
      const u = i / (steps - 1);
      const phase = u * Math.PI * 2;
      times.push(duration * u);
      translation.push([0, Math.sin(phase) * bobAmp, 0]);
      // Sway around the flat (Z) axis — these are thin, near-2D props, so
      // this keeps the silhouette facing the camera instead of turning away.
      rotation.push(quatFromAxisAngle([0, 0, 1], Math.sin(phase) * degToRad(swayDeg)));
    }
    clips.push({ name: "Equipped_Idle", loop: true, track: { times, translation, rotation } });
  }

  // --- Equipped_Swing: quick one-shot slash arc, rotation only, around the flat (Z) axis ---
  {
    const keyDegrees = [0, -55, 40, 8, 0];
    const keyTimeRatios = [0, 0.18, 0.42, 0.7, 1];
    const duration = 0.4;
    const times = keyTimeRatios.map((r) => r * duration);
    const rotation = keyDegrees.map((d) => quatFromAxisAngle([0, 0, 1], degToRad(d)));
    clips.push({ name: "Equipped_Swing", loop: false, track: { times, rotation } });
  }

  return clips;
}
