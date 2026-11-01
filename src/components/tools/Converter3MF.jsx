// Convertitore 3MF tra slicer (beta). L'originale non viene mai modificato.
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import './tools.css';

const FLAVOR = { bambu: 'Bambu Studio', orca: 'OrcaSlicer', prusa: 'PrusaSlicer', cura: 'Cura', generic: '3MF generico' };
const TARGETS = [
  { id: 'bambu', label: 'Bambu Studio', hint: 'piatti multipli, colori AMS' },
  { id: 'orca', label: 'OrcaSlicer', hint: 'piatti multipli, colori' },
  { id: 'prusa', label: 'PrusaSlicer', hint: 'un file per piatto, MMU' },
  { id: 'generic', label: '3MF generico', hint: 'Cura, Lychee, altri' },
];

export default function Converter3MF({ itemId }) {
  const [src, setSrc] = useState(itemId ?? null);
  const [info, setInfo] = useState(null);
  const [target, setTarget] = useState('prusa');
  const [split, setSplit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { if (itemId != null) setSrc(itemId); }, [itemId]);
  useEffect(() => {
    setInfo(null); setResult(null); setError('');
    if (src == null) return;
    let alive = true;
    api.threemf.info(src).then(i => {
      if (!alive) return;
      setInfo(i);
      const fam = i.flavor === 'orca' || i.flavor === 'bambu';
      setTarget(fam ? 'prusa' : 'bambu');
    }).catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [src]);

  async function pick() {
    const p = await api.tools.pickFile([{ name: '3MF', extensions: ['3mf'] }]);
    if (p) setSrc(p);
  }
  async function convert() {
    setBusy(true); setError(''); setResult(null);
    try { setResult(await api.threemf.convert(src, target, { splitPlates: split })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const multi = info && info.plates.length > 1;
  const willSplit = multi && split && (target === 'prusa' || target === 'generic');

  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Convertitore 3MF</h3><span className="badge">beta</span>
      </div>
      <p className="muted">Trasforma un progetto 3MF da uno slicer all'altro mantenendo piatti, colori, estrusori e pittura multicolore. Il file originale non viene toccato: i nuovi file vengono salvati nella stessa cartella.</p>

      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <button className="btn" onClick={pick}>Scegli un file 3MF…</button>
        {info && <span className="muted">{info.name}.3mf</span>}
      </div>

      {error && <div className="tool-warn">{error}</div>}
      {src != null && !info && !error && <p className="muted">Lettura del file…</p>}

      {info && (
        <>
          <div className="row" style={{ gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
            <div><div className="muted">Origine</div><span className="badge">{FLAVOR[info.flavor] || info.flavor}</span></div>
            <div><div className="muted">Oggetti</div>{info.objects.length}</div>
            <div><div className="muted">Piatti</div>{info.plates.length}</div>
            <div><div className="muted">Pittura</div>{info.hasPaint ? 'sì' : 'no'}</div>
            <div>
              <div className="muted">Colori</div>
              {info.colors.length ? info.colors.map((c, i) => <span key={i} className="swatch" title={`Estrusore ${i + 1}: ${c}`} style={{ background: c }} />) : <span className="muted">—</span>}
            </div>
          </div>
          {multi && (
            <ul className="conv-plates">
              {info.plates.map(p => (
                <li key={p.index}>Piatto {p.index}{p.name ? ` – ${p.name}` : ''}: {p.objectIds.map(id => info.objects.find(o => o.id === id)?.name).filter(Boolean).join(', ') || 'vuoto'}</li>
              ))}
            </ul>
          )}

          <h4 style={{ margin: '16px 0 8px' }}>Converti in</h4>
          <div className="conv-targets">
            {TARGETS.map(t => (
              <label key={t.id} className={target === t.id ? 'on' : ''}>
                <input type="radio" name="target" checked={target === t.id} onChange={() => setTarget(t.id)} />
                <span><b>{t.label}</b><br /><span className="muted" style={{ fontSize: 12 }}>{t.hint}</span></span>
              </label>
            ))}
          </div>
          {multi && (target === 'prusa' || target === 'generic') && (
            <label className="row" style={{ gap: 8, marginTop: 10 }}>
              <input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} /> Un file separato per ogni piatto
            </label>
          )}
          <div className="tool-actions">
            <button className="btn primary" disabled={busy} onClick={convert}>{busy ? 'Conversione…' : willSplit ? `Converti (${info.plates.length} file)` : 'Converti'}</button>
          </div>
        </>
      )}

      {result && (
        <div style={{ marginTop: 14 }}>
          {result.outputs.map(o => <div key={o} className="tool-ok">✓ {o} <button className="btn sm" onClick={() => api.tools.revealPath(o)}>Mostra</button></div>)}
          {result.warnings.map(w => <div key={w} className="tool-warn">⚠ {w}</div>)}
        </div>
      )}
    </div>
  );
}
