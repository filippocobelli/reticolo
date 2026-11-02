// Indicizzazione delle sorgenti: scansione, impronte, rinomini, archivi, sorveglianza cartelle.
// I file dell'utente non vengono mai modificati, spostati o rinominati.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { extOf, info } = require('./formats');

const SKIP_DIRS = new Set(['@eaDir', '#recycle', '$RECYCLE.BIN', 'System Volume Information', 'node_modules', '.Trash', '.Trashes', '.git', '#snapshot', '.AppleDouble']);
const state = { running: false, queue: [], progress: null, watchers: new Map() };

const toPosix = (p) => p.split(path.sep).join('/');
const relDir = (root, file) => { const r = toPosix(path.relative(root, path.dirname(file))); return r === '.' ? '' : r; };

async function quickHash(file, size) {
  const h = crypto.createHash('sha1');
  h.update(String(size));
  const fh = await fsp.open(file, 'r');
  try {
    const CH = 1 << 20;
    const a = Buffer.alloc(Math.min(CH, size));
    await fh.read(a, 0, a.length, 0); h.update(a);
    if (size > CH * 2) { const b = Buffer.alloc(CH); await fh.read(b, 0, CH, size - CH); h.update(b); }
    else if (size > CH) { const b = Buffer.alloc(size - CH); await fh.read(b, 0, b.length, CH); h.update(b); }
  } finally { await fh.close(); }
  return h.digest('hex');
}

function pathExists(p) {
  const i = p.indexOf('::');
  return fs.existsSync(i >= 0 ? p.slice(0, i) : p);
}

function emitProgress(ctx, patch) {
  state.progress = { ...(state.progress || {}), ...patch };
  ctx.emit('scan-progress', state.progress);
}

async function* walk(root) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name.startsWith('._')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(full); }
      else if (e.isFile() || e.isSymbolicLink()) yield full;
    }
  }
}

// Inserisce/aggiorna un file. Restituisce {id, changed}
async function processFile(ctx, src, file, seen) {
  const { db } = ctx;
  const ext = extOf(path.basename(file));
  const fmt = info(ext);
  if (!fmt) return null;
  let st;
  try { st = await fsp.stat(file); } catch { return null; }
  if (!st.isFile()) return null;
  const mtime = Math.floor(st.mtimeMs);
  const existing = db.get('SELECT id, size, mtime, missing, kind FROM items WHERE path=?', file);
  if (existing && existing.size === st.size && existing.mtime === mtime) {
    if (existing.missing) db.run('UPDATE items SET missing=0 WHERE id=?', existing.id);
    seen && seen.add(existing.id);
    if (fmt.kind === 'archive' && seen) for (const r of db.all('SELECT id FROM items WHERE archive_id=?', existing.id)) { seen.add(r.id); }
    if (fmt.kind === 'archive' && existing.missing) db.run('UPDATE items SET missing=0 WHERE archive_id=?', existing.id);
    return { id: existing.id, changed: false };
  }
  let qh;
  try { qh = await quickHash(file, st.size); } catch { return null; }
  const name = path.basename(file);
  const dir = relDir(src.path, file);
  let id;
  if (existing) {
    db.run('UPDATE items SET size=?, mtime=?, qhash=?, thumb=0, geo_hash=NULL, tri_count=NULL, dims=NULL, meta=NULL, missing=0, embedding=NULL WHERE id=?', st.size, mtime, qh, existing.id);
    id = existing.id;
  } else {
    // file rinominato o spostato? stessa impronta, vecchio percorso sparito -> conserva note/tag/raccolte
    const cands = db.all('SELECT id, path FROM items WHERE qhash=? AND archive_id IS NULL', qh);
    const moved = cands.find(c => c.path !== file && !pathExists(c.path));
    if (moved) {
      db.run('UPDATE items SET path=?, dir=?, name=?, source_id=?, ext=?, kind=?, mtime=?, missing=0 WHERE id=?', file, dir, name, src.id, ext, fmt.kind, mtime, moved.id);
      id = moved.id;
      if (fmt.kind === 'archive') await relocateArchiveEntries(ctx, src, id, file, dir, name);
      db.refreshSearch(id);
      seen && seen.add(id);
      if (seen && fmt.kind === 'archive') for (const r of db.all('SELECT id FROM items WHERE archive_id=?', id)) seen.add(r.id);
      return { id, changed: true, moved: true };
    }
    const r = db.run('INSERT INTO items(source_id,path,dir,name,ext,kind,size,mtime,qhash,thumb,added_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)',
      src.id, file, dir, name, ext, fmt.kind, st.size, mtime, qh, Date.now());
    id = Number(r.lastInsertRowid);
  }
  db.refreshSearch(id);
  seen && seen.add(id);
  if (fmt.kind === 'archive') await indexArchive(ctx, src, id, file, ext, dir, name, qh, mtime, seen);
  return { id, changed: true };
}

