// Anteprima three.js condivisa dai generatori. Z verso l'alto, piano di stampa in XY.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { themeColors, onThemeChange } from '../../theme.js';

export default function MeshPreview({ parts, frameKey }) {
  const host = useRef(null);
  const st = useRef(null);

  useEffect(() => {
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const tc = themeColors();
    scene.background = new THREE.Color(tc.viewerBg || '#1b1e24');
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(120, -160, 120);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(80, -120, 200);
    scene.add(dir);
    let grid = null;
    const makeGrid = () => {
      const c = themeColors();
      if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
      grid = new THREE.GridHelper(300, 30, new THREE.Color(c.grid1 || '#3a4050'), new THREE.Color(c.grid2 || '#2a2f38'));
      grid.rotation.x = Math.PI / 2;
      scene.add(grid);
      scene.background = new THREE.Color(c.viewerBg || '#1b1e24');
    };
    makeGrid();
    const offTheme = onThemeChange(makeGrid);
    const group = new THREE.Group();
    scene.add(group);

    const resize = () => {
      const w = el.clientWidth || 400, h = el.clientHeight || 400;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
    loop();
    st.current = { renderer, scene, camera, controls, group };
    return () => {
      offTheme();
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      group.traverse(o => { if (o.material) o.material.dispose(); });
      renderer.dispose();
      el.removeChild(renderer.domElement);
      st.current = null;
    };
  }, []);

  // aggiorna le mesh
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    s.group.children.slice().forEach(c => { s.group.remove(c); c.material.dispose(); });
    for (const p of parts || []) {
      if (!p || !p.geometry) continue;
      if (!p.geometry.getAttribute('normal')) p.geometry.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: p.color || '#cccccc', roughness: 0.55, metalness: 0.05, flatShading: !!p.flat });
      s.group.add(new THREE.Mesh(p.geometry, mat));
    }
  }, [parts]);

  // inquadra quando cambia frameKey
  useEffect(() => {
    const s = st.current;
    if (!s || !s.group.children.length) return;
    const box = new THREE.Box3().setFromObject(s.group);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2 || 50;
    const d = r / Math.sin((s.camera.fov * Math.PI / 180) / 2) * 1.1;
    s.controls.target.copy(c);
    s.camera.position.copy(c).add(new THREE.Vector3(0.55, -0.75, 0.6).normalize().multiplyScalar(d));
    s.camera.near = d / 100; s.camera.far = d * 20; s.camera.updateProjectionMatrix();
  }, [frameKey, parts && parts.length > 0]);

  return <div ref={host} className="mesh-preview" />;
}
