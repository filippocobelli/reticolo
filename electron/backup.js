// Backup e ripristino di tag, raccolte, note, immagini di copertina, coda e revisioni duplicati.
const { dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');

const EXT = 'retbak';

function settings(db, ctx) {
  return { auto: 'weekly', keep: 10, dir: ctx.paths.backups, last: null, ...db.getSetting('backup', {}) };
}

function build(ctx) {
  const { db } = ctx;
  const items = [];
  const files = {};
  const rows = db.all(`SELECT i.id, i.qhash, i.path, i.note, i.cover, i.ai_desc, i.ai_tags, i.hidden FROM items i WHERE i.hidden=1 OR i.note IS NOT NULL OR i.cover IS NOT NULL OR i.ai_desc IS NOT NULL
    OR EXISTS (SELECT 1 FROM item_tags x WHERE x.item_id=i.id) OR EXISTS (SELECT 1 FROM collection_items c WHERE c.item_id=i.id) OR EXISTS (SELECT 1 FROM queue q WHERE q.item_id=i.id)`);
  for (const r of rows) {
    const rec = {
      qhash: r.qhash, path: r.path, note: r.note || undefined, hidden: r.hidden ? 1 : undefined, ai_desc: r.ai_desc || undefined, ai_tags: r.ai_tags ? JSON.parse(r.ai_tags) : undefined,
      tags: db.all('SELECT t.name FROM tags t JOIN item_tags x ON x.tag_id=t.id WHERE x.item_id=?', r.id).map(t => t.name),
      collections: db.all('SELECT c.name FROM collections c JOIN collection_items x ON x.collection_id=c.id WHERE x.item_id=?', r.id).map(c => c.name),
    };
    if (r.cover && fs.existsSync(r.cover)) { const n = `covers/${r.qhash || r.id}.png`; files[n] = new Uint8Array(fs.readFileSync(r.cover)); rec.cover = n; }
    items.push(rec);
  }
  const qmap = new Map(db.all('SELECT id, qhash, path FROM items').map(r => [r.id, r]));
  const data = {
    app: 'Reticolo', version: 1, created: new Date().toISOString(),
    tags: db.all('SELECT name, color FROM tags'),
    collections: db.all('SELECT name, color FROM collections'),
    items,
    queue: db.all('SELECT * FROM queue').map(q => ({ ...q, id: undefined, item_qhash: q.item_id ? qmap.get(q.item_id)?.qhash : null, item_path: q.item_id ? qmap.get(q.item_id)?.path : null, item_id: undefined })),
    dupReviews: db.all('SELECT a, b, status FROM dup_reviews').map(r => ({ a: qmap.get(r.a)?.qhash, b: qmap.get(r.b)?.qhash, status: r.status })).filter(r => r.a && r.b),
  };
  files['backup.json'] = strToU8(JSON.stringify(data, null, 1));
  return { zip: zipSync(files, { level: 6 }), stats: { items: items.length, tags: data.tags.length, collections: data.collections.length, queue: data.queue.length } };
}

function restore(ctx, file) {
  const { db } = ctx;
  const z = unzipSync(new Uint8Array(fs.readFileSync(file)));
  if (!z['backup.json']) throw new Error('File di backup non valido');
  const data = JSON.parse(strFromU8(z['backup.json']));
  const find = (qh, p) => (qh && db.get('SELECT id FROM items WHERE qhash=? ORDER BY missing LIMIT 1', qh)) || (p && db.get('SELECT id FROM items WHERE path=?', p));
  const colId = (name) => (db.get('SELECT id FROM collections WHERE name=?', name) || { id: Number(db.run('INSERT INTO collections(name,created_at) VALUES(?,?)', name, Date.now()).lastInsertRowid) }).id;
  let matched = 0, unmatched = 0;
  db.tx(() => {
    for (const t of data.tags || []) { ctx.tagId(t.name); if (t.color) db.run('UPDATE tags SET color=? WHERE name=?', t.color, t.name); }
    for (const c of data.collections || []) { const id = colId(c.name); if (c.color) db.run('UPDATE collections SET color=? WHERE id=?', c.color, id); }
    for (const rec of data.items || []) {
      const it = find(rec.qhash, rec.path);
      if (!it) { unmatched++; continue; }
      matched++;
      if (rec.note) db.run('UPDATE items SET note=? WHERE id=?', rec.note, it.id);
      if (rec.hidden) db.run('UPDATE items SET hidden=1 WHERE id=? OR archive_id=?', it.id, it.id);
      if (rec.ai_desc) db.run('UPDATE items SET ai_desc=?, ai_tags=? WHERE id=?', rec.ai_desc, JSON.stringify(rec.ai_tags || []), it.id);
      for (const t of rec.tags || []) db.run('INSERT OR IGNORE INTO item_tags(item_id,tag_id) VALUES(?,?)', it.id, ctx.tagId(t));
      for (const c of rec.collections || []) db.run('INSERT OR IGNORE INTO collection_items(collection_id,item_id) VALUES(?,?)', colId(c), it.id);
      if (rec.cover && z[rec.cover]) { const p = path.join(ctx.paths.covers, `${it.id}.png`); fs.writeFileSync(p, z[rec.cover]); db.run('UPDATE items SET cover=? WHERE id=?', p, it.id); }
      db.refreshSearch(it.id);
    }
    const existingQ = db.get('SELECT COUNT(*) n FROM queue').n;
    if (!existingQ) for (const q of data.queue || []) {
      const it = find(q.item_qhash, q.item_path);
      db.run('INSERT INTO queue(item_id,title,status,minutes,filament_g,filament_m,material,color,copies,plate,notes,position,created_at,done_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        it ? it.id : null, q.title, q.status, q.minutes, q.filament_g, q.filament_m, q.material, q.color, q.copies || 1, q.plate, q.notes, q.position, q.created_at, q.done_at);
    }
    for (const r of data.dupReviews || []) {
      const a = find(r.a), b = find(r.b);
      if (a && b) { const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id]; db.run('INSERT OR REPLACE INTO dup_reviews(a,b,status) VALUES(?,?,?)', x, y, r.status); }
    }
  });
  for (const ch of ['items-changed', 'tags-changed', 'collections-changed', 'queue-changed']) ctx.emit(ch, {});
  return { matched, unmatched, created: data.created };
}

function createTo(ctx, dir) {
  const { zip, stats } = build(ctx);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(dir, `reticolo-backup-${stamp}.${EXT}`);
  fs.writeFileSync(file, zip);
  return { path: file, ...stats };
}

function prune(dir, keep) {
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.' + EXT) && f.startsWith('reticolo-backup-')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
  } catch {}
}

