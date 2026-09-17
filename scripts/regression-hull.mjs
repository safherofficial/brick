/**
 * Lightweight regression for visual-hull helpers (no browser / ONNX).
 * Run: node scripts/regression-hull.mjs
 *
 * Golden checks:
 * - thin SIDE profile scoring
 * - second-FRONT detection (strict)
 * - adaptive-like aspect math for sword proportions
 */

function assessSideView(frontBounds, sideBounds) {
  const aspectWH = frontBounds.width / Math.max(1, frontBounds.height);
  const aspectDH = sideBounds.width / Math.max(1, sideBounds.height);
  const aspectRatio = aspectDH / Math.max(1e-6, aspectWH);
  const sideLooksLikeFront =
    aspectDH >= 0.35 && aspectRatio >= 0.8 && aspectRatio <= 1.25;
  const sideLooksLikeProfile = aspectDH < 0.28 && aspectDH < aspectWH * 0.55;
  return { aspectWH, aspectDH, sideLooksLikeFront, sideLooksLikeProfile };
}

function isSideAmbiguous(a) {
  if (a.sideLooksLikeFront || a.sideLooksLikeProfile) return false;
  return a.aspectDH >= 0.22 && a.aspectDH < 0.45;
}

function adaptiveDims(frontBounds, sideBounds, heightMax = 6) {
  const maxAxis = 120;
  let height = Math.min(maxAxis, Math.max(4, frontBounds.height));
  let width = Math.max(4, Math.round(height * (frontBounds.width / Math.max(1, frontBounds.height))));
  let depth = Math.max(
    4,
    Math.round(height * (sideBounds.width / Math.max(1, sideBounds.height)))
  );
  width = Math.min(maxAxis, width);
  depth = Math.min(maxAxis, depth);
  return { width, height, depth };
}

let failed = 0;
function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    failed += 1;
  } else {
    console.log("OK  ", name);
  }
}

// Golden: thin sword SIDE
{
  const front = { width: 40, height: 200 };
  const side = { width: 12, height: 200 };
  const a = assessSideView(front, side);
  assert("thin side is profile", a.sideLooksLikeProfile === true);
  assert("thin side not second-front", a.sideLooksLikeFront === false);
  assert("thin side not ambiguous", isSideAmbiguous(a) === false);
  const dims = adaptiveDims(front, side);
  assert("sword depth << height", dims.depth < dims.height * 0.2);
  assert("sword width < height", dims.width < dims.height * 0.5);
}

// Golden: bad SIDE (copy of front proportions)
{
  const front = { width: 80, height: 200 };
  const side = { width: 78, height: 200 };
  const a = assessSideView(front, side);
  assert("fat side looks like front", a.sideLooksLikeFront === true);
  assert("fat side not profile", a.sideLooksLikeProfile === false);
}

// Golden: mid ambiguous SIDE (depth clamp candidate)
{
  // Thin-ish FRONT, moderately wide SIDE → not a duplicate front, mid band.
  const front = { width: 30, height: 180 }; // aspect ~0.17
  const side = { width: 55, height: 180 }; // aspect ~0.31
  const b = assessSideView(front, side);
  assert("mid side not second-front", b.sideLooksLikeFront === false);
  assert("mid side ambiguous", isSideAmbiguous(b) === true);
}

// Golden: proportions stable under uniform scale
{
  const front = { width: 30, height: 240 };
  const side = { width: 10, height: 240 };
  const d = adaptiveDims(front, side);
  const ratio = d.width / d.height;
  const expected = 30 / 240;
  assert("aspect preserved ~", Math.abs(ratio - expected) < 0.05);
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll hull regression checks passed.");
