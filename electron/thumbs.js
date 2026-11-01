// Coda miniature: prima immagini incorporate (3MF, G-code, LightBurn...), poi rendering 3D nella finestra worker.
const { BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { info } = require('./formats');

const MAX_BYTES = 400 * 1024 * 1024;
const JOB_TIMEOUT = 90000;
const st = { running: false, worker: null, workerReady: null, pendingJob: null, done: 0 };

function ensureWorker(ctx) {
  if (st.worker && !st.worker.isDestroyed()) return st.workerReady;
  st.worker = new BrowserWindow({
    show: process.env.RETICOLO_SHOW_WORKER === '1', width: 512, height: 512, paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: false },
  });
  st.workerReady = new Promise((res) => {
    const h = (e) => { if (st.worker && e.sender === st.worker.webContents) { ipcMain.removeListener('worker:ready', h); res(); } };
    ipcMain.on('worker:ready', h);
  });
  st.worker.loadFile(path.join(__dirname, '..', 'dist', 'worker.html'));
  st.worker.webContents.on('render-process-gone', () => { st.worker = null; if (st.pendingJob) st.pendingJob.reject(new Error('worker crash')); });
  st.worker.on('closed', () => { st.worker = null; });
  return st.workerReady;
}

ipcMain.on('worker:done', (_e, result) => {
  if (st.pendingJob && st.pendingJob.id === result.id) { const j = st.pendingJob; st.pendingJob = null; j.resolve(result); }
});

async function renderInWorker(ctx, job) {
  await ensureWorker(ctx);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      st.pendingJob = null;
      try { st.worker && st.worker.destroy(); } catch {}
      st.worker = null;
      reject(new Error('timeout'));
    }, JOB_TIMEOUT);
    st.pendingJob = { id: job.id, resolve: (r) => { clearTimeout(timer); resolve(r); }, reject: (e) => { clearTimeout(timer); reject(e); } };
    st.worker.webContents.send('worker:job', job);
  });
}

function mergeMeta(db, id, patch) {
  const r = db.get('SELECT meta FROM items WHERE id=?', id);
  let m = {}; try { m = r && r.meta ? JSON.parse(r.meta) : {}; } catch {}
  db.run('UPDATE items SET meta=? WHERE id=?', JSON.stringify({ ...m, ...patch }), id);
}

async function processItem(ctx, item) {
  const { db } = ctx;
  const fmt = info(item.ext) || {};
  if (item.kind === 'archive') return archiveThumb(ctx, item);
  if (item.size > MAX_BYTES || item.kind === 'doc') { db.run('UPDATE items SET thumb=2 WHERE id=?', item.id); return; }

  let buf = null, embedded = null;
  const extract = safeRequire('./extract');
  const needsBytes = !(item.kind === 'image' || item.kind === 'video');
  if (needsBytes) {
    try { buf = await ctx.readItemBytes(item); } catch (e) { db.run('UPDATE items SET thumb=2, meta=? WHERE id=?', JSON.stringify({ readError: e.message }), item.id); return; }
    if (extract) {
      try { const meta = await extract.extractMeta(item, buf); if (meta && Object.keys(meta).length) mergeMeta(db, item.id, meta); } catch (e) { console.warn('meta', item.name, e.message); }
      try { embedded = await extract.extractThumbnail(item, buf); } catch (e) { console.warn('thumb-extract', item.name, e.message); }
    }
  }
  let png = embedded || null;
  if (fmt.render) {
    try {
      const r = await renderInWorker(ctx, { id: item.id, ext: item.ext, kind: item.kind, name: item.name, url: `rtc://file/${item.id}`, needImage: !embedded, size: item.size });
      if (r.error) console.warn('render', item.name, r.error);
      if (!png && r.png) png = Buffer.from(r.png);
      if (r.geoHash || r.tris) db.run('UPDATE items SET geo_hash=?, tri_count=?, dims=? WHERE id=?', r.geoHash || null, r.tris || null, r.dims ? JSON.stringify(r.dims) : null, item.id);
      if (r.meta) mergeMeta(db, item.id, r.meta);
    } catch (e) { console.warn('worker', item.name, e.message); }
  }
  buf = null;
  if (png) {
    fs.writeFileSync(ctx.thumbPath(item.id), png);
    db.run('UPDATE items SET thumb=1 WHERE id=?', item.id);
    // aggiorna la miniatura dell'archivio che lo contiene
    if (item.archive_id) {
      const a = db.get('SELECT id, thumb FROM items WHERE id=?', item.archive_id);
      if (a && a.thumb !== 1) { fs.copyFileSync(ctx.thumbPath(item.id), ctx.thumbPath(a.id)); db.run('UPDATE items SET thumb=1 WHERE id=?', a.id); ctx.emit('thumb-ready', { id: a.id }); }
    }
  } else db.run('UPDATE items SET thumb=2 WHERE id=?', item.id);
  ctx.emit('thumb-ready', { id: item.id });
}

