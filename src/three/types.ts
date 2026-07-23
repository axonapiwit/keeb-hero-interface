import type * as THREE from 'three';

/**
 * The parts the animation system drives, in assembly order (bottom of the stack
 * upward). This array is the single source of truth for part names: `PartName`
 * is derived from it, so a typo anywhere downstream is a compile error rather
 * than a silent `undefined` at animation time.
 *
 * KB_Cable_USB was removed in model v4 — the USB-C port became a recessed
 * pocket in the left wall, part of KB_SideControls.
 */
export const EXPECTED_PARTS = [
  'KB_Case_Bottom',
  'KB_Feet',
  'KB_PCB',
  'KB_Plate',
  'KB_Switches_Group',
  'KB_Case_Top', // frame drops over the internals before the caps go on
  'KB_SideControls',
  'KB_Keycaps_Row5', // bottom row first, F-row last
  'KB_Keycaps_Row4',
  'KB_Keycaps_Row3',
  'KB_Keycaps_Row2',
  'KB_Keycaps_Row1',
  'KB_Keycaps_Row0',
] as const;

export type PartName = (typeof EXPECTED_PARTS)[number];
export type Parts = Record<PartName, THREE.Object3D | null>;

export interface PartReport {
  want: PartName;
  ok: boolean;
  how: string;
  type: string;
}

export interface ModelStats {
  kbNodes: number;
  switchInstances: number;
  unexpected: string[];
  uniqueGeometries: number;
  triangles: number;
  /** Model is authored at 1 unit = 1 cm, so mm is unit * 10. */
  sizeMM: [number, number, number];
}

export interface LoadedModel {
  root: THREE.Group;
  parts: Parts;
  report: PartReport[];
  stats: ModelStats;
}

/**
 * Per-part motion state.
 *
 * `t` is the one number every system writes: 1 = assembled (the transform baked
 * into the .glb), 0 = fully exploded. The intro timeline and the scroll scrub
 * both target `t`, so they can never fight over a transform.
 */
export interface PartState {
  name: PartName;
  node: THREE.Object3D;
  t: number;
  home: THREE.Vector3;
  homeRot: THREE.Euler;
  away: THREE.Vector3;
  awayRot: THREE.Euler;
  /** Click micro-interaction, cm of downward travel. */
  press: number;
}

/** Camera rig, mutated in place by the loop and by the debug panel. */
export interface Orbit {
  yaw: number;
  pitch: number;
  distance: number;
  /** Extra yaw swept across the full scroll. */
  scrollOrbit: number;
  /** Lateral pan so the board sits clear of the headline; negative = right. */
  lateral: number;
}
