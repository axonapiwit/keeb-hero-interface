import GUI from 'lil-gui';
import type * as THREE from 'three';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { EASINGS } from './timelineAssemble';
import type { AssembleTimeline } from './timelineAssemble';
import type { ScrollExplode } from './scrollExplode';
import type { Interactions } from './interactions';
import type { Orbit, PartState } from './types';

export interface DebugPanel {
  gui: GUI;
  manual: { amount: number; override: boolean };
  dispose(): void;
}

/** lil-gui art-direction panel. Hidden until "d" is pressed. */
export function createDebug(
  deps: {
    assemble: AssembleTimeline;
    scroll: ScrollExplode;
    interactions: Interactions;
    orbit: Orbit;
    scene: THREE.Scene;
    bloom: UnrealBloomPass | null;
    states: PartState[];
  },
  signal: AbortSignal,
): DebugPanel {
  const { assemble, scroll, interactions, orbit, scene, bloom, states } = deps;
  const gui = new GUI({ title: 'keeb-hero — press D to hide' });
  gui.domElement.style.display = 'none';
  let visible = false;

  const fMotion = gui.addFolder('assemble');
  fMotion.add(assemble.cfg, 'lead', 0, 1200, 10).name('lead-in (ms)');
  fMotion.add(assemble.cfg, 'stagger', 0, 300, 1).name('stagger (ms)');
  fMotion.add(assemble.cfg, 'capStagger', 0, 300, 1).name('cap stagger (ms)');
  fMotion.add(assemble.cfg, 'duration', 200, 3000, 10).name('duration (ms)');
  fMotion.add(assemble.cfg, 'copyAt', 0, 3000, 10).name('copy at (ms)');
  fMotion.add(assemble.cfg, 'easing', Object.keys(EASINGS)).name('easing');
  fMotion.add(assemble.cfg, 'fade').name('fade in');
  fMotion.add({ replay: () => assemble.play() }, 'replay').name('▶ replay');

  const fExplode = gui.addFolder('explode');
  const manual = { amount: 0, override: false };
  fExplode.add(scroll.cfg, 'max', 0, 1.4, 0.01).name('scroll max');
  fExplode.add(scroll.cfg, 'smoothing', 0.01, 0.4, 0.005).name('smoothing');
  fExplode.add(scroll.cfg, 'stages', 1, 8, 1).name('hold stages');
  fExplode.add(scroll.cfg, 'hold', 0, 0.9, 0.02).name('hold fraction');
  fExplode.add(manual, 'override').name('manual override');
  fExplode
    .add(manual, 'amount', 0, 1.4, 0.01)
    .name('explode amount')
    .onChange((v: number) => {
      if (!manual.override) return;
      for (const s of states) s.t = 1 - v;
    });

  const fCam = gui.addFolder('camera');
  fCam.add(orbit, 'yaw', -Math.PI, Math.PI, 0.01).name('orbit yaw').listen();
  fCam.add(orbit, 'pitch', 0.02, 1.4, 0.01).name('orbit pitch').listen();
  fCam.add(orbit, 'distance', 20, 140, 0.5).name('distance').listen();
  fCam.add(orbit, 'lateral', -30, 30, 0.5).name('lateral pan');
  fCam.add(orbit, 'scrollOrbit', 0, 3, 0.05).name('scroll orbit amt');

  const fIdle = gui.addFolder('idle / pointer');
  fIdle.add(interactions.cfg, 'idle').name('idle sway + float');
  fIdle.add(interactions.cfg, 'idleYaw', 0, 0.4, 0.005).name('yaw sway (rad)');
  fIdle.add(interactions.cfg, 'idleRate', 0.1, 3, 0.05).name('sway rate');
  fIdle.add(interactions.cfg, 'floatAmp', 0, 2, 0.01).name('float (cm)');
  fIdle.add(interactions.cfg, 'parallax').name('pointer parallax');
  fIdle.add(interactions.cfg, 'tiltY', 0, 0.5, 0.005).name('tilt amount');
  fIdle.add({ press: () => interactions.press() }, 'press').name('▶ press a row');

  const fLook = gui.addFolder('look');
  fLook.add(scene, 'environmentIntensity', 0, 2, 0.01).name('env intensity');
  if (bloom) {
    fLook.add(bloom, 'strength', 0, 1.2, 0.01).name('bloom strength');
    fLook.add(bloom, 'threshold', 0, 1, 0.01).name('bloom threshold');
  }

  addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'd' && e.key !== 'D') return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      visible = !visible;
      gui.domElement.style.display = visible ? '' : 'none';
    },
    { signal },
  );

  return { gui, manual, dispose: () => gui.destroy() };
}
