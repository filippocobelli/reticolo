// Caricamento modelli condiviso da visualizzatore e worker delle miniature.
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { api, fileUrl } from '../api.js';

export const Z_UP = new Set(['stl', '3mf', 'step', 'stp', '3dm', 'gcode', 'gco', 'ply', 'dxf']);

export function defaultMaterial(color = '#b8c4d6') {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08, side: THREE.DoubleSide, flatShading: false });
}

async function fetchBytes(id) {
  const r = await fetch(fileUrl(id));
  if (!r.ok) throw new Error(await r.text());
  return r.arrayBuffer();
}

let occtPromise = null;
async function occt() {
  if (!occtPromise) occtPromise = (async () => {
    const [{ default: init }, { default: wasmUrl }] = await Promise.all([import('occt-import-js'), import('occt-import-js/dist/occt-import-js.wasm?url')]);
    return init({ locateFile: () => wasmUrl });
  })();
  return occtPromise;
}
let rhinoPromise = null;
async function rhino() {
  if (!rhinoPromise) rhinoPromise = (async () => {
    const [{ default: init }, { default: wasmUrl }] = await Promise.all([import('rhino3dm/rhino3dm.module.js'), import('rhino3dm/rhino3dm.wasm?url')]);
    return init({ locateFile: () => wasmUrl });
  })();
  return rhinoPromise;
}

function meshFromArrays(pos, idx, color, name, normals) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (normals && normals.length === pos.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (idx) g.setIndex(Array.from(idx));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const m = new THREE.Mesh(g, defaultMaterial(color));
  m.name = name || '';
  return m;
}

// --- STEP con albero dell'assieme ---
async function loadStep(buf) {
  const occ = await occt();
  const res = occ.ReadStepFile(new Uint8Array(buf), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 });
  if (!res.success) throw new Error('STEP non leggibile');
  const meshes = res.meshes.map((m, i) => {
    const col = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]).getStyle() : undefined;
    const mesh = meshFromArrays(m.attributes.position.array, m.index ? m.index.array : null, col, m.name || `Parte ${i + 1}`, m.attributes.normal && m.attributes.normal.array);
    mesh.userData.partIndex = i;
    return mesh;
  });
  const root = new THREE.Group();
  const build = (node, parent, depth = 0) => {
    const g = new THREE.Group(); g.name = node.name || 'Assieme';
    const tree = { name: g.name, children: [], meshes: [] };
    for (const mi of node.meshes || []) { if (meshes[mi]) { g.add(meshes[mi]); tree.meshes.push({ index: mi, name: meshes[mi].name }); } }
    for (const c of node.children || []) tree.children.push(build(c, g, depth + 1));
    parent.add(g);
    tree.object = g;
    return tree;
  };
  const tree = build(res.root || { meshes: meshes.map((_, i) => i) }, root);
  return { root, parts: tree, partMeshes: meshes };
}

// --- Rhino 3DM (anteprima parziale: mesh e render mesh delle brep se presenti) ---
async function load3dm(buf) {
  const rh = await rhino();
  const doc = rh.File3dm.fromByteArray(new Uint8Array(buf));
  if (!doc) throw new Error('3DM non leggibile');
  const root = new THREE.Group();
  const loader = new THREE.BufferGeometryLoader();
  const objs = doc.objects();
  let skipped = 0;
  for (let i = 0; i < objs.count; i++) {
    const o = objs.get(i); const geo = o.geometry(); const attr = o.attributes();
    let meshes = [];
    const t = geo.objectType;
    if (t === rh.ObjectType.Mesh) meshes = [geo];
    else if (t === rh.ObjectType.Brep || t === rh.ObjectType.Extrusion || t === rh.ObjectType.SubD) {
      const brep = t === rh.ObjectType.Extrusion ? geo.toBrep(true) : geo;
      if (brep && brep.faces) { const faces = brep.faces(); for (let f = 0; f < faces.count; f++) { const m = faces.get(f).getMesh(rh.MeshType.Any); if (m) meshes.push(m); } }
      if (!meshes.length && t === rh.ObjectType.Extrusion && geo.getMesh) { const m = geo.getMesh(rh.MeshType.Any); if (m) meshes.push(m); }
    }
    if (!meshes.length) { skipped++; continue; }
    const c = attr.drawColor ? attr.drawColor(doc) : null;
    const col = c ? `rgb(${c.r},${c.g},${c.b})` : undefined;
    for (const m of meshes) {
      try { const g = loader.parse(m.toThreejsJSON()); const mesh = new THREE.Mesh(g, defaultMaterial(col)); mesh.name = attr.name || ''; root.add(mesh); } catch { skipped++; }
    }
  }
  return { root, meta: { skipped } };
}

