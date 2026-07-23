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
  /** ms of stillness before anything moves (theirs holds ~400ms). */
  lead: number;
  /** ms between chassis parts. */
  stagger: number;
  /** ms between keycap rows — tighter, so the build accelerates. */
  capStagger: number;
  /** ms the caps start early, so the two phases cross-fade. */
  capOverlap: number;
  duration: number;
  easing: EasingName;
  capEasing: EasingName;
  fade: boolean;
  fadeDuration: number;
  copy: boolean;
  copyAt: number;
  copyStagger: number;
}

export const DEFAULTS: AssembleConfig = {
  // Measured against animejs.com: their intro is a ~2.9s relay whose per-frame
  // motion RISES the whole way (1.0 -> 4.1), staged into six overlapping
  // phases, with the copy landing last. Ours was a single 1.4s burst that
  // decayed to a dead stop at 2.6s and showed all copy instantly at 800ms.
  //
  // So: a beat of stillness first, chassis laid down slowly, then the keycap
  // rows raining in on a tighter stagger — the build accelerates instead of
  // fading out.
  lead: 260,
  stagger: 142,
  capStagger: 58,
  capOverlap: 120,
  duration: 940,
  easing: 'spring (soft)',
  capEasing: 'spring (tight)',
  fade: true,
  // A long global fade washes over the whole stagger and hides it.
  fadeDuration: 380,
  copy: true,
  // Copy lands AFTER the model settles, so the intro finishes on a deliberate
  // beat instead of decaying to nothing. Theirs does the same: nav, sub-copy
  // and buttons are the last things in, at 3.7-3.8s.
  copyAt: 1900,
  copyStagger: 200,
};

/** Copy arrives last and in order, the way theirs does — not all at once. */
const COPY_SELECTORS = ['.hero h1', '.hero .sub', '.hero .meta', 'nav'];

interface TrackedMaterial extends THREE.Material {
  userData: { _opacity?: number; _transparent?: boolean } & Record<string, unknown>;
}

/** Materials are shared between parts, so fade them once, not per part. */
function collectMaterials(states: PartState[]): TrackedMaterial[] {
  const set = new Set<TrackedMaterial>();
  for (const s of states) {
    s.node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const raw of list) {
        const m = raw as TrackedMaterial;
        if (set.has(m)) continue;
        m.userData._opacity ??= m.opacity;
        m.userData._transparent ??= m.transparent;
        set.add(m);
      }
    });
  }
  return [...set];
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
  const materials = collectMaterials(states);
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

    for (const s of states) s.t = 0; // exploded
    const fade = { o: cfg.fade ? 0 : 1 };
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
        restoreMaterials();
      },
    });

    // Two phases, not one queue: the chassis lays down on a slow stagger, then
    // the keycap rows rain in on a tighter one and overlap its tail. The
    // shortening interval is what makes the build accelerate into its finish.
    const isCap = (s: PartState) => /^KB_Keycaps_Row\d$/.test(s.name);
    const chassis = states.filter((s) => !isCap(s));
    const caps = states.filter(isCap);
    const capsAt = cfg.lead + chassis.length * cfg.stagger - cfg.capOverlap;

    chassis.forEach((s, i) => tl!.add(s, { t: 1 }, cfg.lead + i * cfg.stagger));
    caps.forEach((s, i) =>
      tl!.add(s, { t: 1, ease: EASINGS[cfg.capEasing]() }, capsAt + i * cfg.capStagger),
    );

    if (cfg.fade) {
      // short, and starts with the first part
      tl.add(
        fade,
        {
          o: 1,
          duration: cfg.fadeDuration,
          ease: 'outQuad',
          onUpdate: () => {
            for (const m of materials) m.opacity = fade.o * (m.userData._opacity ?? 1);
          },
        },
        cfg.lead,
      );
    }

    // Copy relays in over the assembly instead of being present from frame one.
    // React has already committed this DOM — the engine mounts in an effect.
    if (cfg.copy) {
      const els = COPY_SELECTORS.map((sel) => document.querySelector<HTMLElement>(sel)).filter(
        (el): el is HTMLElement => el !== null,
      );
      for (const el of els) el.style.opacity = '0';
      els.forEach((el, i) =>
        tl!.add(
          el,
          { opacity: [0, 1], translateY: [18, 0], duration: 620, ease: 'outExpo' },
          cfg.copyAt + i * cfg.copyStagger,
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
      restoreMaterials();
    },
    dispose() {
      tl?.revert();
      tl = null;
      running = false;
      restoreMaterials();
    },
  };
}
