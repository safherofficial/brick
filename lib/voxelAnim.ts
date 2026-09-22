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

export type AnimBakeInput = {
  /** Mesh height in export world units (meters in 3D, voxel units in 2D). */
  height: number;
  output?: "2d" | "25d" | string;
  shape?: string;
  /**
   * World-space point to orbit for Equipped_* clips (Socket_Grip).
   * Pickup/Showcase orbit the mesh origin so the floor pivot stays put.
   */
  pivot?: Vec3 | null;
};

function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const half = angleRad / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}

function rotateVec(q: Quat, v: Vec3): Vec3 {
  const p: Quat = [v[0], v[1], v[2], 0];
  const qi: Quat = [-q[0], -q[1], -q[2], q[3]];
  const r = quatMul(quatMul(q, p), qi);
  return [r[0], r[1], r[2]];
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function isPlanar(output?: string) {
  return output === "2d" || output === "25d";
}

function shapeKey(shape?: string) {
  return String(shape ?? "prop").toLowerCase();
}

/**
 * Tiles stay almost static. Characters get idle presentation only.
 * Weapons / props get the full pickup + equipped set.
 */
export function animSetFor(shape?: string, output?: string): Array<
  "Pickup_Idle" | "Showcase_Idle" | "Equipped_Idle" | "Equipped_Swing"
> {
  const kind = shapeKey(shape);
  if (kind === "tile") return ["Showcase_Idle"];
  if (output === "2d") return ["Showcase_Idle", "Equipped_Idle"];
  if (kind === "character") return ["Pickup_Idle", "Showcase_Idle"];
  return ["Pickup_Idle", "Showcase_Idle", "Equipped_Idle", "Equipped_Swing"];
}

/**
 * Rotate the mesh (rest pose at the origin) around `pivot` and add `bob`.
 * T = pivot + R * (0 - pivot) + bob
 */
function posedTranslation(rotation: Quat, bob: Vec3, pivot: Vec3): Vec3 {
  const offset = rotateVec(rotation, [-pivot[0], -pivot[1], -pivot[2]]);
  return [
    pivot[0] + offset[0] + bob[0],
    pivot[1] + offset[1] + bob[1],
    pivot[2] + offset[2] + bob[2]
  ];
}

/**
 * Build the standard clip set for a prop of the given height (export units).
 * Accepts a bare height (legacy) or a bake input with output/shape/grip pivot.
 */
export function buildWeaponAnimClips(input: number | AnimBakeInput): WeaponAnimClip[] {
  const bake: AnimBakeInput = typeof input === "number" ? { height: input } : input;
  const rawHeight = Number.isFinite(bake.height) && bake.height > 0 ? bake.height : 1;
  const planar = isPlanar(bake.output);
  // 2D uses 1 unit/voxel — cap amplitude so a 64px sprite does not leap a tile.
  const safeHeight = planar ? Math.min(rawHeight, 8) : rawHeight;
  const wanted = new Set(animSetFor(bake.shape, bake.output));
  const spinAxis: Vec3 = planar ? [0, 0, 1] : [0, 1, 0];
  const equippedPivot: Vec3 = bake.pivot ?? [0, 0, 0];
  const clips: WeaponAnimClip[] = [];

  if (wanted.has("Pickup_Idle")) {
    const steps = 32;
    const duration = 2.4;
    const amp = Math.max(0.01, safeHeight * 0.06);
    const times: number[] = [];
    const translation: Vec3[] = [];
    const rotation: Quat[] = [];
    for (let i = 0; i < steps; i += 1) {
      const u = i / steps;
      const phase = u * Math.PI * 2;
      const rot = quatFromAxisAngle(spinAxis, phase);
      times.push(duration * u);
      rotation.push(rot);
      translation.push(posedTranslation(rot, [0, Math.sin(phase) * amp, 0], [0, 0, 0]));
    }
    times.push(duration);
    rotation.push(rotation[0]);
    translation.push(translation[0]);
    clips.push({ name: "Pickup_Idle", loop: true, track: { times, translation, rotation } });
  }

  if (wanted.has("Showcase_Idle")) {
    const steps = 40;
    const duration = 4.5;
    const amp = Math.max(0.008, safeHeight * 0.035);
    const times: number[] = [];
    const translation: Vec3[] = [];
    const rotation: Quat[] = [];
    for (let i = 0; i < steps; i += 1) {
      const u = i / steps;
      const phase = u * Math.PI * 2;
      const rot = planar
        ? quatFromAxisAngle([0, 0, 1], Math.sin(phase) * degToRad(8))
        : quatFromAxisAngle(spinAxis, phase);
      times.push(duration * u);
      rotation.push(rot);
      translation.push(posedTranslation(rot, [0, Math.sin(phase) * amp, 0], [0, 0, 0]));
    }
    times.push(duration);
    rotation.push(rotation[0]);
    translation.push(translation[0]);
    clips.push({ name: "Showcase_Idle", loop: true, track: { times, translation, rotation } });
  }

  if (wanted.has("Equipped_Idle")) {
    const steps = 24;
    const duration = 2.8;
    const bobAmp = Math.max(0.004, safeHeight * 0.012);
    const swayDeg = 2.5;
    const times: number[] = [];
    const translation: Vec3[] = [];
    const rotation: Quat[] = [];
    for (let i = 0; i < steps; i += 1) {
      const u = i / steps;
      const phase = u * Math.PI * 2;
      const rot = quatFromAxisAngle([0, 0, 1], Math.sin(phase) * degToRad(swayDeg));
      times.push(duration * u);
      rotation.push(rot);
      translation.push(
        posedTranslation(rot, [0, Math.sin(phase) * bobAmp, 0], equippedPivot)
      );
    }
    times.push(duration);
    rotation.push(rotation[0]);
    translation.push(translation[0]);
    clips.push({ name: "Equipped_Idle", loop: true, track: { times, translation, rotation } });
  }

  if (wanted.has("Equipped_Swing")) {
    const keyDegrees = [0, -55, 40, 8, 0];
    const keyTimeRatios = [0, 0.18, 0.42, 0.7, 1];
    const duration = 0.4;
    const times = keyTimeRatios.map((r) => r * duration);
    const rotation = keyDegrees.map((d) => quatFromAxisAngle([0, 0, 1], degToRad(d)));
    const translation = rotation.map((rot) => posedTranslation(rot, [0, 0, 0], equippedPivot));
    clips.push({ name: "Equipped_Swing", loop: false, track: { times, translation, rotation } });
  }

  return clips;
}
