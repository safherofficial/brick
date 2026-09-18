/**
 * Deterministic target-asset regression suite.
 *
 * These cases model the proportions and projected complexity Brick is intended
 * to handle in 2D/2.5D/voxel games: sword, handgun, rifle, shield, crate and
 * bottle. The suite exercises the same standalone budget allocator used by
 * the image engine, so a budget change cannot silently exceed the established
 * default cap or collapse thin game-readable assets.
 *
 * Run: node --experimental-strip-types scripts/regression-assets.mjs
 */
import { dynamicVoxelBudget } from "../lib/image/budget.ts";

const cases = [
  {
    name: "sword",
    category: "swords",
    mode: "model",
    width: 22,
    height: 108,
    depth: 5,
    projectedFill: 0.20
  },
  {
    name: "handgun",
    category: "guns",
    mode: "model",
    width: 72,
    height: 38,
    depth: 9,
    projectedFill: 0.34
  },
  {
    name: "rifle",
    category: "rifles",
    mode: "model",
    width: 116,
    height: 34,
    depth: 10,
    projectedFill: 0.27
  },
  {
    name: "shield",
    category: "objects",
    mode: "model",
    width: 86,
    height: 92,
    depth: 14,
    projectedFill: 0.52
  },
  {
    name: "crate",
    category: "objects",
    mode: "solid",
    width: 72,
    height: 72,
    depth: 24,
    projectedFill: 0.74
  },
  {
    name: "bottle",
    category: "objects",
    mode: "solid",
    width: 38,
    height: 84,
    depth: 16,
    projectedFill: 0.47
  }
];

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

const volumeSize = 128;
const historicalDefaultCap = 100000;

const budgets = new Map();
for (const item of cases) {
  const budget = dynamicVoxelBudget({
    volumeSize,
    mode: item.mode,
    defaultCap: historicalDefaultCap,
    width: item.width,
    height: item.height,
    depth: item.depth,
    projectedFill: item.projectedFill,
    category: item.category
  });
  budgets.set(item.name, budget);
  assert(`${item.name} stays below default cap`, budget <= historicalDefaultCap);
  assert(`${item.name} stays above safe floor`, budget >= 4096);
}

assert("sword remains protected from excessive compression", budgets.get("sword") >= 4096);
assert("rifle retains a larger budget than sword", budgets.get("rifle") > budgets.get("sword"));
assert("dense crate does not exceed cap", budgets.get("crate") <= historicalDefaultCap);
assert("bottle remains comfortably above floor", budgets.get("bottle") > 4096);

// Explicit user caps remain authoritative and must not be raised by the
// dynamic allocator.
const explicit = dynamicVoxelBudget({
  volumeSize,
  mode: "model",
  requested: 12000,
  defaultCap: historicalDefaultCap,
  width: 100,
  height: 100,
  depth: 20,
  projectedFill: 0.7,
  category: "objects"
});
assert("explicit maxVoxels remains authoritative", explicit === 12000);

// Scaling up the same object should never reduce the allocated budget.
const small = dynamicVoxelBudget({
  volumeSize: 64,
  mode: "model",
  defaultCap: 100000,
  width: 43,
  height: 54,
  depth: 8,
  projectedFill: 0.5,
  category: "objects"
});
const large = dynamicVoxelBudget({
  volumeSize: 128,
  mode: "model",
  defaultCap: 100000,
  width: 86,
  height: 108,
  depth: 16,
  projectedFill: 0.5,
  category: "objects"
});
assert("larger volume does not reduce budget", large >= small);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll asset budget regression checks passed.");
