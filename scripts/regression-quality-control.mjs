import fs from "node:fs";

const source = fs.readFileSync("lib/image/qualityControl.ts", "utf8");
const engine = fs.readFileSync("lib/image/engine.ts", "utf8");

const checks = [
  ["quality module exports evaluator", /export function evaluateVoxelQuality/.test(source)],
  ["silhouette retention metric", /silhouette-retention/.test(source)],
  ["projection precision metric", /projection-precision/.test(source)],
  ["connected component metric", /connectedComponents/.test(source)],
  ["bounded status gate", /status: QualityStatus/.test(source)],
  ["reject gate is conservative", /const hardFailure = retention < 0\.42/.test(source)],
  ["repair gate exists", /const repairable =/.test(source)],
  ["safe integrity repair exists", /export function repairVoxelIntegrity/.test(source)],
  ["repair only wins with material score improvement", /initialQuality\.score \+ 3/.test(engine)]
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL ${name}`);
  console.log(`OK   ${name}`);
}

console.log("All P9.1 quality-control checks passed.");

const repairCode = source.match(/export function repairVoxelIntegrity[\s\S]*?\n}\n\nexport function evaluateVoxelQuality/);
if (!repairCode) throw new Error("FAIL repair function block");
if (!/seen\.has\(key\)/.test(repairCode[0])) throw new Error("FAIL repair dedupe");
console.log("OK   safe integrity repair block");