function archiveThumb(ctx, item) {
  const { db } = ctx;
  const e = db.get("SELECT id FROM items WHERE archive_id=? AND thumb=1 ORDER BY kind='image' DESC, kind='model' DESC LIMIT 1", item.id);
  if (e && fs.existsSync(ctx.thumbPath(e.id))) { fs.copyFileSync(ctx.thumbPath(e.id), ctx.thumbPath(item.id)); db.run('UPDATE items SET thumb=1 WHERE id=?', item.id); }
  else db.run('UPDATE items SET thumb=2 WHERE id=?', item.id);
  ctx.emit('thumb-ready', { id: item.id });
}

function safeRequire(m) { try { return require(m); } catch (e) { if (!safeRequire.warned) { console.warn('modulo', m, e.message); safeRequire.warned = true; } return null; } }

async function loop(ctx) {
  if (st.running) return;
  st.running = true;
  const { db } = ctx;
  try {
    for (;;) {
      const batch = db.all(`SELECT * FROM items WHERE thumb=0 AND missing=0 ORDER BY
        CASE kind WHEN 'model' THEN 0 WHEN 'mesh' THEN 1 WHEN 'gcode' THEN 2 WHEN 'laser' THEN 3 WHEN 'cad' THEN 4 WHEN 'image' THEN 5 WHEN 'video' THEN 6 WHEN 'archive' THEN 8 ELSE 7 END, id LIMIT 25`);
      if (!batch.length) break;
      for (const it of batch) {
        try { await processItem(ctx, it); } catch (e) { console.error('thumb', it.name, e); db.run('UPDATE items SET thumb=2 WHERE id=?', it.id); }
        st.done++;
        if (st.done % 10 === 0) ctx.emit('thumbs-progress', status(ctx));
      }
    }
  } finally {
    st.running = false;
    ctx.emit('thumbs-progress', status(ctx));
    require('./duplicates').invalidate();
    ctx.emit('thumbs-idle');
  }
}

function status(ctx) { return { running: st.running, pending: ctx.db.get('SELECT COUNT(*) n FROM items WHERE thumb=0 AND missing=0').n }; }
function kick(ctx) { setImmediate(() => loop(ctx)); }
function waitIdle(ctx) { return new Promise(res => { const t = setInterval(() => { if (!st.running && status(ctx).pending === 0) { clearInterval(t); res(); } }, 200); }); }

function register(ctx) {
  ctx.handle('thumbs:regenerate', (ids) => {
    if (ids && ids.length) for (const id of ids) ctx.db.run('UPDATE items SET thumb=0 WHERE id=?', id);
    else ctx.db.run('UPDATE items SET thumb=0 WHERE missing=0');
    kick(ctx); return true;
  });
  ctx.handle('thumbs:status', () => status(ctx));
  ctx.renderInWorker = (job) => renderInWorker(ctx, job);
  ctx.afterReady(() => kick(ctx));
}

module.exports = { register, kick, waitIdle, status };
