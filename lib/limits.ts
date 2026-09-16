// Limiti condivisi tra pubblicazione (app/api/creations/route.ts) ed export
// (lib/voxelGlb.ts). Prima erano due costanti scollegate (150_000 vs 80_000):
// un modello legittimo e pubblicabile poteva risultare non esportabile in
// .glb. Un solo numero, una sola fonte di verità.
export const MAX_VOXELS = 150_000;

export const GENERATOR_NAME = "Brick Builder v0.2.0";
