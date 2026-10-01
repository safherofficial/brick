/**
 * Real raster fixture regression.
 *
 * Uses real PNG/JPEG bytes pinned to upstream commits, verifies the bytes,
 * decodes them with pure-JS raster decoders, and feeds the decoded RGBA raster
 * through Brick's existing imageToVoxels() entry point.
 *
 * Run:
 *   node --experimental-strip-types --import ./scripts/_register-aliases.mjs scripts/regression-real-fixtures.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { imageToVoxels } from "../lib/image/engine.ts";
import { VoxelVolume } from "../lib/voxelEngine.ts";
import { exportObj, exportVox } from "../lib/voxelExport.ts";
import { exportGlbTextured } from "../lib/voxelGlb.ts";

const require = createRequire(import.meta.url);
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");

const tempDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../tests/fixtures/.cache"
);

const fixtures = [
  {
    name: "kenney_chest.png",
    mime: "image/png",
    url: "https://raw.githubusercontent.com/shorepine/kenney/3694c6879e487c108f55677be7dd2ca75b07cc3b/2d/Cartography%20Pack/chest.png",
    gitBlobSha: "879a950aa77434e95d17385498bad4e2fc73c965"
  },
  {
    name: "kenney_character_wizard.png",
    mime: "image/png",
    url: "https://raw.githubusercontent.com/shorepine/kenney/3694c6879e487c108f55677be7dd2ca75b07cc3b/2d/Block%20Pack/character_wizard.png",
    gitBlobSha: "93928e4616a7556514ba349e88811214d3460729"
  },
  {
    name: "kenney_character_man.png",
    mime: "image/png",
    url: "https://raw.githubusercontent.com/shorepine/kenney/3694c6879e487c108f55677be7dd2ca75b07cc3b/2d/Block%20Pack/character_man.png",
    gitBlobSha: "5468d004c4fd1bc2dcce964721ec347e806ffebb"
  },
  {
    name: "cc0_bird.jpg",
    mime: "image/jpeg",
    url: "https://raw.githubusercontent.com/Tiddybub/2d-assets/e0cbe0d995554a490d4c182fe9beb8769ffbb606/characters/oga-blue-bird-for-jump-and-run-arcade/bird.jpg",
    gitBlobSha: "19c136a88304d0375dbc8a4dc0de743c2f85e6d5",
    mode: "solid"
  }
];

let failed = 0;

function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

async function fetchBytes(fixture) {
  // The importer test later replaces globalThis.URL with a browser mock.
  // Keep native URL handling in place while fetching the external fixture.
  const previousUrl = globalThis.URL;
  globalThis.URL = originalUrl;
  try {
    const response = await fetch(fixture.url);
    if (!response.ok) {
      throw new Error(
        `Fixture download failed: ${fixture.name} HTTP ${response.status}`
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    globalThis.URL = previousUrl;
  }
}

function gitBlobSha(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1")
    .update(Buffer.concat([header, Buffer.from(bytes)]))
    .digest("hex");
}

function decodeRaster(bytes, name) {
  const extension = path.extname(name).toLowerCase();

  if (extension === ".png") {
    const decoded = PNG.sync.read(Buffer.from(bytes));
    return {
      width: decoded.width,
      height: decoded.height,
      rgba: new Uint8ClampedArray(decoded.data)
    };
  }

  const decoded = jpeg.decode(Buffer.from(bytes), {
    useTArray: true,
    formatAsRGBA: true,
    tolerantDecoding: false
  });

  return {
    width: decoded.width,
    height: decoded.height,
    rgba: new Uint8ClampedArray(decoded.data)
  };
}

function parseGlbJson(glb) {
  const bytes =
    glb instanceof ArrayBuffer
      ? new Uint8Array(glb)
      : glb instanceof Uint8Array
        ? glb
        : null;
  if (!bytes || bytes.length < 20) throw new Error("Invalid GLB buffer");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error("Invalid GLB header");
  }

  const totalLength = view.getUint32(8, true);
  if (totalLength !== bytes.byteLength) throw new Error("Invalid GLB length");

  const jsonChunkLength = view.getUint32(12, true);
  const jsonChunkType = view.getUint32(16, true);
  if (jsonChunkType !== 0x4e4f534a) throw new Error("Missing GLB JSON chunk");

  const start = 20;
  const end = start + jsonChunkLength;
  if (end > bytes.byteLength) throw new Error("Truncated GLB JSON chunk");

  return JSON.parse(new TextDecoder().decode(bytes.subarray(start, end)));
}

const rasterByToken = new Map();
let tokenId = 0;
const originalUrl = globalThis.URL;
const originalImage = globalThis.Image;
const originalDocument = globalThis.document;

fs.mkdirSync(tempDir, { recursive: true });

globalThis.URL = {
  createObjectURL(file) {
    const token = `brick-real-fixture-${++tokenId}`;
    const bytes = file._fixtureBytes;
    if (!(bytes instanceof Uint8Array)) {
      throw new Error(`Missing fixture bytes for ${file.name}`);
    }
    rasterByToken.set(token, decodeRaster(bytes, file.name));
    return token;
  },
  revokeObjectURL(token) {
    rasterByToken.delete(token);
  }
};

class TestImage {
  naturalWidth = 0;
  naturalHeight = 0;
  width = 0;
  height = 0;
  onload = null;
  onerror = null;
  _src = "";

  set src(value) {
    this._src = value;
    const raster = rasterByToken.get(value);
    if (!raster) {
      queueMicrotask(() => this.onerror?.(new Error("Unknown fixture URL")));
      return;
    }
    this.naturalWidth = raster.width;
    this.naturalHeight = raster.height;
    this.width = raster.width;
    this.height = raster.height;
    queueMicrotask(() => this.onload?.());
  }

  get src() {
    return this._src;
  }
}

globalThis.Image = TestImage;

globalThis.document = {
  createElement(tag) {
    if (tag !== "canvas") {
      throw new Error(`Unsupported test element: ${tag}`);
    }
    const canvas = {
      width: 0,
      height: 0,
      _raster: null,
      getContext() {
        return {
          _canvas: canvas,
          clearRect() {},
          drawImage(image) {
            this._canvas._raster = rasterByToken.get(image.src);
          },
          getImageData() {
            if (!this._canvas._raster) {
              throw new Error("Fixture raster missing from canvas");
            }
            return { data: this._canvas._raster.rgba };
          }
        };
      }
    };
    return canvas;
  }
};

try {
  for (const fixture of fixtures) {
    const bytes = await fetchBytes(fixture);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    console.log(
      `FIXTURE ${fixture.name} sha256=${sha256} bytes=${bytes.length}`
    );

    assert(
      `git blob is exact: ${fixture.name}`,
      gitBlobSha(bytes) === fixture.gitBlobSha
    );
    assert(
      `fixture is non-trivial binary: ${fixture.name}`,
      bytes.length > 256
    );

    const extension = path.extname(fixture.name).toLowerCase();
    if (extension === ".png") {
      const signature = [137, 80, 78, 71, 13, 10, 26, 10];
      assert(
        `PNG signature: ${fixture.name}`,
        signature.every((value, index) => bytes[index] === value)
      );
    } else {
      assert(
        `JPEG signature: ${fixture.name}`,
        bytes[0] === 0xff &&
          bytes[1] === 0xd8 &&
          bytes.at(-2) === 0xff &&
          bytes.at(-1) === 0xd9
      );
    }

    const decoded = decodeRaster(bytes, fixture.name);
    assert(
      `decoded raster is valid: ${fixture.name}`,
      decoded.width > 1 &&
        decoded.height > 1 &&
        decoded.rgba.length === decoded.width * decoded.height * 4 &&
        decoded.rgba.some((value) => value !== 0)
    );

    const file = new File([bytes], fixture.name, { type: fixture.mime });
    file._fixtureBytes = bytes;

    const result = await imageToVoxels(file, {
      volumeSize: 48,
      mode: fixture.mode ?? "model",
      maxVoxels: 30000,
      useLocalAi: false,
      aiCategory: "objects"
    });

    assert(
      `voxel output is non-empty: ${fixture.name}`,
      result.count > 0 && result.voxels.length > 0
    );
    assert(
      `palette is non-empty: ${fixture.name}`,
      result.palette.length > 0
    );
    assert(
      `voxel coordinates are finite: ${fixture.name}`,
      result.voxels.every(
        (voxel) =>
          Number.isInteger(voxel.x) &&
          Number.isInteger(voxel.y) &&
          Number.isInteger(voxel.z) &&
          Number.isInteger(voxel.c)
      )
    );

    const zs = result.voxels.map((voxel) => voxel.z);
    assert(
      `model output preserves visible depth: ${fixture.name}`,
      Math.max(...zs) - Math.min(...zs) + 1 >= 2
    );
    assert(
      `quality control is valid: ${fixture.name}`,
      result.qualityControl !== undefined &&
        Number.isFinite(result.qualityControl.score) &&
        result.qualityControl.score >= 0 &&
        result.qualityControl.score <= 100
    );

    // Integration gate: take the exact real-fixture import output and push it
    // through the same game-ready exporters used by the Builder UI. This does
    // not replace the existing exporter regressions; it verifies that the real
    // PNG/JPEG -> voxel importer contract is actually consumable downstream.
    const volume = new VoxelVolume(48);
    for (const voxel of result.voxels) {
      if (volume.inBounds(voxel.x, voxel.y, voxel.z)) {
        volume.apply(voxel.x, voxel.y, voxel.z, voxel.c);
      }
    }
    const exportPalette = result.palette.length ? result.palette : ["#ffffff"];
    const exportName = fixture.name.replace(/\.[^.]+$/, "");

    const glb = await exportGlbTextured(volume, exportPalette, {
      name: exportName,
      shape: result.shape
    });
    assert(
      `real fixture exports to non-empty GLB: ${fixture.name}`,
      ((glb instanceof ArrayBuffer && glb.byteLength > 128) ||
        (glb instanceof Uint8Array && glb.byteLength > 128)) &&
        new DataView(
          glb instanceof ArrayBuffer ? glb : glb.buffer,
          glb instanceof ArrayBuffer ? 0 : glb.byteOffset,
          glb instanceof ArrayBuffer ? glb.byteLength : glb.byteLength
        ).getUint32(0, true) === 0x46546c67
    );

    const gltf = parseGlbJson(glb);
    const brick = gltf.asset?.extras?.brick;
    const nodeNames = (gltf.nodes ?? []).map((node) => node.name);
    const sampler = gltf.samplers?.[0];
    const image = gltf.images?.[0];
    assert(
      `GLB game-ready contract is present: ${fixture.name}`,
      brick?.gameReady === true &&
        brick?.engine === "unity" &&
        brick?.pivot === "bottom-center" &&
        brick?.upAxis === "y" &&
        brick?.material === "voxel-atlas" &&
        brick?.textureFilter === "nearest" &&
        Array.isArray(brick?.sockets) &&
        brick.sockets.length > 0 &&
        brick?.collider?.type === "box" &&
        Number.isFinite(brick?.unitMeters) &&
        brick.unitMeters > 0
    );
    assert(
      `GLB contains runtime collider/socket nodes: ${fixture.name}`,
      nodeNames.includes("Collider_Box") &&
        nodeNames.some((name) => name === "Socket_Ground") &&
        nodeNames.some((name) => name.startsWith("Socket_"))
    );
    assert(
      `GLB uses nearest-filtered atlas texture: ${fixture.name}`,
      sampler?.magFilter === 9728 &&
        sampler?.minFilter === 9728 &&
        image?.mimeType === "image/png"
    );

    const vox = exportVox(volume, exportPalette);
    assert(
      `real fixture exports to valid VOX: ${fixture.name}`,
      vox instanceof Uint8Array && vox.length > 16 &&
        new TextDecoder().decode(vox.subarray(0, 4)) === "VOX "
    );

    const obj = exportObj(volume, exportPalette, { name: exportName });
    assert(
      `real fixture exports to non-empty OBJ/MTL: ${fixture.name}`,
      typeof obj?.obj === "string" && /^v /m.test(obj.obj) &&
        typeof obj?.mtl === "string" && obj.mtl.length > 0
    );
  }
} finally {
  globalThis.URL = originalUrl;
  globalThis.Image = originalImage;
  globalThis.document = originalDocument;
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`\n${failed} real-fixture regression assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll real PNG/JPEG fixture regression checks passed.");
