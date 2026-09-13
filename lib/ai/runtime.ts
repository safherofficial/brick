import type { InferenceSession } from "onnxruntime-web";

export type AiModelId = "segment" | "depth";

export const MODEL_FILES: Record<AiModelId, string[]> = {
  segment: [
    "/models/u2netp.onnx",
    "/models/rmbg.onnx",
    "https://huggingface.co/Heliosoph/u2net-onnx/resolve/main/u2netp.onnx",
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
  ],
  depth: [
    "/models/midas-small.onnx",
    "/models/depth-small.onnx",
    "https://huggingface.co/Heliosoph/midas-small-onnx/resolve/main/midas_v21_small_256.onnx"
  ]
};

const sessions = new Map<AiModelId, Promise<InferenceSession | null>>();
const resolved = new Map<AiModelId, Promise<string | null>>();

async function probe(url: string) {
  try {
    const head = await fetch(url, { method: "HEAD", mode: "cors", cache: "force-cache" });
    if (head.ok) return true;
  } catch {
    /* some hosts reject HEAD */
  }
  try {
    const get = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "force-cache",
      headers: { Range: "bytes=0-64" }
    });
    return get.ok || get.status === 206;
  } catch {
    return false;
  }
}

export async function resolveModel(id: AiModelId) {
  const cached = resolved.get(id);
  if (cached) return cached;
  const job = (async () => {
    for (const url of MODEL_FILES[id]) {
      if (await probe(url)) return url;
    }
    return null;
  })();
  resolved.set(id, job);
  return job;
}

export async function loadModel(id: AiModelId) {
  const existing = sessions.get(id);
  if (existing) return existing;

  const job = (async () => {
    const url = await resolveModel(id);
    if (!url) return null;
    try {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";
      return await ort.InferenceSession.create(url, {
        executionProviders: ["wasm"]
      });
    } catch {
      return null;
    }
  })();

  sessions.set(id, job);
  return job;
}

export async function aiAvailable() {
  const [segment, depth] = await Promise.all([resolveModel("segment"), resolveModel("depth")]);
  return { segment: Boolean(segment), depth: Boolean(depth) };
}
