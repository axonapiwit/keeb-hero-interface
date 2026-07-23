import { chromium } from 'playwright';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/**
 * Background-colour track across a captured scroll sweep.
 *
 * Usage: node scripts/bg.mjs <dir> <section>   e.g. ref scroll
 *
 * Samples the page background from the frame corners (the subject sits centre,
 * so the corners are background in practice), then reports where it changes.
 * The point is the STRUCTURE — how many stops, where they land in the scroll,
 * how abrupt the handoff is — not the palette itself.
 */

const [dir = 'ref', section = 'scroll'] = process.argv.slice(2);
const files = (await readdir(`${dir}/${section}`)).filter((f) => f.endsWith('.png')).sort();
const urls = files.map((f) => pathToFileURL(`${process.cwd()}/${dir}/${section}/${f}`).href);

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.goto(pathToFileURL(`${process.cwd()}/${dir}/${section}/`).href);

const rows = await page.evaluate(async ({ urls, files }) => {
  const W = 320, H = 180;
  const load = (src) =>
    new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });

  const out = [];
  for (let i = 0; i < urls.length; i++) {
    const im = await load(urls[i]);
    ctx.drawImage(im, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const at = (x, y) => {
      const p = (y * W + x) * 4;
      return [d[p], d[p + 1], d[p + 2]];
    };
    // four corners + top/bottom mid — median kills any subject that reaches one
    const pts = [at(6, 6), at(W - 7, 6), at(6, H - 7), at(W - 7, H - 7), at(W >> 1, 4), at(W >> 1, H - 5)];
    const med = (k) => pts.map((p) => p[k]).sort((a, b) => a - b)[pts.length >> 1];
    out.push({ file: files[i], rgb: [med(0), med(1), med(2)] });
  }
  return out;
}, { urls, files });

await browser.close();

const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

console.log(`\n${dir}/${section} — background track (${rows.length} frames)\n`);
console.log('idx  scroll%   background   Δ    ');
let prev = null;
const stops = [];
for (const [i, r] of rows.entries()) {
  const pct = Math.round((i / (rows.length - 1)) * 100);
  const d = prev ? dist(prev, r.rgb) : 0;
  if (d > 24) stops.push({ i, pct, from: hex(prev), to: hex(r.rgb), d });
  console.log(
    `${String(i).padStart(3)}  ${String(pct).padStart(4)}%   ${hex(r.rgb)}    ${String(d).padStart(3)}  ${'█'.repeat(Math.min(40, d))}`,
  );
  prev = r.rgb;
}

console.log(`\n${stops.length} transition(s):`);
for (const s of stops) console.log(`  at ${String(s.pct).padStart(3)}%   ${s.from} -> ${s.to}   (Δ${s.d})`);

const uniq = [];
for (const r of rows) if (!uniq.some((u) => dist(u, r.rgb) < 24)) uniq.push(r.rgb);
console.log(`\n${uniq.length} distinct background stop(s): ${uniq.map(hex).join('  ')}`);
