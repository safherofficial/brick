export const DEFAULT_PALETTE = [
  "#111111",
  "#ffffff",
  "#d9d9d9",
  "#8a8a8a",
  "#3f3f3f",
  "#d72d32",
  "#ff6b2d",
  "#f0c52b",
  "#4fae4f",
  "#1596d1",
  "#3456c1",
  "#754bc4",
  "#d34893",
  "#7a4b2a",
  "#5a9b47",
  "#9e6a3a"
];

export const MAX_RASTER_EDGE = 512;
/** Pixels below this alpha are treated as empty (post-ONNX matte is near-binary). */
export const MIN_ALPHA = 16;
export const MODEL_BUDGET_FILL = 0.90;
export const MODEL_MIN_AXIS = 4;
export const MODEL_EDGE_TOLERANCE = 72;
export const MODEL_EDGE_LUMINANCE_TOLERANCE = 54;
export const MODEL_MIN_COMPONENT_RATIO = 0.0025;
export const MODEL_MIN_COMPONENT_PIXELS = 24;
export const MODEL_BG_COLOR_TOLERANCE = 92;
export const MODEL_BG_LUMINANCE_TOLERANCE = 72;

export const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];
