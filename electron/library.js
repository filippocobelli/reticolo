// Sorgenti, interrogazione libreria, tag, raccolte, note, cartelle
const { dialog, shell, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { FORMATS, COMPANION_KINDS } = require('./formats');

const CARD_COLS = 'i.id, i.name, i.ext, i.kind, i.size, i.mtime, i.thumb, i.dir, i.source_id, i.archive_id, i.tri_count, i.dims, i.missing, i.hidden, i.added_at, i.cover';
const LIBRARY_KINDS = ['model', 'mesh', 'gcode', 'laser', 'cad', 'archive'];

function card(r) { return { ...r, dims: r.dims ? JSON.parse(r.dims) : null }; }

function buildWhere(f = {}) {
  const w = []; const p = [];
  if (!f.missing) w.push('i.missing=0'); else w.push('i.missing=1');
  w.push(f.hidden ? 'i.hidden=1' : 'i.hidden=0');
  const kinds = f.kinds && f.kinds.length ? f.kinds : (f.exts && f.exts.length ? null : LIBRARY_KINDS);
  if (kinds) { w.push(`i.kind IN (${kinds.map(() => '?').join(',')})`); p.push(...kinds); }
  if (f.exts && f.exts.length) { w.push(`i.ext IN (${f.exts.map(() => '?').join(',')})`); p.push(...f.exts); }
  if (f.sourceId) { w.push('i.source_id=?'); p.push(f.sourceId); }
  if (f.dir != null && f.dir !== '') { w.push('(i.dir=? OR i.dir LIKE ?)'); p.push(f.dir, f.dir + '/%'); }
  if (f.archiveId) { w.push('i.archive_id=?'); p.push(f.archiveId); }
  if (f.insideArchives === false) w.push('i.archive_id IS NULL');
  for (const t of f.tagIds || []) { w.push('EXISTS (SELECT 1 FROM item_tags x WHERE x.item_id=i.id AND x.tag_id=?)'); p.push(t); }
  if (f.collectionId) { w.push('EXISTS (SELECT 1 FROM collection_items c WHERE c.item_id=i.id AND c.collection_id=?)'); p.push(f.collectionId); }
  if (f.uncollected) w.push('NOT EXISTS (SELECT 1 FROM collection_items c WHERE c.item_id=i.id)');
  if (f.untagged) w.push('NOT EXISTS (SELECT 1 FROM item_tags x WHERE x.item_id=i.id)');
  if (f.q) {
    for (const tok of String(f.q).toLowerCase().split(/\s+/).filter(Boolean)) {
      if (tok.startsWith('-') && tok.length > 1) { w.push('i.search NOT LIKE ?'); p.push(`%${tok.slice(1)}%`); }
      else { w.push('i.search LIKE ?'); p.push(`%${tok}%`); }
    }
  }
  if (f.ids) { w.push(`i.id IN (${f.ids.map(() => '?').join(',') || 'NULL'})`); p.push(...f.ids); }
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', params: p };
}

const SORTS = { name: 'i.name COLLATE NOCASE', added: 'i.added_at', size: 'i.size', mtime: 'i.mtime', ext: 'i.ext' };

function register(ctx) {
  const { db, handle } = ctx;

  // ---------- sorgenti ----------
  handle('sources:list', () => db.all(`SELECT s.*, (SELECT COUNT(*) FROM items i WHERE i.source_id=s.id AND i.missing=0 AND i.hidden=0 AND i.kind IN ('model','mesh','gcode','laser','cad','archive')) AS count FROM sources s ORDER BY s.name COLLATE NOCASE`));
  handle('sources:add', async (p) => {
    if (!p) {
      const r = await dialog.showOpenDialog(ctx.getMainWindow(), { title: 'Aggiungi una cartella alla libreria', properties: ['openDirectory', 'multiSelections'] });
      if (r.canceled || !r.filePaths.length) return null;
      p = r.filePaths;
    }
    const list = Array.isArray(p) ? p : [p];
    const added = [];
    for (const dir of list) {
      const abs = path.resolve(dir);
      if (!fs.existsSync(abs)) throw new Error(`Cartella non trovata: ${abs}`);
      const ex = db.get('SELECT * FROM sources WHERE path=?', abs);
      if (ex) { added.push(ex); continue; }
      const r = db.run('INSERT INTO sources(path,name,added_at) VALUES(?,?,?)', abs, path.basename(abs) || abs, Date.now());
      added.push(db.get('SELECT * FROM sources WHERE id=?', Number(r.lastInsertRowid)));
    }
    const scanner = require('./scanner');
    for (const s of added) scanner.scanSource(ctx, s.id);
    ctx.emit('sources-changed');
    return added[0];
  });
  handle('sources:remove', (id) => { require('./scanner').unwatch(ctx, id); db.run('DELETE FROM sources WHERE id=?', id); ctx.emit('sources-changed'); ctx.emit('items-changed', {}); return true; });
  handle('sources:setWatch', (id, on) => { db.run('UPDATE sources SET watch=? WHERE id=?', on ? 1 : 0, id); require('./scanner').refreshWatchers(ctx); return true; });

  // ---------- elementi ----------
  handle('items:query', (f = {}) => {
    const { where, params } = buildWhere(f);
    const total = db.get(`SELECT COUNT(*) n FROM items i ${where}`, ...params).n;
    let order = `${SORTS[f.sort] || SORTS.name} ${f.order === 'desc' ? 'DESC' : 'ASC'}`;
    let rows;
    if (f.ids && f.keepOrder) {
      rows = db.all(`SELECT ${CARD_COLS} FROM items i ${where}`, ...params);
      const pos = new Map(f.ids.map((id, k) => [id, k]));
      rows.sort((a, b) => pos.get(a.id) - pos.get(b.id));
      rows = rows.slice(f.offset || 0, (f.offset || 0) + (f.limit || 500));
    } else {
      rows = db.all(`SELECT ${CARD_COLS} FROM items i ${where} ORDER BY ${order}, i.id LIMIT ? OFFSET ?`, ...params, f.limit || 500, f.offset || 0);
    }
    return { items: rows.map(card), total };
  });
  handle('items:get', (id) => {
    const it = db.getItem(id);
    if (!it) return null;
    const src = db.get('SELECT path, name FROM sources WHERE id=?', it.source_id);
    it.source = src;
    if (it.archive_id) it.archive = db.get('SELECT id, name, path FROM items WHERE id=?', it.archive_id);
    if (it.kind === 'archive') it.entryCount = db.get('SELECT COUNT(*) n FROM items WHERE archive_id=?', it.id).n;
    it.queue = db.all('SELECT id, status FROM queue WHERE item_id=?', id);
    const fmt = FORMATS[it.ext] || {};
    it.format = { label: fmt.label || it.ext.toUpperCase(), view: !!fmt.view, partial: !!fmt.partial, experimental: !!fmt.experimental, searchOnly: !!fmt.searchOnly };
    return it;
  });
  handle('items:facets', () => {
    const formats = db.all(`SELECT ext, COUNT(*) count FROM items WHERE missing=0 AND hidden=0 AND kind IN ('model','mesh','gcode','laser','cad','archive') GROUP BY ext ORDER BY count DESC`)
      .map(r => ({ ...r, label: (FORMATS[r.ext] || {}).label || r.ext }));
    const kinds = db.all('SELECT kind, COUNT(*) count FROM items WHERE missing=0 AND hidden=0 GROUP BY kind');
    const total = db.get(`SELECT COUNT(*) n FROM items WHERE missing=0 AND hidden=0 AND kind IN ('model','mesh','gcode','laser','cad','archive')`).n;
    const uncollected = db.get(`SELECT COUNT(*) n FROM items i WHERE missing=0 AND hidden=0 AND kind IN ('model','mesh','gcode','laser','cad','archive') AND NOT EXISTS (SELECT 1 FROM collection_items c WHERE c.item_id=i.id)`).n;
    const missing = db.get('SELECT COUNT(*) n FROM items WHERE missing=1').n;
    const hidden = db.get(`SELECT COUNT(*) n FROM items WHERE missing=0 AND hidden=1 AND kind IN ('model','mesh','gcode','laser','cad','archive')`).n;
    return { formats, kinds, total, uncollected, missing, hidden };
  });
  handle('items:folder', ({ sourceId, dir = '' }) => {
    const prefix = dir ? dir + '/' : '';
    const dirs = db.all(`SELECT dir, COUNT(*) n FROM items WHERE source_id=? AND missing=0 AND hidden=0 AND (dir LIKE ? OR ?='') GROUP BY dir`, sourceId, prefix + '%', dir);
    const sub = new Map();
    for (const d of dirs) {
      if (d.dir === dir) continue;
      if (dir && !d.dir.startsWith(prefix)) continue;
      const rest = d.dir.slice(prefix.length);
      const seg = rest.split('/')[0];
      if (!seg) continue;
      sub.set(seg, (sub.get(seg) || 0) + d.n);
    }
    const files = db.all(`SELECT ${CARD_COLS} FROM items i WHERE i.source_id=? AND i.dir=? AND i.missing=0 AND i.hidden=0 ORDER BY i.kind='archive' DESC, i.name COLLATE NOCASE`, sourceId, dir).map(card);
    const archiveNames = new Set(files.filter(f => f.kind === 'archive').map(f => f.name));
    const folders = [...sub.entries()].filter(([n]) => !archiveNames.has(n)).map(([name, count]) => ({ name, dir: prefix + name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }));
    // gli archivi sono navigabili come cartelle
    for (const f of files) if (f.kind === 'archive') f.browseDir = prefix + f.name;
    return { folders, items: files };
  });
  handle('items:companions', (id) => {
    const it = db.get('SELECT * FROM items WHERE id=?', id);
    if (!it) return [];
    const kinds = [...COMPANION_KINDS];
    return db.all(`SELECT ${CARD_COLS} FROM items i WHERE i.source_id=? AND i.dir=? AND i.id<>? AND i.missing=0 AND i.hidden=0 AND i.kind IN (${kinds.map(() => '?').join(',')}) ORDER BY i.name LIMIT 60`, it.source_id, it.dir, id, ...kinds).map(card);
  });
  handle('items:setNote', (id, text) => { db.run('UPDATE items SET note=? WHERE id=?', text || null, id); db.refreshSearch(id); ctx.emit('items-changed', { ids: [id] }); return true; });
  handle('items:setCover', (id, dataUrl) => {
    const target = path.join(ctx.paths.covers, `${id}.png`);
    if (!dataUrl) { db.run('UPDATE items SET cover=NULL WHERE id=?', id); try { fs.unlinkSync(target); } catch {} }
    else if (!String(dataUrl).startsWith('data:')) fs.copyFileSync(String(dataUrl), target) || db.run('UPDATE items SET cover=? WHERE id=?', target, id);
    else {
      const b64 = String(dataUrl).split(',')[1];
      fs.writeFileSync(target, Buffer.from(b64, 'base64'));
      db.run('UPDATE items SET cover=? WHERE id=?', target, id);
    }
    ctx.emit('items-changed', { ids: [id], thumb: true });
    return true;
  });
  handle('items:reveal', (id) => {
    const it = db.get('SELECT * FROM items WHERE id=?', id);
    const p = it.archive_id ? db.get('SELECT path FROM items WHERE id=?', it.archive_id).path : it.path;
    shell.showItemInFolder(p); return true;
  });
  handle('items:openDefault', async (id) => { const p = await ctx.materialize(id); const err = await shell.openPath(p); if (err) throw new Error(err); return true; });
  // nascondi / mostra: un archivio nascosto nasconde anche tutto il suo contenuto
  handle('items:setHidden', (ids, hidden) => {
    const v = hidden ? 1 : 0;
    db.tx(() => { for (const id of [].concat(ids)) { db.run('UPDATE items SET hidden=? WHERE id=? OR archive_id=?', v, id, id); } });
    ctx.emit('items-changed', { ids: [].concat(ids) }); ctx.emit('sources-changed'); ctx.emit('tags-changed'); ctx.emit('collections-changed');
    return true;
  });
  handle('items:setHiddenDir', ({ sourceId, dir }, hidden) => {
    const r = db.run('UPDATE items SET hidden=? WHERE source_id=? AND (dir=? OR dir LIKE ?)', hidden ? 1 : 0, sourceId, dir, dir + '/%');
    ctx.emit('items-changed', {}); ctx.emit('sources-changed'); ctx.emit('tags-changed'); ctx.emit('collections-changed');
    return Number(r.changes);
  });
  handle('items:purgeMissing', () => { const r = db.run('DELETE FROM items WHERE missing=1'); ctx.emit('items-changed', {}); return Number(r.changes); });

  // ---------- tag ----------
  const tagId = (name) => {
    name = String(name).trim(); if (!name) throw new Error('Nome tag vuoto');
    const ex = db.get('SELECT id FROM tags WHERE name=?', name);
    if (ex) return ex.id;
    return Number(db.run('INSERT INTO tags(name) VALUES(?)', name).lastInsertRowid);
  };
  ctx.tagId = tagId;
  handle('tags:list', () => db.all('SELECT t.*, (SELECT COUNT(*) FROM item_tags x JOIN items i ON i.id=x.item_id WHERE x.tag_id=t.id AND i.missing=0 AND i.hidden=0) count FROM tags t ORDER BY t.name COLLATE NOCASE'));
  handle('tags:add', (ids, name) => {
    const tid = tagId(name);
    db.tx(() => { for (const id of ids) { db.run('INSERT OR IGNORE INTO item_tags(item_id,tag_id) VALUES(?,?)', id, tid); db.refreshSearch(id); } });
    ctx.emit('items-changed', { ids }); ctx.emit('tags-changed'); return tid;
  });
  handle('tags:remove', (ids, tid) => {
    db.tx(() => { for (const id of ids) { db.run('DELETE FROM item_tags WHERE item_id=? AND tag_id=?', id, tid); db.refreshSearch(id); } });
    ctx.emit('items-changed', { ids }); ctx.emit('tags-changed'); return true;
  });
  const refreshTagItems = (tid) => { for (const r of db.all('SELECT item_id FROM item_tags WHERE tag_id=?', tid)) db.refreshSearch(r.item_id); };
  handle('tags:rename', (tid, name) => { db.run('UPDATE tags SET name=? WHERE id=?', name.trim(), tid); refreshTagItems(tid); ctx.emit('tags-changed'); return true; });
  handle('tags:delete', (tid) => { const ids = db.all('SELECT item_id FROM item_tags WHERE tag_id=?', tid).map(r => r.item_id); db.run('DELETE FROM tags WHERE id=?', tid); ids.forEach(id => db.refreshSearch(id)); ctx.emit('tags-changed'); ctx.emit('items-changed', { ids }); return true; });
  handle('tags:setColor', (tid, color) => { db.run('UPDATE tags SET color=? WHERE id=?', color, tid); ctx.emit('tags-changed'); return true; });

  // ---------- raccolte ----------
  handle('collections:list', () => db.all('SELECT c.*, (SELECT COUNT(*) FROM collection_items x JOIN items i ON i.id=x.item_id WHERE x.collection_id=c.id AND i.missing=0 AND i.hidden=0) count FROM collections c ORDER BY c.name COLLATE NOCASE'));
  handle('collections:create', (name) => { const r = db.run('INSERT INTO collections(name,created_at) VALUES(?,?)', String(name).trim() || 'Nuova raccolta', Date.now()); ctx.emit('collections-changed'); return { id: Number(r.lastInsertRowid) }; });
  handle('collections:rename', (id, name) => { db.run('UPDATE collections SET name=? WHERE id=?', name, id); ctx.emit('collections-changed'); return true; });
  handle('collections:delete', (id) => { db.run('DELETE FROM collections WHERE id=?', id); ctx.emit('collections-changed'); ctx.emit('items-changed', {}); return true; });
  handle('collections:addItems', (id, ids) => { db.tx(() => ids.forEach(i => db.run('INSERT OR IGNORE INTO collection_items(collection_id,item_id) VALUES(?,?)', id, i))); ctx.emit('collections-changed'); ctx.emit('items-changed', { ids }); return true; });
  handle('collections:removeItems', (id, ids) => { db.tx(() => ids.forEach(i => db.run('DELETE FROM collection_items WHERE collection_id=? AND item_id=?', id, i))); ctx.emit('collections-changed'); ctx.emit('items-changed', { ids }); return true; });

  // ---------- trascinamento verso altre app ----------
  ipcMain.on('drag:start', async (e, ids) => {
    try {
      const files = [];
      for (const id of [].concat(ids)) files.push(await ctx.materialize(Number(id)));
      let icon = nativeImage.createFromPath(ctx.thumbPath([].concat(ids)[0]));
      if (icon.isEmpty()) icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC');
      else icon = icon.resize({ width: 64 });
      e.sender.startDrag({ files, file: files[0], icon });
    } catch (err) { console.error('drag', err); }
  });
}

module.exports = { register, buildWhere, LIBRARY_KINDS };
