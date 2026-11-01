const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('rtc', {
  async invoke(channel, ...args) {
    const r = await ipcRenderer.invoke(channel, ...args);
    if (!r || !r.ok) throw new Error(r ? r.error : 'Errore IPC');
    return r.data;
  },
  on(fn) {
    const h = (_e, channel, payload) => fn(channel, payload);
    ipcRenderer.on('evt', h);
    return () => ipcRenderer.removeListener('evt', h);
  },
  startDrag(ids) { ipcRenderer.send('drag:start', ids); },
  pathForFile(file) { try { return webUtils.getPathForFile(file); } catch { return null; } },
  // canale riservato alla finestra di rendering miniature
  worker: {
    onJob(fn) { ipcRenderer.on('worker:job', (_e, job) => fn(job)); },
    done(result) { ipcRenderer.send('worker:done', result); },
    ready() { ipcRenderer.send('worker:ready'); },
  },
});
