import { zipStore } from "@/lib/voxelExport";

export type UnityPackSprite = {
  png: Uint8Array;
  meta: string;
};

export type UnityPackOptions = {
  name: string;
  glb: Uint8Array | ArrayBuffer;
  sprite?: UnityPackSprite;
  atlas?: { name?: string; data: Uint8Array };
};

/**
 * Fixed Unity handoff notes. The GLB already embeds its atlas texture, so no
 * external atlas file is required unless a future exporter explicitly passes one.
 */
export const UNITY_IMPORT_TXT = [
  "Brick Unity Import",
  "Engine: Unity URP",
  "glTF loader: glTFast or UnityGLTF",
  "Import Scale: 1",
  "Materials: Unlit",
  "Generate Colliders: Off",
  "Mesh Collider: Off",
  "Texture Filter: Point / NEAREST",
  "Texture Mipmaps: Disabled",
  "GLB Unit: meters",
  "Pivot: bottom-center",
  "Collider: use brick.collider extras",
  "Atlas: embedded in GLB",
  "2D Sprite: PNG + .png.meta when included",
  "Version-locked .unitypackage: not included"
].join("\n") + "\n";

function safeName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "brick";
}

function toBytes(value: Uint8Array | ArrayBuffer) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/** Build the version-neutral Unity handoff ZIP for the current asset. */
export function buildUnityPack(options: UnityPackOptions): Uint8Array {
  const name = safeName(options.name);
  const files: { name: string; data: Uint8Array }[] = [
    { name: `${name}.glb`, data: toBytes(options.glb) }
  ];

  if (options.atlas) {
    files.push({
      name: options.atlas.name?.trim() || `${name}_atlas.png`,
      data: options.atlas.data
    });
  }

  if (options.sprite) {
    files.push({ name: `${name}.png`, data: options.sprite.png });
    files.push({
      name: `${name}.png.meta`,
      data: new TextEncoder().encode(options.sprite.meta)
    });
  }

  files.push({
    name: "IMPORT.txt",
    data: new TextEncoder().encode(UNITY_IMPORT_TXT)
  });

  return zipStore(files);
}
