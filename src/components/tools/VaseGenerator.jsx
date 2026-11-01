// Generatore di vasi parametrici (beta): solido chiuso e manifold, da stampare in modalità vaso
import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import MeshPreview from './MeshPreview.jsx';
import { buildVase, positionsOf, PROFILES } from './geometry.js';
import { Slider, Select, Color } from './controls.jsx';
import './tools.css';

const DEFAULTS = {
  height: 140, baseRadius: 35, topRadius: 45, curve: 1, profile: 'bombato', bulge: 12,
  sides: 0, smooth: 0.4, twist: 60, waves: 0, waveAmp: 2,
  layers: 140, segments: 192, color: '#c9784a',
};
const PROFILE_LABELS = { dritto: 'Dritto', bombato: 'Bombato', clessidra: 'Clessidra', tulipano: 'Tulipano', anfora: 'Anfora' };
const PRESETS = {
  'Classico': {},
  'Esagono ritorto': { sides: 6, smooth: 0, twist: 120, profile: 'dritto', bulge: 0, topRadius: 40 },
  'Onde': { sides: 0, waves: 12, waveAmp: 3, twist: 90, profile: 'tulipano', bulge: 8 },
  'Clessidra': { profile: 'clessidra', bulge: 12, sides: 8, smooth: 0.5, twist: 45, topRadius: 40 },
};

export default function VaseGenerator() {
  const [p, setP] = useState(DEFAULTS);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (v) => setP(s => ({ ...s, [k]: v }));

  const geometry = useMemo(() => buildVase(p), [p]);
  const parts = useMemo(() => [{ geometry, color: p.color }], [geometry, p.color]);
  const tris = geometry.index ? geometry.index.count / 3 : 0;

  async function exportAs(format) {
    setError(''); setStatus('');
    try {
      const out = await api.mesh.export({ name: `Vaso ${Math.round(p.height)}mm`, format, objects: [{ name: 'Vaso', positions: positionsOf(geometry), color: p.color, extruder: 1 }] });
      if (out) setStatus(`Salvato: ${out}`);
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="tool-layout">
      <div className="tool-params panel">
        <div className="row" style={{ alignItems: 'center', gap: 8 }}><h3 style={{ margin: 0 }}>Generatore di vasi</h3><span className="badge">beta</span></div>
        <div className="field">
          <label>Preimpostazioni</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(PRESETS).map(([k, v]) => <button key={k} className="btn" onClick={() => setP({ ...DEFAULTS, ...v })}>{k}</button>)}
          </div>
        </div>
        <h4>Forma</h4>
        <Slider label="Altezza" value={p.height} min={20} max={300} step={1} onChange={set('height')} />
        <Slider label="Raggio base" value={p.baseRadius} min={10} max={120} step={0.5} onChange={set('baseRadius')} />
        <Slider label="Raggio bocca" value={p.topRadius} min={5} max={150} step={0.5} onChange={set('topRadius')} />
        <Slider label="Curvatura raccordo" value={p.curve} min={0.3} max={3} step={0.05} unit="" onChange={set('curve')} />
        <Select label="Profilo" value={p.profile} options={Object.keys(PROFILES).map(k => ({ value: k, label: PROFILE_LABELS[k] || k }))} onChange={set('profile')} />
        {p.profile !== 'dritto' && <Slider label="Intensità profilo" value={p.bulge} min={-40} max={40} step={0.5} onChange={set('bulge')} />}
        <h4>Sezione</h4>
        <Slider label="Numero lati (0 = tondo)" value={p.sides} min={0} max={16} step={1} unit="" onChange={v => set('sides')(v > 0 && v < 3 ? 3 : v)} />
        {p.sides >= 3 && <Slider label="Morbidezza spigoli" value={p.smooth} min={0} max={1} step={0.05} unit="" onChange={set('smooth')} />}
        <Slider label="Torsione totale" value={p.twist} min={-360} max={360} step={5} unit="°" onChange={set('twist')} />
        <Slider label="Onde (numero)" value={p.waves} min={0} max={32} step={1} unit="" onChange={set('waves')} />
        {p.waves > 0 && <Slider label="Ampiezza onde" value={p.waveAmp} min={0.2} max={10} step={0.1} onChange={set('waveAmp')} />}
        <h4>Qualità</h4>
        <Slider label="Strati della mesh" value={p.layers} min={20} max={400} step={10} unit="" onChange={set('layers')} />
        <Slider label="Segmenti per giro" value={p.segments} min={48} max={512} step={16} unit="" onChange={set('segments')} />
        <Color label="Colore anteprima" value={p.color} onChange={set('color')} />
        {error && <div className="tool-warn">{error}</div>}
        {status && <div className="tool-ok">{status}</div>}
        <div className="tool-actions">
          <button className="btn primary" onClick={() => exportAs('stl')}>Esporta STL</button>
          <button className="btn" onClick={() => exportAs('3mf')}>Esporta 3MF</button>
          <button className="btn" onClick={() => setP(DEFAULTS)}>Ripristina</button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Il modello è un solido chiuso: nello slicer attiva la modalità vaso (spirale) per stampare solo la parete esterna con il fondo.</p>
      </div>
      <div className="tool-preview panel">
        <MeshPreview parts={parts} frameKey={`${Math.round(p.height / 20)}-${Math.round(Math.max(p.baseRadius, p.topRadius) / 20)}`} />
        <div className="preview-info">Ø max ≈ {(2 * Math.max(p.baseRadius, p.topRadius) + 2 * Math.max(0, p.bulge) + 2 * p.waveAmp * (p.waves > 0)).toFixed(0)} mm · h {p.height} mm · {tris.toLocaleString('it-IT')} triangoli</div>
      </div>
    </div>
  );
}
