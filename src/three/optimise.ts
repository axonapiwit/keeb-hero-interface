import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Draw-call surgery on the loaded model.
 *
 * Measured on the deployed build: 272 meshes, 252 of them the 84 switches, and
 * 271 shadow casters — so every frame submitted ~540 draw calls across the
 * shadow pass and the main pass. Draw-call overhead is CPU-bound, so it costs
 * the same on a phone as on a workstation and does not care about resolution.
 *
 * The switches never animate individually: `KB_Switches_Group` moves as one
 * unit. That makes them free to merge.
 */

/**
 * Merge the 84 switch instances into one mesh per material.
 *
 * 252 draw calls -> 3. Geometry is baked into group-local space, so the group
 * transform the explode animation drives still applies unchanged.
 */
export function mergeSwitches(group: THREE.Object3D): { before: number; after: number } {
  group.updateWorldMatrix(true, true);
  const toGroupLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();

  // bucket every leaf geometry by the material it draws with
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const doomed: THREE.Object3D[] = [];
  let before = 0;

  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    before++;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.updateWorldMatrix(true, false);
    const local = new THREE.Matrix4().multiplyMatrices(toGroupLocal, mesh.matrixWorld);

    const groups = mesh.geometry.groups.length
      ? mesh.geometry.groups
      : [{ start: 0, count: Infinity, materialIndex: 0 }];

    for (const g of groups) {
      const mat = mats[g.materialIndex ?? 0] ?? mats[0];
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(local);
      // strip attributes that differ between primitives — mergeGeometries
      // requires an identical attribute set across every input
      for (const name of Object.keys(geo.attributes)) {
        if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
      }
      geo.clearGroups();
      const list = byMaterial.get(mat);
      if (list) list.push(geo);
      else byMaterial.set(mat, [geo]);
    }
  });

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) doomed.push(o);
  });
  for (const o of doomed) {
    o.parent?.remove(o);
    const mesh = o as THREE.Mesh;
    mesh.geometry.dispose();
  }

  let after = 0;
  for (const [mat, geos] of byMaterial) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `KB_Switches_merged_${mat.name || after}`;
    // Switches sit inside the case with the plate above and the frame around
    // them. Their shadows are never visible, and 252 casters is most of the
    // shadow pass.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    after++;
  }

  return { before, after };
}

/**
 * Only the parts whose shadow actually lands on the ground plane need to cast.
 * Internals are enclosed by the case; their shadow contribution is invisible.
 */
const SHADOWLESS = /^(KB_Switches|KB_PCB|KB_Plate|KB_SideControls)/;

export function pruneShadowCasters(root: THREE.Object3D): { casters: number } {
  let casters = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let enclosed = false;
    let p: THREE.Object3D | null = o;
    while (p) {
      if (SHADOWLESS.test(p.name)) {
        enclosed = true;
        break;
      }
      p = p.parent;
    }
    mesh.castShadow = !enclosed;
    mesh.receiveShadow = true;
    if (mesh.castShadow) casters++;
  });
  return { casters };
}