async function relocateArchiveEntries(ctx, src, archId, file, dir, name) {
  const { db } = ctx;
  for (const e of db.all('SELECT id, path FROM items WHERE archive_id=?', archId)) {
    const inner = e.path.slice(e.path.indexOf('::') + 2);
    const innerDir = path.posix.dirname(inner);
    const d = [dir, name, innerDir === '.' ? '' : innerDir].filter(Boolean).join('/');
    db.run('UPDATE items SET path=?, dir=?, source_id=?, missing=0 WHERE id=?', `${file}::${inner}`, d, src.id, e.id);
    db.refreshSearch(e.id);
  }
}

async function indexArchive(ctx, src, archId, file, ext, dir, name, qh, mtime, seen) {
  const { db } = ctx;
  let entries = [];
  try { entries = await require('./archives').listEntries(file, ext); }
  catch (e) {
    db.run('UPDATE items SET meta=? WHERE id=?', JSON.stringify({ archiveError: String(e.message || e) }), archId);
    return;
  }
  const keep = new Set();
  const archHidden = (db.get('SELECT hidden FROM items WHERE id=?', archId) || {}).hidden ? 1 : 0;
  db.tx(() => {
    for (const en of entries) {
      const inner = en.name.replace(/\\/g, '/');
      const base = path.posix.basename(inner);
      if (!base || base.startsWith('._') || inner.includes('__MACOSX/')) continue;
      const eext = extOf(base);
      const f = info(eext);
      if (!f || f.kind === 'archive') continue;
      const p = `${file}::${inner}`;
      const innerDir = path.posix.dirname(inner);
      const d = [dir, name, innerDir === '.' ? '' : innerDir].filter(Boolean).join('/');
      const eh = crypto.createHash('sha1').update(`${qh}|${inner}|${en.size}`).digest('hex');
      const ex = db.get('SELECT id, qhash FROM items WHERE path=?', p);
      let id;
      if (ex) {
        id = ex.id;
        if (ex.qhash !== eh) db.run('UPDATE items SET qhash=?, size=?, mtime=?, thumb=0, geo_hash=NULL, missing=0 WHERE id=?', eh, en.size, mtime, id);
        else db.run('UPDATE items SET missing=0, archive_id=? WHERE id=?', archId, id);
      } else {
        id = Number(db.run('INSERT INTO items(source_id,path,dir,name,ext,kind,size,mtime,qhash,thumb,archive_id,added_at,hidden) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?)',
          src.id, p, d, base, eext, f.kind, en.size || 0, mtime, eh, archId, Date.now(), archHidden).lastInsertRowid);
      }
      db.refreshSearch(id);
      keep.add(id); seen && seen.add(id);
    }
    for (const r of db.all('SELECT id FROM items WHERE archive_id=?', archId)) if (!keep.has(r.id)) db.run('UPDATE items SET missing=1 WHERE id=?', r.id);
  });
  db.run('UPDATE items SET meta=? WHERE id=?', JSON.stringify({ entries: keep.size, totalEntries: entries.length }), archId);
}

async function runScan(ctx, sourceId) {
  const { db } = ctx;
  const src = db.get('SELECT * FROM sources WHERE id=?', sourceId);
  if (!src) return;
  if (!fs.existsSync(src.path)) { emitProgress(ctx, { sourceId, phase: 'offline', name: src.name }); return; }
  const seen = new Set();
  let found = 0, changed = 0, last = 0;
  emitProgress(ctx, { sourceId, name: src.name, phase: 'scan', found: 0, changed: 0 });
  for await (const file of walk(src.path)) {
    if (!info(extOf(path.basename(file)))) continue;
    const r = await processFile(ctx, src, file, seen);
    if (!r) continue;
    found++; if (r.changed) changed++;
    if (Date.now() - last > 300) { last = Date.now(); emitProgress(ctx, { found, changed, current: path.basename(file) }); }
  }
  // segna come mancanti gli elementi non trovati (metadati conservati per eventuali ritorni)
  const all = db.all('SELECT id FROM items WHERE source_id=? AND missing=0', sourceId);
  db.tx(() => { for (const r of all) if (!seen.has(r.id)) db.run('UPDATE items SET missing=1 WHERE id=?', r.id); });
  db.run('UPDATE sources SET last_scan=? WHERE id=?', Date.now(), sourceId);
  emitProgress(ctx, { phase: 'done', found, changed });
  ctx.emit('items-changed', {});
  ctx.emit('sources-changed');
  require('./thumbs').kick(ctx);
}

