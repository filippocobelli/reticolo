// Lettura di archivi senza estrazione su disco (quando possibile).
// API: listEntries(archivePath, ext) -> [{name, size, mtime}]   (solo file, separatore '/')
//      readEntry(archivePath, ext, innerPath) -> Buffer
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const fflate = require('fflate');

class ArchiveError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const passwordError = () => new ArchiveError('PASSWORD', 'Archivio protetto da password: non è possibile leggerlo');

const MAX_ENTRY_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

// ---------- cache del listing ----------
const listCache = new Map(); // key -> entries
function cacheKey(p) {
  try { const st = fs.statSync(p); return `${p}|${st.size}|${st.mtimeMs}`; } catch { return null; }
}

function normName(n) {
  return String(n).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

// ====================== ZIP ======================
// Lettura della central directory con fs.read (niente caricamento dell'intero file).
function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = fs.readSync(fd, buf, off, len - off, pos + off);
    if (n <= 0) break;
    off += n;
  }
  return off === len ? buf : buf.subarray(0, off);
}

function decodeName(raw, utf8) {
  if (utf8) return raw.toString('utf8');
  const s = raw.toString('utf8');
  if (!s.includes('�')) return s;
  // CP437 approssimato
  return raw.toString('latin1');
}

function zipCentralDirectory(fd, fileSize) {
  const tailLen = Math.min(fileSize, 65557 + 20);
  const tail = readAt(fd, fileSize - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ArchiveError('BAD', 'ZIP non valido (manca la central directory)');
  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  // ZIP64
  if (cdOffset === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) {
      const eocd64Off = Number(tail.readBigUInt64LE(loc + 8));
      const e64 = readAt(fd, eocd64Off, 56);
      if (e64.readUInt32LE(0) === 0x06064b50) {
        count = Number(e64.readBigUInt64LE(32));
        cdSize = Number(e64.readBigUInt64LE(40));
        cdOffset = Number(e64.readBigUInt64LE(48));
      }
    }
  }
  const cd = readAt(fd, cdOffset, cdSize);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const dosTime = cd.readUInt16LE(p + 12);
    const dosDate = cd.readUInt16LE(p + 14);
    let csize = cd.readUInt32LE(p + 20);
    let usize = cd.readUInt32LE(p + 24);
    const nlen = cd.readUInt16LE(p + 28);
    const xlen = cd.readUInt16LE(p + 30);
    const clen = cd.readUInt16LE(p + 32);
    const extAttr = cd.readUInt32LE(p + 38);
    let lho = cd.readUInt32LE(p + 42);
    const name = decodeName(cd.subarray(p + 46, p + 46 + nlen), !!(flags & 0x800));
    // extra ZIP64
    let x = p + 46 + nlen; const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = cd.readUInt16LE(x), sz = cd.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (lho === 0xffffffff) { lho = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + sz;
    }
    const isDir = name.endsWith('/') || (extAttr & 0x10) === 0x10;
    const mtime = dosToMs(dosDate, dosTime);
    entries.push({ name: normName(name), size: usize, csize, method, flags, lho, isDir, mtime });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

function dosToMs(d, t) {
  try {
    return new Date(((d >> 9) & 0x7f) + 1980, ((d >> 5) & 0xf) - 1, d & 0x1f, (t >> 11) & 0x1f, (t >> 5) & 0x3f, (t & 0x1f) * 2).getTime();
  } catch { return undefined; }
}

const zipDirCache = new Map();
function zipEntriesRaw(archivePath) {
  const key = cacheKey(archivePath);
  if (key && zipDirCache.has(key)) return zipDirCache.get(key);
  const fd = fs.openSync(archivePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const list = zipCentralDirectory(fd, size);
    if (key) { zipDirCache.set(key, list); trimCache(zipDirCache); }
    return list;
  } finally { fs.closeSync(fd); }
}

function zipList(archivePath) {
  return zipEntriesRaw(archivePath).filter(e => !e.isDir).map(e => ({ name: e.name, size: e.size, mtime: e.mtime }));
}

function zipRead(archivePath, inner) {
  const target = normName(inner);
  const e = zipEntriesRaw(archivePath).find(x => x.name === target && !x.isDir);
  if (!e) throw new ArchiveError('NOTFOUND', `Voce non trovata nell'archivio: ${inner}`);
  if (e.flags & 0x1) throw passwordError();
  if (e.size > MAX_ENTRY_BYTES) throw new ArchiveError('TOOBIG', 'Voce troppo grande');
  const fd = fs.openSync(archivePath, 'r');
  try {
    const lh = readAt(fd, e.lho, 30);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new ArchiveError('BAD', 'Intestazione locale ZIP non valida');
    const start = e.lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const data = readAt(fd, start, e.csize);
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) return Buffer.from(fflate.inflateSync(data, { out: e.size ? new Uint8Array(e.size) : undefined }));
    if (e.method === 99) throw passwordError();
    throw new ArchiveError('METHOD', `Metodo di compressione ZIP non supportato (${e.method})`);
  } finally { fs.closeSync(fd); }
}

