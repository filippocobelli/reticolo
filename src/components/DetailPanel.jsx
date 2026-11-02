import React, { useEffect, useState, useCallback } from 'react';
import { api, thumbUrl } from '../api.js';
import { useUI, useEvent, fmtSize, fmtDate, fmtDims, fmtNum, fmtMin } from './ui.jsx';
import { Thumb, useThumbVersion } from './Grid.jsx';

const META_LABELS = {
  slicer: 'Slicer', printer: 'Stampante', generator: 'Generato da', printMinutes: 'Tempo di stampa', printTimeSec: 'Tempo di stampa', layers: 'Layer', objects: 'Oggetti', stlFormat: 'Formato STL', organization: 'Organizzazione', originatingSystem: 'Creato con', dwgVersion: 'Versione DWG', filamentG: 'Filamento (g)', filamentM: 'Filamento (m)', material: 'Materiale', filamentType: 'Materiale',
  layerHeight: 'Altezza layer', nozzle: 'Ugello', plateCount: 'Piatti', parts: 'Parti', products: 'Componenti', author: 'Autore', format: 'Codifica', triangles: 'Triangoli',
  vertices: 'Vertici', faces: 'Facce', entries: 'File indicizzati', totalEntries: 'Voci nell\'archivio', width: 'Larghezza px', height: 'Altezza px', duration: 'Durata (s)', archiveError: 'Errore archivio',
  skippedObjects: 'Oggetti non visualizzabili', flavor: 'Tipo 3MF', units: 'Unità', application: 'Applicazione', title: 'Titolo', designer: 'Designer',
};
function metaValue(k, v) {
  if (v == null || v === '') return null;
  if (k === 'printTimeSec') return fmtMin(v / 60);
  if (k === 'printMinutes') return fmtMin(v);
  if (typeof v === 'number') return fmtNum(Math.round(v * 100) / 100);
  if (Array.isArray(v)) return v.length && typeof v[0] !== 'object' ? v.slice(0, 12).join(', ') + (v.length > 12 ? '…' : '') : null;
  if (typeof v === 'object') return null;
  return String(v);
}

export function SlicerButton({ ids, slicers, small }) {
  const ui = useUI();
  const installed = slicers.filter(s => s.installed);
  const pref = installed.find(s => s.preferred) || installed[0];
  const open = (s) => api.slicers.open(s ? s.id : null, ids).then(() => ui.toast(`Apertura in ${s ? s.name : 'slicer'}…`)).catch(ui.error);
  if (!installed.length) return <button className={`btn ${small ? 'sm' : ''}`} disabled title="Nessuno slicer rilevato (vedi Impostazioni)">Apri nello slicer</button>;
  return (
    <div className="btn-group" style={{ width: '100%' }}>
      <button className={`btn primary grow ${small ? 'sm' : ''}`} onClick={() => open(pref)} title={pref.path}>Apri in {pref.name}</button>
      <button className={`btn primary ${small ? 'sm' : ''}`} style={{ padding: '0 8px' }} onClick={(e) => ui.openMenu(e, [{ header: 'Apri con' },
        ...installed.map(s => ({ label: `${s.name}${s.resin ? ' (resina)' : ''}`, onClick: () => open(s) })),
        '-', { label: 'Imposta preferito…', disabled: true }, ...installed.map(s => ({ label: `★ ${s.name}`, onClick: () => api.slicers.setPreferred(s.id).then(() => ui.toast(`${s.name} è ora lo slicer preferito`)) }))])}>▾</button>
    </div>
  );
}

