// Coda di stampa: tempi, filamento, stato, esportazione checklist (non comunica con le stampanti)
const { dialog } = require('electron');
const fs = require('node:fs');

// Legge stime dai metadati estratti (G-code / 3MF slice_info), tollerando nomi diversi.
function estimates(meta = {}, plate) {
  const pick = (...keys) => { for (const k of keys) { const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), meta); if (v != null && !isNaN(Number(v))) return Number(v); } return null; };
  if (plate != null && Array.isArray(meta.plates)) {
    const p = meta.plates.find(x => String(x.index) === String(plate)) || meta.plates[0];
    if (p) return { minutes: p.minutes ?? (p.printTimeSec != null ? p.printTimeSec / 60 : null), filament_g: p.filamentG ?? p.weight ?? null, filament_m: p.filamentM ?? null };
  }
  const sec = pick('printTimeSec', 'estimatedTimeSec', 'print.timeSec', 'timeSec');
  return {
    minutes: sec != null ? sec / 60 : pick('printMinutes', 'minutes'),
    filament_g: pick('filamentG', 'filament_g', 'filamentWeightG', 'weight'),
    filament_m: pick('filamentM', 'filament_m', 'filamentLengthM'),
    material: meta.material || meta.filamentType || null,
  };
}

const fmtTime = (m) => { if (m == null) return ''; const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h}h ${mm}m` : `${mm}m`; };

function register(ctx) {
  const { db, handle } = ctx;
  const list = () => db.all(`SELECT q.*, i.name item_name, i.ext, i.thumb, i.missing FROM queue q LEFT JOIN items i ON i.id=q.item_id ORDER BY q.status='done', q.position, q.id`);
  handle('queue:list', list);
  handle('queue:add', (data = {}) => {
    const ids = data.itemIds || (data.itemId ? [data.itemId] : [null]);
    const maxPos = (db.get('SELECT MAX(position) m FROM queue').m || 0);
    let k = 0;
    for (const itemId of ids) {
      const it = itemId ? db.getItem(itemId) : null;
      const est = it ? estimates(it.meta, data.plate) : {};
      db.run('INSERT INTO queue(item_id,title,status,minutes,filament_g,filament_m,material,color,copies,plate,notes,position,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        itemId, data.title || (it ? it.name.replace(/\.[^.]+$/, '') : 'Nuova stampa'), 'todo',
        data.minutes ?? est.minutes ?? null, data.filament_g ?? est.filament_g ?? null, data.filament_m ?? est.filament_m ?? null,
        data.material ?? est.material ?? null, data.color ?? null, data.copies || 1, data.plate ?? null, data.notes ?? null, maxPos + (++k), Date.now());
    }
    ctx.emit('queue-changed'); return list();
  });
  handle('queue:update', (id, patch) => {
    const allowed = ['title', 'status', 'minutes', 'filament_g', 'filament_m', 'material', 'color', 'copies', 'plate', 'notes'];
    for (const [k, v] of Object.entries(patch)) if (allowed.includes(k)) db.run(`UPDATE queue SET ${k}=? WHERE id=?`, v === '' ? null : v, id);
    if (patch.status === 'done') db.run('UPDATE queue SET done_at=? WHERE id=?', Date.now(), id);
    ctx.emit('queue-changed'); return true;
  });
  handle('queue:remove', (id) => { db.run('DELETE FROM queue WHERE id=?', id); ctx.emit('queue-changed'); return true; });
  handle('queue:reorder', (ids) => { db.tx(() => ids.forEach((id, i) => db.run('UPDATE queue SET position=? WHERE id=?', i + 1, id))); ctx.emit('queue-changed'); return true; });
  handle('queue:export', async (format = 'md', opts = {}) => {
    const rows = list().filter(r => opts.includeDone || r.status !== 'done');
    let text;
    const tot = rows.reduce((a, r) => ({ m: a.m + (r.minutes || 0) * (r.copies || 1), g: a.g + (r.filament_g || 0) * (r.copies || 1) }), { m: 0, g: 0 });
    if (format === 'csv') {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      text = ['Stato;Titolo;File;Copie;Tempo (min);Filamento (g);Filamento (m);Materiale;Colore;Piatto;Note']
        .concat(rows.map(r => [r.status, r.title, r.item_name, r.copies, r.minutes?.toFixed(0), r.filament_g?.toFixed(1), r.filament_m?.toFixed(2), r.material, r.color, r.plate, r.notes].map(esc).join(';'))).join('\n');
    } else {
      text = `# Coda di stampa — ${new Date().toLocaleDateString('it-IT')}\n\n` +
        rows.map(r => `- [${r.status === 'done' ? 'x' : ' '}] **${r.title}**${r.copies > 1 ? ` ×${r.copies}` : ''} — ${[fmtTime(r.minutes), r.filament_g ? `${r.filament_g.toFixed(0)} g` : '', r.material, r.color, r.plate ? `piatto ${r.plate}` : ''].filter(Boolean).join(' · ')}${r.item_name ? `\n  \`${r.item_name}\`` : ''}${r.notes ? `\n  ${r.notes}` : ''}`).join('\n') +
        `\n\n**Totale:** ${fmtTime(tot.m)} · ${tot.g.toFixed(0)} g\n`;
    }
    if (opts.outPath) { fs.writeFileSync(opts.outPath, text); return { path: opts.outPath, text }; }
    const r = await dialog.showSaveDialog(ctx.getMainWindow(), { defaultPath: `coda-di-stampa.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (r.canceled) return { text };
    fs.writeFileSync(r.filePath, text);
    return { path: r.filePath, text };
  });
}

module.exports = { register, estimates };
