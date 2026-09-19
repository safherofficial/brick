import type { InferenceSession } from "onnxruntime-web";

export type AiModelId = "segment" | "depth";

/** Local-first. Remote URLs only outside production (dev fallback). */
const LOCAL_MODELS: Record<AiModelId, string[]> = {
  segment: ["/models/u2netp.onnx", "/models/rmbg.onnx"],
  depth: ["/models/midas-small.onnx", "/models/depth-small.onnx"]
};

const REMOTE_MODELS: Record<AiModelId, string[]> = {
  segment: [
    "https://huggingface.co/Heliosoph/u2net-onnx/resolve/main/u2netp.onnx",
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
  ],
  depth: ["https://huggingface.co/Heliosoph/midas-small-onnx/resolve/main/midas_v21_small_256.onnx"]
};

function modelCandidates(id: AiModelId): string[] {
  const local = LOCAL_MODELS[id];
  if (process.env.NODE_ENV === "production") return local;
  return [...local, ...REMOTE_MODELS[id]];
}

export const MODEL_FILES: Record<AiModelId, string[]> = {
  segment: modelCandidates("segment"),
  depth: modelCandidates("depth")
};

const sessions = new Map<AiModelId, Promise<InferenceSession | null>>();
const resolved = new Map<AiModelId, Promise<string | null>>();
const inferenceTails = new Map<AiModelId, Promise<void>>();

const ORT_WASM_LOCAL = "/ort/";
const ORT_WASM_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";

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
    for (const url of modelCandidates(id)) {
      if (await probe(url)) return url;
    }
    return null;
  })();
  resolved.set(id, job);
  return job;
}

type WasmEnv = {
  wasmPaths?: string;
  numThreads?: number;
  simd?: boolean;
};

function configureWasm(
  ort: typeof import("onnxruntime-web"),
  wasmPaths: string
) {
  const wasm = ort.env.wasm as WasmEnv;
  wasm.wasmPaths = wasmPaths;
  try {
    const cores =
      typeof navigator !== "undefined" && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 2;
    wasm.numThreads = Math.min(4, Math.max(1, Math.floor(cores / 2)));
  } catch {
    /* ignore */
  }
  try {
    wasm.simd = true;
  } catch {
    /* ignore */
  }
}

async function createSession(
  ort: typeof import("onnxruntime-web"),
  url: string,
  wasmPaths: string
): Promise<InferenceSession> {
  configureWasm(ort, wasmPaths);
  const options = {
    executionProviders: ["wasm"] as string[],
    graphOptimizationLevel: "all" as const,
    enableCpuMemArena: true,
    enableMemPattern: true
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ort.InferenceSession.create(url, options as any);
}

export async function loadModel(id: AiModelId) {
  const existing = sessions.get(id);
  if (existing) return existing;

  const job = (async () => {
    const candidates = modelCandidates(id);
    let ort: typeof import("onnxruntime-web");
    try {
      ort = await import("onnxruntime-web");
    } catch {
      return null;
    }

    for (const url of candidates) {
      if (!(await probe(url))) continue;
      try {
        return await createSession(ort, url, ORT_WASM_LOCAL);
      } catch {
        try {
          return await createSession(ort, url, ORT_WASM_CDN);
        } catch {
          // Keep trying the next local/remote candidate instead of pinning
          // the whole model to a single broken or incompatible file.
        }
      }
    }

    return null;
  })();

  sessions.set(id, job);
  return job;
}


export async function runModel(
  id: AiModelId,
  session: InferenceSession,
  feeds: Parameters<InferenceSession["run"]>[0]
) {
  const previous = inferenceTails.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  inferenceTails.set(id, current);
  await previous;
  try {
    return await session.run(feeds);
  } finally {
    release();
    if (inferenceTails.get(id) === current) inferenceTails.delete(id);
  }
}

export async function aiAvailable() {
  const [segment, depth] = await Promise.all([resolveModel("segment"), resolveModel("depth")]);
  return { segment: Boolean(segment), depth: Boolean(depth) };
}

export function preloadAiModels() {
  if (typeof window === "undefined") return;
  void loadModel("segment");
}
