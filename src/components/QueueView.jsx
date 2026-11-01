import React, { useEffect, useState } from 'react';
import { api, thumbUrl } from '../api.js';
import { useUI, useEvent, fmtMin } from './ui.jsx';

const STATUS = { todo: 'Da stampare', printing: 'In stampa', done: 'Fatto' };

function Cell({ value, onSave, type = 'text', width }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  return <input type={type} value={v} style={width ? { width } : null} onChange={e => setV(e.target.value)}
    onBlur={() => String(v) !== String(value ?? '') && onSave(type === 'number' && v !== '' ? Number(v) : v)} onKeyDown={e => e.key === 'Enter' && e.target.blur()} />;
}

export default function QueueView({ onSelectItem }) {
  const ui = useUI();
  const [rows, setRows] = useState([]);
  const [showDone, setShowDone] = useState(true);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const load = () => api.queue.list().then(setRows).catch(ui.error);
  useEffect(() => { load(); }, []);
  useEvent(['queue-changed'], load);
  const upd = (id, patch) => api.queue.update(id, patch).catch(ui.error);
  const active = rows.filter(r => r.status !== 'done');
  const tot = active.reduce((a, r) => ({ m: a.m + (r.minutes || 0) * (r.copies || 1), g: a.g + (r.filament_g || 0) * (r.copies || 1) }), { m: 0, g: 0 });
  const list = showDone ? rows : active;
  const drop = (targetId) => {
    if (!dragId || dragId === targetId) return;
    const ids = rows.map(r => r.id).filter(id => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    api.queue.reorder(ids); setDragId(null); setOver(null);
  };
  const exp = async (f) => { const r = await api.queue.export(f, { includeDone: showDone }); if (r && r.path) ui.toast('Checklist esportata', 'ok'); };
  return (
    <div className="content" onDragOver={(e) => { if (window.__dragIds && !dragId) e.preventDefault(); }}
      onDrop={(e) => { if (window.__dragIds && !dragId) { e.preventDefault(); api.queue.add({ itemIds: window.__dragIds }); window.__dragIds = null; } }}>
      <div className="headline"><h1>Coda di stampa</h1><div className="spacer" />
        <button className="btn sm" onClick={() => api.queue.add({})}>＋ Voce manuale</button>
        <button className="btn sm" onClick={() => exp('md')}>Esporta checklist (MD)</button>
        <button className="btn sm" onClick={() => exp('csv')}>Esporta CSV</button>
      </div>
      <div className="stats">
        <div className="stat"><div className="v">{active.length}</div><div className="l">stampe da fare</div></div>
        <div className="stat"><div className="v">{fmtMin(tot.m)}</div><div className="l">tempo totale stimato</div></div>
        <div className="stat"><div className="v">{Math.round(tot.g)} g</div><div className="l">filamento totale</div></div>
      </div>
      <p className="small muted">Trascina i modelli qui o sulla voce "Coda di stampa" nella barra laterale. Tempi e filamento vengono letti da G-code e 3MF slicati, quando disponibili. Reticolo non comunica con le stampanti.</p>
      <label className="check"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Mostra stampe completate</label>
      {list.length === 0 ? <div className="empty">La coda è vuota.</div> :
        <table className="qtable"><thead><tr><th></th><th></th><th>Titolo</th><th>Stato</th><th>Copie</th><th>Tempo (min)</th><th>Filamento (g)</th><th>Materiale</th><th>Colore</th><th>Note</th><th></th></tr></thead>
          <tbody>{list.map(r => (
            <tr key={r.id} className={`${r.status === 'done' ? 'done' : ''} ${over === r.id ? 'dragover' : ''}`} draggable
              onDragStart={() => setDragId(r.id)} onDragOver={(e) => { e.preventDefault(); setOver(r.id); }} onDrop={() => drop(r.id)} onDragEnd={() => { setDragId(null); setOver(null); }}>
              <td style={{ cursor: 'grab', color: 'var(--fg3)' }}>⋮⋮</td>
              <td className="thumbcell">{r.item_id && r.thumb === 1 ? <img src={thumbUrl(r.item_id)} alt="" onClick={() => onSelectItem({ id: r.item_id })} /> : null}</td>
              <td style={{ minWidth: 160 }}><Cell value={r.title} onSave={v => upd(r.id, { title: v })} />{r.item_name && <div className="small muted" style={{ marginTop: 2 }}>{r.item_name}{r.missing ? ' (file mancante)' : ''}</div>}</td>
              <td><select value={r.status} onChange={e => upd(r.id, { status: e.target.value })}>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td style={{ width: 70 }}><Cell type="number" value={r.copies} onSave={v => upd(r.id, { copies: v || 1 })} /></td>
              <td style={{ width: 100 }}><Cell type="number" value={r.minutes != null ? Math.round(r.minutes) : ''} onSave={v => upd(r.id, { minutes: v })} /><div className="small muted">{fmtMin(r.minutes)}</div></td>
              <td style={{ width: 100 }}><Cell type="number" value={r.filament_g != null ? Math.round(r.filament_g * 10) / 10 : ''} onSave={v => upd(r.id, { filament_g: v })} /></td>
              <td style={{ width: 100 }}><Cell value={r.material} onSave={v => upd(r.id, { material: v })} /></td>
              <td style={{ width: 90 }}><Cell value={r.color} onSave={v => upd(r.id, { color: v })} /></td>
              <td><Cell value={r.notes} onSave={v => upd(r.id, { notes: v })} /></td>
              <td><button className="btn sm ghost danger" onClick={() => api.queue.remove(r.id)}>✕</button></td>
            </tr>))}</tbody></table>}
    </div>
  );
}
