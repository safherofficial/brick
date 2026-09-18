# lib/image — image→voxel pipeline (decomposed)

| File | Role |
|------|------|
| types.ts | Public + internal TypeScript types |
| constants.ts | Palette, MODEL_* thresholds, Bayer matrix |
| engine.ts | Full pipeline implementation (former imageVoxel.ts body) |

Public entry remains `@/lib/imageVoxel` (stable for Builder / AI / export).
