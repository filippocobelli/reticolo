// Estrazione di miniature incorporate e metadati dai file.
// extractThumbnail(item, buf) -> Buffer PNG/JPEG | null   (mai lancia)
// extractMeta(item, buf) -> object                        (mai lancia)
//
// Chiavi possibili in meta:
//   printMinutes, filamentG, filamentM, layerHeight, material, slicer, printer, nozzle,
//   plates:[{index, minutes, filamentG, filamentM, filaments:[{type,color,g,m}]}], plateCount,
//   application, objects:[name], triangles, stlFormat:'binary'|'ascii', vertices, faces,
//   products:[name], author, organization, fileName, originatingSystem, thumbnails (numero)
const zlib = require('node:zlib');
const fflate = require('fflate');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SCAN_LIMIT = 8 * 1024 * 1024;

const safe = (fn, def) => async (...a) => { try { const r = await fn(...a); return r == null ? def : r; } catch { return def; } };
const extOf = (item) => String(item.ext || (item.name || '').split('.').pop() || '').toLowerCase();
const isZip = (b) => b && b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isPng = (b) => b && b.length > 8 && b.subarray(0, 8).equals(PNG_SIG);
const isJpeg = (b) => b && b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const IMG_RE = /\.(png|jpe?g)$/i;

// ---------------- ZIP (in memoria) ----------------
function unzipFiltered(buf, filter) {
  try { return fflate.unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { filter: (f) => filter(f.name, f.originalSize) }); }
  catch { return {}; }
}
function zipNames(buf) {
  const names = [];
  unzipFiltered(buf, (n, sz) => { names.push({ name: n, size: sz }); return false; });
  return names;
}
function pickZipImage(buf, prefer = []) {
  const names = zipNames(buf).filter(f => IMG_RE.test(f.name) && f.size > 0);
  if (!names.length) return null;
  const score = (f) => {
    const n = f.name.toLowerCase();
    for (let i = 0; i < prefer.length; i++) if (prefer[i].test(n)) return 1000 - i;
    return /thumb|preview|cover|small|icon/.test(n) ? 500 : 0;
  };
  names.sort((a, b) => score(b) - score(a) || b.size - a.size);
  const want = names[0].name;
  const files = unzipFiltered(buf, (n) => n === want);
  const data = files[want];
  return data && data.length ? Buffer.from(data) : null;
}
function zipText(buf, re) {
  const out = {};
  const files = unzipFiltered(buf, (n, sz) => re.test(n) && sz < 64 * 1024 * 1024);
  for (const [n, d] of Object.entries(files)) out[n] = Buffer.from(d).toString('utf8');
  return out;
}

// ---------------- PNG ----------------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { if (zlib.crc32) return zlib.crc32(buf) >>> 0; let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// rgba: Buffer w*h*4
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

// Legge un PNG che inizia a `off`; restituisce {end,w,h} o null
function pngAt(buf, off) {
  if (!buf.subarray(off, off + 8).equals(PNG_SIG)) return null;
  let p = off + 8; let w = 0, h = 0, first = true;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('latin1', p + 4, p + 8);
    if (len > 0x7fffffff || p + 12 + len > buf.length) return null;
    if (first) { if (type !== 'IHDR') return null; w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); first = false; }
    p += 12 + len;
    if (type === 'IEND') return { end: p, w, h };
  }
  return null;
}

