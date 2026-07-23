import { createTimeline, spring } from 'animejs';
import type { Timeline } from 'animejs';
import type * as THREE from 'three';
import type { PartState } from './types';

/**
 * The load animation: parts start exploded + faded, then settle into place.
 *
 * anime.js owns all timing and easing. Each part's scalar `t` is the tween
 * target, so the timeline and the scroll scrub write to the same field instead
 * of fighting over position/rotation.
 */

type EaseFactory = () => ReturnType<typeof spring> | string;

export const EASINGS = {
  'spring (soft)': () => spring({ stiffness: 92, damping: 15 }),
  'spring (tight)': () => spring({ stiffness: 150, damping: 19 }),
  'spring (loose)': () => spring({ stiffness: 62, damping: 11 }),
  outExpo: () => 'outExpo',
  outQuint: () => 'outQuint',
  inOutQuart: () => 'inOutQuart',
} satisfies Record<string, EaseFactory>;

export type EasingName = keyof typeof EASINGS;

export interface AssembleConfig {
  /** ms of stillness on an empty frame before anything appears. */
  lead: number;
  /** ms between keycap rows growing outward from the seed row. */
  capStagger: number;
  /** ms between chassis layers accumulating underneath. */
  stagger: number;
  /** ms the chassis starts before the caps finish, so the phases overlap. */
  capOverlap: number;
  duration: number;
  easing: EasingName;
  capEasing: EasingName;
  fade: boolean;
  fadeDuration: number;
  /** Scale a part grows from. Small enough to read as a seed, not a pop-in. */
  seedScale: number;
  /**
   * Fraction of the full explode distance the intro travels. 1 = all of it.
   * Measured: travelling the whole way put peak per-frame change at 30.2 where
   * the reference peaks at 4.1.
   */
  introFrom: number;
  copy: boolean;
  copyAt: number;
  copyStagger: number;
  /** ms between words of the headline as it types in. */
  wordStagger: number;
}

/**
 * Phase order, taken from a frame-by-frame read of the reference (100 ms/frame):
 *
 *   f5-f9    500-900ms   black, dead still
 *   f10-f16  1000-1600   one seed element draws itself outward into a shape
 *   f17-f27  1700-2700   secondary layers accumulate onto it
 *   f28-f36  2800-3600   the shape transforms; headline types in word by word
 *   f37      3700        nav and the remaining chrome, last
 *
 * The character worth taking is the ORDER and the growth: motion rises to a
 * peak near the end (their per-frame delta runs 1.05 -> 4.14) instead of
 * front-loading. Ours used to open with every part arriving in one frame and
 * decay from there — measured peak 30.2 falling to 0.28.
 *
 * Content is entirely ours: the seed is the Esc row, the layers are the
 * chassis, the transform is the board settling onto its feet.
 */
export const DEFAULTS: AssembleConfig = {
  // Measured against animejs.com: their intro is a ~2.9s relay whose per-frame
  // motion RISES the whole way (1.0 -> 4.1), staged into six overlapping
  // phases, with the copy landing last. Ours was a single 1.4s burst that
  // decayed to a dead stop at 2.6s and showed all copy instantly at 800ms.
  //
  // So: a beat of stillness first, chassis laid down slowly, then the keycap
  // rows raining in on a tighter stagger — the build accelerates instead of
  // fading out.
  lead: 520,
  capStagger: 130,
  stagger: 150,
  capOverlap: 260,
  duration: 900,
  easing: 'spring (soft)',
  capEasing: 'spring (tight)',
  fade: true,
  // Per part now, so it must be shorter than the stagger or arrivals blur into
  // one another again.
  fadeDuration: 240,
  seedScale: 0.06,
  introFrom: 0.34,
  copy: true,
  // Headline starts while the chassis is still accumulating; the rest of the
  // chrome lands after everything else, the way theirs does at f37.
  copyAt: 2300,
  copyStagger: 260,
  wordStagger: 95,
};

/** After the headline: sub-copy, stats, then nav — chrome last. */
const COPY_SELECTORS = ['.hero .sub', '.hero .meta', 'nav'];

/**
 * Wrap each word of the headline so it can be revealed one at a time.
 * Idempotent — replays reuse the spans instead of nesting more of them.
 */
function splitWords(el: HTMLElement): HTMLElement[] {
  const existing = el.querySelectorAll<HTMLElement>('[data-w]');
  if (existing.length) return [...existing];

  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = (child.textContent ?? '').split(/(\s+)/);
        if (parts.length <= 1 && !parts[0]?.trim()) continue;
        const frag = document.createDocumentFragment();
        for (const p of parts) {
          if (!p.trim()) {
            frag.append(p);
            continue;
          }
          const span = document.createElement('span');
          span.dataset.w = '';
          span.style.display = 'inline-block';
          span.textContent = p;
          frag.append(span);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  };
  walk(el);
  return [...el.querySelectorAll<HTMLElement>('[data-w]')];
}

interface TrackedMaterial extends THREE.Material {
  userData: { _opacity?: number; _transparent?: boolean } & Record<string, unknown>;
}

/**
 * Give every part its own copy of the materials it draws with.
 *
 * Materials arrive shared (the case top and bottom are both KB_Mat_Case), so a
 * single global fade was the only option — and that fade revealed all thirteen
 * parts in the same frame. Measured against the reference: their moving region
 * grows 5px -> 69 -> 155 -> 250 -> 361 as parts arrive one at a time, while
 * ours changed the entire viewport in one step. Thirteen clones is nothing.
 */
