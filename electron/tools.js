// Salvataggi e selezioni file generiche
const { dialog, app, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function register(ctx) {
  const win = () => ctx.getMainWindow();
  ctx.handle('tools:saveScreenshot', async (dataUrl, name = 'screenshot', outPath) => {
    let p = outPath;
    if (!p) {
      const r = await dialog.showSaveDialog(win(), { defaultPath: path.join(app.getPath('pictures'), `${name.replace(/[\\/:*?"<>|]/g, '_')}.png`), filters: [{ name: 'PNG', extensions: ['png'] }] });
      if (r.canceled) return null; p = r.filePath;
    }
    fs.writeFileSync(p, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    return p;
  });
  ctx.handle('tools:saveText', async (text, name = 'file.txt', filters) => {
    const r = await dialog.showSaveDialog(win(), { defaultPath: name, filters: filters || [{ name: 'Testo', extensions: [path.extname(name).slice(1) || 'txt'] }] });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, text);
    return r.filePath;
  });
  ctx.handle('tools:revealPath', (p) => { shell.showItemInFolder(p); return true; });
  ctx.handle('tools:pickFile', async (filters) => {
    const r = await dialog.showOpenDialog(win(), { properties: ['openFile'], filters: filters || [] });
    return r.canceled ? null : r.filePaths[0];
  });
}

module.exports = { register };
