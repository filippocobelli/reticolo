import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { api, fileUrl } from '../api.js';
import { loadModel, analyze } from '../viewer/loaders.js';
import { addLights, placeOnFloor, fitCamera, disposeObject, VIEWS } from '../viewer/scene.js';
import { useUI, fmtDims, fmtNum } from './ui.jsx';
import { SlicerButton } from './DetailPanel.jsx';
import { themeColors, onThemeChange } from '../theme.js';

const store = { get: (k, d) => { try { const v = localStorage.getItem('viewer.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('viewer.' + k, JSON.stringify(v)); } catch {} } };

function TreeNode({ node, onToggle, onFocus }) {
  const [vis, setVis] = useState(true);
  const toggle = () => { node.object.visible = !vis; setVis(!vis); onToggle(); };
  return (
    <div className="node">
      <div className="lbl"><input type="checkbox" checked={vis} onChange={toggle} /><span onClick={() => onFocus(node.object)} title="Inquadra">{node.name || 'Assieme'}</span></div>
      {(node.children.length > 0 || node.meshes.length > 1) && <div className="children">
        {node.children.map((c, i) => <TreeNode key={i} node={c} onToggle={onToggle} onFocus={onFocus} />)}
        {node.children.length > 0 && node.meshes.map(m => <div key={m.index} className="muted small" style={{ paddingLeft: 4 }}>▪ {m.name}</div>)}
      </div>}
    </div>
  );
}

function FilePreview({ item }) {
  const url = fileUrl(item.id);
  if (item.kind === 'image') return <div className="loading"><img src={url} style={{ maxWidth: '92%', maxHeight: '86%', objectFit: 'contain' }} alt="" /></div>;
  if (item.kind === 'video') return <div className="loading"><video src={url} controls autoPlay style={{ maxWidth: '92%', maxHeight: '86%' }} /></div>;
  if (item.ext === 'pdf') return <embed className="doc-preview" src={url} type="application/pdf" />;
  return <TextFile url={url} />;
}
function TextFile({ url }) { const [t, setT] = useState('…'); useEffect(() => { fetch(url).then(r => r.text()).then(s => setT(s.slice(0, 500000))); }, [url]); return <div className="text-preview" style={{ paddingTop: 70 }}>{t}</div>; }

export default function Viewer({ item, onClose, slicers }) {
  const ui = useUI();
  const isFile = ['image', 'video', 'doc'].includes(item.kind);
  const mountRef = useRef(null);
  const T = useRef({});
  const [loading, setLoading] = useState(!isFile);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [plates, setPlates] = useState([]);
  const [plate, setPlate] = useState(null);
  const [tree, setTree] = useState(null);
  const [gcode, setGcode] = useState(null);
  const [layer, setLayer] = useState([0, 0]);
  const [measure, setMeasure] = useState(false);
  const [measures, setMeasures] = useState([]);
  const [labels, setLabels] = useState([]);
  const [opts, setOpts] = useState(() => ({ color: store.get('color', '#b8c4d6'), bg: store.get('bg', null), override: store.get('override', false), wire: false, grid: store.get('grid', true), bbox: false }));
  const optsRef = useRef(opts); optsRef.current = opts;

  // ---------- setup scena ----------
  useEffect(() => {
    if (isFile) return;
    const el = mountRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    addLights(scene);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = true;
    const measureGroup = new THREE.Group(); scene.add(measureGroup);
    Object.assign(T.current, { renderer, scene, camera, controls, measureGroup, pending: null });
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let raf;
    const tick = () => { raf = requestAnimationFrame(tick); controls.update(); renderer.render(scene, camera); updateLabels(); };
    tick();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); if (T.current.model) disposeObject(T.current.model); renderer.dispose(); el.innerHTML = ''; };
  }, [isFile]);

  // ---------- caricamento modello / piatto ----------
  useEffect(() => {
    if (isFile) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const loaded = await loadModel(item, { plate });
        if (cancelled) { disposeObject(loaded.object); return; }
        const t = T.current;
        if (t.model) { t.scene.remove(t.model); disposeObject(t.model); }
        if (t.helpers) t.helpers.forEach(h => t.scene.remove(h));
        const obj = loaded.object;
        const box = placeOnFloor(obj);
        t.scene.add(obj); t.model = obj; t.loaded = loaded; t.box = box;
        const a = loaded.type === 'mesh' ? analyze(obj) : { tris: 0, dims: null };
        const size = box.getSize(new THREE.Vector3());
        setInfo({ tris: a.tris, dims: a.dims || [size.x, size.z, size.y].map(n => Math.round(n * 100) / 100), type: loaded.type, meta: loaded.meta });
        if (loaded.plates && loaded.plates.length > 1) { setPlates(loaded.plates); if (plate == null) setPlate(loaded.plate); }
        setTree(loaded.parts && loaded.partMeshes && loaded.partMeshes.length > 1 ? loaded.parts : null);
        if (loaded.gcode && loaded.gcode.layers) { setGcode(loaded.gcode); setLayer([0, loaded.gcode.layers.length - 1]); }
        // griglia e riquadro
        const span = Math.max(size.x, size.z) * 1.6 || 100;
        const step = span > 400 ? 50 : span > 100 ? 10 : span > 20 ? 5 : 1;
        const tc = themeColors();
        const grid = new THREE.GridHelper(Math.ceil(span / step) * step, Math.ceil(span / step), new THREE.Color(tc.grid1), new THREE.Color(tc.grid2));
        grid.position.y = box.min.y - 0.001;
        const bbox = new THREE.Box3Helper(box, new THREE.Color(tc.accent));
        t.helpers = [grid, bbox]; t.grid = grid; t.bboxHelper = bbox; t.gridArgs = [Math.ceil(span / step) * step, Math.ceil(span / step)]; t.gridTheme = tc.mode;
        t.scene.add(grid, bbox);
        applyOpts(optsRef.current);
        fitCamera(t.camera, box, plate == null || !t.fitted ? 'iso' : 'iso', t.controls);
        t.fitted = true;
        clearMeasures();
      } catch (e) { console.error(e); setError(String(e.message || e)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [item.id, plate, isFile]);

  // ---------- opzioni di visualizzazione ----------
  function applyOpts(o) {
    const t = T.current; if (!t.renderer) return;
    const tc = themeColors();
    t.scene.background = new THREE.Color(o.bg || tc.viewerBg);
    if (t.grid && t.gridTheme !== tc.mode) { // ricrea la griglia con i colori del tema
      const g = new THREE.GridHelper(t.gridArgs[0], t.gridArgs[1], new THREE.Color(tc.grid1), new THREE.Color(tc.grid2));
      g.position.copy(t.grid.position); t.scene.remove(t.grid); t.grid.geometry.dispose(); t.grid.material.dispose();
      t.helpers = t.helpers.map(h => h === t.grid ? g : h); t.grid = g; t.scene.add(g); t.gridTheme = tc.mode;
    }
    if (t.bboxHelper) t.bboxHelper.material.color.set(tc.accent);
    if (t.grid) t.grid.visible = o.grid;
    if (t.bboxHelper) t.bboxHelper.visible = o.bbox;
    if (t.model) t.model.traverse(m => {
      if (!m.isMesh || !m.material) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (mat.userData.orig == null) mat.userData.orig = { color: mat.color ? mat.color.getHex() : null, vc: mat.vertexColors };
        const hasOwn = mat.userData.orig.vc || m.userData.hasOwnColor || ['step', 'stp', 'glb', 'fbx', '3dm', 'obj'].includes(item.ext);
        if (o.override || !hasOwn) { mat.color && mat.color.set(o.color); mat.vertexColors = false; }
        else { if (mat.userData.orig.color != null) mat.color.setHex(mat.userData.orig.color); mat.vertexColors = mat.userData.orig.vc; }
        mat.wireframe = o.wire; mat.needsUpdate = true;
      }
    });
  }
  useEffect(() => { applyOpts(opts); store.set('color', opts.color); if (opts.bg) store.set('bg', opts.bg); else { try { localStorage.removeItem('viewer.bg'); } catch {} } store.set('override', opts.override); store.set('grid', opts.grid); }, [opts]);
  useEffect(() => onThemeChange(() => applyOpts(optsRef.current)), []);
  useEffect(() => { if (gcode && gcode.setLayerRange) gcode.setLayerRange(layer[0], layer[1]); }, [layer, gcode]);

  // ---------- misure ----------
  function clearMeasures() { const t = T.current; if (t.measureGroup) { t.measureGroup.children.slice().forEach(c => { t.measureGroup.remove(c); c.geometry && c.geometry.dispose(); }); } t.pending = null; setMeasures([]); setLabels([]); }
  function updateLabels() {
    const t = T.current; if (!t.measureList || !t.renderer) return;
    const el = t.renderer.domElement; const w = el.clientWidth, h = el.clientHeight;
    const out = t.measureList.map(m => { const p = m.mid.clone().project(t.camera); return { x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h, text: `${m.d.toFixed(2)} mm`, vis: p.z < 1 }; });
    if (JSON.stringify(out) !== t.lastLabels) { t.lastLabels = JSON.stringify(out); setLabels(out); }
  }
  useEffect(() => {
    if (isFile) return;
    const t = T.current; const el = t.renderer.domElement;
    let down = null;
    const onDown = (e) => { down = [e.clientX, e.clientY]; };
    const onUp = (e) => {
      if (!measure || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || !t.model) return;
      const r = el.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), t.camera);
      const hit = ray.intersectObject(t.model, true).find(h => h.object.isMesh && h.object.visible);
      if (!hit) return;
      const s = Math.max(t.box.getSize(new THREE.Vector3()).length() / 250, 0.05);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(themeColors().accent), depthTest: false }));
      dot.renderOrder = 999; dot.position.copy(hit.point); t.measureGroup.add(dot);
      if (!t.pending) { t.pending = hit.point.clone(); return; }
      const a = t.pending, b = hit.point.clone(); t.pending = null;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: new THREE.Color(themeColors().accent), depthTest: false }));
      line.renderOrder = 999; t.measureGroup.add(line);
      const d = a.distanceTo(b);
      const m = { d, dx: Math.abs(b.x - a.x), dy: Math.abs(b.z - a.z), dz: Math.abs(b.y - a.y), mid: a.clone().add(b).multiplyScalar(0.5) };
      t.measureList = [...(t.measureList || []), m];
      setMeasures(t.measureList.slice());
    };
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointerup', onUp);
    el.style.cursor = measure ? 'crosshair' : '';
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); };
  }, [measure, isFile]);
  useEffect(() => { if (!measure) T.current.pending = null; }, [measure]);
  const doClear = () => { T.current.measureList = []; clearMeasures(); };

  // ---------- azioni ----------
  const setView = (v) => { const t = T.current; if (t.box) fitCamera(t.camera, t.box, v, t.controls); };
  const focusObj = (o) => { const t = T.current; const b = new THREE.Box3().setFromObject(o); if (!b.isEmpty()) fitCamera(t.camera, b, 'iso', t.controls); };
  const screenshot = async () => {
    const t = T.current; t.renderer.render(t.scene, t.camera);
    const p = await api.tools.saveScreenshot(t.renderer.domElement.toDataURL('image/png'), item.name.replace(/\.[^.]+$/, ''));
    if (p) ui.toast('Screenshot salvato', 'ok');
  };
  const useAsCover = async () => { const t = T.current; t.renderer.render(t.scene, t.camera); await api.items.setCover(item.id, t.renderer.domElement.toDataURL('image/png')); ui.toast('Copertina aggiornata', 'ok'); };
  useEffect(() => {
    const k = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') onClose();
      const map = { '1': 'front', '2': 'back', '3': 'left', '4': 'right', '5': 'top', '6': 'bottom', '0': 'iso' };
      if (map[e.key]) setView(map[e.key]);
      if (e.key === 'm') setMeasure(x => !x);
      if (e.key === 'w') setOpts(o => ({ ...o, wire: !o.wire }));
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="viewer">
      <div className="stage">
        {isFile ? <FilePreview item={item} /> : <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />}
        {labels.map((l, i) => l.vis && <div key={i} className="measure-label" style={{ left: l.x, top: l.y }}>{l.text}</div>)}
        <div className="vtop">
          <button className="btn" onClick={onClose}>← Indietro</button>
          <div className="vtitle">{item.name}</div>
          <div className="spacer" />
          {!isFile && <button className="btn" onClick={screenshot} title="Salva PNG">📷 Screenshot</button>}
        </div>
        {loading && <div className="loading"><div>Caricamento del modello…</div></div>}
        {error && <div className="loading"><div className="err">Impossibile visualizzare: {error}</div><button className="btn" onClick={() => api.items.openDefault(item.id)}>Apri con l'app predefinita</button></div>}
        {!isFile && <div className="vbottom">
          {Object.entries(VIEWS).map(([k, v], i) => <button key={k} className="btn sm ghost" onClick={() => setView(k)} title={`${v.label} (${k === 'iso' ? 0 : i})`}>{v.label}</button>)}
          <span style={{ width: 1, background: 'var(--line2)', margin: '0 4px' }} />
          <button className={`btn sm ${measure ? 'active' : 'ghost'}`} onClick={() => setMeasure(!measure)} title="Misura (M)">📏 Misura</button>
          <button className={`btn sm ${opts.wire ? 'active' : 'ghost'}`} onClick={() => setOpts({ ...opts, wire: !opts.wire })} title="Wireframe (W)">Wire</button>
          <button className={`btn sm ${opts.bbox ? 'active' : 'ghost'}`} onClick={() => setOpts({ ...opts, bbox: !opts.bbox })}>Ingombro</button>
        </div>}
        {!isFile && <div className="hud">Trascina: ruota · Destro/Maiusc: sposta · Rotella: zoom · 0–6: viste</div>}
      </div>

      <div className="side">
        <section><SlicerButton ids={[item.id]} slicers={slicers} /></section>
        {info && <section><h3>Modello</h3>
          <div className="kv">
            {info.dims && <><span>Dimensioni</span><span>{fmtDims(info.dims)}</span></>}
            {info.tris > 0 && <><span>Triangoli</span><span>{fmtNum(info.tris)}</span></>}
            {gcode && gcode.stats && <><span>Layer</span><span>{fmtNum(gcode.layers.length)}</span></>}
            {info.meta && info.meta.flavor && <><span>3MF</span><span>{info.meta.flavor}</span></>}
            {info.meta && info.meta.skipped > 0 && <><span>Non mostrati</span><span>{info.meta.skipped} oggetti (anteprima parziale)</span></>}
          </div>
        </section>}
        {plates.length > 1 && <section><h3>Piatti ({plates.length})</h3>
          <div className="plate-list">{plates.map(p => <button key={p.index} className={`btn sm ${plate === p.index ? 'active' : ''}`} onClick={() => setPlate(p.index)}>{p.name || `Piatto ${p.index}`}</button>)}</div>
        </section>}
        {gcode && gcode.layers && gcode.layers.length > 1 && <section><h3>Layer {layer[1] + 1} / {gcode.layers.length}</h3>
          <input type="range" min={0} max={gcode.layers.length - 1} value={layer[1]} onChange={e => setLayer([Math.min(layer[0], +e.target.value), +e.target.value])} style={{ width: '100%' }} />
          <div className="small muted">Da layer <input type="number" min={0} max={layer[1]} value={layer[0]} onChange={e => setLayer([+e.target.value, layer[1]])} style={{ width: 70 }} /> · Z {gcode.layers[layer[1]] ? gcode.layers[layer[1]].z.toFixed(2) : ''} mm</div>
        </section>}
        {tree && <section><h3>Componenti dell'assieme</h3><div className="tree"><TreeNode node={tree} onToggle={() => {}} onFocus={focusObj} /></div></section>}
        {!isFile && <section><h3>Aspetto</h3>
          <div className="row" style={{ marginBottom: 8 }}><input type="color" value={opts.color} onChange={e => setOpts({ ...opts, color: e.target.value, override: true })} /> Colore modello</div>
          <div className="row" style={{ marginBottom: 8 }}><input type="color" value={opts.bg || themeColors().viewerBg} onChange={e => setOpts({ ...opts, bg: e.target.value })} /> Sfondo
            {opts.bg && <button className="btn sm ghost" title="Usa lo sfondo del tema" onClick={() => setOpts({ ...opts, bg: null })}>Tema</button>}</div>
          <label className="check"><input type="checkbox" checked={!opts.override} onChange={e => setOpts({ ...opts, override: !e.target.checked })} /> Usa i colori del file</label>
          <label className="check"><input type="checkbox" checked={opts.grid} onChange={e => setOpts({ ...opts, grid: e.target.checked })} /> Griglia</label>
        </section>}
        {!isFile && <section><h3>Misure</h3>
          {!measure && !measures.length && <div className="small muted">Attiva "Misura" e fai clic su due punti del modello.</div>}
          {measure && <div className="small" style={{ color: 'var(--accent2)', marginBottom: 6 }}>Clic su due punti del modello…</div>}
          {measures.map((m, i) => <div key={i} className="small" style={{ marginBottom: 4 }}><b>{m.d.toFixed(2)} mm</b> <span className="muted">ΔX {m.dx.toFixed(1)} · ΔY {m.dy.toFixed(1)} · ΔZ {m.dz.toFixed(1)}</span></div>)}
          {measures.length > 0 && <button className="btn sm" onClick={doClear}>Cancella misure</button>}
        </section>}
        {!isFile && !item.archive_id && <section><button className="btn sm" onClick={useAsCover}>Usa questa vista come copertina</button></section>}
      </div>
    </div>
  );
}
