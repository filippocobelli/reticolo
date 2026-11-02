import React, { useEffect, useState, memo, useRef } from 'react';
import { thumbUrl, startDrag, onEvent } from '../api.js';
import { fmtSize, fmtDims, FORMAT_COLORS } from './ui.jsx';

// versioni miniature: aggiornate quando il worker finisce
const versions = new Map();
const subs = new Map();
onEvent((ch, p) => {
  if ((ch === 'thumb-ready' || (ch === 'items-changed' && p && p.thumb)) && p) {
    for (const id of p.ids || [p.id]) { versions.set(id, Date.now()); (subs.get(id) || []).forEach(f => f()); }
  }
});
export function useThumbVersion(id) {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set(x => x + 1);
    const l = subs.get(id) || []; l.push(f); subs.set(id, l);
    return () => subs.set(id, (subs.get(id) || []).filter(x => x !== f));
  }, [id]);
  return versions.get(id) || '';
}

export function Thumb({ item, big }) {
  const v = useThumbVersion(item.id);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [v, item.thumb]);
  const ok = (item.thumb === 1 || v || item.cover) && !failed;
  if (ok) return <img src={thumbUrl(item.id, v || item.cover || '')} loading="lazy" draggable={false} onError={() => setFailed(true)} alt="" />;
  return <div className="ph" style={{ color: FORMAT_COLORS[item.ext] || undefined, borderColor: FORMAT_COLORS[item.ext] || undefined }}>{item.thumb === 0 ? '…' : (item.ext || '').toUpperCase()}</div>;
}

export const Card = memo(function Card({ item, selected, onSelect, onOpen, onMenu, dragIds }) {
  const sub = item.dims ? fmtDims(item.dims) : fmtSize(item.size);
  return (
    <div className={`card ${selected ? 'sel' : ''}`}
      onClick={(e) => onSelect(e, item)} onDoubleClick={() => onOpen(item)} onContextMenu={(e) => onMenu(e, item)}
      draggable onDragStart={(e) => {
        // trascinamento nativo: funziona verso slicer/Finder/Esplora e verso raccolte/tag nella barra laterale
        const ids = dragIds(item);
        e.preventDefault();
        window.__dragIds = ids;
        setTimeout(() => { window.__dragIds = window.__dragIds === ids ? null : window.__dragIds; }, 60000);
        startDrag(ids);
      }}
      title={item.name}>
      <div className="thumb">
        <Thumb item={item} />
        <span className="fmt badge" style={{ color: FORMAT_COLORS[item.ext] }}>{item.ext}</span>
        <span className="flags">{item.archive_id ? <span className="badge" title="Dentro un archivio">📦</span> : null}</span>
      </div>
      <div className="info"><div className="name">{item.name}</div><div className="sub">{sub}</div></div>
    </div>
  );
});

export function FolderCard({ folder, onOpen, isArchive, onMenu }) {
  return (
    <div className="card folder" onDoubleClick={onOpen} onClick={onOpen} onContextMenu={onMenu ? (e) => onMenu(e, folder) : undefined} title={folder.name}>
      <div className="thumb"><div className="ph folder">{isArchive ? '🗜️' : '📁'}</div></div>
      <div className="info"><div className="name">{folder.name}</div><div className="sub">{folder.count} elementi</div></div>
    </div>
  );
}

// Griglia con selezione multipla (clic, Cmd/Ctrl, Maiusc) e caricamento progressivo
export function ItemGrid({ items, selection, setSelection, onOpen, onMenu, onEndReached, folders, onOpenFolder, onFolderMenu }) {
  const lastRef = useRef(null);
  const sentinel = useRef(null);
  useEffect(() => {
    if (!onEndReached || !sentinel.current) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) onEndReached(); }, { rootMargin: '600px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [onEndReached, items.length]);

  const onSelect = (e, item) => {
    const s = new Set(e.metaKey || e.ctrlKey || e.shiftKey ? selection : []);
    if (e.shiftKey && lastRef.current != null) {
      const a = items.findIndex(x => x.id === lastRef.current), b = items.findIndex(x => x.id === item.id);
      if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) s.add(items[i].id);
    } else if ((e.metaKey || e.ctrlKey) && s.has(item.id)) s.delete(item.id);
    else s.add(item.id);
    lastRef.current = item.id;
    setSelection(s, item);
  };
  const dragIds = (item) => selection.has(item.id) ? [...selection] : [item.id];
  return (
    <>
      <div className="grid" onClick={(e) => { if (e.target === e.currentTarget) setSelection(new Set(), null); }}>
        {(folders || []).map(f => <FolderCard key={'f' + f.dir} folder={f} onOpen={() => onOpenFolder(f)} onMenu={onFolderMenu} />)}
        {items.map(it => it.browseDir
          ? <ArchiveCard key={it.id} item={it} selected={selection.has(it.id)} onSelect={onSelect} onOpenFolder={onOpenFolder} onMenu={onMenu} dragIds={dragIds} />
          : <Card key={it.id} item={it} selected={selection.has(it.id)} onSelect={onSelect} onOpen={onOpen} onMenu={onMenu} dragIds={dragIds} />)}
      </div>
      <div ref={sentinel} style={{ height: 1 }} />
    </>
  );
}

function ArchiveCard({ item, selected, onSelect, onOpenFolder, onMenu, dragIds }) {
  return <Card item={item} selected={selected} onSelect={onSelect} onMenu={onMenu} dragIds={dragIds}
    onOpen={() => onOpenFolder({ dir: item.browseDir, name: item.name, archiveId: item.id })} />;
}
