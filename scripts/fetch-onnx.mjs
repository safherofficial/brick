/**
 * 1) Download lightweight ONNX models into public/models
 * 2) Copy onnxruntime-web WASM binaries into public/ort (self-host, no CDN)
 */
import { createWriteStream, createReadStream, existsSync } from "node:fs";
import { mkdir, access, copyFile, readdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "models");
const ortOut = path.join(root, "public", "ort");
const ortSrc = path.join(root, "node_modules", "onnxruntime-web", "dist");

const FILES = [
  {
    name: "u2netp.onnx",
    urls: [
      "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx",
      "https://huggingface.co/Heliosoph/u2net-onnx/resolve/main/u2netp.onnx"
    ]
  },
  {
    name: "midas-small.onnx",
    urls: [
      "https://huggingface.co/Heliosoph/midas-small-onnx/resolve/main/midas_v21_small_256.onnx"
    ]
  }
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`${url} → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

await mkdir(outDir, { recursive: true });

for (const file of FILES) {
  const dest = path.join(outDir, file.name);
  if (await exists(dest)) {
    console.log("skip (exists)", file.name);
    continue;
  }
  let ok = false;
  for (const url of file.urls) {
    try {
      console.log("fetch", file.name, "from", url);
      await download(url, dest);
      ok = true;
      console.log("ok", file.name);
      break;
    } catch (e) {
      console.warn("fail", url, String(e.message || e));
    }
  }
  if (!ok) console.error("MISSING", file.name);
}

// Copy ORT wasm/mjs assets for self-host under /ort/
await mkdir(ortOut, { recursive: true });
if (existsSync(ortSrc)) {
  const entries = await readdir(ortSrc);
  const want = entries.filter(
    (f) =>
      f.endsWith(".wasm") ||
      f.startsWith("ort-wasm") ||
      f.includes("wasm")
  );
  for (const f of want) {
    const src = path.join(ortSrc, f);
    const dest = path.join(ortOut, f);
    try {
      await copyFile(src, dest);
      console.log("ort copy", f);
    } catch (e) {
      console.warn("ort skip", f, String(e.message || e));
    }
  }
  console.log("ORT wasm → public/ort/");
} else {
  console.warn("onnxruntime-web dist not found — run npm install first");
}

console.log("Done. Models in public/models/ ; WASM in public/ort/");
