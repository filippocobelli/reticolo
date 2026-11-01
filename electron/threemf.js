// Lettura, conversione e scrittura di file 3MF (Bambu Studio, OrcaSlicer, PrusaSlicer, Cura, generico)
// e scrittura STL binario. Le funzioni pure (parse3mf, write3mf, writeStl, convertModel) non dipendono da Electron.
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync, zipSync, strToU8, strFromU8 } = require('fflate');

// ---------------------------------------------------------------------------
// XML minimale (veloce, tollerante)
// ---------------------------------------------------------------------------
const TAG_RE = /<(\/?)([A-Za-z_][\w\-.]*:)?([A-Za-z_][\w\-.]*)((?:\s[^>]*?)?)(\/?)>/g;
const ATTR_RE = /([\w\-.:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function decodeEnt(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const l = e.toLowerCase();
    if (l === 'amp') return '&'; if (l === 'lt') return '<'; if (l === 'gt') return '>';
    if (l === 'quot') return '"'; if (l === 'apos') return "'";
    if (l[0] === '#') return String.fromCodePoint(l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
    return m;
  });
}
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function parseAttrs(s) {
  const o = {};
  if (!s) return o;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(s))) o[m[1]] = decodeEnt(m[2] !== undefined ? m[2] : m[3]);
  return o;
}
// Itera i tag: cb(closing, name, attrs (lazy string), selfClosing, matchEnd, text)
function eachTag(text, cb) {
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text))) {
    if (cb(m[1] === '/', m[3], m[4], m[5] === '/' || /\/\s*$/.test(m[4]), TAG_RE.lastIndex) === false) break;
  }
}
function textUntilClose(text, from) {
  const i = text.indexOf('<', from);
  return decodeEnt(text.slice(from, i < 0 ? text.length : i)).trim();
}

// ---------------------------------------------------------------------------
// Matrici 3MF (3x4, vettori riga): x' = x*m00 + y*m10 + z*m20 + m30
// ---------------------------------------------------------------------------
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function parseMatrix(s) {
  if (!s) return IDENT.slice();
  const v = s.trim().split(/\s+/).map(Number);
  return v.length === 12 && v.every(Number.isFinite) ? v : IDENT.slice();
}
// prima A, poi B
function mul(A, B) {
  const r = new Array(12);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  }
  for (let j = 0; j < 3; j++) r[9 + j] = A[9] * B[j] + A[10] * B[3 + j] + A[11] * B[6 + j] + B[9 + j];
  return r;
}
function det3(m) {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}
function matStr(m) { return m.map(fmt).join(' '); }
function fmt(n) { const r = Math.round(n * 1e6) / 1e6; return Object.is(r, -0) ? '0' : String(r); }

// ---------------------------------------------------------------------------
// Pittura per triangolo (codifica TriangleSelector di PrusaSlicer, uguale in Bambu/Orca)
// Restituisce lo stato dominante (0 = non dipinto, 1..n = estrusore)
// ---------------------------------------------------------------------------
function paintDominant(str) {
  if (!str) return 0;
  let pos = str.length - 1;
  const next = () => (pos >= 0 ? parseInt(str[pos--], 16) || 0 : 0);
  const acc = new Map();
  const rec = (w, depth) => {
    if (depth > 30 || pos < -1) return;
    const code = next();
    const split = code & 3;
    if (split) {
      const n = split + 1;
      for (let i = 0; i < n; i++) rec(w / n, depth + 1);
    } else {
      let st = code >> 2;
      if (st === 3) st = next() + 3;
      acc.set(st, (acc.get(st) || 0) + w);
    }
  };
  rec(1, 0);
  let best = 0, bw = -1;
  for (const [s, w] of acc) if (w > bw) { bw = w; best = s; }
  return best;
}

// ---------------------------------------------------------------------------
// Parsing di un file .model
// ---------------------------------------------------------------------------
const UNIT = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

function normColor(c) {
  if (!c) return null;
  c = c.trim();
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)) return c.slice(0, 7).toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toUpperCase();
  return null;
}

