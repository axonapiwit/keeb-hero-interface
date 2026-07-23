import { chromium } from 'playwright';
import { readdir, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/**
 * Motion analysis over a captured frame set.
 *
 * Usage: node scripts/analyze.mjs <dir> <section>   e.g. ref load
 *
 * Chromium decodes the PNGs (node has no image decoder and this needs no new
 * dependency). Per frame it reports:
 *   dPrev  mean |delta| vs previous frame  -> how fast things are moving now
 *   dLast  mean |delta| vs final frame     -> convergence; a non-monotonic tail
 *                                             is overshoot / spring settle
 *   bbox   bounding box of changed pixels  -> WHICH region is moving
 * Also writes downscaled contact sheets so a whole sequence can be eyeballed.
 */

const [dir, section] = process.argv.slice(2);
if (!dir || !section) {
  console.error('usage: node scripts/analyze.mjs <dir> <section>');
  process.exit(1);
}

const files = (await readdir(`${dir}/${section}`)).filter(f => f.endsWith('.png')).sort();
const urls = files.map(f => pathToFileURL(`${process.cwd()}/${dir}/${section}/${f}`).href);

// file:// origin + file access, or getImageData taints the canvas
const browser = await chromium.launch({
  headless: false,
  args: ['--allow-file-access-from-files'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(pathToFileURL(`${process.cwd()}/${dir}/${section}/`).href);

const result = await page.evaluate(async ({ urls, files }) => {
  const W = 480, H = 270;                    // analysis resolution — plenty for motion
  const load = src => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src;
  });
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });

  const datas = [];
  for (const u of urls) {
    const im = await load(u);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(im, 0, 0, W, H);
    datas.push(ctx.getImageData(0, 0, W, H).data);
  }

  const compare = (a, b) => {
    let sum = 0, n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let p = 0; p < a.length; p += 4) {
      const d = Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]);
      sum += d; n++;
      if (d > 30) {                          // ignore dither/noise
        const i = p / 4, x = i % W, y = (i / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return {
      mean: +(sum / n / 3).toFixed(2),
      bbox: x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
    };
  };

  const last = datas[datas.length - 1];
  return datas.map((d, i) => {
    const prev = i ? compare(datas[i - 1], d) : { mean: 0, bbox: null };
    const fin = compare(d, last);
    return { file: files[i], dPrev: prev.mean, dLast: fin.mean, bbox: prev.bbox };
  });
}, { urls, files });

// ── table ──────────────────────────────────────────────────────────────
console.log(`\n${dir}/${section}  (${files.length} frames)`);
console.log('idx  file                    dPrev   dLast   moving region (x,y,w,h @480x270)');
for (const [i, r] of result.entries()) {
  const b = r.bbox ? `${r.bbox.x},${r.bbox.y} ${r.bbox.w}x${r.bbox.h}` : '-';
  const bar = '#'.repeat(Math.min(30, Math.round(r.dPrev * 2)));
  console.log(`${String(i).padStart(3)}  ${r.file.padEnd(22)} ${String(r.dPrev).padStart(6)}  ${String(r.dLast).padStart(6)}  ${b.padEnd(20)} ${bar}`);
}

// ── contact sheets ─────────────────────────────────────────────────────
await mkdir(`${dir}/sheets`, { recursive: true });
const PER = 20;
for (let s = 0; s * PER < urls.length; s++) {
  const chunk = urls.slice(s * PER, (s + 1) * PER);
  const labels = files.slice(s * PER, (s + 1) * PER).map((f, i) => `${s * PER + i} ${f}`);
  const sheet = await page.evaluate(async ({ chunk, labels }) => {
    const CW = 480, CH = 270, COLS = 4;
    const rows = Math.ceil(chunk.length / COLS);
    const c = document.createElement('canvas');
    c.width = CW * COLS; c.height = (CH + 22) * rows;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, c.width, c.height);
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    for (let i = 0; i < chunk.length; i++) {
      const im = await load(chunk[i]);
      const x = (i % COLS) * CW, y = ((i / COLS) | 0) * (CH + 22);
      ctx.drawImage(im, x, y + 22, CW, CH);
      ctx.fillStyle = '#0f0'; ctx.font = 'bold 15px monospace';
      ctx.fillText(labels[i], x + 6, y + 16);
      ctx.strokeStyle = '#333'; ctx.strokeRect(x, y + 22, CW, CH);
    }
    return c.toDataURL('image/png');
  }, { chunk, labels });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${dir}/sheets/${section}_${s}.png`,
    Buffer.from(sheet.split(',')[1], 'base64'));
}
console.log(`sheets -> ${dir}/sheets/${section}_*.png`);

await browser.close();