// Scansione generica: PNG valido (>=32x32) o data URL base64 nei primi 8MB
function genericScan(buf) {
  const b = buf.length > SCAN_LIMIT ? buf.subarray(0, SCAN_LIMIT) : buf;
  let best = null; let from = 0;
  for (let n = 0; n < 50; n++) {
    const i = b.indexOf(PNG_SIG, from);
    if (i < 0) break;
    const r = pngAt(b, i);
    if (r && r.w >= 32 && r.h >= 32 && (!best || r.w * r.h > best.w * best.h)) best = { ...r, start: i };
    from = r ? r.end : i + 8;
  }
  if (best) return Buffer.from(b.subarray(best.start, best.end));
  return dataUrlScan(b);
}
function dataUrlScan(b) {
  const s = b.toString('latin1');
  const re = /data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s\\]{200,})/g;
  let m, best = null;
  while ((m = re.exec(s))) {
    const img = Buffer.from(m[2].replace(/\\[nr\/]|\s/g, (x) => (x === '\\/' ? '/' : '')), 'base64');
    if ((isPng(img) || isJpeg(img)) && (!best || img.length > best.length)) best = img;
  }
  if (best) return best;
  // base64 PNG "nudo" (es. JSON con campi thumbnail)
  const re2 = /"(iVBORw0KGgo[A-Za-z0-9+/=\\]{200,})"/g;
  while ((m = re2.exec(s))) {
    const img = Buffer.from(m[1].replace(/\\\//g, '/').replace(/\\[nr]/g, ''), 'base64');
    if (isPng(img) && (!best || img.length > best.length)) best = img;
  }
  return best;
}

// ---------------- BMP DIB -> PNG ----------------
function dibToPng(buf, off = 0) {
  const hs = buf.readUInt32LE(off);
  if (hs < 40 || hs > 124) return null;
  const w = buf.readInt32LE(off + 4); let h = buf.readInt32LE(off + 8);
  const bpp = buf.readUInt16LE(off + 14); const comp = buf.readUInt32LE(off + 16);
  if (w <= 0 || w > 4096 || h === 0 || Math.abs(h) > 4096) return null;
  if (comp !== 0 && comp !== 3) return null;
  const topDown = h < 0; h = Math.abs(h);
  let colors = buf.readUInt32LE(off + 32);
  if (bpp <= 8 && !colors) colors = 1 << bpp;
  const palOff = off + hs + (comp === 3 && hs === 40 ? 12 : 0);
  const dataOff = palOff + (bpp <= 8 ? colors * 4 : 0);
  const stride = Math.ceil((w * bpp) / 32) * 4;
  if (dataOff + stride * h > buf.length) return null;
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = dataOff + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      let r, g, b, a = 255;
      if (bpp === 24) { const p = row + x * 3; b = buf[p]; g = buf[p + 1]; r = buf[p + 2]; }
      else if (bpp === 32) { const p = row + x * 4; b = buf[p]; g = buf[p + 1]; r = buf[p + 2]; }
      else if (bpp === 8 || bpp === 4 || bpp === 1) {
        let idx;
        if (bpp === 8) idx = buf[row + x];
        else if (bpp === 4) idx = (buf[row + (x >> 1)] >> (x & 1 ? 0 : 4)) & 0xf;
        else idx = (buf[row + (x >> 3)] >> (7 - (x & 7))) & 1;
        const p = palOff + idx * 4; b = buf[p]; g = buf[p + 1]; r = buf[p + 2];
      } else if (bpp === 16) { const v = buf.readUInt16LE(row + x * 2); r = ((v >> 10) & 31) << 3; g = ((v >> 5) & 31) << 3; b = (v & 31) << 3; }
      else return null;
      const o = (y * w + x) * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
  }
  return encodePng(w, h, rgba);
}

// ---------------- DWG ----------------
const DWG_SENTINEL = Buffer.from([0x1f, 0x25, 0x6d, 0x07, 0xd4, 0x36, 0x28, 0x28, 0x9d, 0x57, 0xca, 0x3f, 0x9d, 0x44, 0x10, 0x2b]);
function dwgThumb(buf) {
  if (buf.toString('latin1', 0, 2) !== 'AC') return genericScan(buf);
  try {
    const addr = buf.readUInt32LE(0x0d);
    let p = addr;
    if (addr > 0 && addr + 16 < buf.length && buf.subarray(addr, addr + 16).equals(DWG_SENTINEL)) p = addr + 16;
    else { const s = buf.indexOf(DWG_SENTINEL, 0); if (s < 0) return genericScan(buf); p = s + 16; }
    p += 4; // dimensione complessiva
    const count = buf[p]; p += 1;
    let png = null, bmp = null;
    for (let i = 0; i < count && i < 8; i++) {
      const code = buf[p]; const start = buf.readUInt32LE(p + 1); const size = buf.readUInt32LE(p + 5); p += 9;
      if (start + size > buf.length) continue;
      if (code === 6) png = buf.subarray(start, start + size);
      if (code === 2) bmp = buf.subarray(start, start + size);
    }
    if (png && isPng(png)) return Buffer.from(png);
    if (bmp) { const r = dibToPng(bmp, 0); if (r) return r; }
  } catch { /* fallback */ }
  return genericScan(buf);
}

