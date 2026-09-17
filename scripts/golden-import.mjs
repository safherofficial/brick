/**
 * Golden checks for category unification, shell, finish evenPack, hull.
 * Run: node scripts/golden-import.mjs
 */

function maskRect(w, h, fill) {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => fill(x, y, w, h))
  );
}

function stats(mask) {
  const h = mask.length;
  const w = mask[0].length;
  let hits = 0, minX = w, minY = h, maxX = -1, maxY = -1;
  const rowW = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    let lo = w, hi = -1;
    for (let x = 0; x < w; x++) {
      if (!mask[y][x]) continue;
      hits++;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    rowW[y] = hi >= 0 ? hi - lo + 1 : 0;
  }
  const bw = Math.max(1, maxX - minX + 1);
  const bh = Math.max(1, maxY - minY + 1);
  return {
    hits,
    fill: hits / (bw * bh),
    aspect: bh / bw,
    slenderness: Math.max(bw, bh) / Math.min(bw, bh)
  };
}

function categoryFromStats(s) {
  if (s.aspect <= 0.78 && s.fill >= 0.12 && s.fill <= 0.48 && s.slenderness >= 2.05) {
    return s.slenderness >= 3.15 ? "rifles" : "guns";
  }
  if (s.aspect >= 1.7 && s.fill <= 0.28 && s.slenderness >= 2.4) return "swords";
  return "objects";
}

function wantsDepth(category, mode) {
  if (mode === "flat") return false;
  if (!category) return mode !== "flat";
  return category !== "swords";
}

function surfaceShell(voxels) {
  const occ = new Set(voxels.map((v) => `${v.x},${v.y},${v.z}`));
  return voxels.filter((v) => {
    const k = (x, y, z) => occ.has(`${x},${y},${z}`);
    return !k(v.x - 1, v.y, v.z) || !k(v.x + 1, v.y, v.z) || !k(v.x, v.y - 1, v.z) || !k(v.x, v.y + 1, v.z) || !k(v.x, v.y, v.z - 1) || !k(v.x, v.y, v.z + 1);
  });
}

function evenPackSkip(voxels, volumeSize) {
  let minY = Infinity, minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const v of voxels) {
    minY = Math.min(minY, v.y);
    minX = Math.min(minX, v.x);
    minZ = Math.min(minZ, v.z);
    maxX = Math.max(maxX, v.x);
    maxZ = Math.max(maxZ, v.z);
  }
  return minY === 0 && minX >= 0 && minZ >= 0 && maxX < volumeSize && maxZ < volumeSize;
}

let failed = 0;
function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    failed += 1;
  } else console.log("OK  ", name);
}

{
  const rifle = maskRect(100, 30, (x, y) => (y >= 14 && y <= 16 && x >= 5 && x <= 95) || (y >= 16 && y <= 28 && x >= 8 && x <= 18));
  const s = stats(rifle);
  assert("rifle landscape slenderness", s.slenderness >= 3.15);
  assert("rifle category", categoryFromStats(s) === "rifles");
  assert("rifle wants depth", wantsDepth("rifles", "model") === true);
}

{
  const gun = maskRect(50, 28, (x, y) => (y >= 12 && y <= 15 && x >= 4 && x <= 46) || (y >= 15 && y <= 26 && x >= 8 && x <= 18));
  const s = stats(gun);
  assert("gun category", categoryFromStats(s) === "guns");
}

{
  const sword = maskRect(22, 90, (x, y) => (x >= 10 && x <= 11 && y >= 4 && y <= 88) || (y >= 82 && x >= 6 && x <= 16));
  const s = stats(sword);
  assert("sword portrait category", categoryFromStats(s) === "swords");
  assert("sword skips depth", wantsDepth("swords", "model") === false);
}

{
  const crate = maskRect(32, 32, (x, y) => x > 4 && x < 28 && y > 4 && y < 28);
  assert("crate objects", categoryFromStats(stats(crate)) === "objects");
}

{
  const slab = [];
  for (let x = 0; x < 4; x++) for (let y = 0; y < 8; y++) for (let z = 0; z < 5; z++) slab.push({ x, y, z });
  const shell = surfaceShell(slab);
  assert("shell smaller than slab", shell.length < slab.length);
  assert("shell keeps surface", shell.length >= 4 * 8 * 2);
}

{
  const grounded = [
    { x: 10, y: 0, z: 10 },
    { x: 11, y: 0, z: 10 }
  ];
  assert("evenPack skip when grounded", evenPackSkip(grounded, 64) === true);
}

{
  assert("flat never depth", wantsDepth("guns", "flat") === false);
  assert("auto solid depth", wantsDepth(undefined, "solid") === true);
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll golden import checks passed.");