function scanSource(ctx, sourceId) {
  if (!state.queue.includes(sourceId)) state.queue.push(sourceId);
  pump(ctx);
}
async function pump(ctx) {
  if (state.running) return;
  state.running = true;
  try {
    while (state.queue.length) {
      const id = state.queue.shift();
      try { await runScan(ctx, id); } catch (e) { console.error('scan', e); }
    }
  } finally { state.running = false; state.progress = { phase: 'idle' }; ctx.emit('scan-progress', state.progress); }
  refreshWatchers(ctx);
}
function waitIdle() { return new Promise(res => { const t = setInterval(() => { if (!state.running && !state.queue.length) { clearInterval(t); res(); } }, 100); }); }

// ---------- sorveglianza cartelle ----------
async function refreshWatchers(ctx) {
  const { db } = ctx;
  if (!db.getSetting('watchFolders', true)) { for (const id of [...state.watchers.keys()]) unwatch(ctx, id); return; }
  let chokidar;
  try { chokidar = require('chokidar'); } catch (e) { console.warn('chokidar non disponibile', e.message); return; }
  const sources = db.all('SELECT * FROM sources');
  const ids = new Set(sources.filter(s => s.watch).map(s => s.id));
  for (const id of [...state.watchers.keys()]) if (!ids.has(id)) unwatch(ctx, id);
  for (const s of sources) {
    if (!s.watch || state.watchers.has(s.id) || !fs.existsSync(s.path)) continue;
    const pending = new Map();
    let timer = null;
    const flush = async () => {
      timer = null;
      const batch = [...pending.entries()]; pending.clear();
      const src = db.get('SELECT * FROM sources WHERE id=?', s.id); if (!src) return;
      let n = 0;
      for (const [file, ev] of batch) {
        if (ev === 'unlink') {
          const it = db.get('SELECT id FROM items WHERE path=?', file);
          if (it) { db.run('UPDATE items SET missing=1 WHERE id=? OR archive_id=?', it.id, it.id); n++; }
        } else if (ev === 'unlinkDir') {
          const r = db.run("UPDATE items SET missing=1 WHERE source_id=? AND (path LIKE ? OR path LIKE ?)", s.id, file + path.sep + '%', file + '::%');
          n += Number(r.changes);
        } else { const r = await processFile(ctx, src, file, null); if (r) n++; }
      }
      if (n) { ctx.emit('items-changed', {}); ctx.emit('sources-changed'); require('./thumbs').kick(ctx); }
    };
    const ignored = (p) => { const b = path.basename(p); return (b.startsWith('.') && p !== s.path) || SKIP_DIRS.has(b); };
    const w = chokidar.watch(s.path, { ignoreInitial: true, ignored, awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 }, usePolling: !!db.getSetting('watchPolling', false), interval: 5000 });
    const on = (ev) => (p) => {
      if (ev !== 'unlinkDir' && !info(extOf(path.basename(p)))) return;
      pending.set(p, ev);
      clearTimeout(timer); timer = setTimeout(flush, 1200);
    };
    w.on('add', on('add')).on('change', on('change')).on('unlink', on('unlink')).on('unlinkDir', on('unlinkDir')).on('error', e => console.warn('watch', e.message));
    state.watchers.set(s.id, w);
  }
}
function unwatch(_ctx, id) { const w = state.watchers.get(id); if (w) { w.close(); state.watchers.delete(id); } }

function register(ctx) {
  ctx.handle('scan:rescan', (id) => {
    const ids = id ? [id] : ctx.db.all('SELECT id FROM sources').map(r => r.id);
    ids.forEach(i => scanSource(ctx, i));
    return true;
  });
  ctx.handle('scan:status', () => state.progress || { phase: 'idle' });
  ctx.afterReady(() => {
    if (ctx.db.getSetting('scanOnStartup', true) && !ctx.isTest) ctx.handle && ctx.db.all('SELECT id FROM sources').forEach(s => scanSource(ctx, s.id));
    else refreshWatchers(ctx);
  });
}

module.exports = { register, scanSource, waitIdle, refreshWatchers, unwatch, quickHash, processFile };