// ---------------- G-code testuale ----------------
function gcodeHeadTail(buf) {
  const H = 2 * 1024 * 1024, T = 1024 * 1024;
  if (buf.length <= H + T) return buf.toString('latin1');
  return buf.toString('latin1', 0, H) + '\n' + buf.toString('latin1', buf.length - T);
}
function gcodeThumbs(text) {
  const re = /;\s*(thumbnail(?:_(JPG|PNG|QOI))?) begin\s+(\d+)x(\d+)\s+\d+\s*\r?\n([\s\S]*?);\s*\1 end/g;
  const out = []; let m;
  while ((m = re.exec(text))) {
    const fmt = (m[2] || 'PNG').toUpperCase();
    if (fmt === 'QOI') continue;
    const b64 = m[5].replace(/^[ \t]*;[ \t]?/gm, '').replace(/\s+/g, '');
    const img = Buffer.from(b64, 'base64');
    if (isPng(img) || isJpeg(img)) out.push({ w: +m[3], h: +m[4], img });
  }
  return out;
}
function parseDuration(s) {
  if (!s) return null;
  s = s.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return +s / 60; // secondi
  let t = 0, any = false;
  for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m|s)\b/gi)) { any = true; t += +n * { d: 1440, h: 60, m: 1, s: 1 / 60 }[u.toLowerCase()]; }
  if (!any) { // "1 hours 2 minutes"
    for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)\s*(day|hour|minute|second)s?/gi)) { any = true; t += +n * { day: 1440, hour: 60, minute: 1, second: 1 / 60 }[u.toLowerCase()]; }
    const hms = s.match(/^(\d+):(\d{2}):(\d{2})$/); if (hms) { any = true; t = +hms[1] * 60 + +hms[2] + +hms[3] / 60; }
  }
  return any ? t : null;
}
const sumList = (s) => { const v = String(s).split(/[,;]/).map(x => parseFloat(x)).filter(x => !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const round = (x, d = 2) => (x == null || isNaN(x) ? undefined : Math.round(x * 10 ** d) / 10 ** d);

function gcodeMeta(text) {
  const meta = {};
  const first = text.slice(0, 4000);
  const gen = first.match(/generated by\s+([^\r\n]+?)(?:\s+on\s+\d{4}|\r?\n)/i) || first.match(/^;\s*(BambuStudio[^\r\n]*|OrcaSlicer[^\r\n]*|SuperSlicer[^\r\n]*|PrusaSlicer[^\r\n]*)/mi)
    || first.match(/Generated with\s+([^\r\n]+)/i) || first.match(/^;\s*(Simplify3D[^\r\n]*)/mi) || first.match(/^;\s*(ideaMaker[^\r\n]*|FLASHPRINT[^\r\n]*|Creality[^\r\n]*|ElegooSlicer[^\r\n]*|QIDIStudio[^\r\n]*)/mi);
  if (gen) meta.slicer = gen[1].trim();
  const get = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  let t = get(/;\s*estimated printing time \(normal mode\)\s*=\s*([^\r\n]+)/i)
    || get(/;\s*total estimated time:\s*([^\r\n;]+)/i)
    || get(/;\s*estimated printing time\s*=\s*([^\r\n]+)/i)
    || get(/^;TIME:(\d+(?:\.\d+)?)/m)
    || get(/;\s*Build time:\s*([^\r\n]+)/i)
    || get(/;\s*model printing time:\s*([^\r\n;]+)/i)
    || get(/;\s*Print Time:\s*([^\r\n]+)/i);
  const mins = parseDuration(t); if (mins != null) meta.printMinutes = round(mins, 1);
  let g = get(/;\s*total filament used \[g\]\s*=\s*([^\r\n]+)/i) || get(/;\s*filament used \[g\]\s*=\s*([^\r\n]+)/i) || get(/;\s*total filament weight \[g\]\s*:\s*([^\r\n]+)/i) || get(/;\s*Plastic weight:\s*([\d.]+)\s*g/i);
  if (g) meta.filamentG = round(sumList(g));
  let mm = get(/;\s*filament used \[mm\]\s*=\s*([^\r\n]+)/i) || get(/;\s*total filament length \[mm\]\s*:\s*([^\r\n]+)/i) || get(/;\s*Filament length:\s*([\d.]+)\s*mm/i);
  if (mm) meta.filamentM = round(sumList(mm) / 1000, 3);
  const cm = get(/^;Filament used:\s*([^\r\n]+)/mi);
  if (cm && meta.filamentM == null) meta.filamentM = round(sumList(cm.replace(/m/g, '')), 3);
  const lh = get(/;\s*layer_height\s*=\s*([\d.]+)/i) || get(/^;Layer height:\s*([\d.]+)/mi) || get(/;\s*layerHeight,([\d.]+)/i);
  if (lh) meta.layerHeight = +lh;
  const mat = get(/;\s*filament_type\s*=\s*([^\r\n]+)/i) || get(/^;MATERIAL:([^\r\n]+)/m) || get(/;\s*filament_settings_id\s*=\s*([^\r\n]+)/i);
  if (mat) meta.material = mat.replace(/"/g, '');
  const pr = get(/;\s*printer_model\s*=\s*([^\r\n]+)/i) || get(/^;TARGET_MACHINE\.NAME:([^\r\n]+)/m) || get(/;\s*printer_settings_id\s*=\s*([^\r\n]+)/i);
  if (pr) meta.printer = pr.replace(/"/g, '');
  const nz = get(/;\s*nozzle_diameter\s*=\s*([^\r\n]+)/i); if (nz) meta.nozzle = parseFloat(nz);
  const lc = get(/^;LAYER_COUNT:(\d+)/m) || get(/;\s*total layer number:\s*(\d+)/i) || get(/;\s*total layers count\s*=\s*(\d+)/i);
  if (lc) meta.layers = +lc;
  return meta;
}

// ---------------- G-code binario (Prusa .bgcode) ----------------
function parseBgcode(buf) {
  const res = { thumbs: [], meta: {} };
  if (buf.toString('latin1', 0, 4) !== 'GCDE') return res;
  const checksumType = buf.readUInt16LE(8);
  const ck = checksumType === 1 ? 4 : 0;
  let p = 10;
  const ini = [];
  while (p + 8 <= buf.length) {
    const type = buf.readUInt16LE(p); const comp = buf.readUInt16LE(p + 2); const usize = buf.readUInt32LE(p + 4);
    let hdr = 8, csize = usize;
    if (comp !== 0) { csize = buf.readUInt32LE(p + 8); hdr = 12; }
    const paramSize = type === 5 ? 6 : 2;
    const paramOff = p + hdr; const dataOff = paramOff + paramSize;
    if (dataOff + csize > buf.length) break;
    if (type === 5) {
      const fmt = buf.readUInt16LE(paramOff); const w = buf.readUInt16LE(paramOff + 2); const h = buf.readUInt16LE(paramOff + 4);
      const img = buf.subarray(dataOff, dataOff + csize);
      if (fmt === 0 || fmt === 1) res.thumbs.push({ w, h, img: Buffer.from(img) });
    } else if (type === 0 || type === 2 || type === 3 || type === 4) {
      let data = buf.subarray(dataOff, dataOff + csize);
      try {
        if (comp === 1) { try { data = zlib.inflateSync(data); } catch { data = zlib.inflateRawSync(data); } }
        if (comp === 0 || comp === 1) ini.push(data.toString('utf8'));
      } catch { /* heatshrink non supportato */ }
    } else if (type === 1) {
      // blocchi G-code: fine dei metadati utili
      if (ini.length >= 3 && res.thumbs.length) break;
    }
    p = dataOff + csize + ck;
  }
  const kv = {};
  for (const t of ini) for (const line of t.split(/\r?\n/)) { const i = line.indexOf('='); if (i > 0) kv[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  const m = res.meta;
  if (kv.producer) m.slicer = kv.producer;
  const tm = parseDuration(kv['estimated printing time (normal mode)']); if (tm != null) m.printMinutes = round(tm, 1);
  if (kv['filament used [g]']) m.filamentG = round(sumList(kv['filament used [g]']));
  if (kv['filament used [mm]']) m.filamentM = round(sumList(kv['filament used [mm]']) / 1000, 3);
  if (kv.filament_type) m.material = kv.filament_type;
  if (kv.layer_height) m.layerHeight = +kv.layer_height;
  if (kv.printer_model) m.printer = kv.printer_model;
  if (kv.nozzle_diameter) m.nozzle = parseFloat(kv.nozzle_diameter);
  return res;
}

const largest = (arr) => { if (!arr.length) return null; arr.sort((a, b) => b.w * b.h - a.w * a.h || b.img.length - a.img.length); return arr[0].img; };

// ---------------- 3MF ----------------
function threeMfThumb(buf) {
  return pickZipImage(buf, [/^metadata\/plate_1\.png$/, /^metadata\/thumbnail\.png$/, /^metadata\/plate_\d+\.png$/, /^auxiliaries\/\.thumbnails\//, /^metadata\/thumbnail/, /^metadata\/top_1\.png$/, /^metadata\/pick_1\.png$/]);
}
function xmlAttrs(tag) { const o = {}; for (const [, k, v] of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) o[k] = v; return o; }
function threeMfMeta(buf) {
  const meta = {};
  const names = zipNames(buf).map(f => f.name);
  const texts = zipText(buf, /^(3D\/3dmodel\.model|Metadata\/slice_info\.config|Metadata\/model_settings\.config|Metadata\/Slic3r_PE\.config|Metadata\/project_settings\.config)$/i);
  const model = Object.entries(texts).find(([n]) => /3dmodel\.model$/i.test(n));
  if (model) {
    const x = model[1];
    const app = x.match(/<metadata\s+name="Application"\s*>([^<]*)</i); if (app) meta.application = app[1].trim();
    const objs = [...x.matchAll(/<object\b([^>]*)>/g)].map(m => xmlAttrs(m[1])).filter(a => a.name).map(a => a.name);
    if (objs.length) meta.objects = [...new Set(objs)].slice(0, 200);
    let tris = 0; for (const _ of x.matchAll(/<triangle\b/g)) tris++;
    if (tris) meta.triangles = tris;
    const unit = x.match(/<model\b[^>]*\bunit="([^"]+)"/); if (unit) meta.unit = unit[1];
  }
  const si = Object.entries(texts).find(([n]) => /slice_info\.config$/i.test(n));
  if (si) {
    const plates = [];
    for (const [, body] of si[1].matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
      const md = {}; for (const [, k, v] of body.matchAll(/<metadata\s+key="([^"]+)"\s+value="([^"]*)"/g)) md[k] = v;
      const filaments = [...body.matchAll(/<filament\b([^>]*)\/?>/g)].map(m => xmlAttrs(m[1])).map(a => ({ id: +a.id || undefined, type: a.type, color: a.color, m: a.used_m != null ? +a.used_m : undefined, g: a.used_g != null ? +a.used_g : undefined }));
      const pl = { index: +md.index || plates.length + 1 };
      if (md.prediction) pl.minutes = round(+md.prediction / 60, 1);
      if (md.weight) pl.filamentG = round(+md.weight);
      const mSum = filaments.reduce((a, f) => a + (f.m || 0), 0); if (mSum) pl.filamentM = round(mSum, 3);
      if (filaments.length) pl.filaments = filaments;
      plates.push(pl);
    }
    if (plates.length) {
      meta.plates = plates;
      const tm = plates.reduce((a, p) => a + (p.minutes || 0), 0); if (tm) meta.printMinutes = round(tm, 1);
      const tg = plates.reduce((a, p) => a + (p.filamentG || 0), 0); if (tg) meta.filamentG = round(tg);
      const tmm = plates.reduce((a, p) => a + (p.filamentM || 0), 0); if (tmm) meta.filamentM = round(tmm, 3);
      const types = [...new Set(plates.flatMap(p => (p.filaments || []).map(f => f.type)).filter(Boolean))]; if (types.length) meta.material = types.join(', ');
    }
    const cv = si[1].match(/<metadata\s+key="X-BBL-Client-Version"\s+value="([^"]*)"/); if (cv && !meta.slicer) meta.slicer = `BambuStudio ${cv[1]}`;
  }
  const ms = Object.entries(texts).find(([n]) => /model_settings\.config$/i.test(n));
  if (ms) { let c = 0; for (const _ of ms[1].matchAll(/<plate>/g)) c++; if (c) meta.plateCount = c; }
  if (!meta.plateCount) { const c = names.filter(n => /^Metadata\/plate_\d+\.png$/i.test(n)).length; if (c) meta.plateCount = c; }
  const ps = Object.entries(texts).find(([n]) => /project_settings\.config$/i.test(n));
  if (ps) {
    try {
      const j = JSON.parse(ps[1]);
      if (!meta.material && Array.isArray(j.filament_type)) meta.material = [...new Set(j.filament_type)].join(', ');
      if (j.printer_model) meta.printer = j.printer_model;
      if (j.layer_height) meta.layerHeight = parseFloat(j.layer_height);
      if (Array.isArray(j.filament_colour)) meta.colors = j.filament_colour;
    } catch { /* */ }
  }
  const pe = Object.entries(texts).find(([n]) => /Slic3r_PE\.config$/i.test(n));
  if (pe) {
    const g = gcodeMeta(pe[1].replace(/^/gm, ''));
    for (const k of ['material', 'printer', 'layerHeight', 'nozzle']) if (meta[k] == null && g[k] != null) meta[k] = g[k];
    const cm = pe[1].match(/;\s*(?:extruder_colour|filament_colour)\s*=\s*([^\r\n]+)/); if (cm && !meta.colors) meta.colors = cm[1].split(';').map(s => s.replace(/"/g, ''));
    if (!meta.slicer) { const gm = pe[1].match(/generated by\s+([^\r\n]+?)(?:\s+on\s+|\r?\n)/i); if (gm) meta.slicer = gm[1]; }
  }
  if (!meta.slicer && meta.application) meta.slicer = meta.application;
  meta.thumbnails = names.filter(n => IMG_RE.test(n)).length;
  return meta;
}

// ---------------- STL / OBJ / STEP ----------------
function stlMeta(buf) {
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length) return { stlFormat: 'binary', triangles: n };
  }
  const head = buf.toString('latin1', 0, Math.min(buf.length, 512)).trimStart();
  if (head.startsWith('solid')) {
    let c = 0, i = 0; const pat = Buffer.from('facet normal');
    while ((i = buf.indexOf(pat, i)) >= 0) { c++; i += 12; }
    return { stlFormat: 'ascii', triangles: c };
  }
  if (buf.length >= 84) return { stlFormat: 'binary', triangles: buf.readUInt32LE(80) };
  return {};
}
function objMeta(buf) {
  let v = 0, f = 0; const len = buf.length; let lineStart = true;
  for (let i = 0; i < len; i++) {
    const c = buf[i];
    if (lineStart && i + 1 < len && buf[i + 1] === 0x20) { if (c === 0x76) v++; else if (c === 0x66) f++; }
    lineStart = c === 0x0a;
  }
  const meta = { vertices: v, faces: f };
  const mtl = buf.toString('latin1', 0, Math.min(len, 65536)).match(/^mtllib\s+(.+)$/m); if (mtl) meta.mtllib = mtl[1].trim();
  return meta;
}
const stepStr = (s) => s.replace(/''/g, "'").replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, h) => String.fromCharCode(...h.match(/.{4}/g).map(x => parseInt(x, 16)))).replace(/\\X\\([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
function stepMeta(buf) {
  const meta = {};
  const head = buf.toString('latin1', 0, Math.min(buf.length, 65536));
  const fn = head.match(/FILE_NAME\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*\(([^)]*)\)\s*,\s*\(([^)]*)\)\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/);
  if (fn) {
    meta.fileName = stepStr(fn[1]);
    const author = [...fn[3].matchAll(/'((?:[^']|'')*)'/g)].map(m => stepStr(m[1])).filter(Boolean).join(', '); if (author) meta.author = author;
    const org = [...fn[4].matchAll(/'((?:[^']|'')*)'/g)].map(m => stepStr(m[1])).filter(Boolean).join(', '); if (org) meta.organization = org;
    if (fn[6]) meta.originatingSystem = stepStr(fn[6]);
  }
  const sch = head.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/); if (sch) meta.schema = sch[1];
  const body = buf.toString('latin1', 0, Math.min(buf.length, 40 * 1024 * 1024));
  const names = new Set();
  for (const m of body.matchAll(/\bPRODUCT\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/g)) {
    const n = stepStr(m[2] || m[1]).trim() || stepStr(m[1]).trim();
    if (n) names.add(n);
    if (names.size >= 500) break;
  }
  if (names.size) meta.products = [...names];
  return meta;
}

// ---------------- LightBurn / xTool ----------------
function lbrnThumb(buf) {
  const s = buf.toString('latin1', 0, Math.min(buf.length, 32 * 1024 * 1024));
  const m = s.match(/<Thumbnail\s+Source="([^"]+)"/);
  if (m) { const img = Buffer.from(m[1], 'base64'); if (isPng(img) || isJpeg(img)) return img; }
  return null;
}
function xtoolThumb(buf) {
  if (isZip(buf)) return pickZipImage(buf, [/cover/, /thumb/, /preview/]);
  return dataUrlScan(buf.length > 64 * 1024 * 1024 ? buf.subarray(0, 64 * 1024 * 1024) : buf) || genericScan(buf);
}

// ---------------- Fusion / Lychee ----------------
function fusionThumb(buf, ext) {
  if (!isZip(buf)) return genericScan(buf);
  const direct = pickZipImage(buf, [/small\.png$/, /preview/, /thumbnail/, /\.png$/]);
  if (direct) return direct;
  if (ext === 'f3z') {
    const inner = zipNames(buf).filter(f => /\.f3d$/i.test(f.name)).sort((a, b) => b.size - a.size)[0];
    if (inner) { const f = unzipFiltered(buf, (n) => n === inner.name)[inner.name]; if (f) return fusionThumb(Buffer.from(f), 'f3d'); }
  }
  return null;
}

// =============== API ===============
async function extractThumbnail(item, buf) {
  try {
    if (!buf || !buf.length) return null;
    const ext = extOf(item);
    switch (ext) {
      case '3mf': return threeMfThumb(buf);
      case 'gcode': case 'gco': case 'g': return largest(gcodeThumbs(gcodeHeadTail(buf)));
      case 'bgcode': return largest(parseBgcode(buf).thumbs);
      case 'lbrn': case 'lbrn2': return lbrnThumb(buf) || genericScan(buf);
      case 'xcs': case 'xs': return xtoolThumb(buf);
      case 'dwg': return dwgThumb(buf);
      case 'f3d': case 'f3z': return fusionThumb(buf, ext);
      case 'lys': return isZip(buf) ? pickZipImage(buf, [/thumb/, /preview/]) : genericScan(buf);
      case '3dm': case 'fbx': return genericScan(buf);
      case 'stl': case 'obj': case 'ply': case 'glb': case 'gltf': case 'step': case 'stp': case 'dxf':
        return null;
      default:
        if (isZip(buf)) return pickZipImage(buf);
        return null;
    }
  } catch { return null; }
}

async function extractMeta(item, buf) {
  try {
    if (!buf || !buf.length) return {};
    const ext = extOf(item);
    switch (ext) {
      case '3mf': return threeMfMeta(buf);
      case 'gcode': case 'gco': case 'g': { const t = gcodeHeadTail(buf); const m = gcodeMeta(t); const th = gcodeThumbs(t).length; if (th) m.thumbnails = th; return m; }
      case 'bgcode': { const r = parseBgcode(buf); return { ...r.meta, thumbnails: r.thumbs.length }; }
      case 'stl': return stlMeta(buf);
      case 'obj': return objMeta(buf);
      case 'step': case 'stp': return stepMeta(buf);
      case 'lbrn': case 'lbrn2': {
        const s = buf.toString('latin1', 0, Math.min(buf.length, 4 * 1024 * 1024));
        const m = {}; const v = s.match(/<LightBurnProject[^>]*AppVersion="([^"]+)"/); if (v) m.application = `LightBurn ${v[1]}`;
        let shapes = 0; for (const _ of s.matchAll(/<Shape\b/g)) shapes++; if (shapes) m.shapes = shapes;
        let cuts = 0; for (const _ of s.matchAll(/<CutSetting\b/g)) cuts++; if (cuts) m.layers = cuts;
        return m;
      }
      case 'xcs': case 'xs': {
        if (isZip(buf)) return { container: 'zip' };
        try { const j = JSON.parse(buf.toString('utf8')); const m = {}; if (j.version) m.version = String(j.version); if (j.device && j.device.id) m.device = String(j.device.id); if (Array.isArray(j.canvas)) m.canvases = j.canvas.length; return m; } catch { return {}; }
      }
      case 'dwg': { const v = buf.toString('latin1', 0, 6); return /^AC\d{4}$/.test(v) ? { dwgVersion: v } : {}; }
      default: return {};
    }
  } catch { return {}; }
}

module.exports = {
  extractThumbnail: safe(extractThumbnail, null),
  extractMeta: safe(extractMeta, {}),
  _internal: { encodePng, dibToPng, genericScan, gcodeMeta, parseDuration, parseBgcode },
};
