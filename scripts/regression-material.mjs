/**
 * P6 material reconstruction regression.
 * Executes the real FRONT + SIDE reconstruction pipeline with local AI disabled,
 * using a tiny in-memory browser adapter so the test stays deterministic.
 * Run: node --experimental-strip-types scripts/regression-material.mjs
 */
import { imagesToVoxels } from "../lib/image/engine.ts";

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

const rasterByUrl = new Map();
let urlId = 0;
const originalUrl = globalThis.URL;
globalThis.URL = {
  createObjectURL(file) {
    const token = `brick-test-image-${++urlId}`;
    rasterByUrl.set(token, file.__brickRaster);
    return token;
  },
  revokeObjectURL(token) {
    rasterByUrl.delete(token);
  }
};

class TestImage {
  naturalWidth = 0;
  naturalHeight = 0;
  width = 0;
  height = 0;
  onload = null;
  onerror = null;
  setSrc(value) {
    this.src = value;
  }
}
Object.defineProperty(TestImage.prototype, "src", {
  get() {
    return this._src ?? "";
  },
  set(value) {
    this._src = value;
    const raster = rasterByUrl.get(value);
    if (!raster) return;
    this.naturalWidth = raster.width;
    this.naturalHeight = raster.height;
    this.width = raster.width;
    this.height = raster.height;
    queueMicrotask(() => this.onload?.());
  }
});
globalThis.Image = TestImage;

globalThis.document = {
  createElement(tag) {
    if (tag !== "canvas") throw new Error(`unsupported test element: ${tag}`);
    const canvas = {
      width: 0,
      height: 0,
      _raster: null,
      getContext() {
        return {
          clearRect() {},
          drawImage(image) {
            this._canvas._raster = rasterByUrl.get(image.src);
          },
          getImageData() {
            return this._canvas._raster.rgba;
          },
          _canvas: canvas
        };
      }
    };
    return canvas;
  }
};

function makeRaster(width, height, rgb) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      const i = (y * width + x) * 4;
      rgba[i] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
      rgba[i + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function makeFile(name, rgb) {
  const file = new File([new Uint8Array(64)], name, { type: "image/png" });
  file.__brickRaster = makeRaster(12, 12, rgb);
  return file;
}

const front = makeFile("front.png", [220, 42, 42]);
const side = makeFile("side.png", [42, 82, 220]);

const result = await imagesToVoxels(
  { front, side },
  {
    volumeSize: 32,
    mode: "model",
    maxVoxels: 10000,
    useLocalAi: false,
    aiCategory: "objects"
  }
);

assert("real reconstruction produced voxels", result.count > 0 && result.voxels.length > 0);
const usedIndices = [...new Set(result.voxels.map((voxel) => voxel.c))];
assert("real reconstruction uses more than one material color", usedIndices.length >= 2);
const usedColors = usedIndices.map((index) => result.palette[index] ?? "#000000");
const rgb = usedColors.map((hex) => {
  const clean = hex.replace(/^#/, "");
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16)
  ];
});
const colorSpread = Math.max(...rgb.map((c) => Math.max(...c) - Math.min(...c)));
const minLuma = Math.min(...rgb.map((c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]));
assert("material output preserves visible chroma", colorSpread >= 40);
assert("material output avoids dark-collapse", minLuma >= 20);

// Restore the process globals after executing the real importer.
globalThis.URL = originalUrl;

if (failed) {
  console.error(`\n${failed} material functional assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll material functional regression checks passed.");
