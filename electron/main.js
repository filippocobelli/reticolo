const { app, BrowserWindow, ipcMain, protocol, globalShortcut, shell, nativeImage, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { DB } = require('./db');

protocol.registerSchemesAsPrivileged([
  { scheme: 'rtc', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } },
]);

const isTest = process.env.RETICOLO_TEST === '1';
// ripiego software per WebGL su macchine senza GPU utilizzabile (VM, driver in blocklist)
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
if (process.env.RETICOLO_SOFTWARE_GL === '1') app.commandLine.appendSwitch('ignore-gpu-blocklist');
if (process.env.RETICOLO_USERDATA) app.setPath('userData', process.env.RETICOLO_USERDATA);

let mainWindow = null;
const listeners = new Set();

const ctx = {
  db: null,
  paths: {},
  isTest,
  getMainWindow: () => mainWindow,
  // invia un evento all'interfaccia
  emit(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('evt', channel, payload);
    for (const l of listeners) l(channel, payload);
  },
  onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  getItem(id) { return ctx.db.getItem(id); },
  // legge i byte di un elemento (file normale o voce dentro un archivio)
  async readItemBytes(item) {
    if (typeof item === 'number') item = ctx.db.get('SELECT * FROM items WHERE id=?', item);
    if (!item) throw new Error('Elemento non trovato');
    if (item.archive_id) {
      const arch = ctx.db.get('SELECT path, ext FROM items WHERE id=?', item.archive_id);
      const inner = item.path.slice(item.path.indexOf('::') + 2);
      return require('./archives').readEntry(arch.path, arch.ext, inner);
    }
    return fs.promises.readFile(item.path);
  },
  // restituisce un percorso reale su disco (estrae in temp le voci d'archivio)
  async materialize(item) {
    if (typeof item === 'number') item = ctx.db.get('SELECT * FROM items WHERE id=?', item);
    if (!item.archive_id) return item.path;
    const buf = await ctx.readItemBytes(item);
    const dir = path.join(ctx.paths.temp, String(item.id));
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, item.name);
    fs.writeFileSync(out, buf);
    return out;
  },
  thumbPath(id) { return path.join(ctx.paths.thumbs, `${id}.png`); },
};

const MODULES = ['library', 'scanner', 'thumbs', 'duplicates', 'queue', 'backup', 'threemf', 'slicers', 'ai', 'tools'];

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { console.error(`[${channel}]`, err); return { ok: false, error: String(err && err.message || err) }; }
  });
}
ctx.handle = handle;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    title: 'Reticolo',
    backgroundColor: '#14161a',
    show: !isTest || process.env.RETICOLO_SHOW === '1',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, plugins: true },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; if (process.platform !== 'darwin') app.quit(); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function registerProtocol() {
  protocol.handle('rtc', async (request) => {
    const u = new URL(request.url);
    const [kind, idStr] = [u.hostname, u.pathname.replace(/^\//, '').split('/')[0]];
    const id = Number(idStr);
    try {
      if (kind === 'thumb') {
        const it = ctx.db.get('SELECT cover FROM items WHERE id=?', id);
        const p = it && it.cover && fs.existsSync(it.cover) ? it.cover : ctx.thumbPath(id);
        const buf = await fs.promises.readFile(p);
        return new Response(buf, { headers: { 'content-type': mimeFor(p), 'cache-control': 'no-cache', 'access-control-allow-origin': '*' } });
      }
      if (kind === 'file') {
        const item = ctx.db.get('SELECT * FROM items WHERE id=?', id);
        const buf = await ctx.readItemBytes(item);
        return new Response(buf, { headers: { 'content-type': mimeFor(item.name), 'access-control-allow-origin': '*' } });
      }
      if (kind === 'asset') { // file in userData (es. copertine)
        const p = path.join(ctx.paths.userData, decodeURIComponent(u.pathname));
        if (!p.startsWith(ctx.paths.userData)) return new Response('no', { status: 403 });
        return new Response(await fs.promises.readFile(p), { headers: { 'content-type': mimeFor(p) } });
      }
    } catch (e) {
      return new Response(String(e.message), { status: 404 });
    }
    return new Response('not found', { status: 404 });
  });
}

function mimeFor(p) {
  const e = path.extname(p).toLowerCase();
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' })[e] || 'application/octet-stream';
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  const acc = ctx.db.getSetting('globalShortcut', 'CommandOrControl+Shift+M');
  if (!acc) return;
  try {
    globalShortcut.register(acc, () => {
      if (!mainWindow) createWindow();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show(); mainWindow.focus();
      ctx.emit('focus-search');
    });
  } catch (e) { console.warn('Scorciatoia non valida', acc, e.message); }
}
ctx.registerShortcut = registerShortcut;

const gotLock = isTest || app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

app.whenReady().then(async () => {
  const ud = app.getPath('userData');
  ctx.paths = {
    userData: ud,
    thumbs: path.join(ud, 'thumbs'),
    covers: path.join(ud, 'covers'),
    temp: path.join(app.getPath('temp'), 'reticolo'),
    backups: path.join(ud, 'backups'),
  };
  for (const p of Object.values(ctx.paths)) fs.mkdirSync(p, { recursive: true });
  ctx.db = new DB(path.join(ud, 'library.db'));

  registerProtocol();
  for (const m of MODULES) {
    try { require(`./${m}`).register(ctx); }
    catch (e) { console.error(`Modulo ${m} non caricato:`, e); }
  }
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, userData: ud }));
  handle('app:setShortcut', (acc) => { ctx.db.setSetting('globalShortcut', acc); registerShortcut(); return true; });

  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));

  createWindow();
  registerShortcut();
  ctx.emit('ready');
  for (const l of [...(ctx._afterReady || [])]) try { l(); } catch (e) { console.error(e); }

  if (isTest && process.env.RETICOLO_TEST_SCRIPT) require(process.env.RETICOLO_TEST_SCRIPT)(ctx, app);

  app.on('activate', () => { if (!mainWindow) createWindow(); });
});

ctx.afterReady = (fn) => { (ctx._afterReady ||= []).push(fn); };

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

module.exports = ctx;
