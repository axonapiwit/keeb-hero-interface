import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { EXPECTED_PARTS } from './types';
import type { LoadedModel, PartName, PartReport, Parts } from './types';

// glTF splits a multi-material object into one primitive per material, so
// Three.js wraps it in a Group. Keycap rows and switches arrive as
// Group{ Name, Name_1 } — drive the Group, ignore the primitives.
const PRIMITIVE_CHILD = /_\d+$/;
const SWITCH_INSTANCE = /^KB_Switch_\d/;
const SWITCH_PRIMITIVE = /^KB_Switch_master/;

export function loadKeyboard(url: string): Promise<LoadedModel> {
  const draco = new DRACOLoader().setDecoderPath(
    'https://www.gstatic.com/draco/versioned/decoders/1.5.7/',
  );
  // harmless while the .glb is uncompressed; survives a later gltf-transform pass
  const loader = new GLTFLoader().setDRACOLoader(draco);

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        draco.dispose();
        resolve(inspect(gltf));
      },
      undefined,
      reject,
    );
  });
}

/**
 * Walk the scene graph, bucket every KB_* node, and resolve each expected part.
 *
 * Resolution is exact-name first, then a startsWith fallback, so a rename in
 * Blender degrades into a warning instead of a silent undefined at animation
 * time. KB_Switches_Group is an Empty with 84 KB_Switch_* children — those are
 * counted, never treated as top-level parts.
 */
function inspect(gltf: GLTF): LoadedModel {
  const root = gltf.scene;
  const found: { name: string; type: string }[] = [];
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (!o.name) return;
    byName.set(o.name, o);
    if (o.name.startsWith('KB_')) found.push({ name: o.name, type: o.type });
  });

  const parts = {} as Parts;
  const report: PartReport[] = [];
  for (const want of EXPECTED_PARTS) {
    let node = byName.get(want) ?? null;
    let how: string | null = node ? 'exact' : null;
    if (!node) {
      // prefix fallback — skip split primitives and switch instances, or
      // KB_Keycaps_Row0 would resolve to its own KB_Keycaps_Row0_1 child
      for (const [name, o] of byName) {
        if (name.startsWith(want) && !PRIMITIVE_CHILD.test(name) && !SWITCH_INSTANCE.test(name)) {
          node = o;
          how = `prefix:${name}`;
          break;
        }
      }
    }
    parts[want] = node;
    report.push({ want, ok: !!node, how: how ?? 'MISSING', type: node?.type ?? '—' });
  }

  const switchInstances = found.filter((f) => SWITCH_INSTANCE.test(f.name)).length;
  const expected = EXPECTED_PARTS as readonly string[];
  const unexpected = [
    ...new Set(
      found
        .filter(
          (f) =>
            !expected.includes(f.name) &&
            !SWITCH_INSTANCE.test(f.name) &&
            !SWITCH_PRIMITIVE.test(f.name) &&
            !PRIMITIVE_CHILD.test(f.name),
        )
        .map((f) => f.name),
    ),
  ];

  const meshes = new Set<string>();
  let tris = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes.add(mesh.geometry.uuid);
    const g = mesh.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });

  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());

  return {
    root,
    parts,
    report,
    stats: {
      kbNodes: found.length,
      switchInstances,
      unexpected,
      uniqueGeometries: meshes.size,
      triangles: Math.round(tris),
      sizeMM: [size.x * 10, size.y * 10, size.z * 10],
    },
  };
}

/** Names that failed to resolve — surfaced by the engine so a Blender rename is loud. */
export function missingParts(report: PartReport[]): PartName[] {
  return report.filter((r) => !r.ok).map((r) => r.want);
}
