/**
 * Download lightweight ONNX models into public/models for offline/in-browser AI.
 */
import { createWriteStream } from "node:fs";
import { mkdir, access } from "node:fs/promises";
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

const aliases = [
  ["u2netp.onnx", "rmbg.onnx"],
  ["midas-small.onnx", "depth-small.onnx"]
];
for (const [srcName, aliasName] of aliases) {
  const src = path.join(outDir, srcName);
  const alias = path.join(outDir, aliasName);
  if ((await exists(src)) && !(await exists(alias))) {
    const { copyFile } = await import("node:fs/promises");
    await copyFile(src, alias);
    console.log("alias", aliasName, "←", srcName);
  }
}

console.log("Done. Models in public/models/");
