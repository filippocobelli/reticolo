// Rilevamento degli slicer installati e apertura dei modelli.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const FDM = ['stl', '3mf', 'obj', 'step', 'stp', 'amf', 'ply'];
const RESIN = ['stl', 'obj', '3mf', 'ply'];

// Percorsi relativi alle radici di ricerca; '/' separa i segmenti, '*' e' un jolly nel segmento.
const SLICERS = [
  { id: 'prusaslicer', name: 'PrusaSlicer', resin: false, formats: [...FDM, 'gcode'],
    mac: ['PrusaSlicer.app', 'Original Prusa Drivers/PrusaSlicer.app'],
    win: ['Prusa3D/PrusaSlicer/prusa-slicer.exe', 'PrusaSlicer/prusa-slicer.exe', 'Prusa3D/PrusaSlicer*/prusa-slicer.exe'],
    linux: ['prusa-slicer', 'PrusaSlicer*.AppImage', 'com.prusa3d.PrusaSlicer'] },
  { id: 'prusaslicer-sla', name: 'PrusaSlicer (SLA)', resin: true, formats: RESIN, sameAs: 'prusaslicer' },
  { id: 'bambustudio', name: 'Bambu Studio', resin: false, formats: FDM,
    mac: ['BambuStudio.app', 'Bambu Studio.app'],
    win: ['Bambu Studio/bambu-studio.exe', 'BambuStudio/bambu-studio.exe'],
    linux: ['bambu-studio', 'Bambu_Studio*.AppImage', 'BambuStudio*.AppImage', 'com.bambulab.BambuStudio'] },
  { id: 'orcaslicer', name: 'OrcaSlicer', resin: false, formats: FDM,
    mac: ['OrcaSlicer.app'],
    win: ['OrcaSlicer/orca-slicer.exe', 'Orca Slicer/orca-slicer.exe'],
    linux: ['orca-slicer', 'OrcaSlicer*.AppImage', 'io.github.softfever.OrcaSlicer'] },
  { id: 'cura', name: 'UltiMaker Cura', resin: false, formats: ['stl', '3mf', 'obj', 'ply', 'gcode'],
    mac: ['UltiMaker Cura.app', 'Ultimaker Cura.app', 'UltiMaker-Cura.app', 'UltiMaker Cura*.app', 'Ultimaker Cura*.app'],
    win: ['UltiMaker Cura */UltiMaker-Cura.exe', 'Ultimaker Cura */UltiMaker-Cura.exe', 'Ultimaker Cura */Ultimaker-Cura.exe', 'Ultimaker Cura */Cura.exe'],
    linux: ['cura', 'UltiMaker-Cura*.AppImage', 'Ultimaker-Cura*.AppImage', 'com.ultimaker.cura'] },
  { id: 'superslicer', name: 'SuperSlicer', resin: false, formats: FDM,
    mac: ['SuperSlicer.app'],
    win: ['SuperSlicer/superslicer.exe', 'SuperSlicer*/superslicer.exe'],
    linux: ['superslicer', 'SuperSlicer*.AppImage'] },
  { id: 'crealityprint', name: 'Creality Print', resin: false, formats: FDM,
    mac: ['CrealityPrint.app', 'Creality Print.app', 'Creality Print*.app'],
    win: ['Creality/Creality Print*/CrealityPrint.exe', 'Creality Print*/CrealityPrint.exe', 'Creality/CrealityPrint*/CrealityPrint.exe'],
    linux: ['CrealityPrint*.AppImage', 'Creality_Print*.AppImage'] },
  { id: 'elegooslicer', name: 'ElegooSlicer', resin: false, formats: FDM,
    mac: ['ElegooSlicer.app', 'Elegoo Slicer.app'],
    win: ['ElegooSlicer/elegoo-slicer.exe', 'ElegooSlicer/ElegooSlicer.exe', 'ELEGOO/ElegooSlicer/elegoo-slicer.exe'],
    linux: ['ElegooSlicer*.AppImage'] },
  { id: 'anycubicnext', name: 'Anycubic Slicer Next', resin: false, formats: FDM,
    mac: ['AnycubicSlicerNext.app', 'Anycubic Slicer Next.app'],
    win: ['AnycubicSlicerNext/AnycubicSlicerNext.exe', 'Anycubic Slicer Next/AnycubicSlicerNext.exe', 'AnycubicSlicerNext/anycubicslicernext.exe'],
    linux: ['AnycubicSlicerNext*.AppImage'] },
  { id: 'qidistudio', name: 'QIDI Studio', resin: false, formats: FDM,
    mac: ['QIDIStudio.app', 'QIDI Studio.app'],
    win: ['QIDIStudio/qidi-studio.exe', 'QIDI Studio/qidi-studio.exe'],
    linux: ['QIDIStudio*.AppImage', 'QIDI_Studio*.AppImage'] },
  { id: 'snapmakerorca', name: 'Snapmaker Orca', resin: false, formats: FDM,
    mac: ['Snapmaker Orca.app', 'SnapmakerOrca.app'],
    win: ['Snapmaker Orca/snapmaker-orca.exe', 'Snapmaker Orca/Snapmaker Orca.exe'],
    linux: ['Snapmaker_Orca*.AppImage', 'SnapmakerOrca*.AppImage'] },
  { id: 'luban', name: 'Snapmaker Luban', resin: false, formats: ['stl', 'obj', '3mf', 'svg', 'dxf', 'png', 'jpg'],
    mac: ['Snapmaker Luban.app'],
    win: ['Snapmaker Luban/Snapmaker Luban.exe'],
    linux: ['snapmaker-luban', 'snapmaker-luban*.AppImage', 'Snapmaker-Luban*.AppImage'] },
  { id: 'flashprint', name: 'FlashPrint', resin: false, formats: ['stl', 'obj', '3mf', 'fpp'],
    mac: ['FlashPrint 5.app', 'FlashPrint.app', 'FlashPrint*.app'],
    win: ['FlashForge/FlashPrint 5/FlashPrint.exe', 'FlashPrint 5/FlashPrint.exe', 'FlashForge/FlashPrint/FlashPrint.exe', 'FlashPrint*/FlashPrint.exe'],
    linux: ['flashprint', 'flashprint5', 'FlashPrint*.AppImage'] },
  { id: 'ideamaker', name: 'ideaMaker', resin: false, formats: ['stl', 'obj', '3mf', 'ply', 'step', 'stp'],
    mac: ['ideaMaker.app', 'Raise3D/ideaMaker.app'],
    win: ['Raise3D/ideaMaker/ideaMaker.exe', 'ideaMaker/ideaMaker.exe'],
    linux: ['ideamaker', 'ideaMaker*.AppImage'] },
  { id: 'simplify3d', name: 'Simplify3D', resin: false, formats: ['stl', 'obj', '3mf'],
    mac: ['Simplify3D.app', 'Simplify3D*.app', 'Simplify3D*/Simplify3D.app'],
    win: ['Simplify3D-5*/simplify3d.exe', 'Simplify3D*/Simplify3D.exe', 'Simplify3D*/simplify3d.exe'],
    linux: ['Simplify3D*/Simplify3D', 'simplify3d'] },
  { id: 'kirimoto', name: 'Kiri:Moto', resin: false, formats: ['stl', 'obj', '3mf', 'svg', 'dxf'],
    mac: ['KiriMoto.app', 'Kiri Moto.app', 'Kiri-Moto.app'],
    win: ['KiriMoto/KiriMoto.exe', 'Kiri Moto/Kiri Moto.exe', 'kirimoto/KiriMoto.exe'],
    linux: ['KiriMoto*.AppImage', 'kirimoto'] },
  { id: 'lychee', name: 'Lychee Slicer', resin: true, formats: [...RESIN, 'lys'],
    mac: ['LycheeSlicer.app', 'Lychee Slicer.app', 'Lychee Slicer*.app'],
    win: ['Mango3D/LycheeSlicer/LycheeSlicer.exe', 'LycheeSlicer/LycheeSlicer.exe', 'Lychee Slicer/Lychee Slicer.exe', 'Mango3D/Lychee Slicer/Lychee Slicer.exe'],
    linux: ['LycheeSlicer*.AppImage', 'lycheeslicer'] },
  { id: 'chitubox', name: 'CHITUBOX Basic', resin: true, formats: RESIN,
    mac: ['CHITUBOX.app', 'CHITUBOX Basic.app', 'CHITUBOX_Basic.app', 'CHITUBOX_V*.app'],
    win: ['CHITUBOX Basic/CHITUBOX Basic.exe', 'CHITUBOX/CHITUBOX.exe', 'CHITUBOX_V*/CHITUBOX.exe', 'CHITUBOX Basic*/CHITUBOX Basic.exe'],
    linux: ['CHITUBOX*Basic*', 'chitubox'] },
  { id: 'chituboxpro', name: 'CHITUBOX Pro', resin: true, formats: RESIN,
    mac: ['CHITUBOX Pro.app', 'CHITUBOX_Pro.app', 'CHITUBOX Pro*.app'],
    win: ['CHITUBOX Pro/CHITUBOX Pro.exe', 'CHITUBOX Pro*/CHITUBOX Pro.exe', 'CHITUBOX_Pro*/CHITUBOX Pro.exe'],
    linux: ['CHITUBOX*Pro*'] },
  { id: 'tango', name: 'VoxelDance Tango', resin: true, formats: RESIN,
    mac: ['VoxelDance Tango.app', 'VoxelDanceTango.app', 'VoxelDance Tango*.app'],
    win: ['VoxelDance Tango/VoxelDanceTango.exe', 'VoxelDance Tango*/VoxelDanceTango.exe', 'VoxelDance/Tango/VoxelDanceTango.exe', 'VoxelDance Tango*/VoxelDance Tango.exe'],
    linux: [] },
  { id: 'photonworkshop', name: 'Anycubic Photon Workshop', resin: true, formats: RESIN,
    mac: ['Photon Workshop.app', 'ANYCUBIC Photon Workshop.app', 'AnycubicPhotonWorkshop.app'],
    win: ['ANYCUBIC Photon Workshop/AnycubicPhotonWorkshop.exe', 'Photon Workshop/PhotonWorkshop.exe', 'ANYCUBIC/Photon Workshop/PhotonWorkshop.exe', 'Photon Workshop*/Photon Workshop.exe'],
    linux: [] },
  { id: 'halotbox', name: 'HALOT BOX', resin: true, formats: RESIN,
    mac: ['HALOT BOX.app', 'HALOT_BOX.app', 'HALOTBOX.app'],
    win: ['Creality/HALOT BOX/HALOT BOX.exe', 'HALOT BOX/HALOT BOX.exe', 'Creality/HALOT_BOX/HALOT_BOX.exe'],
    linux: [] },
  { id: 'satellite', name: 'ELEGOO SatelLite', resin: true, formats: RESIN,
    mac: ['ELEGOO SatelLite.app', 'SatelLite.app'],
    win: ['ELEGOO SatelLite/SatelLite.exe', 'ELEGOO/SatelLite/SatelLite.exe', 'SatelLite/SatelLite.exe'],
    linux: [] },
];

