/** Soft browser capability probe. Never throws. */

export type BrowserCompat = {
  canvas: boolean;
  wasm: boolean;
  webgl: boolean;
};

export function probeBrowserCompat(): BrowserCompat {
  const canvas = typeof document !== "undefined" && Boolean(document.createElement);
  let wasm = false;
  try {
    wasm = typeof WebAssembly !== "undefined";
  } catch {
    wasm = false;
  }
  let webgl = false;
  try {
    if (typeof document !== "undefined") {
      const el = document.createElement("canvas");
      webgl = Boolean(el.getContext("webgl2") || el.getContext("webgl"));
    }
  } catch {
    webgl = false;
  }
  return { canvas, wasm, webgl };
}

export function localAiSupported(compat: BrowserCompat = probeBrowserCompat()) {
  return compat.wasm;
}
