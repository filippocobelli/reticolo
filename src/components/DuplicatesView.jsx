import React, { useEffect, useState } from 'react';
import { api, thumbUrl } from '../api.js';
import { useUI, useEvent, fmtSize, fmtDims } from './ui.jsx';

function DupItem({ it, onPick }) {
  return (
    <div className="dupitem" onClick={() => onPick(it)} onContextMenu={(e) => e.preventDefault()}>
      {it.thumb === 1 ? <img src={thumbUrl(it.id)} alt="" /> : <div style={{ aspectRatio: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="muted">{it.ext.toUpperCase()}</div>}
      <div className="t"><div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
        <div className="p">{fmtSize(it.size)}{it.dims ? ` · ${fmtDims(it.dims)}` : ''}</div>
        <div className="p">{it.path.split('::')[0].split(/[\\/]/).slice(-3, -1).join('/')}</div></div>
    </div>
  );
}

export default function DuplicatesView({ onSelectItem }) {
  const ui = useUI();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('exact');
  const load = () => api.dups.list().then(setData).catch(ui.error);
  useEffect(() => { load(); }, []);
  useEvent(['thumbs-idle'], load);
  if (!data) return <div className="content"><div className="empty">Analisi in corso…</div></div>;
  const review = async (p, status) => { await api.dups.review(p.a.id, p.b.id, status); load(); };
  const tabs = [
    ['exact', 'Copie esatte', data.exact.length],
    ['geometry', 'Stessa geometria', data.geometry.length],
    ['probable', 'Da rivedere', data.probable.length],
    ['confirmed', 'Confermati', data.confirmed.length],
  ];
  const groups = tab === 'exact' ? data.exact : tab === 'geometry' ? data.geometry : null;
  const pairs = tab === 'probable' ? data.probable : tab === 'confirmed' ? data.confirmed : null;
  return (
    <div className="content">
      <div className="headline"><h1>Duplicati</h1><span className="muted">{data.wasted ? `${fmtSize(data.wasted)} occupati da copie esatte` : 'Nessuno spazio sprecato da copie esatte'}</span>
        <div className="spacer" /><button className="btn sm" onClick={load}>↻ Aggiorna</button></div>
      <p className="muted small" style={{ marginTop: -6 }}>Reticolo non cancella né sposta nulla: usa "Mostra nella cartella" per decidere tu cosa tenere.</p>
      <div className="tabs">{tabs.map(([k, l, n]) => <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}<span className="count">{n}</span></div>)}</div>
      {groups && (groups.length ? groups.map((g, i) => (
        <div key={i} className="dupgroup">
          <div className="row" style={{ marginBottom: 8 }}><b>{g[0].name}</b><span className="muted small">{g.length} file</span>
            <div className="spacer" /><button className="btn sm" onClick={() => g.forEach(x => api.items.reveal(x.id))}>Mostra tutti</button></div>
          <div className="items">{g.map(it => <DupItem key={it.id} it={it} onPick={onSelectItem} />)}</div>
        </div>)) : <div className="empty">Nessun gruppo trovato.</div>)}
      {pairs && (pairs.length ? pairs.map((p, i) => (
        <div key={i} className="dupgroup">
          <div className="row" style={{ marginBottom: 8 }}><span className="badge">{p.reason}</span><div className="spacer" />
            {tab === 'probable' ? <>
              <button className="btn sm" onClick={() => review(p, 'same')}>Sono duplicati</button>
              <button className="btn sm" onClick={() => review(p, 'different')}>Sono diversi</button>
            </> : <button className="btn sm" onClick={() => review(p, 'different')}>Annulla conferma</button>}
          </div>
          <div className="items">{[p.a, p.b].map(it => <DupItem key={it.id} it={it} onPick={onSelectItem} />)}</div>
        </div>)) : <div className="empty">{tab === 'probable' ? 'Nessun probabile duplicato da rivedere.' : 'Nessuna coppia confermata.'}</div>)}
    </div>
  );
}