function isolateMaterials(states: PartState[]): Map<PartState, TrackedMaterial[]> {
  const perPart = new Map<PartState, TrackedMaterial[]>();
  for (const s of states) {
    const mine: TrackedMaterial[] = [];
    s.node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const clones = list.map((raw) => {
        const m = raw.clone() as TrackedMaterial;
        m.userData._opacity = raw.opacity;
        m.userData._transparent = raw.transparent;
        mine.push(m);
        return m;
      });
      mesh.material = Array.isArray(mesh.material) ? clones : clones[0];
    });
    perPart.set(s, mine);
  }
  return perPart;
}

export interface AssembleTimeline {
  cfg: AssembleConfig;
  play(): void;
  readonly running: boolean;
  skip(): void;
  dispose(): void;
}

export function createAssembleTimeline(
  states: PartState[],
  opts: Partial<AssembleConfig> = {},
): AssembleTimeline {
  const cfg: AssembleConfig = { ...DEFAULTS, ...opts };
  const perPart = isolateMaterials(states);
  const materials = [...perPart.values()].flat();
  let tl: Timeline | null = null;
  let running = false;

  const restoreMaterials = () => {
    for (const m of materials) {
      m.opacity = m.userData._opacity ?? 1;
      m.transparent = m.userData._transparent ?? false;
    }
  };

  function play() {
    tl?.revert();
    running = true;

    // Start part-way out, not from the full explode distance. The intro reuses
    // the scroll explode offsets, and travelling all of it made the opening
    // frames violent: peak per-frame change measured 30.2 against the
    // reference's 4.1.
    for (const s of states) {
      s.t = 1 - cfg.introFrom;
      s.scale = cfg.seedScale; // everything starts as a seed, nothing visible
    }
    if (cfg.fade) {
      for (const m of materials) {
        m.transparent = true;
        m.opacity = 0;
      }
    }

    tl = createTimeline({
      defaults: { duration: cfg.duration, ease: EASINGS[cfg.easing]() },
      onComplete: () => {
        running = false;
        for (const s of states) s.scale = 1;
        restoreMaterials();
      },
    });

    // PHASE 1 — the seed grows outward.
    // Row0 carries the one orange key, so it opens alone; the rest of the field
    // unfolds from it row by row. This is the reference's dot-becomes-a-ring
    // beat: one element first, the shape assembled from it, never all at once.
    const isCap = (s: PartState) => /^KB_Keycaps_Row\d$/.test(s.name);
    const caps = states.filter(isCap).sort((a, b) => a.name.localeCompare(b.name));
    // PHASE 2 — the chassis accumulates underneath, bottom of the stack upward.
    const chassis = states.filter((s) => !isCap(s));

    const startOf = new Map<PartState, number>();
    caps.forEach((s, i) => {
      const at = cfg.lead + i * cfg.capStagger;
      startOf.set(s, at);
      tl!.add(s, { t: 1, scale: 1, ease: EASINGS[cfg.capEasing]() }, at);
    });

    const chassisAt = cfg.lead + caps.length * cfg.capStagger - cfg.capOverlap;
    chassis.forEach((s, i) => {
      const at = chassisAt + i * cfg.stagger;
      startOf.set(s, at);
      tl!.add(s, { t: 1, scale: 1 }, at);
    });

    if (cfg.fade) {
      // Each part fades with its OWN arrival, so the visible area grows step by
      // step instead of the whole frame lighting up at once.
      for (const [s, mats] of perPart) {
        const fade = { o: 0 };
        tl.add(
          fade,
          {
            o: 1,
            duration: cfg.fadeDuration,
            ease: 'outQuad',
            onUpdate: () => {
              for (const m of mats) m.opacity = fade.o * (m.userData._opacity ?? 1);
            },
          },
          startOf.get(s) ?? cfg.lead,
        );
      }
    }

    // PHASE 3 — the headline types in word by word while the chassis is still
    // landing, then the rest of the chrome follows. React has already committed
    // this DOM; the engine mounts in an effect.
    if (cfg.copy) {
      const h1 = document.querySelector<HTMLElement>('.hero h1');
      if (h1) {
        const words = splitWords(h1);
        h1.style.opacity = '1';
        for (const w of words) w.style.opacity = '0';
        words.forEach((w, i) =>
          tl!.add(
            w,
            { opacity: [0, 1], translateY: [22, 0], duration: 520, ease: 'outExpo' },
            cfg.copyAt + i * cfg.wordStagger,
          ),
        );
      }

      const tail = cfg.copyAt + (h1 ? splitWords(h1).length * cfg.wordStagger : 0);
      const els = COPY_SELECTORS.map((sel) => document.querySelector<HTMLElement>(sel)).filter(
        (el): el is HTMLElement => el !== null,
      );
      for (const el of els) el.style.opacity = '0';
      els.forEach((el, i) =>
        tl!.add(
          el,
          { opacity: [0, 1], translateY: [18, 0], duration: 620, ease: 'outExpo' },
          tail + i * cfg.copyStagger,
        ),
      );
    }
  }

  return {
    cfg,
    play,
    get running() {
      return running;
    },
    skip() {
      tl?.complete();
      running = false;
      for (const s of states) s.scale = 1; // or a skipped part stays seed-sized
      restoreMaterials();
    },
    dispose() {
      tl?.revert();
      tl = null;
      running = false;
      for (const s of states) s.scale = 1;
      restoreMaterials();
    },
  };
}
