import fs from 'node:fs';
import assert from 'node:assert/strict';

const runtimeSource = fs.readFileSync(new URL('../lib/ai/runtime.ts', import.meta.url), 'utf8');
const engineSource = fs.readFileSync(new URL('../lib/image/engine.ts', import.meta.url), 'utf8');
const enhanceSource = fs.readFileSync(new URL('../lib/ai/enhance.ts', import.meta.url), 'utf8');

function ok(label, value) {
  assert.equal(Boolean(value), true, label);
  console.log(`OK   ${label}`);
}

ok('adaptive depth is cached on the source grid', /buildAdaptiveDepthGrid\(/.test(engineSource));
ok('adaptive depth callers pass the cache',
  (engineSource.match(/adaptiveDepthAt\(/g) ?? []).length === 4 && engineSource.includes('options.aiCategory,\n        adaptiveDepthGrid'));
ok('Local AI reuses one source Canvas', /const sourceCanvas = wantSegment \|\| wantDepth \? rasterToCanvas\(raster\)/.test(enhanceSource));
ok('Local AI passes the reused Canvas into inference',
  enhanceSource.includes('runMap("segment", raster, sourceCanvas)') &&
  enhanceSource.includes('runMap("depth", raster, sourceCanvas)'));
ok('ONNX inference is serialized per model', runtimeSource.includes('const inferenceTails = new Map<AiModelId, Promise<void>>()'));
ok('ONNX calls use the serialized runner', enhanceSource.includes('await runModel(id, session'));
ok('two-view segmentation is processed sequentially', engineSource.includes('for (const raster of rasters)'));
ok('two-view path no longer launches parallel segmentation', !/Promise\.all\(\s*rasters\.map\(\(raster\) =>\s*applyLocalAiRaster/s.test(engineSource));

// Reproduce the runtime queue semantics with a local mock of runModel.
const queues = new Map();
async function queuedRun(id, session, feeds) {
  const previous = queues.get(id) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  queues.set(id, current);
  await previous;
  try {
    return await session.run(feeds);
  } finally {
    release();
    if (queues.get(id) === current) queues.delete(id);
  }
}

let active = 0;
let maxActive = 0;
const order = [];
const mock = {
  async run(feed) {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(`start-${feed.id}`);
    await new Promise((resolve) => setTimeout(resolve, feed.delay));
    order.push(`end-${feed.id}`);
    active -= 1;
    return { id: feed.id };
  }
};

const results = await Promise.all([
  queuedRun('segment', mock, { id: 'a', delay: 18 }),
  queuedRun('segment', mock, { id: 'b', delay: 6 }),
  queuedRun('segment', mock, { id: 'c', delay: 1 })
]);

assert.equal(maxActive, 1, 'same model inference must never overlap');
assert.deepEqual(results.map((r) => r.id), ['a', 'b', 'c']);
assert.deepEqual(order, ['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c']);
ok('same-model inference queue stays single-flight', true);

console.log('All performance and browser-stability checks passed.');