function defaultRoots(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') return ['/Applications', path.join(home, 'Applications'), '/Applications/Utilities'];
  if (platform === 'win32') {
    const r = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432,
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.LOCALAPPDATA,
      'C:\\Program Files', 'C:\\Program Files (x86)'];
    return [...new Set(r.filter(Boolean))];
  }
  const pathDirs = (env.PATH || '').split(':').filter(Boolean);
  return [...new Set([...pathDirs, '/usr/bin', '/usr/local/bin', '/opt', path.join(home, '.local/bin'),
    path.join(home, 'Applications'), path.join(home, 'AppImages'), path.join(home, 'Downloads'),
    '/var/lib/flatpak/exports/bin', path.join(home, '.local/share/flatpak/exports/bin')])];
}

function segRegex(seg, ci) {
  const esc = seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, ci ? 'i' : '');
}

function safeReaddir(dir) { try { return fs.readdirSync(dir); } catch { return []; } }

// Risolve un percorso con jolly sotto una radice. Restituisce la corrispondenza "piu' recente" (ordine alfabetico decrescente).
function resolvePattern(root, rel, ci = true) {
  const segs = rel.split('/').filter(Boolean);
  let cur = [root];
  for (const seg of segs) {
    const next = [];
    for (const base of cur) {
      if (!seg.includes('*') && !seg.includes('?')) {
        const p = path.join(base, seg);
        if (fs.existsSync(p)) next.push(p);
        else if (ci) { // match case-insensitive per file system che lo sono solo parzialmente
          const rx = segRegex(seg, true);
          for (const n of safeReaddir(base)) if (rx.test(n)) next.push(path.join(base, n));
        }
      } else {
        const rx = segRegex(seg, ci);
        const names = safeReaddir(base).filter(n => rx.test(n)).sort(naturalDesc);
        for (const n of names) next.push(path.join(base, n));
      }
    }
    if (!next.length) return null;
    cur = [...new Set(next)];
  }
  return cur[0] || null;
}

