// node test/archives.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fflate = require('fflate');
const tar = require('tar');
const A = require('../electron/archives');

const zlib = require('node:zlib');
function makeRar4(files) {
  const crc = (b) => zlib.crc32(b) >>> 0;
  const hdr = (body) => { const c = Buffer.alloc(2); c.writeUInt16LE(crc(body) & 0xffff); return Buffer.concat([c, body]); };
  const parts = [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])];
  const main = Buffer.alloc(11); main[0] = 0x73; main.writeUInt16LE(0, 1); main.writeUInt16LE(13, 3);
  parts.push(hdr(main));
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name.replace(/\//g, '\\'), 'latin1');
    const b = Buffer.alloc(30 + n.length);
    b[0] = 0x74; b.writeUInt16LE(0x8000, 1); b.writeUInt16LE(32 + n.length, 3);
    b.writeUInt32LE(data.length, 5); b.writeUInt32LE(data.length, 9); b[13] = 0;
    b.writeUInt32LE(crc(data), 14); b.writeUInt32LE(0x5a210000, 18); b[22] = 20; b[23] = 0x30;
    b.writeUInt16LE(n.length, 24); b.writeUInt32LE(0x20, 26); n.copy(b, 30);
    parts.push(hdr(b), data);
  }
  parts.push(Buffer.from([0xc4, 0x3d, 0x7b, 0x00, 0x40, 0x07, 0x00]));
  return Buffer.concat(parts);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtc-arch-'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(path.join(src, 'parti', 'sub'), { recursive: true });
  const big = Buffer.alloc(300000, 7); big.write('solid cube');
  fs.writeFileSync(path.join(src, 'cubo.stl'), big);
  fs.writeFileSync(path.join(src, 'parti', 'sub', 'à perno.obj'), 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  fs.writeFileSync(path.join(src, 'leggimi.txt'), 'ciao');
  const files = { 'cubo.stl': big, 'parti/sub/à perno.obj': fs.readFileSync(path.join(src, 'parti/sub/à perno.obj')), 'leggimi.txt': Buffer.from('ciao') };

  // ZIP (deflate + stored + cartella)
  const zipPath = path.join(dir, 'a.zip');
  fs.writeFileSync(zipPath, fflate.zipSync({ 'cubo.stl': [big, { level: 6 }], 'parti/': new Uint8Array(0), 'parti/sub/à perno.obj': [files['parti/sub/à perno.obj'], { level: 0 }], 'leggimi.txt': Buffer.from('ciao') }));
  // TAR, TGZ
  const tarPath = path.join(dir, 'a.tar'); const tgzPath = path.join(dir, 'a.tgz');
  await tar.c({ file: tarPath, cwd: src }, ['.']);
  await tar.c({ file: tgzPath, cwd: src, gzip: true }, ['cubo.stl', 'parti', 'leggimi.txt']);
  // 7Z
  const z7 = A._internal.sevenZipPath();
  const p7 = path.join(dir, 'a.7z');
  const env = { ...process.env, LC_ALL: 'C.UTF-8' };
  execFileSync(z7, ['a', '-t7z', p7, '.'], { cwd: src, stdio: 'ignore', env });
  // 7Z protetto
  const p7pw = path.join(dir, 'pw.7z');
  execFileSync(z7, ['a', '-t7z', '-psegreto', '-mhe=on', p7pw, 'leggimi.txt'], { cwd: src, stdio: 'ignore' });

  for (const [p, ext] of [[zipPath, 'zip'], [tarPath, 'tar'], [tgzPath, 'tgz'], [p7, '7z']]) {
    const list = await A.listEntries(p, ext);
    const names = list.map(e => e.name).sort();
    assert.deepStrictEqual(names, Object.keys(files).sort(), `${ext}: ${names}`);
    assert.strictEqual(list.find(e => e.name === 'cubo.stl').size, big.length, `${ext} size`);
    for (const [n, b] of Object.entries(files)) {
      const got = await A.readEntry(p, ext, n);
      assert.ok(Buffer.compare(got, b) === 0, `${ext} read ${n}`);
    }
    await assert.rejects(A.readEntry(p, ext, 'non-esiste.stl'), /non trovata/);
    console.log('ok', ext, names.length, 'voci');
  }
  // cache
  assert.strictEqual(await A.listEntries(zipPath, 'zip'), await A.listEntries(zipPath, 'zip'));
  await assert.rejects(A.listEntries(p7pw, '7z'), /password/i);
  console.log('ok 7z con password -> errore chiaro');

  // RAR: non possiamo crearne uno (formato proprietario); verifichiamo il caricamento del wasm
  // e la gestione di un file non valido.
  const wasm = A._internal.unrarWasmBinary();
  assert.ok(wasm.byteLength > 100000);
  const badRar = path.join(dir, 'bad.rar'); fs.writeFileSync(badRar, Buffer.from('Rar!\x1a\x07\x00non valido'));
  await assert.rejects(A.listEntries(badRar, 'rar'), (e) => e instanceof A.ArchiveError);
  // RAR4 minimale (metodo "store") costruito a mano
  const rarPath = path.join(dir, 'a.rar');
  fs.writeFileSync(rarPath, makeRar4({ 'cartella/pezzo.stl': Buffer.from('solid x\nendsolid x\n'), 'note.txt': Buffer.from('ciao rar') }));
  const rl = await A.listEntries(rarPath, 'rar');
  assert.deepStrictEqual(rl.map(e => e.name).sort(), ['cartella/pezzo.stl', 'note.txt']);
  assert.strictEqual((await A.readEntry(rarPath, 'rar', 'note.txt')).toString(), 'ciao rar');
  assert.strictEqual((await A.readEntry(rarPath, 'rar', 'cartella/pezzo.stl')).toString(), 'solid x\nendsolid x\n');
  console.log('ok rar (RAR4 store)');
  console.log('ok rar wasm', wasm.byteLength, 'byte');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ARCHIVES OK');
})().catch((e) => { console.error(e); process.exit(1); });
