import * as THREE from 'three';

export const VIEWS = {
  iso: { label: 'Isometrica', dir: [1, 0.8, 1] },
  front: { label: 'Fronte', dir: [0, 0, 1] },
  back: { label: 'Retro', dir: [0, 0, -1] },
  left: { label: 'Sinistra', dir: [-1, 0, 0] },
  right: { label: 'Destra', dir: [1, 0, 0] },
  top: { label: 'Alto', dir: [0, 1, 0.0001] },
  bottom: { label: 'Basso', dir: [0, -1, 0.0001] },
};

export function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 1.6));
  const d1 = new THREE.DirectionalLight(0xffffff, 1.8); d1.position.set(3, 5, 4); scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.7); d2.position.set(-4, 2, -3); scene.add(d2);
  const d3 = new THREE.DirectionalLight(0xffffff, 0.35); d3.position.set(0, -4, 0); scene.add(d3);
}

// Appoggia il modello sul piano e lo centra in XZ
export function placeOnFloor(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return box;
  const c = box.getCenter(new THREE.Vector3());
  object.position.x -= c.x; object.position.z -= c.z; object.position.y -= box.min.y;
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

export function fitCamera(camera, box, view = 'iso', controls, margin = 1.25) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.001);
  const d = new THREE.Vector3(...(VIEWS[view] || VIEWS.iso).dir).normalize();
  if (camera.isOrthographicCamera) {
    const aspect = (camera.right - camera.left) / (camera.top - camera.bottom) || 1;
    const h = radius * margin;
    camera.left = -h * aspect; camera.right = h * aspect; camera.top = h; camera.bottom = -h;
    camera.position.copy(center).addScaledVector(d, radius * 4);
  } else {
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const dist = (radius * margin) / Math.sin(fov / 2);
    camera.position.copy(center).addScaledVector(d, dist);
  }
  camera.near = Math.max(radius / 1000, 0.001); camera.far = radius * 100;
  camera.up.set(0, 1, 0);
  if (Math.abs(d.y) > 0.99) camera.up.set(0, 0, d.y > 0 ? -1 : 1);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  if (controls) { controls.target.copy(center); controls.update(); }
}

export function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); });
  });
}
