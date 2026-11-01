import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { UIProvider, useUI, useEvent } from './components/ui.jsx';
import Sidebar from './components/Sidebar.jsx';
import { ItemGrid } from './components/Grid.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import Viewer from './components/Viewer.jsx';
import DuplicatesView from './components/DuplicatesView.jsx';
import QueueView from './components/QueueView.jsx';
import SettingsView from './components/SettingsView.jsx';
import Converter3MF from './components/tools/Converter3MF.jsx';
import NameplateGenerator from './components/tools/NameplateGenerator.jsx';
import VaseGenerator from './components/tools/VaseGenerator.jsx';

const PAGE = 300;
const SORTS = [['name', 'Nome'], ['added', 'Data aggiunta'], ['mtime', 'Data modifica'], ['size', 'Dimensione file'], ['ext', 'Formato']];

function useDebounced(v, ms) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

function Shell() {
  const ui = useUI();
  const [view, setView] = useState({ type: 'library', filter: {}, title: 'Tutti i modelli', key: 'all' });
  const [history, setHistory] = useState([]);
  const [facets, setFacets] = useState({});
  const [sources, setSources] = useState([]);
  const [tags, setTags] = useState([]);
  const [collections, setCollections] = useState([]);
  const [slicers, setSlicers] = useState([]);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 160);
  const [semantic, setSemantic] = useState(false);
  const [sort, setSort] = useState(() => { try { return JSON.parse(localStorage.getItem('sort')) || { sort: 'name', order: 'asc' }; } catch { return { sort: 'name', order: 'asc' }; } });
  const [cardSize, setCardSize] = useState(() => Number(localStorage.getItem('cardSize')) || 180);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [folders, setFolders] = useState(null);
  const [selection, setSel] = useState(new Set());
  const [detailId, setDetailId] = useState(null);
  const [viewerItem, setViewerItem] = useState(null);
  const [status, setStatus] = useState({});
  const [fileDrop, setFileDrop] = useState(false);
  const searchRef = useRef(null);
  const reqRef = useRef(0);

  const go = useCallback((v) => { setHistory(h => [...h.slice(-30), view]); setView(v); setSel(new Set()); setDetailId(null); setQ(''); }, [view]);
  const back = () => { const h = history.slice(); const v = h.pop(); if (v) { setHistory(h); setView(v); setSel(new Set()); } };

  // ---------- dati laterali ----------
  const loadSide = useCallback(() => {
    api.items.facets().then(setFacets);
    api.sources.list().then(setSources);
    api.tags.list().then(setTags);
    api.collections.list().then(setCollections);
    api.queue.list().then(r => setQueueCount(r.filter(x => x.status !== 'done').length));
  }, []);
  const loadSlicers = () => api.slicers.detect().then(setSlicers).catch(() => setSlicers([]));
  const loadAi = () => api.ai.getConfig().then(c => setAiConfigured(!!c && (['ollama', 'codex'].includes(c.provider) || (c.keys && c.keys[c.provider] && c.keys[c.provider].set)))).catch(() => {});
  useEffect(() => { loadSide(); loadSlicers(); loadAi(); }, []);
  useEffect(() => { if (view.type !== 'settings') { loadAi(); loadSlicers(); } }, [view.type]);

  // ---------- elementi ----------
  const filters = useMemo(() => {
    if (view.type === 'library') return { ...view.filter, sort: view.filter.sort || sort.sort, order: view.filter.order || sort.order };
    if (view.type === 'folder' && dq) return { sourceId: view.sourceId, dir: view.dir, sort: sort.sort, order: sort.order };
    return null;
  }, [view, sort, dq]);

  const loadItems = useCallback(async (append = false) => {
    const req = ++reqRef.current;
    try {
      if (view.type === 'folder' && !dq) {
        const r = await api.items.folder({ sourceId: view.sourceId, dir: view.dir });
        if (req !== reqRef.current) return;
        setFolders(r.folders); setItems(r.items); setTotal(r.items.length);
        return;
      }
      if (!filters) return;
      setFolders(null);
      let f = { ...filters, q: dq, limit: PAGE, offset: append ? items.length : 0 };
      if (semantic && dq) {
        const hits = await api.ai.semantic(dq, 300);
        f = { ...filters, ids: hits.map(h => h.id), keepOrder: true, limit: PAGE, offset: append ? items.length : 0 };
      }
      const r = await api.items.query(f);
      if (req !== reqRef.current) return;
      setTotal(r.total);
      setItems(prev => append ? [...prev, ...r.items] : r.items);
    } catch (e) { ui.error(e); }
  }, [view, filters, dq, semantic, items.length]);
  useEffect(() => { loadItems(false); }, [view, filters, dq, semantic]); // eslint-disable-line
  const endReached = useCallback(() => { if (!folders && items.length < total) loadItems(true); }, [folders, items.length, total, loadItems]);

  const reloadTimer = useRef(null);
  useEvent(['items-changed', 'sources-changed', 'tags-changed', 'collections-changed', 'queue-changed'], (_p, ch) => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => { loadSide(); if (ch === 'items-changed' || ch === 'sources-changed' || ch === 'collections-changed' || ch === 'tags-changed') loadItems(false); }, 350);
  }, [loadItems, loadSide]);
  useEvent(['scan-progress'], (p) => setStatus(s => ({ ...s, scan: p })));
  useEvent(['thumbs-progress'], (p) => setStatus(s => ({ ...s, thumbs: p })));
  useEvent(['ai-progress'], (p) => setStatus(s => ({ ...s, ai: p })));
  useEvent(['focus-search'], () => { searchRef.current && searchRef.current.focus(); searchRef.current && searchRef.current.select(); });
  useEvent(['backup-done'], () => ui.toast('Backup automatico completato', 'ok'));

  const setSelection = (s, item) => { setSel(s); if (item) setDetailId(item.id); else if (!s.size) setDetailId(null); };
  const selectItem = (it) => { setSel(new Set([it.id])); setDetailId(it.id); };
  const openItem = async (it) => {
    const full = await api.items.get(it.id);
    if (!full) return;
    if (full.format.view || ['image', 'video', 'doc'].includes(full.kind)) setViewerItem(full);
    else api.items.openDefault(full.id).catch(ui.error);
  };
  const openFolder = (f) => { if (view.type === 'folder') go({ ...view, dir: f.dir }); };

  // ---------- menu contestuale ----------
  const cardMenu = (e, item) => {
    const ids = selection.has(item.id) ? [...selection] : [item.id];
    if (!selection.has(item.id)) selectItem(item);
    const installed = slicers.filter(s => s.installed);
    const inCol = view.type === 'library' && view.filter.collectionId;
    ui.openMenu(e, [
      { label: 'Visualizza', icon: '◈', onClick: () => openItem(item), disabled: ids.length > 1 },
      ...(installed.length ? [{ header: 'Apri nello slicer' }, ...installed.slice(0, 8).map(s => ({ label: s.name + (s.preferred ? ' ★' : ''), onClick: () => api.slicers.open(s.id, ids).catch(ui.error) }))] : []),
      '-',
      { label: 'Mostra nella cartella', icon: '📂', onClick: () => api.items.reveal(item.id) },
      { label: 'Aggiungi alla coda di stampa', icon: '☰', onClick: () => api.queue.add({ itemIds: ids }).then(() => ui.toast('Aggiunti alla coda', 'ok')) },
      { label: 'Genera tag con IA', icon: '✦', disabled: !aiConfigured, onClick: () => api.ai.tag(ids).then(() => ui.toast('Analisi IA avviata')) },
      { label: 'Rigenera miniatura', icon: '↻', onClick: () => api.thumbs.regenerate(ids) },
      collections.length ? { header: 'Aggiungi a raccolta' } : null,
      ...collections.slice(0, 10).map(c => ({ label: c.name, icon: '◆', onClick: () => api.collections.addItems(c.id, ids).then(() => ui.toast(`Aggiunti a "${c.name}"`, 'ok')) })),
      { label: 'Nuova raccolta con la selezione…', icon: '＋', onClick: async () => { const n = await ui.prompt('Nuova raccolta'); if (n) { const r = await api.collections.create(n); await api.collections.addItems(r.id, ids); } } },
      inCol ? '-' : null,
      inCol ? { label: 'Togli da questa raccolta', icon: '✕', onClick: () => api.collections.removeItems(view.filter.collectionId, ids) } : null,
    ]);
  };

  // ---------- tastiera ----------
  useEffect(() => {
    const k = (e) => {
      if (viewerItem) return;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current && searchRef.current.focus(); }
      if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(new Set(items.map(i => i.id))); }
      if (e.key === 'Escape') setSelection(new Set(), null);
      if ((e.key === ' ' || e.key === 'Enter') && detailId) { e.preventDefault(); openItem({ id: detailId }); }
      if (e.key === 'Backspace' && (e.metaKey || e.altKey)) back();
      if (['ArrowRight', 'ArrowLeft'].includes(e.key) && detailId) {
        const i = items.findIndex(x => x.id === detailId); const n = items[i + (e.key === 'ArrowRight' ? 1 : -1)];
        if (n) selectItem(n);
      }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [items, detailId, viewerItem, history]);

  // ---------- trascina cartelle dal sistema per aggiungerle ----------
  const onDragOver = (e) => { if (!window.__dragIds && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setFileDrop(true); } };
  const onDrop = (e) => {
    setFileDrop(false);
    if (window.__dragIds) return;
    e.preventDefault();
    const paths = [...e.dataTransfer.files].map(f => window.rtc.pathForFile(f)).filter(Boolean);
    if (paths.length) api.sources.add(paths).then(() => ui.toast('Cartella aggiunta: scansione in corso…', 'ok')).catch(ui.error);
  };

  // ---------- testo stato ----------
  const s = status;
  const statusText = s.scan && s.scan.phase === 'scan' ? <>Scansione {s.scan.name}: {s.scan.found} file…<div className="progress"><div style={{ width: '60%' }} /></div></>
    : s.scan && s.scan.phase === 'offline' ? <span className="err">Sorgente non raggiungibile: {s.scan.name}</span>
    : s.ai && s.ai.total && s.ai.done < s.ai.total ? <>IA: {s.ai.done}/{s.ai.total}<div className="progress"><div style={{ width: `${s.ai.done / s.ai.total * 100}%` }} /></div></>
    : s.thumbs && s.thumbs.running && s.thumbs.pending > 0 ? <>Miniature: {s.thumbs.pending} in coda</>
    : <>{facets.total || 0} modelli indicizzati</>;

  // ---------- contenuto ----------
  const showDetail = (view.type === 'library' || view.type === 'folder' || view.type === 'duplicates' || view.type === 'queue') && (detailId || selection.size > 1);
  const crumbs = view.type === 'folder' ? (() => {
    const src = sources.find(x => x.id === view.sourceId);
    const parts = view.dir ? view.dir.split('/') : [];
    return [{ name: src ? src.name : 'Sorgente', dir: '' }, ...parts.map((p, i) => ({ name: p, dir: parts.slice(0, i + 1).join('/') }))];
  })() : null;

  let content;
  if (view.type === 'library' || view.type === 'folder') {
    const empty = !items.length && !(folders && folders.length);
    content = (
      <>
        <div className="toolbar">
          {history.length > 0 && <button className="btn icon" title="Indietro" onClick={back}>←</button>}
          <div className="search">
            <span className="muted">⌕</span>
            <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder={semantic ? 'Descrivi cosa cerchi (ricerca semantica)…' : view.type === 'folder' ? 'Cerca in questa cartella…' : 'Cerca per nome, percorso, tag, descrizione…'} />
            {q && <button className="btn sm ghost" onClick={() => setQ('')}>✕</button>}
            <span className="kbd">⌘F</span>
          </div>
          <button className={`btn ${semantic ? 'active' : ''}`} title="Ricerca semantica (richiede embeddings IA)" onClick={() => setSemantic(!semantic)}>✦ Semantica</button>
          <select value={`${sort.sort}:${sort.order}`} onChange={e => { const [a, b] = e.target.value.split(':'); const ns = { sort: a, order: b }; setSort(ns); localStorage.setItem('sort', JSON.stringify(ns)); }}>
            {SORTS.flatMap(([k, l]) => [<option key={k + 'a'} value={`${k}:asc`}>{l} ↑</option>, <option key={k + 'd'} value={`${k}:desc`}>{l} ↓</option>])}
          </select>
          <input type="range" min={120} max={320} value={cardSize} onChange={e => { setCardSize(+e.target.value); localStorage.setItem('cardSize', e.target.value); }} title="Dimensione miniature" style={{ width: 90 }} />
        </div>
        {selection.size > 1 && <div className="selection-bar"><b>{selection.size} selezionati</b><div className="spacer" />
          <button className="btn sm" onClick={() => setSel(new Set(items.map(i => i.id)))}>Seleziona tutti ({items.length})</button>
          <button className="btn sm" onClick={() => setSelection(new Set(), null)}>Deseleziona</button></div>}
        <div className="content" style={{ '--card': `${cardSize}px` }}>
          {crumbs ? <div className="breadcrumb">{crumbs.map((c, i) => <React.Fragment key={c.dir}>{i > 0 && <span className="muted" style={{ cursor: 'default' }}>›</span>}
            <span className={i === crumbs.length - 1 ? 'cur' : ''} onClick={() => i < crumbs.length - 1 && go({ ...view, dir: c.dir })}>{c.name}</span></React.Fragment>)}</div>
            : <div className="headline"><h1>{view.title}</h1><span className="muted">{total.toLocaleString('it-IT')} elementi</span></div>}
          {empty ? (
            sources.length === 0 ? <div className="empty"><h2>Benvenuto in Reticolo</h2><p>Aggiungi le cartelle, i dischi o il NAS dove tieni i tuoi modelli 3D.<br />Reticolo li indicizza in locale: nessun caricamento online, nessun file spostato.</p>
              <button className="btn primary" onClick={() => api.sources.add().catch(ui.error)}>＋ Aggiungi una cartella</button><p className="small">Oppure trascina qui una cartella.</p></div>
              : <div className="empty">{dq ? `Nessun risultato per "${dq}"` : 'Nessun elemento qui.'}</div>
          ) : <ItemGrid items={items} folders={folders} selection={selection} setSelection={setSelection} onOpen={openItem} onMenu={cardMenu} onEndReached={endReached} onOpenFolder={openFolder} />}
          {!folders && items.length < total && <div className="loadmore">Caricamento…</div>}
        </div>
      </>
    );
  } else if (view.type === 'duplicates') content = <><div className="titlebar-pad" /><DuplicatesView onSelectItem={selectItem} /></>;
  else if (view.type === 'queue') content = <><div className="titlebar-pad" /><QueueView onSelectItem={selectItem} /></>;
  else if (view.type === 'settings') content = <><div className="titlebar-pad" /><SettingsView /></>;
  else if (view.type === 'tool') {
    const Tool = { converter: Converter3MF, nameplate: NameplateGenerator, vase: VaseGenerator }[view.tool];
    content = <><div className="titlebar-pad" /><div className="content"><Tool key={view.tool + (view.itemId || '')} itemId={view.itemId} /></div></>;
  }

  return (
    <div className={`app ${showDetail ? 'with-detail' : ''}`} onDragOver={onDragOver} onDragLeave={(e) => { if (!e.relatedTarget) setFileDrop(false); }} onDrop={onDrop}>
      <Sidebar view={view} go={go} facets={facets} sources={sources} tags={tags} collections={collections} status={statusText} queueCount={queueCount} />
      <main className="main">{(view.type === 'library' || view.type === 'folder') && <div className="titlebar-pad" />}{content}</main>
      {showDetail && <DetailPanel itemId={detailId} selection={selection} onView={openItem} go={go} slicers={slicers} allTags={tags} collections={collections} aiConfigured={aiConfigured} />}
      {viewerItem && <Viewer item={viewerItem} slicers={slicers} onClose={() => setViewerItem(null)} />}
      {fileDrop && <div className="dropzone">Rilascia per aggiungere la cartella alla libreria</div>}
    </div>
  );
}

export default function App() {
  return <UIProvider><Shell /></UIProvider>;
}