function naturalDesc(a, b) { return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }); }

/**
 * Rileva gli slicer.
 * @param {object} o  { platform, roots, env, home, custom }
 */
function detect(o = {}) {
  const platform = o.platform || process.platform;
  const roots = o.roots || defaultRoots(platform, o.env || process.env, o.home || os.homedir());
  const key = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux';
  const ci = platform !== 'linux';
  const found = {};
  const out = [];
  for (const s of SLICERS) {
    if (s.sameAs) continue;
    let p = null;
    for (const rel of s[key] || []) {
      for (const root of roots) {
        p = resolvePattern(root, rel, ci);
        if (p) break;
      }
      if (p) break;
    }
    found[s.id] = p;
  }
  for (const s of SLICERS) {
    const p = s.sameAs ? found[s.sameAs] : found[s.id];
    out.push({ id: s.id, name: s.name, resin: s.resin, formats: s.formats, path: p || null, installed: !!p, custom: false });
  }
  for (const c of o.custom || []) {
    out.push({ id: c.id, name: c.name, resin: !!c.resin, formats: c.formats || FDM, path: c.path, installed: fs.existsSync(c.path), custom: true });
  }
  return out;
}

function launch(appPath, files, platform = process.platform) {
  return new Promise((resolve, reject) => {
    let cmd, args;
    if (platform === 'darwin' && appPath.endsWith('.app')) { cmd = 'open'; args = ['-a', appPath, ...files]; }
    else if (platform === 'linux' && !appPath.includes('/') ) { cmd = 'flatpak'; args = ['run', appPath, ...files]; }
    else { cmd = appPath; args = files; }
    let child;
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false, cwd: path.dirname(files[0] || os.homedir()) });
    } catch (e) { return reject(e); }
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(true); });
  });
}

