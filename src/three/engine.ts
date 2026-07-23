import * as THREE from 'three';
import { createScene, fitDistance, IS_MOBILE } from './scene';
import { loadKeyboard, missingParts } from './loader';
import { createStates, applyStates, createScrollExplode } from './scrollExplode';
import { createAssembleTimeline } from './timelineAssemble';
import { createInteractions } from './interactions';
import { createDebug } from './debug';
import { mergeSwitches, pruneShadowCasters } from './optimise';
import { createBackdrop } from './theme';
import type { ScrollExplode } from './scrollExplode';
import type { AssembleTimeline } from './timelineAssemble';
import type { Interactions } from './interactions';
import type { LoadedModel, Orbit, PartState } from './types';

/**
 * Everything imperative lives here, behind one start/dispose pair.
 *
 * React owns the DOM shell and nothing else: the render loop mutates
 * Object3D transforms 60 times a second, which is exactly the work React state
 * must never do. The only value crossing back into React is `onReady`, fired
 * once.
 */
export interface Engine {
  model: LoadedModel;
  states: PartState[];
  orbit: Orbit;
  dispose(): void;
}

/** Console/QA handle. Typed, so the browser harness gets checked too. */
export interface KeebHandle extends Engine {
  parts: LoadedModel['parts'];
  stats: LoadedModel['stats'];
  scroll: ScrollExplode;
  assemble: AssembleTimeline;
  interactions: Interactions;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

declare global {
  interface Window {
    __keeb?: KeebHandle;
  }
}

/** Full-motion defaults. Reduced motion swaps both to their "off" value. */
const SCROLL_SMOOTHING = 0.14;
const SCROLL_ORBIT = 1.15;

export interface StartOptions {
  canvas: HTMLCanvasElement;
  modelUrl?: string;
  /** Number of layer sections on the page — the scroll hold/handoff count. */
  stages?: number;
  /** Every section on the page, hero bookends included. */
  sectionCount?: number;
  /** Indices into that list whose backdrop flips to the light theme. */
  lightSections?: number[];
  onReady?: () => void;
}

export async function startEngine({
  canvas,
  modelUrl = '/assets/keyboard_75.glb',
  stages,
  sectionCount = 7,
  lightSections = [],
  onReady,
}: StartOptions): Promise<Engine> {
  // One controller for every listener in every module — teardown is one call,
  // which is what makes a StrictMode double-mount harmless.
  const ac = new AbortController();
  const { signal } = ac;

  const rig3d = createScene(canvas, signal);
  const { renderer, composer, scene, camera, ground, bloom } = rig3d;

  const model = await loadKeyboard(modelUrl);
  if (signal.aborted) {
    // unmounted while the .glb was in flight
    rig3d.dispose();
    throw new DOMException('aborted', 'AbortError');
  }

  const { root, parts, stats, report } = model;
  const missing = missingParts(report);
  if (missing.length) console.warn('[keeb-hero] unresolved parts:', missing);

  // Draw-call surgery before anything else touches the graph. Measured on the
  // deployed build: 272 meshes / 271 shadow casters ≈ 540 draw calls a frame.
  const switchGroup = parts.KB_Switches_Group;
  const merged = switchGroup ? mergeSwitches(switchGroup) : { before: 0, after: 0 };
  const { casters } = pruneShadowCasters(root);

  // rig carries idle sway + pointer parallax so it never touches part transforms
  const rig = new THREE.Group();
  const pivot = new THREE.Group(); // recentres the model on its own bbox
  rig.add(pivot);
  pivot.add(root);
  scene.add(rig);

  const fit = fitDistance(camera, root, 1.3);
  pivot.position.set(-fit.center.x, -fit.center.y, -fit.center.z);
  ground.position.y = fit.box.min.y - fit.center.y - 0.1;

  const states = createStates(parts);
  const scroll = createScrollExplode(states, signal, stages ? { stages } : {});
  const assemble = createAssembleTimeline(states);
  const interactions = createInteractions(rig, states, signal);

  const orbit: Orbit = {
    yaw: -0.42,
    pitch: 0.46,
    distance: fit.dist,
    scrollOrbit: SCROLL_ORBIT,
    lateral: IS_MOBILE ? 0 : -11,
  };

  const backdrop = createBackdrop(scene, { lightSections, sectionCount });

  const debug = createDebug(
    { assemble, scroll, interactions, orbit, scene, bloom: IS_MOBILE ? null : bloom, states },
    signal,
  );

  // ── prefers-reduced-motion ──────────────────────────────────────────
  // Removed: the autoplay intro, the idle sway/float, pointer parallax, the
  // camera sweep, and the damping tail that keeps the board drifting after
  // scrolling stops. Kept: the explode itself, because it is the content and
  // it is 1:1 with the scroll position — direct manipulation, not autoplay.
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');

  const applyMotionPreference = (reduced: boolean) => {
    interactions.cfg.reduced = reduced;
    interactions.cfg.idle = !reduced;
    interactions.cfg.parallax = !reduced && !IS_MOBILE;
    scroll.cfg.smoothing = reduced ? 1 : SCROLL_SMOOTHING; // 1 = no lerp tail
    orbit.scrollOrbit = reduced ? 0 : SCROLL_ORBIT;
  };
  applyMotionPreference(motionQuery.matches);
  motionQuery.addEventListener('change', (e) => applyMotionPreference(e.matches), { signal });

  onReady?.();

  if (motionQuery.matches) {
    // land assembled without playing the relay; the copy is never hidden,
    // so there is nothing to fade back in
    for (const s of states) s.t = 1;
  } else {
    assemble.play();
  }

  // ── loop ────────────────────────────────────────────────────────────
  const clock = new THREE.Clock();
  const camTarget = new THREE.Vector3();
  const right = new THREE.Vector3(); // reused each frame, never reallocated
  let lastP = -1;
  const baseBloom = bloom.strength;

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);

