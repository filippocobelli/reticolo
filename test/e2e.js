// Test end-to-end eseguito dentro Electron (RETICOLO_TEST_SCRIPT). Usa l'app reale.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx, app) {
  const LIB = process.env.RETICOLO_LIB;
  const SHOTS = process.env.RETICOLO_SHOTS || '/tmp/reticolo-shots';
  fs.mkdirSync(SHOTS, { recursive: true });
  const results = []; let failed = 0;
  const ok = (cond, msg, extra) => { results.push(`${cond ? 'OK  ' : 'FAIL'} ${msg}${extra != null ? ' — ' + JSON.stringify(extra) : ''}`); if (!cond) failed++; };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const win = ctx.getMainWindow();
  await new Promise(r => win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r());
  const js = (code) => win.webContents.executeJavaScript(code);
  const inv = (ch, ...a) => js(`window.rtc.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(a)}).catch(e => ({ __err: String(e.message) }))`).then(r => { if (r && r.__err) throw new Error(ch + ': ' + r.__err); return r; });
  const shot = async (name) => { await sleep(700); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); };
  const click = (text, sel = '.nav-item, .btn, .tab, .card, span') => js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => (e.querySelector('.label') ? e.querySelector('.label').textContent : e.textContent).trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
  const dbl = (text) => js(`(() => { const el = [...document.querySelectorAll('.card')].find(e => e.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; })()`);
  const scanner = require(path.join(app.getAppPath(), 'electron/scanner')); const thumbs = require(path.join(app.getAppPath(), 'electron/thumbs'));
  try {
    win.setSize(1440, 900);
    await shot('00-vuota');
    await inv('sources:add', LIB);
    await sleep(500); await scanner.waitIdle(); await thumbs.waitIdle(ctx); await sleep(500);
    const db = ctx.db;
    const all = db.all('SELECT id, name, ext, kind, thumb, geo_hash, tri_count, dims, archive_id, meta FROM items');
    const by = (n) => all.find(i => i.name === n);
    ok(all.length >= 19, 'elementi indicizzati', all.length);
    for (const n of ['cubo_calibrazione.stl', 'vaso_cilindro.stl', 'supporto_cuffie.obj', 'portachiavi_bambu.3mf', 'anello.gcode', 'sottobicchiere.lbrn2', 'mandala.dxf', 'torre.stl', 'foto_vaso.png'])
      ok(by(n) && by(n).thumb === 1, `miniatura ${n}`, by(n) && by(n).thumb);
    ok(by('torre.stl') && by('torre.stl').archive_id, 'voce in archivio indicizzata');
    ok(by('staffa.step') && by('staffa.step').thumb === 1 && JSON.parse(by('staffa.step').dims || '[]').join(',') === '40,30,10', 'STEP: miniatura e dimensioni', by('staffa.step') && [by('staffa.step').thumb, by('staffa.step').dims, by('staffa.step').meta]);
    const in7z = all.filter(i => i.archive_id === by('ricambi.7z').id);
    ok(in7z.length === 2 && in7z.every(i => i.thumb === 1), 'archivio 7z indicizzato con miniature', in7z.map(i => [i.name, i.thumb]));
    ok(by('pack_miniature.zip').thumb === 1, 'miniatura archivio');
    ok(by('cubo_calibrazione.stl').tri_count === 12, 'triangoli STL', by('cubo_calibrazione.stl').tri_count);
    ok(JSON.parse(by('cubo_calibrazione.stl').dims || 'null')?.join(',') === '20,20,20', 'dimensioni STL', by('cubo_calibrazione.stl').dims);
    ok(by('cubo_calibrazione.stl').geo_hash === by('cubo-v2.stl').geo_hash, 'stessa geometria anche se spostata');
    const gm = JSON.parse(by('anello.gcode').meta || '{}');
    ok(Math.abs((gm.printMinutes || 0) - 62.05) < 0.1 && gm.filamentG === 3.72, 'metadati G-code', { m: gm.printMinutes, g: gm.filamentG, s: gm.slicer });
    const tm = JSON.parse(by('portachiavi_bambu.3mf').meta || '{}');
    ok(tm.plateCount === 2, 'piatti 3MF', tm.plateCount);

    const d = await inv('dups:list');
    ok(d.exact.length === 1 && d.exact[0].length === 2, 'duplicati esatti', d.exact.map(g => g.map(x => x.name)));
    ok(d.geometry.length >= 1, 'duplicati di geometria', d.geometry.map(g => g.map(x => x.name)));
    ok(d.probable.length >= 0, 'probabili', d.probable.map(p => [p.a.name, p.b.name, p.reason]));

    // ricerca e filtri
    const s1 = await inv('items:query', { q: 'vaso' });
    ok(s1.total >= 1, 'ricerca per nome', s1.total);
    const f1 = await inv('items:folder', { sourceId: 1, dir: 'Pacchetti' });
    ok(f1.items.some(i => i.browseDir), 'archivio navigabile come cartella');
    const f2 = await inv('items:folder', { sourceId: 1, dir: 'Pacchetti/pack_miniature.zip/miniature' });
    ok(f2.items.length >= 3, 'contenuto archivio', f2.items.map(i => i.name));

    // tag, note, raccolte persistono dopo rinomina
    const cube = by('vaso_cilindro.stl').id;
    await inv('tags:add', [cube], 'vaso'); await inv('items:setNote', cube, 'Modalità vaso 0.2');
    const col = await inv('collections:create', 'Regali'); await inv('collections:addItems', col.id, [cube]);
    fs.renameSync(path.join(LIB, 'Vasi/vaso_cilindro.stl'), path.join(LIB, 'Vasi/vaso_rinominato.stl'));
    await inv('scan:rescan', 1); await sleep(300); await scanner.waitIdle();
    const moved = db.getItem(cube);
    ok(moved.name === 'vaso_rinominato.stl' && moved.note === 'Modalità vaso 0.2' && moved.tags.length === 1 && moved.collections.length === 1, 'metadati conservati dopo rinomina', { name: moved.name, note: moved.note });
    const s2 = await inv('items:query', { q: 'vaso modalità' });
    ok(s2.items.some(i => i.id === cube), 'ricerca su note e tag');
    const unc = await inv('items:query', { uncollected: true });
    ok(!unc.items.some(i => i.id === cube), 'vista senza raccolta');

    // nascondi: archivio e contenuto, persistenza dopo nuova scansione, ripristino
    const zipId = by('pack_miniature.zip').id;
    await inv('items:setHidden', [zipId], true);
    const h1 = await inv('items:query', {});
    ok(!h1.items.some(i => i.id === zipId || i.archive_id === zipId), 'archivio e contenuto nascosti dalla libreria');
    const hv = await inv('items:query', { hidden: true });
    ok(hv.items.some(i => i.id === zipId) && hv.items.some(i => i.name === 'torre.stl'), 'vista Nascosti', hv.items.map(i => i.name));
    await inv('scan:rescan', 1); await sleep(300); await scanner.waitIdle();
    ok(db.get('SELECT COUNT(*) n FROM items WHERE archive_id=? AND hidden=0', zipId).n === 0 && db.get('SELECT hidden FROM items WHERE id=?', zipId).hidden === 1, 'nascosti anche dopo nuova scansione');
    const fz = await inv('items:folder', { sourceId: 1, dir: 'Pacchetti' });
    ok(!fz.items.some(i => i.id === zipId), 'archivio nascosto non compare nelle cartelle');
    await inv('items:setHidden', [zipId], false);
    ok((await inv('items:query', {})).items.some(i => i.name === 'torre.stl'), 'mostra di nuovo');
    const nd = await inv('items:setHiddenDir', { sourceId: 1, dir: 'Laser' }, true);
    ok(nd === 2 && !(await inv('items:query', {})).items.some(i => i.name === 'mandala.dxf'), 'nascondi cartella intera', nd);
    await inv('items:setHiddenDir', { sourceId: 1, dir: 'Laser' }, false);

    // coda
    await inv('queue:add', { itemId: by('anello.gcode').id });
    const q = await inv('queue:list');
    ok(q.length === 1 && Math.round(q[0].minutes) === 62 && q[0].filament_g === 3.72, 'coda con stime', q[0]);
    const ex = await inv('queue:export', 'md', { outPath: '/tmp/reticolo-coda.md' });
    ok(ex.text.includes('anello') && ex.text.includes('1h 2m'), 'export checklist');

    // backup e ripristino
    const bk = await inv('backup:create', '/tmp/reticolo-backups');
    ok(bk && fs.existsSync(bk.path), 'backup creato', bk);
    db.run('UPDATE items SET note=NULL WHERE id=?', cube); db.run('DELETE FROM item_tags');
    const rs = await inv('backup:restore', bk.path);
    ok(rs.matched >= 1 && db.getItem(cube).note === 'Modalità vaso 0.2' && db.getItem(cube).tags.length === 1, 'ripristino', rs);

    // convertitore 3MF
    const cv = await inv('threemf:convert', by('portachiavi_bambu.3mf').id, 'prusa', { outDir: '/tmp/reticolo-conv' });
    ok(cv.outputs.length === 2, 'conversione 3MF verso Prusa (un file per piatto)', cv.outputs.map(p => path.basename(p)));

    // slicer + ia (solo canali)
    const sl = await inv('slicers:detect'); ok(Array.isArray(sl) && sl.length >= 18, 'catalogo slicer', sl.length);
    const ap = await inv('ai:providers'); ok(ap.providers.length >= 6, 'provider IA', ap.providers.map(p => p.id));

    // ---------- screenshot interfaccia ----------
    await js('location.reload()'); await sleep(1500);
    await inv('items:setHidden', [by('cubo-v2.stl').id], true); await js('location.reload()'); await sleep(1500);
    await click('Tutti i modelli'); await shot('01-libreria');
    await click('Nascosti'); await sleep(600); await shot('01b-nascosti'); await inv('items:setHidden', [by('cubo-v2.stl').id], false); await click('Tutti i modelli'); await sleep(800);
    const found = await js(`(() => { const c = [...document.querySelectorAll('.card')]; const e = c.find(e => e.textContent.includes('portachiavi')); if (e) { e.click(); return 'ok'; } return document.querySelector('h1') && document.querySelector('h1').textContent + ' | ' + c.map(x => x.textContent).join(','); })()`); ok(found === 'ok', 'selezione card', found); await shot('02-dettaglio-3mf');
    await dbl('portachiavi'); await sleep(2500); await shot('03-viewer-3mf');
    await click('Gancio', '.btn'); await sleep(1500); await shot('04-viewer-3mf-piatto2');
    await click('← Indietro'); await sleep(300);
    await dbl('anello.gcode'); await sleep(2500); await shot('05-viewer-gcode');
    await click('← Indietro'); await dbl('mandala'); await sleep(2000); await shot('06-viewer-dxf');
    await click('← Indietro'); await dbl('supporto_cuffie'); await sleep(2000);
    await click('📏 Misura'); await shot('07-viewer-obj');
    await click('← Indietro'); await dbl('staffa'); await sleep(3000); await shot('07b-viewer-step');
    await click('← Indietro');
    await click(path.basename(LIB)); await sleep(800); await shot('08-cartelle');
    await click('Duplicati'); await sleep(800); await shot('09-duplicati');
    await click('Coda di stampa'); await shot('10-coda');
    await click('Targhette'); await sleep(2500); await shot('11-targhette');
    await click('Vasi', '.nav-item'); await sleep(2000); await shot('12-vasi');
    await click('Convertitore 3MF'); await shot('13-convertitore');
    await click('Impostazioni'); await sleep(1000); await shot('14-impostazioni');
  } catch (e) { ok(false, 'eccezione: ' + (e.stack || e)); }
  fs.writeFileSync(path.join(SHOTS, 'results.txt'), results.join('\n') + `\n\n${failed} falliti\n`);
  console.log('\n' + results.join('\n') + `\n\nRISULTATO: ${failed} falliti\n`);
  app.exit(failed ? 1 : 0);
};
