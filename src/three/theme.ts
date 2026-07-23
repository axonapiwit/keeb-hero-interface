import * as THREE from 'three';
import { THEMES } from '../content';

/**
 * Scroll-driven backdrop.
 *
 * The page has one dark base with a couple of "light windows" — sections that
 * flip the whole backdrop, page copy included, then flip back. The handoff is
 * deliberately quick: a slow fade across a whole section reads as a mistake,
 * a fast one reads as a cut between chapters.
 *
 * Which sections go light is a content decision and lives in `content.ts`.
 */

/** Section index i owns the viewport at scroll fraction i / (count - 1). */
const FULL = 0.34; // |distance from that section| where the theme is fully applied
const EDGE = 0.6; // ...and where it is fully gone. The gap is the crossfade.

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export interface Backdrop {
  /** @param raw undamped scroll fraction @returns 0 = dark, 1 = light */
  update(raw: number): number;
  dispose(): void;
}

export function createBackdrop(
  scene: THREE.Scene,
  opts: {
    /** Index of every section that goes light, in a list of `sectionCount`. */
    lightSections: number[];
    sectionCount: number;
  },
): Backdrop {
  const { lightSections, sectionCount } = opts;
  const span = Math.max(1, sectionCount - 1);

  // every colour pre-parsed; the loop only lerps between them, never allocates
  const pair = (a: string, b: string) => [new THREE.Color(a), new THREE.Color(b)] as const;
  const [bgD, bgL] = pair(THEMES.dark.bg, THEMES.light.bg);
  const [inkD, inkL] = pair(THEMES.dark.ink, THEMES.light.ink);
  const [dimD, dimL] = pair(THEMES.dark.dim, THEMES.light.dim);

  const bg = new THREE.Color().copy(bgD);
  const ink = new THREE.Color();
  const dim = new THREE.Color();
  scene.background = bg;

  const root = document.documentElement;
  let lastApplied = -1;

  return {
    update(raw) {
      // how "light" is this scroll position — the max over every light window
      const at = raw * span;
      let t = 0;
      for (const i of lightSections) {
        const d = Math.abs(at - i);
        t = Math.max(t, 1 - smoothstep(FULL, EDGE, d));
      }

      bg.copy(bgD).lerp(bgL, t);

      // CSS side: quantised, and only written when it moves. A custom-property
      // write on :root invalidates style for the whole document, so doing it
      // every frame is the same trap the progress bar had.
      const q = Math.round(t * 24) / 24;
      if (q !== lastApplied) {
        lastApplied = q;
        ink.copy(inkD).lerp(inkL, q);
        dim.copy(dimD).lerp(dimL, q);
        root.style.setProperty('--bg', `#${bg.getHexString()}`);
        root.style.setProperty('--ink', `#${ink.getHexString()}`);
        root.style.setProperty('--dim', `#${dim.getHexString()}`);
      }
      return t;
    },
    dispose() {
      root.style.removeProperty('--bg');
      root.style.removeProperty('--ink');
      root.style.removeProperty('--dim');
      root.style.removeProperty('--ink-mix');
    },
  };
}