    // the intro owns `t` until it finishes; after that scroll takes over
    const p = scroll.update(dt, assemble.running || debug.manual.override);
    interactions.update(dt);
    applyStates(states);

    const yaw = orbit.yaw + p * orbit.scrollOrbit;
    const cp = Math.cos(orbit.pitch);
    camera.position.set(
      Math.sin(yaw) * cp * orbit.distance,
      Math.sin(orbit.pitch) * orbit.distance,
      Math.cos(yaw) * cp * orbit.distance,
    );
    // slide camera and target together along the view's right axis: pure lateral
    // pan, so the board shifts on screen without skewing the perspective
    right.set(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(orbit.lateral);
    camTarget.set(right.x, 0, right.z);
    camera.position.add(right);
    camera.lookAt(camTarget);

    // The bar and hint read `--p` off the document — a CSS custom property, not
    // React state, precisely because it changes every frame. Raw, not staged:
    // staged progress visibly stalls the bar on every hold.
    //
    // Written only when it moves by a visible amount. A `--p` write on :root
    // invalidates style for the whole document, and at 2 px of bar travel per
    // 0.002 progress the extra writes buy nothing.
    const p3 = Math.round(scroll.raw * 500) / 500;
    if (p3 !== lastP) {
      lastP = p3;
      document.documentElement.style.setProperty('--p', String(p3));
    }

    // Backdrop follows raw scroll, not staged: the theme should hand over at
    // the section boundary the reader is actually crossing.
    const lightness = backdrop.update(scroll.raw);
    // A light backdrop sits near the bloom threshold, so the whole frame starts
    // glowing and washes out. Fade the bloom back as the page goes light.
    bloom.strength = baseBloom * (1 - lightness * 0.8);

    composer.render();
  });

  // skip the intro on first scroll — nobody should have to wait for it
  addEventListener(
    'wheel',
    () => {
      if (assemble.running) assemble.skip();
    },
    { once: true, passive: true, signal },
  );

  let handle: KeebHandle;

  const engine: Engine = {
    model,
    states,
    orbit,
    dispose() {
      ac.abort();
      renderer.setAnimationLoop(null);
      assemble.dispose();
      backdrop.dispose();
      debug.dispose();
      scene.remove(rig);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          m.dispose();
        }
      });
      rig3d.dispose();
      // Only clear the global if it still points at THIS engine. Under
      // StrictMode the first engine can finish loading after its cleanup has
      // already run and a second engine has taken over — an unconditional
      // delete here wipes the live engine's handle.
      if (window.__keeb === handle) delete window.__keeb;
    },
  };

  // handle for console poking and the QA harness
  handle = Object.assign(engine, {
    parts,
    stats,
    scroll,
    assemble,
    interactions,
    scene,
    camera,
  });
  window.__keeb = handle;

  let drawn = 0;
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) drawn++;
  });
  console.log(
    '[keeb-hero]',
    `${stats.triangles.toLocaleString()} tris,`,
    `${states.length} parts,`,
    `switches ${merged.before}->${merged.after} meshes,`,
    `${drawn} meshes / ${casters} shadow casters,`,
    `mobile: ${IS_MOBILE}`,
  );

  return engine;
}
