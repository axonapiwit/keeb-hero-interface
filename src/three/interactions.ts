import type * as THREE from 'three';
import { animate, utils } from 'animejs';
import { IS_MOBILE } from './scene';
import type { PartState } from './types';

export interface InteractionConfig {
  parallax: boolean;
  /** Radians at full deflection — a few degrees. */
  tiltX: number;
  tiltY: number;
  damping: number;
  /** Rad amplitude of the idle sway. */
  idleYaw: number;
  /** Rad/sec of the sine. */
  idleRate: number;
  /** cm of vertical float. */
  floatAmp: number;
  floatSpeed: number;
  idle: boolean;
}

export interface Interactions {
  cfg: InteractionConfig;
  press(): void;
  update(dt: number): void;
}

/**
 * Pointer parallax, idle sway, and the click micro-interaction.
 *
 * Parallax writes to a rig Object3D that wraps the model, so it never touches
 * the per-part transforms the timeline and scroll scrub own.
 */
export function createInteractions(
  rig: THREE.Object3D,
  states: PartState[],
  signal: AbortSignal,
  { enableParallax = !IS_MOBILE }: { enableParallax?: boolean } = {},
): Interactions {
  const cfg: InteractionConfig = {
    parallax: enableParallax,
    tiltX: 0.075,
    tiltY: 0.13,
    damping: 0.075,
    // Theirs breathes and returns: per-frame change oscillates 0.03-0.34 and
    // comes back to where it started inside ~2s. An unbounded `elapsed * 0.16`
    // turntable is 15x the motion and never returns, so the composition never
    // actually holds still. Sine instead of ramp.
    idleYaw: 0.042,
    // Theirs cycles in ~2s, but that is a dot orbiting a small ring; on a
    // full-width board 2s reads as a wobble.
    idleRate: 1.2,
    floatAmp: 0.17,
    floatSpeed: 0.5,
    idle: true,
  };

  let targetX = 0;
  let targetY = 0;
  let curX = 0;
  let curY = 0;

  if (enableParallax) {
    addEventListener(
      'pointermove',
      (e) => {
        targetY = (e.clientX / innerWidth - 0.5) * 2;
        targetX = (e.clientY / innerHeight - 0.5) * 2;
      },
      { passive: true, signal },
    );
    addEventListener('pointerleave', () => {
      targetX = targetY = 0;
    }, { signal });
  }

  // ── click: press a keycap row and pop it back ──────────────────────
  // The .glb merges each row's caps into a single object, so the smallest
  // pressable unit is a row, not a key. Per-key press needs the caps exported
  // as individual objects — see the README.
  const rows = states.filter((s) => /^KB_Keycaps_Row\d$/.test(s.name));
  let pressing: PartState | null = null;

  const press = () => {
    if (!rows.length) return;
    const s = rows[Math.floor(utils.random(0, rows.length))] ?? rows[0];
    if (pressing === s) return;
    pressing = s;
    animate(s, {
      press: [
        { to: 0.34, duration: 70, ease: 'outQuad' },
        { to: 0, duration: 420, ease: 'outElastic(1, .55)' },
      ],
      onComplete: () => {
        if (pressing === s) pressing = null;
      },
    });
  };
  addEventListener('pointerdown', press, { signal });

  let elapsed = 0;
  return {
    cfg,
    press,
    update(dt) {
      elapsed += dt;
      const k = Math.min(1, cfg.damping * dt * 60);
      if (cfg.parallax) {
        curX += (targetX - curX) * k;
        curY += (targetY - curY) * k;
      } else {
        curX += (0 - curX) * k;
        curY += (0 - curY) * k;
      }
      rig.rotation.x = curX * cfg.tiltX;
      rig.rotation.z = -curY * cfg.tiltY * 0.35;
      rig.rotation.y =
        (cfg.idle ? Math.sin(elapsed * cfg.idleRate) * cfg.idleYaw : 0) + curY * cfg.tiltY;
      rig.position.y = cfg.idle ? Math.sin(elapsed * cfg.floatSpeed) * cfg.floatAmp : 0;
    },
  };
}