function parseModelFile(text) {
  const out = { unitScale: 1, metadata: {}, basematerials: new Map(), colorgroups: new Map(), objects: new Map(), build: [], namespaces: {} };
  let obj = null, mats = null, group = null, inBuild = false;
  eachTag(text, (closing, name, rawAttrs, self, end) => {
    if (closing) {
      if (name === 'object') obj = null;
      else if (name === 'basematerials') mats = null;
      else if (name === 'colorgroup') group = null;
      else if (name === 'build') inBuild = false;
      return;
    }
    switch (name) {
      case 'vertex': {
        if (!obj) return;
        const a = parseAttrs(rawAttrs);
        obj.vertices.push(+a.x || 0, +a.y || 0, +a.z || 0);
        return;
      }
      case 'triangle': {
        if (!obj) return;
        const a = parseAttrs(rawAttrs);
        const t = obj.triangles.length / 3;
        obj.triangles.push(+a.v1, +a.v2, +a.v3);
        if (a.pid !== undefined || a.p1 !== undefined) (obj.triProps ||= [])[t] = [a.pid !== undefined ? +a.pid : -1, a.p1 !== undefined ? +a.p1 : -1];
        const pc = a.paint_color ?? a['slic3rpe:mmu_segmentation'];
        const ps = a.paint_supports ?? a['slic3rpe:custom_supports'];
        const pz = a.paint_seam ?? a['slic3rpe:custom_seam'];
        if (pc || ps || pz) (obj.paint ||= [])[t] = { color: pc || null, supports: ps || null, seam: pz || null };
        return;
      }
      case 'model': {
        const a = parseAttrs(rawAttrs);
        out.unitScale = UNIT[a.unit] || 1;
        for (const k of Object.keys(a)) if (k.startsWith('xmlns')) out.namespaces[k] = a[k];
        return;
      }
      case 'metadata': {
        const a = parseAttrs(rawAttrs);
        if (a.name && !obj && !self) out.metadata[a.name] = textUntilClose(text, end);
        else if (a.name && obj && !self) obj.metadata[a.name] = textUntilClose(text, end);
        return;
      }
      case 'basematerials': {
        const a = parseAttrs(rawAttrs);
        mats = []; out.basematerials.set(+a.id, mats);
        return;
      }
      case 'base': {
        if (!mats) return;
        const a = parseAttrs(rawAttrs);
        mats.push({ name: a.name || '', color: normColor(a.displaycolor) || '#C8C8C8' });
        return;
      }
      case 'colorgroup': {
        const a = parseAttrs(rawAttrs);
        group = []; out.colorgroups.set(+a.id, group);
        return;
      }
      case 'color': {
        if (!group) return;
        const a = parseAttrs(rawAttrs);
        group.push(normColor(a.color) || '#C8C8C8');
        return;
      }
      case 'object': {
        const a = parseAttrs(rawAttrs);
        obj = { id: +a.id, name: a.name || '', type: a.type || 'model', pid: a.pid !== undefined ? +a.pid : -1, pindex: a.pindex !== undefined ? +a.pindex : 0,
          vertices: [], triangles: [], components: [], metadata: {} };
        out.objects.set(obj.id, obj);
        if (self) obj = null;
        return;
      }
      case 'component': {
        if (!obj) return;
        const a = parseAttrs(rawAttrs);
        obj.components.push({ objectid: +a.objectid, path: pathAttr(a), transform: parseMatrix(a.transform) });
        return;
      }
      case 'build': inBuild = true; return;
      case 'item': {
        if (!inBuild) return;
        const a = parseAttrs(rawAttrs);
        out.build.push({ objectid: +a.objectid, path: pathAttr(a), transform: parseMatrix(a.transform), printable: a['p:printable'] !== '0' });
        return;
      }
      default:
    }
  });
  return out;
}
function pathAttr(a) {
  for (const k of Object.keys(a)) if (k === 'path' || k.endsWith(':path')) return a[k].replace(/^\//, '');
  return null;
}

// ---------------------------------------------------------------------------
// Config dei vari slicer
// ---------------------------------------------------------------------------
function parseBambuModelSettings(text) {
  const objects = new Map(); const plates = [];
  let obj = null, part = null, plate = null, inst = null, inAssemble = false;
  eachTag(text, (closing, name, raw, self) => {
    if (closing) {
      if (name === 'object') obj = null;
      else if (name === 'part') part = null;
      else if (name === 'plate') { plates.push(plate); plate = null; }
      else if (name === 'model_instance') { if (plate && inst) plate.instances.push(inst); inst = null; }
      else if (name === 'assemble') inAssemble = false;
      return;
    }
    const a = parseAttrs(raw);
    if (name === 'assemble') { inAssemble = !self; return; }
    if (inAssemble) return;
    if (name === 'object') { obj = { id: +a.id, meta: {}, parts: new Map() }; objects.set(obj.id, obj); if (self) obj = null; }
    else if (name === 'part' && obj) { part = { id: +a.id, subtype: a.subtype || 'normal_part', meta: {} }; obj.parts.set(part.id, part); if (self) part = null; }
    else if (name === 'plate') { plate = { meta: {}, instances: [] }; }
    else if (name === 'model_instance' && plate) { inst = {}; }
    else if (name === 'metadata') {
      const k = a.key, v = a.value;
      if (inst) inst[k] = v;
      else if (plate) plate.meta[k] = v;
      else if (part) part.meta[k] = v;
      else if (obj) obj.meta[k] = v;
    }
  });
  return { objects, plates };
}

function parsePrusaModelConfig(text) {
  const objects = new Map();
  let obj = null, vol = null;
  eachTag(text, (closing, name, raw, self) => {
    if (closing) {
      if (name === 'object') obj = null;
      else if (name === 'volume') vol = null;
      return;
    }
    const a = parseAttrs(raw);
    if (name === 'object') { obj = { id: +a.id, meta: {}, volumes: [] }; objects.set(obj.id, obj); if (self) obj = null; }
    else if (name === 'volume' && obj) { vol = { first: +a.firstid, last: +a.lastid, meta: {} }; obj.volumes.push(vol); if (self) vol = null; }
    else if (name === 'metadata') {
      if (vol) vol.meta[a.key] = a.value;
      else if (obj) obj.meta[a.key] = a.value;
    }
  });
  return { objects };
}

function parsePrusaIni(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^;\s*([\w]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
function splitColors(v) {
  if (!v) return [];
  return v.split(';').map(s => normColor(s.replace(/"/g, ''))).filter(Boolean);
}

const PRUSA_TYPE = { ModelPart: 'part', NegativeVolume: 'negative', ParameterModifier: 'modifier', SupportBlocker: 'support_blocker', SupportEnforcer: 'support_enforcer' };
const BAMBU_TYPE = { normal_part: 'part', negative_part: 'negative', modifier_part: 'modifier', support_blocker: 'support_blocker', support_enforcer: 'support_enforcer' };
const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const TYPE_PRUSA = invert(PRUSA_TYPE), TYPE_BAMBU = invert(BAMBU_TYPE);

// ---------------------------------------------------------------------------
// parse3mf: modello normalizzato
// ---------------------------------------------------------------------------
/**
 * @returns {{
 *  flavor:string, application:string, title:string, colors:string[], hasPaint:boolean,
 *  objects:{id:number,name:string,extruder:number,plate:number,sourceId:number,
 *           volumes:{name:string,type:string,extruder:number,partId:number,positions:Float32Array,
 *                    paint:(null|{color,supports,seam}[]),triColor:(null|string[]),baseColor:(string|null)}[]}[],
 *  plates:{index:number,name:string,objectIds:number[],thumbnail:(string|null)}[],
 *  files:Object, raw:{projectSettings:(string|null)}
 * }}
 */
function parse3mf(buffer) {
  const files = unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
  const names = Object.keys(files);
  const find = (p) => { const lp = p.toLowerCase(); const k = names.find(n => n.replace(/^\//, '').toLowerCase() === lp); return k ? files[k] : null; };

  // modello radice da _rels/.rels
  let rootPath = '3D/3dmodel.model';
  const rels = find('_rels/.rels');
  if (rels) {
    const t = strFromU8(rels);
    const m = /Target="([^"]+\.model)"/i.exec(t);
    if (m) rootPath = m[1].replace(/^\//, '');
  }
  if (!find(rootPath)) {
    const alt = names.find(n => n.toLowerCase().endsWith('.model'));
    if (!alt) throw new Error('File 3MF non valido: modello non trovato');
    rootPath = alt.replace(/^\//, '');
  }
  const cache = new Map();
  const getFile = (p) => {
    const key = (p || rootPath).replace(/^\//, '');
    if (!cache.has(key)) {
      const b = find(key);
      cache.set(key, b ? parseModelFile(strFromU8(b)) : null);
    }
    return cache.get(key);
  };
  const root = getFile(rootPath);
  const app = root.metadata.Application || root.metadata.application || '';
  const scale = root.unitScale;

  const bambuCfg = find('Metadata/model_settings.config');
  const prusaCfg = find('Metadata/Slic3r_PE_model.config');
  let flavor = 'generic';
  if (/orca/i.test(app)) flavor = 'orca';
  else if (/bambu/i.test(app)) flavor = 'bambu';
  else if (/prusa|slic3r|superslicer/i.test(app) || prusaCfg) flavor = 'prusa';
  else if (bambuCfg) flavor = 'bambu';
  else if (/cura/i.test(app) || names.some(n => /^\/?cura\//i.test(n)) || Object.values(root.namespaces).some(v => /ultimaker/i.test(v))) flavor = 'cura';

  const colorOf = (file, pid, idx) => {
    if (pid < 0 || !file) return null;
    const bm = file.basematerials.get(pid);
    if (bm && bm[idx]) return bm[idx].color;
    const cg = file.colorgroups.get(pid);
    if (cg && cg[idx]) return cg[idx];
    return null;
  };

  // appiattisce un oggetto (e i suoi componenti) in volumi in coordinate mondo
  const flatten = (filePath, objId, matrix, outVols, depth = 0) => {
    const file = getFile(filePath);
    if (!file || depth > 16) return;
    const o = file.objects.get(objId);
    if (!o) return;
    if (o.triangles.length) {
      const V = o.vertices, T = o.triangles;
      const n = T.length / 3;
      const pos = new Float32Array(n * 9);
      const flip = det3(matrix) < 0;
      const m = matrix;
      for (let t = 0; t < n; t++) {
        const ids = flip ? [T[t * 3], T[t * 3 + 2], T[t * 3 + 1]] : [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]];
        for (let k = 0; k < 3; k++) {
          const vi = ids[k] * 3;
          const x = V[vi], y = V[vi + 1], z = V[vi + 2];
          const o9 = t * 9 + k * 3;
          pos[o9] = (x * m[0] + y * m[3] + z * m[6] + m[9]) * scale;
          pos[o9 + 1] = (x * m[1] + y * m[4] + z * m[7] + m[10]) * scale;
          pos[o9 + 2] = (x * m[2] + y * m[5] + z * m[8] + m[11]) * scale;
        }
      }
      const baseColor = colorOf(file, o.pid, o.pindex);
      let triColor = null;
      if (o.triProps) {
        triColor = new Array(n).fill(null);
        for (let t = 0; t < n; t++) {
          const p = o.triProps[t];
          if (p) triColor[t] = colorOf(file, p[0] >= 0 ? p[0] : o.pid, p[1] >= 0 ? p[1] : o.pindex);
        }
      }
      outVols.push({ name: o.name, type: o.type === 'support' ? 'support_blocker' : 'part', extruder: 0, partId: o.id, filePath: filePath || rootPath,
        positions: pos, paint: o.paint ? Array.from({ length: n }, (_, i) => o.paint[i] || null) : null, triColor, baseColor });
    }
    for (const c of o.components) flatten(c.path || filePath, c.objectid, mul(c.transform, matrix), outVols, depth + 1);
  };

  const objects = [];
  const instCount = new Map();
  let nextId = 1;
  for (const item of root.build) {
    const o = root.objects.get(item.objectid) || (item.path ? getFile(item.path)?.objects.get(item.objectid) : null);
    const vols = [];
    flatten(item.path || rootPath, item.objectid, item.transform, vols);
    if (!vols.length) continue;
    const inst = instCount.get(item.objectid) || 0; instCount.set(item.objectid, inst + 1);
    objects.push({ id: nextId++, sourceId: item.objectid, instance: inst, name: (o && o.name) || vols[0].name || `Oggetto ${nextId - 1}`, extruder: 0, plate: 1, volumes: vols, printable: item.printable });
  }

  // colori filamento
  let colors = [];
  let projectSettings = null;
  const ps = find('Metadata/project_settings.config');
  if (ps) {
    projectSettings = strFromU8(ps);
    try { const j = JSON.parse(projectSettings); colors = (j.filament_colour || []).map(normColor).filter(Boolean); } catch { /* ignora */ }
  }
  const pini = find('Metadata/Slic3r_PE.config');
  if (pini && !colors.length) {
    const ini = parsePrusaIni(strFromU8(pini));
    const ex = splitColors(ini.extruder_colour), fi = splitColors(ini.filament_colour);
    const n = Math.max(ex.length, fi.length);
    for (let i = 0; i < n; i++) colors.push(ex[i] || fi[i] || '#C8C8C8');
  }

  // piatti ed estrusori
  let plates = [];
  if (bambuCfg) {
    const cfg = parseBambuModelSettings(strFromU8(bambuCfg));
    for (const obj of objects) {
      const oc = cfg.objects.get(obj.sourceId);
      if (!oc) continue;
      if (oc.meta.name) obj.name = oc.meta.name;
      obj.extruder = +oc.meta.extruder || 0;
      for (const v of obj.volumes) {
        const pc = oc.parts.get(v.partId);
        if (!pc) continue;
        if (pc.meta.name) v.name = pc.meta.name;
        v.extruder = +pc.meta.extruder || 0;
        v.type = BAMBU_TYPE[pc.subtype] || 'part';
      }
    }
    cfg.plates.forEach((p, i) => {
      const index = +p.meta.plater_id || i + 1;
      const ids = [];
      for (const inst of p.instances) {
        const o = objects.find(x => x.sourceId === +inst.object_id && x.instance === (+inst.instance_id || 0));
        if (o) { o.plate = index; ids.push(o.id); }
      }
      let thumb = p.meta.thumbnail_file || `Metadata/plate_${index}.png`;
      if (!find(thumb)) thumb = null;
      plates.push({ index, name: p.meta.plater_name || '', objectIds: ids, thumbnail: thumb });
    });
    // oggetti non assegnati -> piatto 1
    const assigned = new Set(plates.flatMap(p => p.objectIds));
    const orphan = objects.filter(o => !assigned.has(o.id));
    if (orphan.length) {
      if (!plates.length) plates.push({ index: 1, name: '', objectIds: [], thumbnail: find('Metadata/plate_1.png') ? 'Metadata/plate_1.png' : null });
      for (const o of orphan) { o.plate = plates[0].index; plates[0].objectIds.push(o.id); }
    }
  } else if (prusaCfg) {
    const cfg = parsePrusaModelConfig(strFromU8(prusaCfg));
    for (const obj of objects) {
      const oc = cfg.objects.get(obj.sourceId);
      if (!oc) continue;
      if (oc.meta.name) obj.name = oc.meta.name;
      obj.extruder = +oc.meta.extruder || 0;
      if (oc.volumes.length && obj.volumes.length === 1) {
        const src = obj.volumes[0];
        const nv = [];
        for (const vc of oc.volumes) {
          const a = Math.max(0, vc.first), b = Math.min(src.positions.length / 9 - 1, vc.last);
          if (b < a) continue;
          nv.push({ ...src, name: vc.meta.name || src.name, extruder: +vc.meta.extruder || 0, type: PRUSA_TYPE[vc.meta.volume_type] || 'part',
            positions: src.positions.slice(a * 9, (b + 1) * 9), paint: src.paint ? src.paint.slice(a, b + 1) : null, triColor: src.triColor ? src.triColor.slice(a, b + 1) : null });
        }
        if (nv.length) obj.volumes = nv;
      }
    }
  }
  if (!plates.length) {
    const t = find('Metadata/thumbnail.png') ? 'Metadata/thumbnail.png' : null;
    plates = [{ index: 1, name: '', objectIds: objects.map(o => o.id), thumbnail: t }];
  }

  // colori di ripiego dai materiali base
  if (!colors.length) {
    const seen = [];
    for (const o of objects) for (const v of o.volumes) {
      if (v.baseColor && !seen.includes(v.baseColor)) seen.push(v.baseColor);
    }
    if (seen.length > 1) {
      colors = seen;
      for (const o of objects) for (const v of o.volumes) if (v.baseColor && !v.extruder) v.extruder = seen.indexOf(v.baseColor) + 1;
    }
  }

  const hasPaint = objects.some(o => o.volumes.some(v => v.paint && v.paint.some(p => p && p.color)));
  return { flavor, application: app, title: root.metadata.Title || '', colors, hasPaint, objects, plates, files, raw: { projectSettings } };
}

// ---------------------------------------------------------------------------
// Utilità geometriche
// ---------------------------------------------------------------------------
function bboxOf(arrays) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of arrays) for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) { const v = p[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  }
  if (mn[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min: mn, max: mx };
}
function effectiveExtruder(obj, vol) { return vol.extruder || obj.extruder || 1; }
function volColor(model, obj, vol) {
  const e = effectiveExtruder(obj, vol);
  return model.colors[e - 1] || vol.baseColor || '#C8C8C8';
}
function hexToRgb(h) { const n = parseInt((h || '#C8C8C8').slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }

// indicizza un array di triangoli espansi
function indexMesh(positions, offset = [0, 0, 0]) {
  const map = new Map();
  const verts = [];
  const n = positions.length / 9;
  const tris = new Uint32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const x = positions[i * 3] - offset[0], y = positions[i * 3 + 1] - offset[1], z = positions[i * 3 + 2] - offset[2];
    const key = `${fmt(x)} ${fmt(y)} ${fmt(z)}`;
    let id = map.get(key);
    if (id === undefined) { id = verts.length / 3; map.set(key, id); verts.push(x, y, z); }
    tris[i] = id;
  }
  return { verts, tris };
}

function translateModel(model, dx, dy, dz) {
  for (const o of model.objects) for (const v of o.volumes) {
    const p = v.positions = new Float32Array(v.positions);
    for (let i = 0; i < p.length; i += 3) { p[i] += dx; p[i + 1] += dy; p[i + 2] += dz; }
  }
}

// ---------------------------------------------------------------------------
// Scrittura
// ---------------------------------------------------------------------------
const NS_CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const NS_MAT = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02';
const NS_PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const NS_SLIC3R = 'http://schemas.slic3r.org/3mf/2017/06';
const NS_BAMBU = 'http://schemas.bambulab.com/package/2021';

function contentTypes(extra = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
    ` <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
    ` <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n` +
    ` <Default Extension="png" ContentType="image/png"/>\n` +
    ` <Default Extension="config" ContentType="application/xml"/>\n${extra}</Types>`;
}
function rootRels(hasThumb) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    ` <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n` +
    (hasThumb ? ` <Relationship Target="/Metadata/thumbnail.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>\n` : '') +
    `</Relationships>`;
}

function meshXml(parts, offset, triAttr) {
  // parts: [{positions, attrs: (t)=>string}]
  const vs = [], ts = [];
  let base = 0;
  for (const part of parts) {
    const { verts, tris } = indexMesh(part.positions, offset);
    for (let i = 0; i < verts.length; i += 3) vs.push(`<vertex x="${fmt(verts[i])}" y="${fmt(verts[i + 1])}" z="${fmt(verts[i + 2])}"/>`);
    const n = tris.length / 3;
    for (let t = 0; t < n; t++) {
      const extra = triAttr ? triAttr(part, t) : '';
      ts.push(`<triangle v1="${tris[t * 3] + base}" v2="${tris[t * 3 + 1] + base}" v3="${tris[t * 3 + 2] + base}"${extra}/>`);
    }
    part.triCount = n;
    base += verts.length / 3;
  }
  return `<mesh><vertices>\n${vs.join('\n')}\n</vertices><triangles>\n${ts.join('\n')}\n</triangles></mesh>`;
}

function objectCenter(obj, onlyParts = false) {
  const b = bboxOf(obj.volumes.filter(v => !onlyParts || v.type === 'part').map(v => v.positions));
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

function paletteFor(model) {
  const pal = [];
  const add = (c) => { const i = pal.indexOf(c); if (i >= 0) return i; pal.push(c); return pal.length - 1; };
  return { pal, add };
}

/**
 * Scrive un 3MF.
 * @param model modello normalizzato (vedi parse3mf)
 * @param target 'generic' | 'prusa' | 'bambu' | 'orca' | 'export'
 * @param opts { thumbnail?:Uint8Array, plateThumbs?:{[index]:Uint8Array}, projectSettings?:string, includeColorConfig?:boolean }
 * @returns {Uint8Array}
 */
function write3mf(model, target = 'generic', opts = {}) {
  const out = {};
  const thumb = opts.thumbnail || null;
  if (target === 'bambu' || target === 'orca') writeBambu(model, target, opts, out);
  else if (target === 'prusa') writePrusa(model, opts, out);
  else writeGeneric(model, target === 'export', out);
  if (thumb && !out['Metadata/thumbnail.png']) out['Metadata/thumbnail.png'] = thumb;
  out['[Content_Types].xml'] = strToU8(contentTypes());
  out['_rels/.rels'] = strToU8(rootRels(!!out['Metadata/thumbnail.png']));
  return zipSync(out, { level: 6 });
}

function colorTriAttr(model, mode) {
  // mode: 'generic' -> pid/p1; 'prusa' -> slic3rpe:*; 'bambu' -> paint_*
  return (part, t) => {
    let s = '';
    const p = part.vol.paint && part.vol.paint[t];
    if (mode === 'generic') {
      let c = part.color;
      if (p && p.color) { const st = paintDominant(p.color); if (st > 0) c = model.colors[st - 1] || c; }
      else if (part.vol.triColor && part.vol.triColor[t]) c = part.vol.triColor[t];
      const idx = part.palette.add(c);
      if (idx !== part.colorIdx) s += ` pid="1" p1="${idx}"`;
    } else if (p) {
      if (mode === 'prusa') {
        if (p.color) s += ` slic3rpe:mmu_segmentation="${esc(p.color)}"`;
        if (p.supports) s += ` slic3rpe:custom_supports="${esc(p.supports)}"`;
        if (p.seam) s += ` slic3rpe:custom_seam="${esc(p.seam)}"`;
      } else {
        if (p.color) s += ` paint_color="${esc(p.color)}"`;
        if (p.supports) s += ` paint_supports="${esc(p.supports)}"`;
        if (p.seam) s += ` paint_seam="${esc(p.seam)}"`;
      }
    }
    return s;
  };
}

function writeGeneric(model, withSlicerHints, out) {
  const { pal, add } = paletteFor(model);
  const objs = [], items = [], prusaObjs = [], bambuObjs = [];
  let id = 2;
  for (const obj of model.objects) {
    const vols = obj.volumes.filter(v => v.type === 'part');
    if (!vols.length) continue;
    const c = objectCenter({ volumes: vols });
    const parts = vols.map(v => { const color = volColor(model, obj, v); return { positions: v.positions, vol: v, color, colorIdx: add(color), palette: { add } }; });
    const objColorIdx = parts[0].colorIdx;
    parts.forEach(p => { p.colorIdx = objColorIdx; });
    const mesh = meshXml(parts, c, colorTriAttr(model, 'generic'));
    objs.push(`<object id="${id}" name="${esc(obj.name)}" type="model" pid="1" pindex="${objColorIdx}">\n${mesh}\n</object>`);
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${fmt(c[0])} ${fmt(c[1])} ${fmt(c[2])}" printable="1"/>`);
    if (withSlicerHints) {
      let first = 0;
      const volsXml = parts.map(p => {
        const x = `  <volume firstid="${first}" lastid="${first + p.triCount - 1}">\n   <metadata type="volume" key="name" value="${esc(p.vol.name || obj.name)}"/>\n   <metadata type="volume" key="extruder" value="${effectiveExtruder(obj, p.vol)}"/>\n   <metadata type="volume" key="volume_type" value="ModelPart"/>\n  </volume>`;
        first += p.triCount; return x;
      }).join('\n');
      prusaObjs.push(` <object id="${id}" instances_count="1">\n  <metadata type="object" key="name" value="${esc(obj.name)}"/>\n  <metadata type="object" key="extruder" value="${effectiveExtruder(obj, vols[0])}"/>\n${volsXml}\n </object>`);
      bambuObjs.push(` <object id="${id}">\n  <metadata key="name" value="${esc(obj.name)}"/>\n  <metadata key="extruder" value="${effectiveExtruder(obj, vols[0])}"/>\n </object>`);
    }
    id++;
  }
  const mats = `<basematerials id="1">\n${pal.map((c, i) => `<base name="Colore ${i + 1}" displaycolor="${c}FF"/>`).join('\n')}\n</basematerials>`;
  const ns = withSlicerHints ? ` xmlns:slic3rpe="${NS_SLIC3R}"` : '';
  const meta = `<metadata name="Application">Reticolo</metadata>\n` + (withSlicerHints ? `<metadata name="slic3rpe:Version3mf">1</metadata>\n` : '') +
    (model.title ? `<metadata name="Title">${esc(model.title)}</metadata>\n` : '');
  out['3D/3dmodel.model'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}" xmlns:m="${NS_MAT}"${ns}>\n${meta}<resources>\n${mats}\n${objs.join('\n')}\n</resources>\n<build>\n${items.join('\n')}\n</build>\n</model>`);
  if (withSlicerHints) {
    out['Metadata/Slic3r_PE_model.config'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${prusaObjs.join('\n')}\n</config>\n`);
    out['Metadata/model_settings.config'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${bambuObjs.join('\n')}\n</config>\n`);
  }
}

function writePrusa(model, opts, out) {
  const objs = [], items = [], cfg = [];
  let id = 1;
  for (const obj of model.objects) {
    if (!obj.volumes.length) continue;
    const c = objectCenter(obj, true);
    const parts = obj.volumes.map(v => ({ positions: v.positions, vol: v }));
    const mesh = meshXml(parts, c, colorTriAttr(model, 'prusa'));
    objs.push(`<object id="${id}" name="${esc(obj.name)}" type="model">\n${mesh}\n</object>`);
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${fmt(c[0])} ${fmt(c[1])} ${fmt(c[2])}" printable="1"/>`);
    let first = 0;
    const vx = parts.map(p => {
      const e = p.vol.extruder || 0;
      const x = `  <volume firstid="${first}" lastid="${first + p.triCount - 1}">\n   <metadata type="volume" key="name" value="${esc(p.vol.name || obj.name)}"/>\n` +
        (e ? `   <metadata type="volume" key="extruder" value="${e}"/>\n` : '') +
        `   <metadata type="volume" key="volume_type" value="${TYPE_PRUSA[p.vol.type] || 'ModelPart'}"/>\n  </volume>`;
      first += p.triCount; return x;
    }).join('\n');
    cfg.push(` <object id="${id}" instances_count="1">\n  <metadata type="object" key="name" value="${esc(obj.name)}"/>\n  <metadata type="object" key="extruder" value="${obj.extruder || effectiveExtruder(obj, obj.volumes[0])}"/>\n${vx}\n </object>`);
    id++;
  }
  out['3D/3dmodel.model'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}" xmlns:slic3rpe="${NS_SLIC3R}">\n` +
    `<metadata name="slic3rpe:Version3mf">1</metadata>\n<metadata name="Application">Reticolo</metadata>\n` + (model.title ? `<metadata name="Title">${esc(model.title)}</metadata>\n` : '') +
    `<resources>\n${objs.join('\n')}\n</resources>\n<build>\n${items.join('\n')}\n</build>\n</model>`);
  out['Metadata/Slic3r_PE_model.config'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${cfg.join('\n')}\n</config>\n`);
  if (opts.includeColorConfig !== false && model.colors.length) {
    const c = model.colors.join(';');
    out['Metadata/Slic3r_PE.config'] = strToU8(`; generated by Reticolo\n\n; extruder_colour = ${c}\n; filament_colour = ${c}\n`);
  }
}

function writeBambu(model, target, opts, out) {
  const appName = target === 'orca' ? 'OrcaSlicer-2.2.0' : 'BambuStudio-02.00.00.00';
  const topObjs = [], items = [], cfgObjs = [], objFileRels = [];
  let partId = 1;
  let topId = 1000;
  const objectIdMap = new Map();
  model.objects.forEach((obj, oi) => {
    if (!obj.volumes.length) return;
    const c = objectCenter(obj, true);
    const fileName = `3D/Objects/object_${oi + 1}.model`;
    const meshObjs = [], comps = [], partsCfg = [];
    for (const v of obj.volumes) {
      const pid = partId++;
      const part = { positions: v.positions, vol: v };
      meshObjs.push(`<object id="${pid}" type="model">\n${meshXml([part], c, colorTriAttr(model, 'bambu'))}\n</object>`);
      comps.push(`<component p:path="/${fileName}" objectid="${pid}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`);
      partsCfg.push(`    <part id="${pid}" subtype="${TYPE_BAMBU[v.type] || 'normal_part'}">\n      <metadata key="name" value="${esc(v.name || obj.name)}"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n` +
        (v.extruder ? `      <metadata key="extruder" value="${v.extruder}"/>\n` : '') + `    </part>`);
    }
    out[fileName] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}" xmlns:BambuStudio="${NS_BAMBU}" xmlns:p="${NS_PROD}" requiredextensions="p">\n<metadata name="BambuStudio:3mfVersion">1</metadata>\n<resources>\n${meshObjs.join('\n')}\n</resources>\n<build/>\n</model>`);
    objFileRels.push(` <Relationship Target="/${fileName}" Id="rel-${oi + 1}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`);
    const tid = topId++;
    objectIdMap.set(obj.id, tid);
    topObjs.push(`<object id="${tid}" type="model">\n<components>\n${comps.join('\n')}\n</components>\n</object>`);
    items.push(`<item objectid="${tid}" transform="1 0 0 0 1 0 0 0 1 ${fmt(c[0])} ${fmt(c[1])} ${fmt(c[2])}" printable="1"/>`);
    cfgObjs.push(`  <object id="${tid}">\n    <metadata key="name" value="${esc(obj.name)}"/>\n    <metadata key="extruder" value="${obj.extruder || effectiveExtruder(obj, obj.volumes[0])}"/>\n${partsCfg.join('\n')}\n  </object>`);
  });
  const plates = (model.plates && model.plates.length ? model.plates : [{ index: 1, name: '', objectIds: model.objects.map(o => o.id) }]);
  const platesXml = plates.map((p, i) => {
    const insts = p.objectIds.filter(id => objectIdMap.has(id)).map((id, k) =>
      `    <model_instance>\n      <metadata key="object_id" value="${objectIdMap.get(id)}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${(i + 1) * 100 + k + 1}"/>\n    </model_instance>`).join('\n');
    const thumb = opts.plateThumbs && opts.plateThumbs[p.index];
    if (thumb) out[`Metadata/plate_${i + 1}.png`] = thumb;
    return `  <plate>\n    <metadata key="plater_id" value="${i + 1}"/>\n    <metadata key="plater_name" value="${esc(p.name || '')}"/>\n    <metadata key="locked" value="false"/>\n` +
      (thumb ? `    <metadata key="thumbnail_file" value="Metadata/plate_${i + 1}.png"/>\n` : '') + `${insts}\n  </plate>`;
  }).join('\n');
  out['3D/_rels/3dmodel.model.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n${objFileRels.join('\n')}\n</Relationships>`);
  out['3D/3dmodel.model'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}" xmlns:BambuStudio="${NS_BAMBU}" xmlns:p="${NS_PROD}" requiredextensions="p">\n` +
    `<metadata name="Application">${appName}</metadata>\n<metadata name="BambuStudio:3mfVersion">1</metadata>\n` + (model.title ? `<metadata name="Title">${esc(model.title)}</metadata>\n` : '') +
    `<resources>\n${topObjs.join('\n')}\n</resources>\n<build>\n${items.join('\n')}\n</build>\n</model>`);
  out['Metadata/model_settings.config'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${cfgObjs.join('\n')}\n${platesXml}\n</config>\n`);
  // impostazioni progetto: conserva quelle originali se presenti, aggiornando i colori
  let ps = null;
  if (opts.projectSettings) { try { ps = JSON.parse(opts.projectSettings); } catch { ps = null; } }
  if (!ps) ps = { name: 'project_settings', from: 'project', version: '02.00.00.00' };
  if (model.colors.length) {
    ps.filament_colour = model.colors.slice();
    const n = model.colors.length;
    if (!Array.isArray(ps.filament_type) || ps.filament_type.length !== n) ps.filament_type = Array.from({ length: n }, (_, i) => (ps.filament_type && ps.filament_type[i]) || 'PLA');
  }
  out['Metadata/project_settings.config'] = strToU8(JSON.stringify(ps, null, 4));
}

/** STL binario dagli oggetti [{name, positions}] */
function writeStl(objects, name = 'Reticolo') {
  const total = objects.reduce((s, o) => s + o.positions.length / 9, 0);
  const buf = Buffer.alloc(84 + total * 50);
  buf.write(String(name).slice(0, 79), 0, 'ascii');
  buf.writeUInt32LE(total, 80);
  let off = 84;
  for (const o of objects) {
    const p = o.positions;
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      buf.writeFloatLE(nx, off); buf.writeFloatLE(ny, off + 4); buf.writeFloatLE(nz, off + 8); off += 12;
      for (let k = 0; k < 9; k++) { buf.writeFloatLE(p[i + k], off); off += 4; }
      buf.writeUInt16LE(0, off); off += 2;
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Conversione
// ---------------------------------------------------------------------------
function subModelForPlate(model, plate) {
  const ids = new Set(plate.objectIds);
  return { ...model, objects: model.objects.filter(o => ids.has(o.id)), plates: [{ ...plate, index: 1 }] };
}
function cloneModel(model) {
  return { ...model, objects: model.objects.map(o => ({ ...o, volumes: o.volumes.map(v => ({ ...v, positions: new Float32Array(v.positions) })) })), plates: model.plates.map(p => ({ ...p, objectIds: p.objectIds.slice() })) };
}

/**
 * Converte un modello verso un altro slicer.
 * @returns {{files:{suffix:string, data:Uint8Array}[], warnings:string[]}}
 */
function convertModel(model, target, opts = {}) {
  const warnings = [];
  const files = [];
  const get = (p) => (p && model.files ? model.files[p] || model.files['/' + p] : null);
  const fam = (f) => (f === 'bambu' || f === 'orca' ? 'bambu' : f);
  if (!['bambu', 'orca', 'prusa', 'generic'].includes(target)) throw new Error(`Formato di destinazione non supportato: ${target}`);
  if (model.hasPaint && target === 'generic') warnings.push('La pittura multicolore per triangolo è approssimata: ogni triangolo prende il colore dominante.');
  const nonParts = model.objects.some(o => o.volumes.some(v => v.type !== 'part'));
  if (nonParts && target === 'generic') warnings.push('Modificatori, volumi negativi e blocchi supporto non esistono nel 3MF generico e sono stati omessi.');
  if (model.flavor === 'cura') warnings.push('Le impostazioni specifiche di Cura non vengono trasferite.');

  const multi = model.plates.length > 1;
  if ((target === 'prusa' || target === 'generic') && multi && opts.splitPlates !== false) {
    const center = opts.bedCenter || [128, 128];
    for (const plate of model.plates) {
      if (!plate.objectIds.length) continue;
      const sub = cloneModel(subModelForPlate(model, plate));
      const b = bboxOf(sub.objects.flatMap(o => o.volumes.map(v => v.positions)));
      translateModel(sub, center[0] - (b.min[0] + b.max[0]) / 2, center[1] - (b.min[1] + b.max[1]) / 2, 0);
      const thumb = get(plate.thumbnail);
      files.push({ suffix: ` - piatto ${plate.index}`, data: write3mf(sub, target, { thumbnail: thumb, includeColorConfig: opts.includeColorConfig }) });
    }
    warnings.push(`${target === 'prusa' ? 'PrusaSlicer' : 'Il 3MF generico'} non ha piatti multipli: creato un file per ogni piatto (${files.length}).`);
  } else {
    const plateThumbs = {};
    for (const p of model.plates) { const t = get(p.thumbnail); if (t) plateThumbs[p.index] = t; }
    const thumb = get('Metadata/thumbnail.png') || get(model.plates[0] && model.plates[0].thumbnail);
    const projectSettings = fam(model.flavor) === 'bambu' && fam(target) === 'bambu' ? model.raw.projectSettings : null;
    files.push({ suffix: '', data: write3mf(model, target, { thumbnail: thumb, plateThumbs, projectSettings, includeColorConfig: opts.includeColorConfig }) });
  }
  if (fam(target) === 'bambu' && fam(model.flavor) !== 'bambu') warnings.push('Profili di stampante e filamento non inclusi: selezionali nello slicer dopo l\'apertura.');
  if (target === 'prusa' && fam(model.flavor) === 'bambu') warnings.push('PrusaSlicer potrebbe proporre di caricare i colori come preset modificato.');
  return { files, warnings };
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p), ext = path.extname(p), base = path.basename(p, ext);
  for (let i = 2; i < 1000; i++) { const q = path.join(dir, `${base} ${i}${ext}`); if (!fs.existsSync(q)) return q; }
  return path.join(dir, `${base} ${Date.now()}${ext}`);
}

const TARGET_LABEL = { bambu: 'Bambu', orca: 'Orca', prusa: 'Prusa', generic: 'generico' };

/** Risposta per il viewer: un elemento per volume, con offset di centratura per piatto */
function meshForViewer(model) {
  const objects = [];
  for (const o of model.objects) {
    o.volumes.forEach((v, vi) => {
      if (v.type !== 'part') return;
      const color = volColor(model, o, v);
      let vertexColors = null;
      if ((v.paint && v.paint.some(p => p && p.color)) || (v.triColor && v.triColor.some(Boolean))) {
        const n = v.positions.length / 9;
        vertexColors = new Float32Array(n * 9);
        const base = hexToRgb(color);
        for (let t = 0; t < n; t++) {
          let rgb = base;
          const p = v.paint && v.paint[t];
          if (p && p.color) { const st = paintDominant(p.color); if (st > 0) rgb = hexToRgb(model.colors[st - 1] || color); }
          else if (v.triColor && v.triColor[t]) rgb = hexToRgb(v.triColor[t]);
          for (let k = 0; k < 3; k++) vertexColors.set(rgb, t * 9 + k * 3);
        }
      }
      objects.push({ id: o.id, volume: vi, name: o.name, partName: v.name || o.name, plate: o.plate, extruder: effectiveExtruder(o, v), color, positions: v.positions, vertexColors });
    });
  }
  const plates = model.plates.map(p => {
    const arr = objects.filter(x => p.objectIds.includes(x.id)).map(x => x.positions);
    const b = bboxOf(arr);
    return { index: p.index, name: p.name, objectIds: p.objectIds, bbox: b, offset: [-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]] };
  });
  return { flavor: model.flavor, objects, plates, colors: model.colors };
}

function infoOf(model) {
  return {
    flavor: model.flavor, application: model.application, title: model.title, colors: model.colors, hasPaint: model.hasPaint,
    plates: model.plates.map(p => ({ index: p.index, name: p.name, objectIds: p.objectIds, hasThumbnail: !!p.thumbnail })),
    objects: model.objects.map(o => ({ id: o.id, name: o.name, plate: o.plate, extruder: o.extruder || effectiveExtruder(o, o.volumes[0]),
      parts: o.volumes.length, triangles: o.volumes.reduce((s, v) => s + v.positions.length / 9, 0) })),
  };
}

/** Costruisce un modello normalizzato dagli oggetti inviati dall'interfaccia (generatori) */
function modelFromObjects(objects, title = '') {
  const colors = [];
  const objs = objects.map((o, i) => {
    const ex = o.extruder || i + 1;
    if (o.color) colors[ex - 1] = normColor(o.color) || '#C8C8C8';
    return { id: i + 1, name: o.name || `Parte ${i + 1}`, extruder: ex, plate: 1,
      volumes: [{ name: o.name || `Parte ${i + 1}`, type: 'part', extruder: 0, positions: o.positions instanceof Float32Array ? o.positions : new Float32Array(o.positions), paint: null, triColor: null, baseColor: normColor(o.color) }] };
  });
  for (let i = 0; i < colors.length; i++) if (!colors[i]) colors[i] = '#C8C8C8';
  return { flavor: 'generic', application: 'Reticolo', title, colors, hasPaint: false, objects: objs, plates: [{ index: 1, name: '', objectIds: objs.map(o => o.id) }], files: {}, raw: {} };
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function register(ctx) {
  const { dialog } = require('electron');

  async function load(src) {
    if (typeof src === 'number' || (typeof src === 'string' && /^\d+$/.test(src))) {
      const item = ctx.db.get('SELECT * FROM items WHERE id=?', Number(src));
      if (!item) throw new Error('Elemento non trovato');
      const buf = await ctx.readItemBytes(item);
      let dir = path.dirname(item.path);
      if (item.archive_id) { const a = ctx.db.get('SELECT path FROM items WHERE id=?', item.archive_id); dir = path.dirname(a.path); }
      return { model: parse3mf(buf), dir, base: item.name.replace(/\.3mf$/i, '') };
    }
    const p = String(src);
    const buf = await fs.promises.readFile(p);
    return { model: parse3mf(buf), dir: path.dirname(p), base: path.basename(p).replace(/\.3mf$/i, ''), path: p };
  }

  ctx.handle('threemf:info', async (src) => {
    const { model, base, path: p } = await load(src);
    return { ...infoOf(model), name: base, path: p || null };
  });

  ctx.handle('threemf:mesh', async (src) => meshForViewer((await load(src)).model));

  ctx.handle('threemf:convert', async (src, target, opts = {}) => {
    const { model, dir, base } = await load(src);
    const { files, warnings } = convertModel(model, target, opts);
    const outDir = opts.outDir || dir;
    fs.mkdirSync(outDir, { recursive: true });
    const outputs = [];
    for (const f of files) {
      const p = uniquePath(path.join(outDir, `${base} (${TARGET_LABEL[target]})${f.suffix}.3mf`));
      fs.writeFileSync(p, f.data);
      outputs.push(p);
    }
    return { outputs, warnings };
  });

  ctx.handle('mesh:export', async (req = {}) => {
    const format = req.format === '3mf' ? '3mf' : 'stl';
    const name = (req.name || 'modello').replace(/[\\/:*?"<>|]/g, '_');
    let outPath = req.outPath && ctx.isTest ? req.outPath : null;
    if (!outPath) {
      const win = ctx.getMainWindow();
      const r = await dialog.showSaveDialog(win, {
        title: 'Esporta modello', defaultPath: `${name}.${format}`,
        filters: [format === '3mf' ? { name: '3MF', extensions: ['3mf'] } : { name: 'STL', extensions: ['stl'] }],
      });
      if (r.canceled || !r.filePath) return null;
      outPath = r.filePath;
    }
    const objects = (req.objects || []).filter(o => o.positions && o.positions.length >= 9);
    if (!objects.length) throw new Error('Nessuna geometria da esportare');
    const data = format === '3mf' ? write3mf(modelFromObjects(objects, req.name || ''), 'export') : writeStl(objects, name);
    await fs.promises.writeFile(outPath, data);
    return outPath;
  });
}

module.exports = { register, parse3mf, write3mf, writeStl, convertModel, meshForViewer, infoOf, modelFromObjects, paintDominant, indexMesh };
