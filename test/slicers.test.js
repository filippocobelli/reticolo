// Test del rilevamento slicer su directory finte.
const { makeCtx } = require('./helpers');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { detect, resolvePattern, SLICERS, register } = require('../electron/slicers');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slicers-'));
const mk = (rel, file = false) => {
  const p = path.join(tmp, rel);
  if (file) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); }
  else fs.mkdirSync(p, { recursive: true });
  return p;
};

assert.ok(SLICERS.length >= 18, 'catalogo di almeno 18 slicer');
assert.ok(SLICERS.filter(s => s.resin).length >= 6, 'slicer per resina');
for (const s of SLICERS) { assert.ok(s.id && s.name && Array.isArray(s.formats)); }

// --- macOS ---
const macApps = mk('mac/Applications');
const macHome = mk('mac/home/Applications');
mk('mac/Applications/PrusaSlicer.app');
mk('mac/Applications/BambuStudio.app');
mk('mac/Applications/UltiMaker Cura 5.7.app');
mk('mac/Applications/UltiMaker Cura 5.10.app');
mk('mac/home/Applications/LycheeSlicer.app');
mk('mac/Applications/CHITUBOX Pro 2.app');
let r = detect({ platform: 'darwin', roots: [macApps, macHome] });
const by = (id) => r.find(x => x.id === id);
assert.ok(by('prusaslicer').installed);
assert.ok(by('prusaslicer-sla').installed, 'SLA usa lo stesso PrusaSlicer');
assert.ok(by('bambustudio').installed);
assert.ok(by('cura').installed);
assert.ok(by('cura').path.endsWith('UltiMaker Cura 5.10.app'), 'sceglie la versione piu recente: ' + by('cura').path);
assert.ok(by('lychee').installed && by('lychee').resin);
assert.ok(by('chituboxpro').installed);
assert.ok(!by('chitubox').installed, 'CHITUBOX Basic non deve corrispondere a Pro');
assert.ok(!by('orcaslicer').installed);
assert.equal(r.filter(x => x.installed).length, 6);

// --- Windows (simulato) ---
const pf = mk('win/Program Files');
const pf86 = mk('win/Program Files (x86)');
const local = mk('win/Local/Programs');
mk('win/Program Files/Prusa3D/PrusaSlicer/prusa-slicer.exe', true);
mk('win/Program Files/UltiMaker Cura 5.8.1/UltiMaker-Cura.exe', true);
mk('win/Program Files/Creality/Creality Print 6.0/CrealityPrint.exe', true);
mk('win/Program Files (x86)/FlashForge/FlashPrint 5/FlashPrint.exe', true);
mk('win/Local/Programs/OrcaSlicer/orca-slicer.exe', true);
mk('win/Program Files/Bambu Studio/README.txt', true); // cartella senza exe -> non installato
r = detect({ platform: 'win32', roots: [pf, pf86, local] });
assert.ok(by('prusaslicer').installed);
assert.ok(by('cura').path.endsWith(path.join('UltiMaker Cura 5.8.1', 'UltiMaker-Cura.exe')));
assert.ok(by('crealityprint').installed);
assert.ok(by('flashprint').installed);
assert.ok(by('orcaslicer').installed);
assert.ok(!by('bambustudio').installed);

// case-insensitive su Windows
mk('win/Program Files/superslicer/SUPERSLICER.EXE', true);
r = detect({ platform: 'win32', roots: [pf] });
assert.ok(by('superslicer').installed, 'match case-insensitive');

// --- Linux ---
const bin = mk('linux/bin');
mk('linux/bin/prusa-slicer', true);
mk('linux/apps/OrcaSlicer_Linux_V2.3.0.AppImage', true);
r = detect({ platform: 'linux', roots: [bin, path.join(tmp, 'linux/apps')] });
assert.ok(by('prusaslicer').installed);
assert.ok(by('orcaslicer').installed);

// resolvePattern
assert.equal(resolvePattern(pf, 'Nope/*.exe'), null);

// --- personalizzati + register ---
const ctx = makeCtx();
register(ctx);
ctx.db.setSetting('customSlicers', [{ id: 'custom-1', name: 'MioSlicer', path: path.join(pf, 'Prusa3D/PrusaSlicer/prusa-slicer.exe') }]);
const list = await_(ctx.call('slicers:detect', true));
function await_(p) { return p; }
(async () => {
  const l = await list;
  const c = l.find(x => x.id === 'custom-1');
  assert.ok(c && c.custom && c.installed);
  await ctx.call('slicers:setPreferred', 'custom-1');
  const l2 = await ctx.call('slicers:detect');
  assert.ok(l2.find(x => x.id === 'custom-1').preferred);
  // apertura: uno "slicer" che e' uno script che scrive i file ricevuti
  if (process.platform !== 'win32') {
    const out = path.join(tmp, 'opened.txt');
    const script = path.join(tmp, 'fake-slicer.sh');
    fs.writeFileSync(script, `#!/bin/sh\necho "$@" > "${out}"\n`); fs.chmodSync(script, 0o755);
    ctx.db.setSetting('customSlicers', [{ id: 'custom-2', name: 'Finto', path: script }]);
    ctx.db.run("INSERT INTO items(id,path,name,ext,kind) VALUES(1,'/tmp/a b.stl','a b.stl','stl','model')");
    await ctx.call('slicers:detect', true);
    const res = await ctx.call('slicers:open', 'custom-2', [1]);
    assert.equal(res.files, 1);
    for (let i = 0; i < 50 && !fs.existsSync(out); i++) await new Promise(r2 => setTimeout(r2, 20));
    assert.equal(fs.readFileSync(out, 'utf8').trim(), '/tmp/a b.stl');
    await assert.rejects(ctx.call('slicers:open', 'inesistente', [1]));
  }
  console.log('slicers.test.js: OK');
})().catch(e => { console.error(e); process.exit(1); });