export function TagEditor({ ids, tags, allTags, onChange }) {
  const ui = useUI();
  const [val, setVal] = useState('');
  const add = async (name) => { name = name.trim().replace(/^#/, ''); if (!name) return; await api.tags.add(ids, name).catch(ui.error); setVal(''); onChange && onChange(); };
  return (
    <div className="tagbox">
      {tags.map(t => <span key={t.id} className="tag" style={t.color ? { borderColor: t.color } : null}>{t.name}<button onClick={async () => { await api.tags.remove(ids, t.id); onChange && onChange(); }}>×</button></span>)}
      <input className="tag-input" list="all-tags" value={val} placeholder="+ tag" onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(val); } }} onBlur={() => val && add(val)} />
      <datalist id="all-tags">{allTags.map(t => <option key={t.id} value={t.name} />)}</datalist>
    </div>
  );
}

function CollectionPicker({ ids, current = [], collections, onChange }) {
  const ui = useUI();
  const add = async (id) => {
    if (id === 'new') { const n = await ui.prompt('Nuova raccolta'); if (!n) return; id = (await api.collections.create(n)).id; }
    await api.collections.addItems(Number(id), ids); onChange && onChange();
  };
  const avail = collections.filter(c => !current.some(x => x.id === c.id));
  return (
    <div className="tagbox">
      {current.map(c => <span key={c.id} className="tag">◆ {c.name}<button onClick={async () => { await api.collections.removeItems(c.id, ids); onChange && onChange(); }}>×</button></span>)}
      <select value="" onChange={e => e.target.value && add(e.target.value)} style={{ padding: '2px 6px', fontSize: 12 }}>
        <option value="">+ raccolta</option>
        {avail.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="new">Nuova raccolta…</option>
      </select>
    </div>
  );
}

export default function DetailPanel({ itemId, selection, onView, go, slicers, allTags, collections, aiConfigured }) {
  const ui = useUI();
  const [item, setItem] = useState(null);
  const [companions, setCompanions] = useState([]);
  const [note, setNote] = useState('');
  const multi = selection.size > 1;
  const ids = multi ? [...selection] : (itemId ? [itemId] : []);

  const load = useCallback(async () => {
    if (!itemId) { setItem(null); return; }
    const it = await api.items.get(itemId).catch(() => null);
    setItem(it); setNote(it ? it.note || '' : '');
    setCompanions(it ? await api.items.companions(itemId) : []);
  }, [itemId]);
  useEffect(() => { load(); }, [load]);
  useEvent(['items-changed', 'thumb-ready', 'tags-changed', 'collections-changed', 'queue-changed'], (p) => { if (!p || !p.ids || p.ids.includes(itemId) || p.id === itemId) load(); }, [itemId, load]);
  const v = useThumbVersion(itemId);

  if (multi) {
    return (
      <aside className="detail"><div className="titlebar-pad" /><div className="body">
        <div className="title">{selection.size} elementi selezionati</div>
        <section><h3>Azioni</h3>
          <div className="col">
            <SlicerButton ids={ids} slicers={slicers} />
            <div className="actions">
              <button className="btn" onClick={() => api.queue.add({ itemIds: ids }).then(() => ui.toast('Aggiunti alla coda', 'ok'))}>＋ Coda di stampa</button>
              <button className="btn" disabled={!aiConfigured} title={aiConfigured ? '' : 'Configura l\'IA nelle impostazioni'} onClick={() => api.ai.tag(ids).then(() => ui.toast('Analisi IA avviata'))}>✦ Tag con IA</button>
              <button className="btn" onClick={() => api.thumbs.regenerate(ids)}>↻ Miniature</button>
              <button className="btn" title="Tasto H" onClick={() => api.items.setHidden(ids, true).then(() => ui.toast(`${ids.length} elementi nascosti`, 'ok'))}>◌ Nascondi</button>
            </div>
          </div>
        </section>
        <section><h3>Aggiungi tag a tutti</h3><TagEditor ids={ids} tags={[]} allTags={allTags} onChange={() => ui.toast('Tag applicato', 'ok')} /></section>
        <section><h3>Aggiungi a raccolta</h3><CollectionPicker ids={ids} collections={collections} onChange={() => ui.toast('Aggiunti alla raccolta', 'ok')} /></section>
      </div></aside>
    );
  }
  if (!item) return <aside className="detail"><div className="titlebar-pad" /><div className="empty">Seleziona un elemento</div></aside>;

  const canView = item.format.view || ['image', 'video', 'doc'].includes(item.kind);
  const metaRows = Object.entries(item.meta || {}).map(([k, val]) => [META_LABELS[k], metaValue(k, val)]).filter(([l, val]) => l && val);
  const plates = Array.isArray(item.meta.plates) ? item.meta.plates : null;
  const setCover = async () => {
    const p = await api.tools.pickFile([{ name: 'Immagini', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]);
    if (p) api.items.setCover(item.id, p).catch(ui.error);
  };

  return (
    <aside className="detail">
      <div className="titlebar-pad" />
      <div className="preview" onClick={() => canView ? onView(item) : api.items.openDefault(item.id).catch(ui.error)} title={canView ? 'Apri il visualizzatore' : 'Apri con l\'app predefinita'}>
        {item.thumb === 1 || item.cover || v ? <img src={thumbUrl(item.id, v || item.cover || '')} alt="" /> : <Thumb item={item} />}
      </div>
      <div className="body">
        <div className="title">{item.name}</div>
        <div className="row" style={{ gap: 4, marginBottom: 6 }}>
          <span className="badge">{item.format.label}</span>
          {item.format.partial && <span className="badge warn">anteprima parziale</span>}
          {item.format.experimental && <span className="badge beta">sperimentale</span>}
          {item.format.searchOnly && <span className="badge">solo ricerca</span>}
          {item.missing ? <span className="badge warn">file non trovato</span> : null}
          {item.hidden ? <span className="badge">nascosto</span> : null}
          {item.queue.length > 0 && <span className="badge ok">in coda</span>}
        </div>
        <div className="mono muted" style={{ overflowWrap: 'anywhere' }}>{item.archive ? `${item.archive.name} › ${item.path.split('::')[1]}` : item.path}</div>

        <section className="col">
          <SlicerButton ids={[item.id]} slicers={slicers} />
          <div className="actions">
            {canView && <button className="btn" onClick={() => onView(item)}>◈ Visualizza</button>}
            <button className="btn" onClick={() => api.items.reveal(item.id)}>{navigator.platform.startsWith('Mac') ? 'Mostra nel Finder' : 'Mostra nella cartella'}</button>
            <button className="btn" onClick={() => api.items.openDefault(item.id).catch(ui.error)}>Apri con…</button>
            <button className="btn" onClick={() => api.queue.add({ itemId: item.id }).then(() => ui.toast('Aggiunto alla coda di stampa', 'ok'))}>＋ Coda</button>
            {item.ext === '3mf' && <button className="btn" onClick={() => go({ type: 'tool', tool: 'converter', itemId: item.id })}>⇄ Converti 3MF</button>}
            {item.kind === 'archive' && <button className="btn" onClick={() => go({ type: 'folder', sourceId: item.source_id, dir: [item.dir, item.name].filter(Boolean).join('/'), title: item.name })}>Sfoglia archivio</button>}
            <button className="btn" disabled={!aiConfigured} title={aiConfigured ? 'Genera tag e descrizione' : 'Configura l\'IA nelle impostazioni'} onClick={() => api.ai.tag([item.id]).then(() => ui.toast('Analisi IA avviata'))}>✦ Tag IA</button>
            <button className="btn" onClick={(e) => ui.openMenu(e, [
              { label: 'Rigenera miniatura', onClick: () => api.thumbs.regenerate([item.id]) },
              { label: 'Imposta copertina da immagine…', onClick: setCover },
              ...companions.filter(c => c.kind === 'image').slice(0, 8).map(c => ({ label: `Copertina: ${c.name}`, onClick: async () => { const b = await (await fetch(`rtc://file/${c.id}`)).blob(); const fr = new FileReader(); fr.onload = () => api.items.setCover(item.id, fr.result); fr.readAsDataURL(b); } })),
              item.cover ? { label: 'Rimuovi copertina', onClick: () => api.items.setCover(item.id, null) } : null,
              '-',
              item.hidden ? { label: 'Mostra di nuovo nella libreria', onClick: () => api.items.setHidden([item.id], false).then(load) }
                : { label: item.kind === 'archive' ? 'Nascondi archivio e contenuto' : 'Nascondi dalla libreria', onClick: () => api.items.setHidden([item.id], true).then(() => ui.toast('Nascosto. Lo ritrovi in "Nascosti".', 'ok')) },
            ])}>⋯ Altro</button>
          </div>
        </section>

        <section><h3>Tag</h3><TagEditor ids={[item.id]} tags={item.tags} allTags={allTags} onChange={load} /></section>
        {(item.ai_desc || item.ai_tags.length > 0) && <section><h3>Descrizione IA</h3>
          {item.ai_desc && <p style={{ margin: '0 0 8px', lineHeight: 1.5, color: 'var(--fg2)' }}>{item.ai_desc}</p>}
          <div className="tagbox">{item.ai_tags.filter(t => !item.tags.some(x => x.name.toLowerCase() === String(t).toLowerCase())).map(t =>
            <span key={t} className="tag ai" title="Clic per aggiungerlo come tag" onClick={() => api.tags.add([item.id], t).then(load)}>+ {t}</span>)}</div>
        </section>}
        <section><h3>Raccolte</h3><CollectionPicker ids={[item.id]} current={item.collections} collections={collections} onChange={load} /></section>
        <section><h3>Note</h3>
          <textarea style={{ width: '100%' }} value={note} placeholder="Impostazioni di stampa, supporti, materiali…" onChange={e => setNote(e.target.value)}
            onBlur={() => note !== (item.note || '') && api.items.setNote(item.id, note)} />
          <div className="small muted">Le note restano legate al file anche se lo rinomini o lo sposti.</div>
        </section>

        <section><h3>Informazioni</h3>
          <div className="kv">
            {item.dims && <><span>Dimensioni</span><span>{fmtDims(item.dims)}</span></>}
            {item.tri_count ? <><span>Triangoli</span><span>{fmtNum(item.tri_count)}</span></> : null}
            <span>Peso file</span><span>{fmtSize(item.size)}</span>
            <span>Modificato</span><span>{fmtDate(item.mtime)}</span>
            <span>Aggiunto</span><span>{fmtDate(item.added_at)}</span>
            {item.source && <><span>Sorgente</span><span>{item.source.name}</span></>}
            {item.kind === 'archive' && <><span>Contenuto</span><span>{item.entryCount} file</span></>}
            {metaRows.map(([l, val]) => <React.Fragment key={l}><span>{l}</span><span>{val}</span></React.Fragment>)}
          </div>
          {plates && plates.length > 0 && <div style={{ marginTop: 8 }} className="small">
            {plates.map((p, i) => <div key={i} className="muted">Piatto {p.index ?? i + 1}: {p.minutes != null ? fmtMin(p.minutes) : p.printTimeSec ? fmtMin(p.printTimeSec / 60) : '—'}{p.filamentG ? ` · ${Math.round(p.filamentG)} g` : ''}</div>)}
          </div>}
        </section>

        {companions.length > 0 && <section><h3>File di accompagnamento ({companions.length})</h3>
          <div className="companions">
            {companions.map(c => <div key={c.id} className="c" title={c.name} onClick={() => ['image', 'video', 'doc'].includes(c.kind) ? onView(c) : api.items.openDefault(c.id)}>
              {c.thumb === 1 ? <img src={thumbUrl(c.id)} alt="" /> : <span>{c.ext.toUpperCase()}<br />{c.name.slice(0, 18)}</span>}
            </div>)}
          </div>
        </section>}
      </div>
    </aside>
  );
}
