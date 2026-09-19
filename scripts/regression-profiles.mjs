/**
 * P7 adaptive game-asset profile regression.
 * Run: node --experimental-strip-types scripts/regression-profiles.mjs
 */
import { adaptiveAssetProfile, adaptiveHeightMax } from "../lib/ai/assetProfiles.ts";
import { dynamicVoxelBudget } from "../lib/image/budget.ts";

const features = {
  thin: false,
  long: false,
  tapered: false,
  symmetric: false,
  broadHead: false,
  irregular: false
};

const evidence = {
  hits: 200,
  fill: 0.5,
  aspect: 1.2,
  slenderness: 1.2,
  symmetry: 0.6,
  taper: 0.8,
  bulge: 1,
  widthCv: 0.15,
  edgeThinness: 0.1
};

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

const sword = adaptiveAssetProfile({
  category: "swords",
  features: { ...features, thin: true, long: true },
  evidence: { ...evidence, aspect: 3.4, slenderness: 3.4 },
  width: 40,
  height: 160,
  volumeSize: 128,
  mode: "model",
  hasSide: false,
  hasDepth: false
});

const rifleFront = adaptiveAssetProfile({
  category: "rifles",
  features: { ...features, thin: true, long: true },
  evidence: { ...evidence, aspect: 0.55, slenderness: 3.2 },
  width: 160,
  height: 44,
  volumeSize: 128,
  mode: "model",
  hasSide: false,
  hasDepth: true
});

const rifleDual = adaptiveAssetProfile({
  category: "rifles",
  features: { ...features, thin: true, long: true },
  evidence: { ...evidence, aspect: 0.55, slenderness: 3.2 },
  width: 160,
  height: 44,
  volumeSize: 128,
  mode: "model",
  hasSide: true,
  hasDepth: true
});


const budgetArgs = {
  volumeSize: 128,
  mode: "model",
  defaultCap: 100000,
  width: 80,
  height: 80,
  depth: 8,
  projectedFill: 0.5,
  category: "objects"
};
const budgetBase = dynamicVoxelBudget({ ...budgetArgs, profileScale: 1 });
const budgetBoost = dynamicVoxelBudget({ ...budgetArgs, profileScale: 1.08 });
const budgetExplicit = dynamicVoxelBudget({ ...budgetArgs, requested: 12000, profileScale: 1.08 });

const prop = adaptiveAssetProfile({
  category: "objects",
  features: { ...features, broadHead: true },
  evidence: { ...evidence, fill: 0.62, bulge: 1.4 },
  width: 80,
  height: 80,
  volumeSize: 128,
  mode: "model",
  hasSide: true,
  hasDepth: true
});

assert("sword keeps thin-feature protection", sword.thinFeatures && sword.shell);
assert("sword keeps depth hint disabled", sword.useDepthHint === false);
assert("rifle front is thinner than its category baseline", rifleFront.depthScale < 1);
assert("dual-view can add bounded depth support", rifleDual.depthScale > rifleFront.depthScale);
assert("dual-view budget nudge stays bounded", rifleDual.budgetScale >= 0.96 && rifleDual.budgetScale <= 1.1);
assert("prop remains non-sword", prop.shell === false);
assert("all depth scales stay bounded", [sword, rifleFront, rifleDual, prop].every((p) => p.depthScale >= 0.72 && p.depthScale <= 1.08));
assert("all budget scales stay bounded", [sword, rifleFront, rifleDual, prop].every((p) => p.budgetScale >= 0.96 && p.budgetScale <= 1.1));
assert("height max never drops below 2", adaptiveHeightMax(1, 128, sword) >= 2);
assert("height max remains inside volume", adaptiveHeightMax(128, 128, prop) < 128);
assert("adaptive budget can add bounded capacity", budgetBoost >= budgetBase && budgetBoost <= 100000);
assert("explicit maxVoxels ignores adaptive budget scale", budgetExplicit === 12000);
assert("profile is deterministic", JSON.stringify(prop) === JSON.stringify(adaptiveAssetProfile({
  category: "objects",
  features: { ...features, broadHead: true },
  evidence: { ...evidence, fill: 0.62, bulge: 1.4 },
  width: 80,
  height: 80,
  volumeSize: 128,
  mode: "model",
  hasSide: true,
  hasDepth: true
})));

if (failed) {
  console.error(`\n${failed} adaptive profile assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll adaptive profile regression checks passed.");
