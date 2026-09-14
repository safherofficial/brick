let cvPromise: Promise<any | null> | null = null;

const OPENCV_SRC = "https://docs.opencv.org/4.13.0/opencv.js";
const OPENCV_TIMEOUT_MS = 12_000;

type OpenCvMask = boolean[][];

declare global {
  interface Window {
    cv?: any;
  }
}

function loadScript(src: string) {
  return new Promise<any | null>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-brick-opencv="true"]`
    );

    const finish = () => {
      const current = window.cv;
      if (!current) {
        resolve(null);
        return;
      }
      if (current instanceof Promise) {
        current.then(resolve).catch(() => resolve(null));
        return;
      }
      if (typeof current.Mat === "function") {
        resolve(current);
        return;
      }
      resolve(null);
    };

    if (existing) {
      if (window.cv) {
        finish();
        return;
      }
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => resolve(null), { once: true });
      window.setTimeout(() => resolve(null), OPENCV_TIMEOUT_MS);
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    script.dataset.brickOpencv = "true";
    script.onload = finish;
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
    window.setTimeout(() => resolve(null), OPENCV_TIMEOUT_MS);
  });
}

async function getOpenCv() {
  if (typeof window === "undefined") return null;
  if (window.cv) return window.cv instanceof Promise ? window.cv : window.cv;
  if (!cvPromise) cvPromise = loadScript(OPENCV_SRC);
  return cvPromise;
}

export async function refineMaskWithOpenCv(mask: OpenCvMask): Promise<OpenCvMask> {
  if (!mask.length || !mask[0]?.length) return mask;

  const cv = await getOpenCv();
  if (!cv) return mask;

  const h = mask.length;
  const w = mask[0].length;
  let source: any = null;
  let closed: any = null;
  let kernel: any = null;

  try {
    source = new cv.Mat(h, w, cv.CV_8UC1);
    for (let y = 0; y < h; y += 1) {
      const row = source.data.subarray(y * w, (y + 1) * w);
      for (let x = 0; x < w; x += 1) row[x] = mask[y][x] ? 255 : 0;
    }

    kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    closed = new cv.Mat();
    cv.morphologyEx(source, closed, cv.MORPH_CLOSE, kernel);

    const out = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
    for (let y = 0; y < h; y += 1) {
      const row = closed.data.subarray(y * w, (y + 1) * w);
      for (let x = 0; x < w; x += 1) out[y][x] = row[x] >= 128;
    }
    return out;
  } catch {
    return mask;
  } finally {
    try {
      source?.delete();
      closed?.delete();
      kernel?.delete();
    } catch {
      // OpenCV owns these allocations; failure to release one should not abort voxelization.
    }
  }
}
