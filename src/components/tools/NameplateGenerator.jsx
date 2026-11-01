// Generatore di targhette (beta): base + testo come oggetti separati (estrusore 1 e 2)
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import MeshPreview from './MeshPreview.jsx';
import { FONTS, loadFont, textShapes } from './fonts.js';
import { buildNameplate, positionsOf } from './geometry.js';
import { Slider, Check, Select, Color } from './controls.jsx';
import './tools.css';

const DEFAULTS = {
  line1: 'Reticolo', line2: '', fontId: 'roboto-bold', textHeight: 10, lineSpacing: 0.5,
  autoSize: true, padding: 5, width: 100, height: 35,
  baseThickness: 3, textThickness: 1.2, cornerRadius: 4,
  border: true, borderWidth: 1.2, borderGap: 2.5,
  hole: false, holeDiameter: 5,
  mode: 'rilievo', fillEngraving: true,
  baseColor: '#1f2a44', textColor: '#f2f2f2',
};

export default function NameplateGenerator() {
  const [p, setP] = useState(DEFAULTS);
  const [font, setFont] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (v) => setP(s => ({ ...s, [k]: v }));

  useEffect(() => {
    let alive = true;
    setFont(null);
    loadFont(p.fontId).then(f => { if (alive) setFont(f); }).catch(e => setError(`Font non caricato: ${e.message}`));
    return () => { alive = false; };
  }, [p.fontId]);

  const result = useMemo(() => {
    if (!font) return null;
    try {
      const script = !!FONTS.find(f => f.id === p.fontId)?.script;
      const lines = [p.line1, p.line2].filter(t => t && t.trim()).map((t, i) => {
        const h = i === 0 ? p.textHeight : p.textHeight * 0.7; // la seconda riga e' piu' piccola
        return { ...textShapes(font, t, h), height: h, script };
      });
      return buildNameplate(p, lines);
    } catch (e) {
      return { error: e.message };
    }
  }, [font, p]);

  const parts = useMemo(() => {
    if (!result || result.error) return [];
    return [{ geometry: result.base, color: p.baseColor }, result.text && { geometry: result.text, color: p.textColor }].filter(Boolean);
  }, [result, p.baseColor, p.textColor]);

  async function exportAs(format) {
    setError(''); setStatus('');
    if (!result || result.error) return;
    const objects = [{ name: 'Base', positions: positionsOf(result.base), color: p.baseColor, extruder: 1 }];
    if (result.text) objects.push({ name: 'Testo', positions: positionsOf(result.text), color: p.textColor, extruder: 2 });
    try {
      const name = `Targhetta ${(p.line1 || 'testo').trim()}`.slice(0, 60);
      const out = await api.mesh.export({ name, format, objects });
      if (out) setStatus(`Salvato: ${out}`);
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="tool-layout">
      <div className="tool-params panel">
        <div className="row" style={{ alignItems: 'center', gap: 8 }}><h3 style={{ margin: 0 }}>Generatore di targhette</h3><span className="badge">beta</span></div>
        <h4>Testo</h4>
        <div className="field"><label>Riga 1</label><input value={p.line1} onChange={e => set('line1')(e.target.value)} /></div>
        <div className="field"><label>Riga 2 (facoltativa)</label><input value={p.line2} onChange={e => set('line2')(e.target.value)} /></div>
        <Select label="Font" value={p.fontId} options={FONTS.map(f => ({ value: f.id, label: f.name }))} onChange={set('fontId')} />
        <Slider label="Altezza lettere" value={p.textHeight} min={3} max={40} step={0.5} onChange={set('textHeight')} />
        {p.line2 && <Slider label="Spaziatura righe" value={p.lineSpacing} min={0.1} max={1.5} step={0.05} unit="×" onChange={set('lineSpacing')} />}
        <Select label="Stile testo" value={p.mode} options={[{ value: 'rilievo', label: 'In rilievo' }, { value: 'inciso', label: 'Inciso' }]} onChange={set('mode')} />
        <Slider label={p.mode === 'inciso' ? 'Profondità incisione' : 'Altezza rilievo'} value={p.textThickness} min={0.4} max={5} step={0.1} onChange={set('textThickness')} />
        {p.mode === 'inciso' && <Check label="Riempi l'incisione con il secondo colore (intarsio a filo)" value={p.fillEngraving} onChange={set('fillEngraving')} />}

        <h4>Base</h4>
        <Check label="Dimensioni automatiche dal testo" value={p.autoSize} onChange={set('autoSize')} />
        {p.autoSize
          ? <Slider label="Margine" value={p.padding} min={1} max={20} step={0.5} onChange={set('padding')} />
          : <>
            <Slider label="Larghezza" value={p.width} min={20} max={250} step={1} onChange={set('width')} />
            <Slider label="Altezza" value={p.height} min={10} max={150} step={1} onChange={set('height')} />
          </>}
        <Slider label="Spessore base" value={p.baseThickness} min={1} max={10} step={0.2} onChange={set('baseThickness')} />
        <Slider label="Raggio angoli" value={p.cornerRadius} min={0} max={20} step={0.5} onChange={set('cornerRadius')} />
        <Check label="Bordo" value={p.border} onChange={set('border')} />
        {p.border && <>
          <Slider label="Larghezza bordo" value={p.borderWidth} min={0.4} max={5} step={0.1} onChange={set('borderWidth')} />
          <Slider label="Distanza bordo dal margine" value={p.borderGap} min={0.5} max={8} step={0.1} onChange={set('borderGap')} />
        </>}
        <Check label="Foro per appendere" value={p.hole} onChange={set('hole')} />
        {p.hole && <Slider label="Diametro foro" value={p.holeDiameter} min={2} max={12} step={0.5} onChange={set('holeDiameter')} />}

        <h4>Colori (anteprima e 3MF)</h4>
        <div className="row" style={{ gap: 12 }}>
          <Color label="Base (estrusore 1)" value={p.baseColor} onChange={set('baseColor')} />
          <Color label="Testo (estrusore 2)" value={p.textColor} onChange={set('textColor')} />
        </div>

        {result && result.warnings && result.warnings.map(w => <div key={w} className="tool-warn">{w}</div>)}
        {result && result.error && <div className="tool-warn">Errore geometria: {result.error}</div>}
        {error && <div className="tool-warn">{error}</div>}
        {status && <div className="tool-ok">{status}</div>}
        <div className="tool-actions">
          <button className="btn primary" disabled={!parts.length} onClick={() => exportAs('3mf')}>Esporta 3MF (2 colori)</button>
          <button className="btn" disabled={!parts.length} onClick={() => exportAs('stl')}>Esporta STL</button>
          <button className="btn" onClick={() => setP(DEFAULTS)}>Ripristina</button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Il 3MF contiene base e testo come oggetti separati, già assegnati agli estrusori 1 e 2. L'STL unisce tutto in un solo corpo.</p>
      </div>
      <div className="tool-preview panel">
        <MeshPreview parts={parts} frameKey={`${p.autoSize}-${p.line1.length > 0}-${p.fontId}`} />
        {result && !result.error && <div className="preview-info">{result.width.toFixed(1)} × {result.height.toFixed(1)} × {(p.baseThickness + (p.mode === 'rilievo' ? p.textThickness : 0)).toFixed(1)} mm</div>}
        {!font && !error && <div className="preview-info">Caricamento font…</div>}
      </div>
    </div>
  );
}