// --- 3MF tramite parser del processo principale (piatti, colori, extruder) ---
async function load3mf(item, buf, opts) {
  try {
    const data = await api.threemf.mesh(item.id);
    if (data && data.objects && data.objects.length) {
      const root = new THREE.Group();
      const plates = data.plates || [];
      const plate = opts.plate ?? (plates.length > 1 ? plates[0].index : null);
      for (const o of data.objects) {
        if (plate != null && o.plate != null && o.plate !== plate) continue;
        const pos = o.positions instanceof Float32Array ? o.positions : new Float32Array(o.positions);
        if (!pos.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const vc = o.vertexColors || o.colors;
        if (vc && vc.length === pos.length) {
          const lin = new Float32Array(vc.length);
          for (let i = 0; i < vc.length; i++) { const c = vc[i]; lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
          g.setAttribute('color', new THREE.BufferAttribute(lin, 3));
        }
        g.computeVertexNormals();
        const mat = defaultMaterial(o.color || undefined);
        if (g.getAttribute('color')) { mat.vertexColors = true; mat.color.set('#ffffff'); }
        const m = new THREE.Mesh(g, mat); m.name = o.name || ''; m.userData.extruder = o.extruder; m.userData.hasOwnColor = !!o.color;
        root.add(m);
      }
      return { root, plates, plate, meta: { flavor: data.flavor, colors: data.colors } };
    }
  } catch (e) { console.warn('threemf:mesh non disponibile, uso loader di three', e.message); }
  const obj = new ThreeMFLoader().parse(buf);
  return { root: obj };
}

export async function loadModel(item, opts = {}) {
  const ext = item.ext;
  const buf = opts.buffer || await fetchBytes(item.id);
  let out;
  switch (ext) {
    case 'stl': { const g = new STLLoader().parse(buf); if (!g.getAttribute('normal')) g.computeVertexNormals(); const mat = defaultMaterial(); if (g.hasColors) { mat.vertexColors = true; } out = { root: new THREE.Mesh(g, mat) }; break; }
    case 'obj': out = { root: new OBJLoader().parse(new TextDecoder().decode(buf)) }; break;
    case 'ply': { const g = new PLYLoader().parse(buf); const mat = defaultMaterial(); if (g.getAttribute('color')) mat.vertexColors = true; if (!g.getIndex() && !g.getAttribute('normal')) g.computeVertexNormals(); else if (!g.getAttribute('normal')) g.computeVertexNormals();
      out = { root: g.index || g.attributes.position.count >= 3 ? new THREE.Mesh(g, mat) : new THREE.Points(g, new THREE.PointsMaterial({ size: 0.5, vertexColors: !!g.getAttribute('color') })) }; break; }
    case 'glb': case 'gltf': { const r = await new GLTFLoader().parseAsync(buf, ''); out = { root: r.scene, animations: r.animations }; break; }
    case 'fbx': out = { root: new FBXLoader().parse(buf, '') }; break;
    case '3mf': out = await load3mf(item, buf, opts); break;
    case 'step': case 'stp': out = await loadStep(buf); break;
    case '3dm': out = await load3dm(buf); break;
    case 'gcode': case 'gco': {
      const { buildGcodeObject } = await import('./gcode.js');
      const r = buildGcodeObject(new TextDecoder().decode(buf), THREE);
      out = { root: r.object, type: 'lines', gcode: r }; break;
    }
    case 'dxf': {
      const { buildDxfObject } = await import('./dxf.js');
      const r = buildDxfObject(new TextDecoder().decode(buf), THREE);
      out = { root: r.object, type: 'lines', flat: true }; break;
    }
    default: throw new Error(`Formato non visualizzabile: ${ext}`);
  }
  out.type ||= 'mesh';
  const wrapper = new THREE.Group();
  wrapper.add(out.root);
  if (Z_UP.has(ext)) out.root.rotation.x = -Math.PI / 2;
  wrapper.updateMatrixWorld(true);
  out.object = wrapper;
  return out;
}

// Analisi geometrica: triangoli, dimensioni e impronta indipendente da ordine/posizione/formato
export function analyze(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  let tris = 0;
  const v = new THREE.Vector3();
  const meshes = [];
  object.traverse(o => { if (o.isMesh && o.geometry && o.geometry.getAttribute('position')) meshes.push(o); });
  // dimensioni nel sistema originale del file (Z verso l'alto per STL/3MF)
  const size = box.getSize(new THREE.Vector3());
  let h1 = 0, h2 = 0;
  const q = 0.05; // quantizzazione 0.05 unita'
  const min = box.min;
  for (const m of meshes) {
    const g = m.geometry; const pos = g.getAttribute('position'); const idx = g.getIndex();
    const n = idx ? idx.count : pos.count;
    tris += Math.floor(n / 3);
    for (let i = 0; i < n; i++) {
      const k = idx ? idx.getX(i) : i;
      v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld);
      const x = Math.round((v.x - min.x) / q), y = Math.round((v.y - min.y) / q), z = Math.round((v.z - min.z) / q);
      let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
      h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 16;
      h1 = (h1 + h) | 0; h2 = (h2 ^ Math.imul(h, 0x27d4eb2d)) | 0;
    }
  }
  const dims = [size.x, size.z, size.y].map(n => Math.round(n * 100) / 100); // X, Y(profondita'), Z(altezza)
  const geoHash = tris ? `${tris}-${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}` : null;
  return { tris, dims, geoHash, box };
}
