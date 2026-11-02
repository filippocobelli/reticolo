import React, { useState } from 'react';
import { api } from '../api.js';
import { useUI, Logo } from './ui.jsx';

const TAG_COLORS = ['#ff7a3d', '#f3c04c', '#3ccf8e', '#4fd1c5', '#5aa9ff', '#c38bff', '#ff5d9e', '#9aa3b2'];

function Item({ icon, label, count, active, onClick, onMenu, onDropIds, dot }) {
  const [over, setOver] = useState(false);
  const dropProps = onDropIds ? {
    onDragOver: (e) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e) => { e.preventDefault(); setOver(false); const ids = window.__dragIds; if (ids && ids.length) onDropIds(ids); },
  } : {};
  return (
    <div className={`nav-item ${active ? 'active' : ''} ${over ? 'drop' : ''}`} onClick={onClick} onContextMenu={onMenu} {...dropProps}>
      {dot ? <span className="dot" style={{ background: dot }} /> : <span className="ico">{icon}</span>}
      <span className="label">{label}</span>
      {count != null && <span className="count">{count}</span>}
    </div>
  );
}

export default function Sidebar({ view, go, facets, sources, tags, collections, status, queueCount }) {
  const ui = useUI();
  const [showAllFormats, setShowAllFormats] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const is = (type, key, val) => view.type === type && (key ? view[key] === val : true);
  const lib = (filter, title, key) => go({ type: 'library', filter, title, key });

  const newCollection = async () => {
    const name = await ui.prompt('Nuova raccolta', '', { placeholder: 'Nome della raccolta' });
    if (name) { const r = await api.collections.create(name); go({ type: 'library', filter: { collectionId: r.id }, title: name, key: 'col' + r.id }); }
  };
  const sourceMenu = (e, s) => ui.openMenu(e, [
    { label: 'Ripeti scansione', icon: '↻', onClick: () => api.scan.rescan(s.id) },
    { label: s.watch ? 'Disattiva sorveglianza' : 'Attiva sorveglianza', icon: '👁', onClick: () => api.sources.setWatch(s.id, !s.watch) },
    { label: 'Tutti i modelli di questa sorgente', icon: '▦', onClick: () => lib({ sourceId: s.id }, s.name, 'src' + s.id) },
    '-',
    { label: 'Rimuovi dalla libreria', icon: '✕', onClick: async () => {
      if (await ui.confirm('Rimuovere la sorgente?', `"${s.path}" verrà tolta dalla libreria. I file su disco non vengono toccati. Tag e note degli elementi andranno persi (salvali prima con un backup).`, { ok: 'Rimuovi', danger: true })) api.sources.remove(s.id);
    } },
  ]);
  const collMenu = (e, c) => ui.openMenu(e, [
    { label: 'Rinomina', icon: '✎', onClick: async () => { const n = await ui.prompt('Rinomina raccolta', c.name); if (n) api.collections.rename(c.id, n); } },
    { label: 'Elimina raccolta', icon: '✕', onClick: async () => { if (await ui.confirm('Eliminare la raccolta?', 'I modelli restano nella libreria.', { ok: 'Elimina', danger: true })) { api.collections.delete(c.id); if (is('library', 'key', 'col' + c.id)) lib({}, 'Tutti i modelli', 'all'); } } },
  ]);
  const tagMenu = (e, t) => ui.openMenu(e, [
    { label: 'Rinomina', icon: '✎', onClick: async () => { const n = await ui.prompt('Rinomina tag', t.name); if (n) api.tags.rename(t.id, n); } },
    { header: 'Colore' },
    ...TAG_COLORS.map(c => ({ label: <span style={{ display: 'inline-block', width: 40, height: 10, borderRadius: 3, background: c }} />, onClick: () => api.tags.setColor(t.id, c) })),
    '-',
    { label: 'Elimina tag', icon: '✕', onClick: async () => { if (await ui.confirm(`Eliminare il tag "${t.name}"?`, 'Verrà rimosso da tutti i modelli.', { ok: 'Elimina', danger: true })) api.tags.delete(t.id); } },
  ]);

  const formats = facets.formats || [];
  const shownFormats = showAllFormats ? formats : formats.slice(0, 7);
  const shownTags = showAllTags ? tags : tags.slice(0, 12);

  return (
    <aside className="sidebar">
      <div className="titlebar-pad" />
      <div className="brand"><Logo /> Reticolo</div>
      <nav>
        <div className="nav-sec">
          <Item icon="▦" label="Tutti i modelli" count={facets.total} active={is('library', 'key', 'all')} onClick={() => lib({}, 'Tutti i modelli', 'all')} />
          <Item icon="🕘" label="Aggiunti di recente" active={is('library', 'key', 'recent')} onClick={() => lib({ sort: 'added', order: 'desc' }, 'Aggiunti di recente', 'recent')} />
          <Item icon="◌" label="Senza raccolta" count={facets.uncollected} active={is('library', 'key', 'uncol')} onClick={() => lib({ uncollected: true }, 'Senza raccolta', 'uncol')} />
          <Item icon="#" label="Senza tag" active={is('library', 'key', 'untag')} onClick={() => lib({ untagged: true }, 'Senza tag', 'untag')} />
          {facets.hidden > 0 && <Item icon="◍" label="Nascosti" count={facets.hidden} active={is('library', 'key', 'hidden')} onClick={() => lib({ hidden: true }, 'Elementi nascosti', 'hidden')} />}
          {facets.missing > 0 && <Item icon="⚠" label="Non più trovati" count={facets.missing} active={is('library', 'key', 'missing')} onClick={() => lib({ missing: true }, 'Non più trovati', 'missing')} />}
        </div>

        <div className="nav-sec">
          <div className="nav-title">Sorgenti <button title="Aggiungi cartella" onClick={() => api.sources.add().catch(ui.error)}>+</button></div>
          {sources.length === 0 && <div className="nav-item muted" onClick={() => api.sources.add().catch(ui.error)}><span className="ico">＋</span>Aggiungi una cartella…</div>}
          {sources.map(s => <Item key={s.id} icon={s.watch ? '🗂' : '📁'} label={s.name} count={s.count} active={is('folder', 'sourceId', s.id)}
            onClick={() => go({ type: 'folder', sourceId: s.id, dir: '', title: s.name })} onMenu={(e) => sourceMenu(e, s)} />)}
        </div>

        <div className="nav-sec">
          <div className="nav-title">Raccolte <button title="Nuova raccolta" onClick={newCollection}>+</button></div>
          {collections.map(c => <Item key={c.id} icon="◆" label={c.name} count={c.count} active={is('library', 'key', 'col' + c.id)}
            onClick={() => lib({ collectionId: c.id }, c.name, 'col' + c.id)} onMenu={(e) => collMenu(e, c)}
            onDropIds={(ids) => api.collections.addItems(c.id, ids).then(() => ui.toast(`${ids.length} aggiunti a "${c.name}"`, 'ok'))} />)}
          {!collections.length && <div className="nav-item muted small" onClick={newCollection}>Crea una raccolta e trascinaci dentro i modelli</div>}
        </div>

        {formats.length > 0 && <div className="nav-sec">
          <div className="nav-title">Formati {formats.length > 7 && <button onClick={() => setShowAllFormats(!showAllFormats)}>{showAllFormats ? '−' : '…'}</button>}</div>
          {shownFormats.map(f => <Item key={f.ext} icon="·" label={f.label} count={f.count} active={is('library', 'key', 'fmt' + f.ext)} onClick={() => lib({ exts: [f.ext] }, `Formato ${f.label}`, 'fmt' + f.ext)} />)}
        </div>}

        {tags.length > 0 && <div className="nav-sec">
          <div className="nav-title">Tag {tags.length > 12 && <button onClick={() => setShowAllTags(!showAllTags)}>{showAllTags ? '−' : '…'}</button>}</div>
          {shownTags.map(t => <Item key={t.id} dot={t.color || '#737b8a'} label={t.name} count={t.count} active={is('library', 'key', 'tag' + t.id)}
            onClick={() => lib({ tagIds: [t.id] }, `#${t.name}`, 'tag' + t.id)} onMenu={(e) => tagMenu(e, t)}
            onDropIds={(ids) => api.tags.add(ids, t.name).then(() => ui.toast(`Tag "${t.name}" applicato a ${ids.length}`, 'ok'))} />)}
        </div>}

        <div className="nav-sec">
          <div className="nav-title">Strumenti</div>
          <Item icon="⧉" label="Duplicati" active={is('duplicates')} onClick={() => go({ type: 'duplicates' })} />
          <Item icon="☰" label="Coda di stampa" count={queueCount || null} active={is('queue')} onClick={() => go({ type: 'queue' })}
            onDropIds={(ids) => api.queue.add({ itemIds: ids }).then(() => ui.toast(`${ids.length} aggiunti alla coda`, 'ok'))} />
          <Item icon="⇄" label="Convertitore 3MF" active={is('tool', 'tool', 'converter')} onClick={() => go({ type: 'tool', tool: 'converter' })} />
          <Item icon="▭" label="Targhette" active={is('tool', 'tool', 'nameplate')} onClick={() => go({ type: 'tool', tool: 'nameplate' })} />
          <Item icon="⚱" label="Vasi" active={is('tool', 'tool', 'vase')} onClick={() => go({ type: 'tool', tool: 'vase' })} />
          <Item icon="⚙" label="Impostazioni" active={is('settings')} onClick={() => go({ type: 'settings' })} />
        </div>
      </nav>
      <div className="status">{status}</div>
    </aside>
  );
}
