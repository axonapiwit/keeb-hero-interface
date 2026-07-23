import { chromium } from 'playwright';
import { readdir, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/**
 * Before/after strip: same frame indices from two capture dirs, stacked.
 *
 * Usage: node scripts/compare.mjs <beforeDir> <afterDir> <section> <i,i,i> <out.png>
 */
const [beforeDir, afterDir, section, idxArg, out] = process.argv.slice(2);
const idxs = idxArg.split(',').map(Number);

const pick = async d => {
  const f = (await readdir(`${d}/${section}`)).filter(x => x.endsWith('.png')).sort();
  return idxs.map(i => ({ name: f[i], url: pathToFileURL(`${process.cwd()}/${d}/${section}/${f[i]}`).href }));
};
const before = await pick(beforeDir), after = await pick(afterDir);

const browser = await chromium.launch({ headless: false, args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.goto(pathToFileURL(`${process.cwd()}/${beforeDir}/${section}/`).href);

const png = await page.evaluate(async ({ before, after, section }) => {
  const CW = 470, CH = 264, LBL = 26;
  const cols = before.length;
  const c = document.createElement('canvas');
  c.width = CW * cols; c.height = (CH + LBL) * 2 + 30;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0b0d'; ctx.fillRect(0, 0, c.width, c.height);
  const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });

  for (const [row, set] of [[0, before], [1, after]].values ? [[0, before], [1, after]] : []) {
    for (let i = 0; i < set.length; i++) {
      const im = await load(set[i].url);
      const x = i * CW, y = 30 + row * (CH + LBL);
      ctx.fillStyle = row ? '#7CFF9B' : '#FF8A6B';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(`${row ? 'AFTER ' : 'BEFORE'}  ${set[i].name}`, x + 8, y + 18);
      ctx.drawImage(im, x, y + LBL, CW, CH);
      ctx.strokeStyle = '#333'; ctx.strokeRect(x, y + LBL, CW, CH);
    }
  }
  ctx.fillStyle = '#fff'; ctx.font = 'bold 17px monospace';
  ctx.fillText(section, 8, 20);
  return c.toDataURL('image/png');
}, { before, after, section });

await mkdir('compare', { recursive: true });
await writeFile(out, Buffer.from(png.split(',')[1], 'base64'));
await browser.close();
console.log(`-> ${out}`);
