import { useEffect, useState } from 'react';
import { api } from '../api.js';
import './settings.css';

export default function SlicerSettings() {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const load = async (force) => {
    setBusy(true); setErr(null);
    try { setList(await api.slicers.detect(force)); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  useEffect(() => { load(false); }, []);

  if (!list) return <div className="panel muted">{err || 'Ricerca degli slicer…'}</div>;

  const installed = list.filter(s => s.installed);
  const missing = list.filter(s => !s.installed && !s.custom);
  const pref = async (id) => { await api.slicers.setPreferred(id); load(false); };
  const addCustom = async () => { try { const r = await api.slicers.addCustom(); if (r) load(true); } catch (e) { setErr(e.message); } };
  const removeCustom = async (id) => { await window.rtc.invoke('slicers:removeCustom', id); load(true); };

  const row = (s) => (
    <div key={s.id} className="list-item st-slicer">
      <span className={`st-dot ${s.installed ? 'on' : ''}`} />
      <div className="st-name">
        <div>{s.name} {s.resin && <span className="badge">Resina</span>} {s.custom && <span className="badge">Personalizzato</span>}</div>
        {s.path && <div className="st-path" title={s.path}>{s.path}</div>}
      </div>
      {s.installed && (s.preferred
        ? <span className="badge">Preferito</span>
        : <button className="btn" onClick={() => pref(s.id)}>Imposta preferito</button>)}
      {s.custom && <button className="btn" onClick={() => removeCustom(s.id)}>Rimuovi</button>}
    </div>
  );

  return (
    <div className="panel st-section">
      <h3>Slicer</h3>
      <div className="st-inline" style={{ marginBottom: 10 }}>
        <span className="muted">{installed.length} rilevati su {list.length}</span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => load(true)} disabled={busy}>{busy ? 'Ricerca…' : 'Rileva di nuovo'}</button>
        <button className="btn primary" onClick={addCustom}>Aggiungi slicer…</button>
      </div>
      {err && <div className="st-msg err">{err}</div>}
      <div className="list">
        {installed.length ? installed.map(row) : <div className="muted list-item">Nessuno slicer trovato. Puoi aggiungerne uno a mano.</div>}
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => setShowAll(v => !v)}>{showAll ? 'Nascondi' : 'Mostra'} slicer non installati ({missing.length})</button>
      </div>
      {showAll && <div className="list" style={{ marginTop: 8, opacity: .75 }}>{missing.map(row)}</div>}
      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Puoi anche trascinare un modello dalla libreria direttamente nella finestra di qualsiasi slicer.
      </div>
    </div>
  );
}
