import type { InferenceSession } from "onnxruntime-web";

export type AiModelId = "segment" | "depth";

export const MODEL_FILES: Record<AiModelId, string> = {
  segment: "/models/rmbg.onnx",
  depth: "/models/depth-small.onnx"
};

const sessions = new Map<AiModelId, Promise<InferenceSession | null>>();

export async function loadModel(id: AiModelId) {
  const existing = sessions.get(id);
  if (existing) return existing;

  const job = (async () => {
    try {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.wasmPaths =
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";
      return await ort.InferenceSession.create(MODEL_FILES[id], {
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
  const [segment, depth] = await Promise.all([
    loadModel("segment"),
    loadModel("depth")
  ]);
  return {
    segment: Boolean(segment),
    depth: Boolean(depth)
  };
}
