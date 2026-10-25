// Netverse GLB loader — assets live in public/models/netverse/.
// Each file is parsed once and cached as a pre-merged Group (one mesh per
// material) so cloning it per rack slot stays cheap on mobile GPUs.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const loader = new GLTFLoader();
const cache = new Map<string, THREE.Group>();

function markAsset(group: THREE.Group): THREE.Group {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = true;
      obj.userData.glbAsset = true;
    }
  });
  return group;
}

// The Netverse assets are authored with a single vertex-coloured material but
// hundreds of tiny meshes (drives, LEDs, vents). Merge them by material so a
// cloned rack unit is 1 draw call instead of ~100.
function mergeByMaterial(root: THREE.Group): THREE.Group {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (Array.isArray(obj.material)) return;
    let bucket = buckets.get(obj.material.uuid);
    if (!bucket) {
      bucket = { material: obj.material, geometries: [] };
      buckets.set(obj.material.uuid, bucket);
    }
    const geometry = obj.geometry.clone();
    geometry.applyMatrix4(obj.matrixWorld);
    bucket.geometries.push(geometry);
  });
  if (buckets.size === 0) return markAsset(root);

  const output = new THREE.Group();
  output.name = root.name || "netverse-asset";
  for (const bucket of buckets.values()) {
    const merged = bucket.geometries.length === 1
      ? bucket.geometries[0]
      : mergeGeometries(bucket.geometries, false);
    if (!merged) {
      bucket.geometries.forEach((g) => g.dispose());
      return markAsset(root);
    }
    if (bucket.geometries.length > 1) bucket.geometries.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.userData.glbAsset = true;
    output.add(mesh);
  }
  return output;
}

export async function loadNetverseAsset(file: string): Promise<THREE.Group> {
  const cached = cache.get(file);
  if (cached) return cached.clone(true);

  const gltf = await loader.loadAsync(`/models/netverse/${file}`);
  const prepared = mergeByMaterial(gltf.scene);
  cache.set(file, prepared);
  return prepared.clone(true);
}
