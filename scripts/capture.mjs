import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

/**
 * Frame-by-frame motion capture: load-in, idle, and scroll behaviour.
 *
 * Usage: node scripts/capture.mjs <url> <outDir>
 *   node scripts/capture.mjs https://animejs.com/ ref
 *   node scripts/capture.mjs http://localhost:5174 our
 *
 * Runs HEADED on purpose. Headless chromium falls back to SwiftShader, which
 * rasterises these WebGL pages at ~9.7s/frame — 100x too slow to sample a 4s
 * intro. On the real GPU it is ~110ms/frame.
 *
 * Load and idle use CDP screencast rather than page.screenshot: screencast
 * frames come off the compositor with their own timestamps, so we can pick the
 * frame nearest each 100ms mark instead of letting screenshot cost set the
 * cadence. Scroll uses plain screenshots — there the 150ms settle is what
 * matters, not the capture rate.
 */

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) {
  console.error('usage: node scripts/capture.mjs <url> <outDir>');
  process.exit(1);
}

const LOAD_FRAMES = 40;    // 100ms x 40 = first 4s
const IDLE_FRAMES = 20;    // 100ms x 20 = 2s parked at scroll 0
const SCROLL_STEPS = 40;   // 41 positions, 0%..100% in 2.5% steps
const SETTLE_MS = 3000;    // after load, before idle/scroll capture

const pad = (n, w = 3) => String(n).padStart(w, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: false,
  args: ['--hide-scrollbars', '--force-device-scale-factor=1'],
});
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});

for (const d of ['load', 'idle', 'scroll']) await mkdir(`${outDir}/${d}`, { recursive: true });
const manifest = { url, capturedAt: new Date().toISOString(), load: [], idle: [], scroll: [] };

// ── screencast plumbing ────────────────────────────────────────────────
const cdp = await page.context().newCDPSession(page);
let bucket = null;   // when non-null, collects {ms, data} frames

cdp.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
  if (bucket) bucket.push({ ts: metadata.timestamp * 1000, data });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

/** Pick the frame nearest each 100ms mark and write it out. */
async function writeGrid(frames, t0, count, dir, prefix) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const want = t0 + i * 100;
    let best = null;
    for (const f of frames) {
      if (!best || Math.abs(f.ts - want) < Math.abs(best.ts - want)) best = f;
    }
    if (!best) continue;
    await writeFile(`${dir}/${prefix}_${pad(i)}.png`, Buffer.from(best.data, 'base64'));
    rows.push({ frame: i, nominalMs: i * 100, actualMs: Math.round(best.ts - t0) });
  }
  return rows;
}

// ── LOAD-IN ────────────────────────────────────────────────────────────
// Screencast starts before navigation so frame 0 is genuinely first paint,
// not "whenever the first screenshot finished encoding".
await cdp.send('Page.startScreencast',
  { format: 'png', everyNthFrame: 1, maxWidth: 1920, maxHeight: 1080 });
bucket = [];
const t0 = Date.now();
await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
await sleep(4200);
const loadFrames = bucket; bucket = null;
manifest.load = await writeGrid(loadFrames, t0, LOAD_FRAMES, `${outDir}/load`, 'frame');
console.log(`load: ${manifest.load.length} frames from ${loadFrames.length} captured`);

// ── SETTLE ─────────────────────────────────────────────────────────────
await page.waitForLoadState('load').catch(() => {});
await sleep(SETTLE_MS);
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(400);

// ── IDLE (parked at scroll 0) ──────────────────────────────────────────
bucket = [];
const ti = Date.now();
await sleep(IDLE_FRAMES * 100 + 300);
const idleFrames = bucket; bucket = null;
manifest.idle = await writeGrid(idleFrames, ti, IDLE_FRAMES, `${outDir}/idle`, 'frame');
console.log(`idle: ${manifest.idle.length} frames from ${idleFrames.length} captured`);

await cdp.send('Page.stopScreencast');

// ── SCROLL ─────────────────────────────────────────────────────────────
const maxScroll = await page.evaluate(
  () => document.documentElement.scrollHeight - window.innerHeight);

for (let i = 0; i <= SCROLL_STEPS; i++) {
  const pct = (i / SCROLL_STEPS) * 100;
  const y = Math.round((maxScroll * i) / SCROLL_STEPS);
  await page.evaluate(py => window.scrollTo(0, py), y);
  await sleep(150);
  await page.screenshot({
    path: `${outDir}/scroll/step_${pad(i, 2)}_${pad(Math.round(pct))}.png`,
    animations: 'allow',
  });
  manifest.scroll.push({ step: i, pct: +pct.toFixed(1), scrollY: y });
}
console.log(`scroll: ${SCROLL_STEPS + 1} steps, maxScroll ${maxScroll}px`);

manifest.maxScroll = maxScroll;
await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
await browser.close();
console.log(`done -> ${outDir}/`);
