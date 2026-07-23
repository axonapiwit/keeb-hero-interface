import * as THREE from 'three';
import { utils } from 'animejs';
import { EXPECTED_PARTS } from './types';
import type { PartName, PartState, Parts } from './types';

/** How far each part travels when fully exploded (cm), plus a little spin. */
type Move = { move: [number, number, number]; spin: [number, number, number] };

const EXPLODE: Partial<Record<PartName, Move>> = {
  KB_Case_Bottom: { move: [0, -11, 0], spin: [0, 0, 0] },
  KB_Feet: { move: [0, -17, 3], spin: [0.3, 0, 0] },
  KB_PCB: { move: [-9, -3, 0], spin: [0, 0.1, -0.05] }, // fans out
  KB_Plate: { move: [9, 3, 0], spin: [0, -0.1, 0.05] }, // fans the other way
  KB_Switches_Group: { move: [0, 12, 0], spin: [0, 0, 0] }, // float up
  KB_Case_Top: { move: [0, 26, 0], spin: [0, 0, 0] }, // lifts high
  KB_SideControls: { move: [-16, 4, 0], spin: [0, 0.4, 0] }, // flies out sideways
  // keycap rows get a per-row height instead, below
};

const ROW_LIFT = [30, 26.5, 23, 19.5, 16, 12.5]; // Row0 (F-row) highest

export function createStates(parts: Parts): PartState[] {
  const rand = utils.createSeededRandom(20260722); // stable across reloads
  const states: PartState[] = [];

  for (const name of EXPECTED_PARTS) {
    const node = parts[name];
    if (!node) continue;

    const row = /^KB_Keycaps_Row(\d)$/.exec(name);
    const { move, spin } = row
      ? ({ move: [0, ROW_LIFT[Number(row[1])], 0], spin: [0, 0, 0] } as Move)
      : (EXPLODE[name] ?? ({ move: [0, 8, 0], spin: [0, 0, 0] } as Move));

    // small seeded jitter so the exploded view reads loose, not grid-like
    const jx = (rand() - 0.5) * 1.6;
    const jz = (rand() - 0.5) * 1.6;
    const jr = (rand() - 0.5) * 0.13;
    const jp = (rand() - 0.5) * 0.1;

    states.push({
      name,
      node,
      t: 1, // start assembled; the intro sets it to 0
      home: node.position.clone(),
      homeRot: node.rotation.clone(),
      away: new THREE.Vector3(move[0] + jx, move[1], move[2] + jz),
      awayRot: new THREE.Euler(spin[0] + jp, spin[1] + jr, spin[2]),
      press: 0,
    });
  }
  return states;
}

/** Single writer for every part transform. Allocates nothing per frame. */
export function applyStates(states: PartState[]): void {
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const k = 1 - s.t; // 0 assembled -> 1 exploded
    s.node.position.set(
      s.home.x + s.away.x * k,
      s.home.y + s.away.y * k - s.press,
      s.home.z + s.away.z * k,
    );
    s.node.rotation.set(
      s.homeRot.x + s.awayRot.x * k,
      s.homeRot.y + s.awayRot.y * k,
      s.homeRot.z + s.awayRot.z * k,
    );
  }
}

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * Remap linear scroll into hold-then-move stages.
 *
 * A straight `t = 1 - progress` scrubs everything at a constant rate, so no
 * section ever arrives and rests — measured against animejs.com, their per-step
 * change sits at 2-7 across long pinned stretches and spikes to 77-145 at four
 * discrete handoffs (a ~50:1 range). A constant scrub gives ~3:1.
 *
 * Each stage spends `hold` of its scroll range parked, then eases to the next
 * layer. That is what reads as "pinned, then hands off".
 */
export function staged(p: number, stages: number, hold: number): number {
  const s = Math.min(stages - 1e-6, Math.max(0, p) * stages);
  const i = Math.floor(s);
  const f = s - i;
  const m = f <= hold ? 0 : (f - hold) / (1 - hold);
  return (i + easeInOutCubic(m)) / stages;
}

export interface ScrollConfig {
  smoothing: number;
  max: number;
  enabled: boolean;
  /** Number of layer sections in the page. */
  stages: number;
  /** Fraction of each section's scroll spent parked before the handoff. */
  hold: number;
}

export interface ScrollExplode {
  cfg: ScrollConfig;
  /** Damped, staged progress — drives parts AND camera. */
  readonly progress: number;
  /** Undamped, unstaged scroll fraction, for the progress bar. */
  readonly raw: number;
  update(dt: number, claimed: boolean): number;
  setProgressManually(v: number): void;
}

/**
 * Scroll scrub.
 *
 * anime.js ships ScrollObserver/onScroll, but this uses the plain
 * scroll-progress lerp the brief allows as the alternative: the same `t` fields
 * are already owned by the intro timeline, and a damped scalar is easier to hand
 * to the debug panel than a second animation graph competing for the same props.
 */
export function createScrollExplode(
  states: PartState[],
  signal: AbortSignal,
  opts: Partial<ScrollConfig> = {},
): ScrollExplode {
  const cfg: ScrollConfig = {
    smoothing: 0.14,
    max: 1.0,
    enabled: true,
    stages: 5,
    hold: 0.42,
    ...opts,
  };
  let target = 0;
  let current = 0;

  const read = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    target = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  };
  addEventListener('scroll', read, { passive: true, signal });
  addEventListener('resize', read, { signal });
  read();

  return {
    cfg,
    get progress() {
      return current;
    },
    get raw() {
      return target;
    },
    update(dt, claimed) {
      read();
      current += (target - current) * Math.min(1, cfg.smoothing * dt * 60);
      const p = staged(current, cfg.stages, cfg.hold);
      if (claimed || !cfg.enabled) return p;
      const explode = p * cfg.max;
      for (let i = 0; i < states.length; i++) states[i].t = 1 - explode;
      return p;
    },
    setProgressManually(v) {
      current = target = v;
    },
  };
}
