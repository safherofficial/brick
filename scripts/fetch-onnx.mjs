/**
 * Download lightweight ONNX models into public/models for offline/in-browser AI.
 */
import { createWriteStream } from "node:fs";
import { mkdir, access, rename, rm, stat, readdir, copyFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "models");

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
  const tmp = `${dest}.part`;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`${url} → ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    const size = (await stat(tmp)).size;
    if (size < 64 * 1024) {
      throw new Error(`${url} → downloaded file is unexpectedly small (${size} bytes)`);
    }
    await rename(tmp, dest);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
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

const aliases = [
  ["u2netp.onnx", "rmbg.onnx"],
  ["midas-small.onnx", "depth-small.onnx"]
];
for (const [srcName, aliasName] of aliases) {
  const src = path.join(outDir, srcName);
  const alias = path.join(outDir, aliasName);
  if ((await exists(src)) && !(await exists(alias))) {
    await copyFile(src, alias);
    console.log("alias", aliasName, "←", srcName);
  }
}

const ortDist = path.join(root, "node_modules", "onnxruntime-web", "dist");
const ortOut = path.join(root, "public", "ort");
try {
  const ortFiles = await readdir(ortDist);
  const wasmFiles = ortFiles.filter((name) => name.endsWith(".wasm"));
  if (wasmFiles.length) {
    await mkdir(ortOut, { recursive: true });
    for (const name of wasmFiles) {
      const source = path.join(ortDist, name);
      const target = path.join(ortOut, name);
      if (!(await exists(target))) {
        await copyFile(source, target);
        console.log("ort wasm", name);
      }
    }
  } else {
    console.warn("No ONNX Runtime WASM files found in", ortDist);
  }
} catch (error) {
  console.warn("ONNX Runtime local WASM preparation skipped:", String(error?.message || error));
}

console.log("Done. Local AI assets prepared in public/models/ and public/ort/");
