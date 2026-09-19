import type { Raster } from "@/lib/image/types";
import { MIN_ALPHA } from "@/lib/image/constants";

/**
 * Conservative cleanup for premultiplied / JPEG-on-white fringes.
 * Opaque pixels are left untouched so reconstruction math stays identical.
 */
export function sanitizeRaster(raster: Raster): Raster {
  const { width, height, rgba } = raster;
  if (width < 1 || height < 1 || rgba.length < 4) {
    throw new Error("Unable to read image");
  }
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a < MIN_ALPHA) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }
    // Near-invisible near-white fringe (typical PNG-on-white / JPEG matte).
    if (a < 48 && out[i] > 240 && out[i + 1] > 240 && out[i + 2] > 240) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
    }
  }
  return { width, height, rgba: out };
}