// ====================== TAR / TGZ ======================
function tarLib() { return require('tar'); }

async function tarList(archivePath) {
  const tar = tarLib();
  const out = [];
  await tar.t({
    file: archivePath,
    onReadEntry: (e) => {
      if (e.type === 'File' || e.type === 'OldFile' || e.type === 'ContiguousFile') {
        out.push({ name: normName(e.path), size: e.size, mtime: e.mtime ? e.mtime.getTime() : undefined });
      }
      e.resume();
    },
  });
  return out;
}

async function tarRead(archivePath, inner) {
  const tar = tarLib();
  const target = normName(inner);
  const chunks = [];
  let found = false;
  await tar.t({
    file: archivePath,
    filter: (p) => normName(p) === target,
    onReadEntry: (e) => {
      if (normName(e.path) === target && !found) {
        found = true;
        e.on('data', (c) => chunks.push(c));
      } else e.resume();
    },
  });
  if (!found) throw new ArchiveError('NOTFOUND', `Voce non trovata nell'archivio: ${inner}`);
  return Buffer.concat(chunks);
}

// ====================== 7Z ======================
function sevenZipPath() {
  let p = require('7zip-bin').path7za;
  p = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`).replace('app.asar/', 'app.asar.unpacked/');
  try { if (process.platform !== 'win32') { const st = fs.statSync(p); if (!(st.mode & 0o111)) fs.chmodSync(p, 0o755); } } catch { /* ignora */ }
  return p;
}

function run7z(args, { maxBytes = MAX_ENTRY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(sevenZipPath(), args, { windowsHide: true, env: process.platform === 'win32' ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' } }); }
    catch (e) { return reject(new ArchiveError('BIN', `7-Zip non disponibile: ${e.message}`)); }
    const out = []; let outLen = 0; const err = [];
    child.stdout.on('data', (c) => {
      outLen += c.length;
      if (outLen > maxBytes) { child.kill(); reject(new ArchiveError('TOOBIG', 'Voce troppo grande')); return; }
      out.push(c);
    });
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (e) => reject(new ArchiveError('BIN', `7-Zip non disponibile: ${e.message}`)));
    child.on('close', (code) => {
      const stderr = Buffer.concat(err).toString();
      if (/wrong password|password/i.test(stderr) && code !== 0) return reject(passwordError());
      if (code !== 0 && code !== 1) return reject(new ArchiveError('7Z', `Errore 7-Zip (${code}): ${stderr.trim().split('\n').slice(-2).join(' ')}`));
      resolve(Buffer.concat(out));
    });
  });
}

async function sevenList(archivePath) {
  const txt = (await run7z(['l', '-slt', '-ba', '-p-', '-sccUTF-8', archivePath], { maxBytes: 256 * 1024 * 1024 })).toString('utf8');
  const out = [];
  let encrypted = false;
  for (const block of txt.split(/\r?\n\r?\n/)) {
    const rec = {};
    for (const line of block.split(/\r?\n/)) {
      const i = line.indexOf(' = ');
      if (i > 0) rec[line.slice(0, i).trim()] = line.slice(i + 3);
    }
    if (!rec.Path) continue;
    const isDir = rec.Folder === '+' || /^D/.test(rec.Attributes || '');
    if (isDir) continue;
    if (rec.Encrypted === '+') encrypted = true;
    out.push({ name: normName(rec.Path), size: Number(rec.Size || 0), mtime: rec.Modified ? Date.parse(rec.Modified.replace(' ', 'T')) || undefined : undefined, encrypted: rec.Encrypted === '+' });
  }
  if (!out.length && encrypted) throw passwordError();
  return out.map(({ encrypted: _e, ...r }) => r);
}

async function sevenRead(archivePath, inner) {
  const target = normName(inner);
  const entries = await listEntries(archivePath, '7z');
  if (!entries.some(e => e.name === target)) throw new ArchiveError('NOTFOUND', `Voce non trovata nell'archivio: ${inner}`);
  // -spd: nessun carattere jolly nel nome
  return run7z(['e', '-so', '-p-', '-spd', '-sccUTF-8', archivePath, '--', target.replace(/\//g, process.platform === 'win32' ? '\\' : '/')]);
}

// ====================== RAR ======================
let unrarWasm = null;
function unrarWasmBinary() {
  if (unrarWasm) return unrarWasm;
  const candidates = [];
  try { candidates.push(path.join(path.dirname(require.resolve('node-unrar-js')), 'js', 'unrar.wasm')); } catch { /* */ }
  candidates.push(path.join(__dirname, '..', 'node_modules', 'node-unrar-js', 'dist', 'js', 'unrar.wasm'));
  for (const c of candidates) {
    for (const p of [c, c.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)]) {
      try { const b = fs.readFileSync(p); unrarWasm = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); return unrarWasm; } catch { /* prova il prossimo */ }
    }
  }
  throw new ArchiveError('BIN', 'Modulo RAR (unrar.wasm) non trovato');
}

function mapUnrarError(e) {
  const r = e && e.reason;
  if (r === 'ERAR_MISSING_PASSWORD' || r === 'ERAR_BAD_PASSWORD') return passwordError();
  if (r === 'ERAR_BAD_ARCHIVE' || r === 'ERAR_UNKNOWN_FORMAT') return new ArchiveError('BAD', 'RAR non valido o danneggiato');
  return e instanceof ArchiveError ? e : new ArchiveError('RAR', `Errore RAR: ${e && e.message || e}`);
}

async function rarList(archivePath) {
  const { createExtractorFromFile } = require('node-unrar-js');
  try {
    const ex = await createExtractorFromFile({ wasmBinary: unrarWasmBinary(), filepath: archivePath });
    const list = ex.getFileList();
    if (list.arcHeader.flags.headerEncrypted) throw passwordError();
    const out = [];
    for (const h of list.fileHeaders) {
      if (h.flags.directory) continue;
      out.push({ name: normName(h.name), size: h.unpSize, mtime: Date.parse(h.time) || undefined });
    }
    return out;
  } catch (e) { throw mapUnrarError(e); }
}

async function rarRead(archivePath, inner) {
  const { createExtractorFromFile } = require('node-unrar-js');
  const target = normName(inner);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtc-rar-'));
  try {
    const ex = await createExtractorFromFile({ wasmBinary: unrarWasmBinary(), filepath: archivePath, targetPath: tmp });
    let header = null;
    const res = ex.extract({ files: (h) => normName(h.name) === target });
    for (const f of res.files) header = f.fileHeader;
    if (!header) throw new ArchiveError('NOTFOUND', `Voce non trovata nell'archivio: ${inner}`);
    const out = path.join(tmp, header.name.replace(/\\/g, '/'));
    return fs.readFileSync(out);
  } catch (e) { throw mapUnrarError(e); }
  finally { fs.rm(tmp, { recursive: true, force: true }, () => {}); }
}

// ====================== API ======================
function normExt(ext, archivePath) {
  let e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (!e && archivePath) {
    const n = archivePath.toLowerCase();
    e = n.endsWith('.tar.gz') ? 'tar.gz' : path.extname(n).slice(1);
  }
  return e;
}

function trimCache(m, max = 200) { while (m.size > max) m.delete(m.keys().next().value); }

async function listEntries(archivePath, ext) {
  const e = normExt(ext, archivePath);
  const key = cacheKey(archivePath);
  if (!key) throw new ArchiveError('NOTFOUND', `Archivio non trovato: ${archivePath}`);
  const ck = `${e}|${key}`;
  if (listCache.has(ck)) return listCache.get(ck);
  let res;
  switch (e) {
    case 'zip': case '3mf': case 'f3z': res = zipList(archivePath); break;
    case 'tar': case 'tar.gz': case 'tgz': res = await tarList(archivePath); break;
    case '7z': res = await sevenList(archivePath); break;
    case 'rar': res = await rarList(archivePath); break;
    default: throw new ArchiveError('FORMAT', `Formato archivio non supportato: ${e}`);
  }
  listCache.set(ck, res); trimCache(listCache);
  return res;
}

async function readEntry(archivePath, ext, innerPath) {
  const e = normExt(ext, archivePath);
  if (!fs.existsSync(archivePath)) throw new ArchiveError('NOTFOUND', `Archivio non trovato: ${archivePath}`);
  switch (e) {
    case 'zip': case '3mf': case 'f3z': return zipRead(archivePath, innerPath);
    case 'tar': case 'tar.gz': case 'tgz': return tarRead(archivePath, innerPath);
    case '7z': return sevenRead(archivePath, innerPath);
    case 'rar': return rarRead(archivePath, innerPath);
    default: throw new ArchiveError('FORMAT', `Formato archivio non supportato: ${e}`);
  }
}

module.exports = { listEntries, readEntry, ArchiveError, _internal: { sevenZipPath, unrarWasmBinary } };
