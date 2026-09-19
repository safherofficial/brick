/** Promise timeout used by import decode and ONNX load/run. */

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export const IMPORT_TIMEOUT_MS = 45_000;
export const DECODE_TIMEOUT_MS = 20_000;
export const ONNX_LOAD_TIMEOUT_MS = 20_000;
export const ONNX_RUN_TIMEOUT_MS = 15_000;
export const ONNX_PROBE_TIMEOUT_MS = 4_000;