function checkAuto(ctx) {
  const s = settings(ctx.db, ctx);
  if (s.auto === 'off') return;
  const period = s.auto === 'daily' ? 864e5 : 7 * 864e5;
  if (s.last && Date.now() - s.last < period) return;
  try {
    createTo(ctx, s.dir);
    prune(s.dir, s.keep || 10);
    ctx.db.setSetting('backup', { ...s, last: Date.now() });
    ctx.emit('backup-done', { auto: true });
  } catch (e) { console.warn('backup automatico', e.message); }
}

function register(ctx) {
  const { db, handle } = ctx;
  handle('backup:settings', () => settings(db, ctx));
  handle('backup:setSettings', (patch) => { db.setSetting('backup', { ...settings(db, ctx), ...patch }); return settings(db, ctx); });
  handle('backup:create', async (outDir) => {
    if (!outDir) {
      const s = settings(db, ctx);
      const r = await dialog.showSaveDialog(ctx.getMainWindow(), { title: 'Salva backup', defaultPath: path.join(s.dir, `reticolo-backup.${EXT}`), filters: [{ name: 'Backup Reticolo', extensions: [EXT] }] });
      if (r.canceled) return null;
      const { zip, stats } = build(ctx);
      fs.writeFileSync(r.filePath, zip);
      return { path: r.filePath, ...stats };
    }
    return createTo(ctx, outDir);
  });
  handle('backup:restore', async (file) => {
    if (!file) {
      const r = await dialog.showOpenDialog(ctx.getMainWindow(), { title: 'Ripristina backup', properties: ['openFile'], filters: [{ name: 'Backup Reticolo', extensions: [EXT, 'zip'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      file = r.filePaths[0];
    }
    return restore(ctx, file);
  });
  handle('backup:pickDir', async () => {
    const r = await dialog.showOpenDialog(ctx.getMainWindow(), { title: 'Cartella dei backup', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('backup:list', () => {
    const s = settings(db, ctx);
    try { return fs.readdirSync(s.dir).filter(f => f.endsWith('.' + EXT)).map(f => { const p = path.join(s.dir, f); return { name: f, path: p, size: fs.statSync(p).size, mtime: fs.statSync(p).mtimeMs }; }).sort((a, b) => b.mtime - a.mtime); }
    catch { return []; }
  });
  handle('settings:get', () => Object.fromEntries(db.all('SELECT key, value FROM settings').filter(r => r.key !== 'ai').map(r => [r.key, JSON.parse(r.value)])));
  handle('settings:set', (patch) => { for (const [k, v] of Object.entries(patch)) if (k !== 'ai') db.setSetting(k, v); if ('watchFolders' in patch || 'watchPolling' in patch) require('./scanner').refreshWatchers(ctx); return true; });
  ctx.afterReady(() => { if (!ctx.isTest) { setTimeout(() => checkAuto(ctx), 60000); setInterval(() => checkAuto(ctx), 3600000); } });
}

module.exports = { register, build, restore, createTo, checkAuto };