function register(ctx) {
  let cache = null;
  const getCustom = () => ctx.db.getSetting('customSlicers', []);
  const list = (force) => {
    if (!cache || force) cache = detect({ custom: getCustom() });
    const pref = ctx.db.getSetting('preferredSlicer', null);
    return cache.map(s => ({ ...s, preferred: s.id === pref }));
  };

  ctx.handle('slicers:detect', (force) => list(!!force));

  ctx.handle('slicers:setPreferred', (id) => { ctx.db.setSetting('preferredSlicer', id || null); return true; });

  ctx.handle('slicers:addCustom', async () => {
    const { dialog } = require('electron');
    const isMac = process.platform === 'darwin';
    const r = await dialog.showOpenDialog(ctx.getMainWindow(), {
      title: 'Scegli lo slicer',
      defaultPath: isMac ? '/Applications' : (process.env.ProgramFiles || undefined),
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Programmi', extensions: ['exe', 'bat', 'cmd'] }] : isMac ? [{ name: 'App', extensions: ['app'] }] : [],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    const name = path.basename(p).replace(/\.(app|exe|bat|cmd|AppImage)$/i, '');
    const custom = getCustom().filter(c => c.path !== p);
    const entry = { id: `custom-${Date.now()}`, name, path: p, resin: false };
    custom.push(entry);
    ctx.db.setSetting('customSlicers', custom);
    cache = null;
    return entry;
  });

  ctx.handle('slicers:removeCustom', (id) => {
    ctx.db.setSetting('customSlicers', getCustom().filter(c => c.id !== id));
    cache = null; return true;
  });

  ctx.handle('slicers:open', async (slicerId, itemIds) => {
    const all = list(false);
    let s = slicerId ? all.find(x => x.id === slicerId) : (all.find(x => x.preferred && x.installed) || all.find(x => x.installed));
    if (!s || !s.installed) {
      const fresh = list(true);
      s = slicerId ? fresh.find(x => x.id === slicerId) : fresh.find(x => x.installed);
    }
    if (!s || !s.installed) throw new Error('Slicer non trovato: installalo o aggiungilo nelle impostazioni');
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    const files = [];
    for (const id of ids) {
      const it = ctx.db.get('SELECT * FROM items WHERE id=?', id);
      if (it) files.push(await ctx.materialize(it));
    }
    if (!files.length) throw new Error('Nessun file da aprire');
    await launch(s.path, files);
    return { slicer: s.name, files: files.length };
  });
}

module.exports = { register, SLICERS, detect, resolvePattern, defaultRoots };
