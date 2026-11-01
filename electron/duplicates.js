// Rilevamento duplicati: copie esatte (impronta), geometria identica (hash geometrico), probabili (da rivedere).
const { LIBRARY_KINDS } = require('./library');

let cache = null;
function invalidate() { cache = null; }

const COLS = 'id, name, ext, kind, size, thumb, dir, source_id, archive_id, tri_count, dims, qhash, geo_hash, path';
const parse = (r) => ({ ...r, dims: r.dims ? JSON.parse(r.dims) : null });
const kindsSql = LIBRARY_KINDS.filter(k => k !== 'archive').map(k => `'${k}'`).join(',');

function normName(n) {
  return n.toLowerCase()
    .replace(/\.(tar\.gz|[a-z0-9]{2,5})$/, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[\s_-]*(copy|copia|final|finale|fixed|v\d+(\.\d+)*|rev\s?\d+|\d{1,2})$/g, '')
    .replace(/[\s_.-]+/g, ' ').trim();
}

function compute(db) {
  const exact = [];
  for (const g of db.all(`SELECT qhash FROM items WHERE missing=0 AND kind IN (${kindsSql}) AND qhash IS NOT NULL GROUP BY qhash HAVING COUNT(*)>1`)) {
    exact.push(db.all(`SELECT ${COLS} FROM items WHERE qhash=? AND missing=0 AND kind IN (${kindsSql}) ORDER BY path`, g.qhash).map(parse));
  }
  const geometry = [];
  for (const g of db.all(`SELECT geo_hash FROM items WHERE missing=0 AND geo_hash IS NOT NULL GROUP BY geo_hash HAVING COUNT(DISTINCT qhash)>1`)) {
    geometry.push(db.all(`SELECT ${COLS} FROM items WHERE geo_hash=? AND missing=0 ORDER BY path`, g.geo_hash).map(parse));
  }
  // probabili: stesso nome normalizzato o stessi triangoli+dimensioni, ma non gia' identici
  const reviews = new Map(db.all('SELECT a, b, status FROM dup_reviews').map(r => [`${r.a}-${r.b}`, r.status]));
  const rows = db.all(`SELECT ${COLS} FROM items WHERE missing=0 AND kind IN ('model','mesh')`).map(parse);
  const pairs = []; const seenPair = new Set(); const confirmed = [];
  const addPair = (a, b, reason) => {
    if (a.qhash === b.qhash || (a.geo_hash && a.geo_hash === b.geo_hash)) return;
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const key = `${x.id}-${y.id}`;
    if (seenPair.has(key)) return; seenPair.add(key);
    const s = reviews.get(key);
    if (s === 'different') return;
    if (s === 'same') { confirmed.push({ a: x, b: y, reason }); return; }
    if (pairs.length < 400) pairs.push({ a: x, b: y, reason });
  };
  const byName = new Map();
  for (const r of rows) { const k = normName(r.name); if (k.length < 3) continue; (byName.get(k) || byName.set(k, []).get(k)).push(r); }
  for (const [, list] of byName) if (list.length > 1 && list.length < 12) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) addPair(list[i], list[j], 'Nome simile');
  const byTris = new Map();
  for (const r of rows) if (r.tri_count > 50) (byTris.get(r.tri_count) || byTris.set(r.tri_count, []).get(r.tri_count)).push(r);
  for (const [, list] of byTris) {
    if (list.length < 2 || list.length > 12) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i].dims, b = list[j].dims;
      if (!a || !b) continue;
      const sa = [...a].sort((p, q) => p - q), sb = [...b].sort((p, q) => p - q);
      if (sa.every((v, k) => Math.abs(v - sb[k]) <= Math.max(0.05, v * 0.005))) addPair(list[i], list[j], 'Stessi triangoli e dimensioni');
    }
  }
  const wasted = exact.reduce((s, g) => s + g.slice(1).reduce((t, x) => t + (x.size || 0), 0), 0);
  return { exact, geometry, probable: pairs, confirmed, wasted };
}

function register(ctx) {
  ctx.handle('dups:list', () => { if (!cache) cache = compute(ctx.db); return cache; });
  ctx.handle('dups:review', (a, b, status) => {
    const [x, y] = a < b ? [a, b] : [b, a];
    ctx.db.run('INSERT INTO dup_reviews(a,b,status) VALUES(?,?,?) ON CONFLICT(a,b) DO UPDATE SET status=excluded.status', x, y, status);
    invalidate(); return true;
  });
  ctx.onEvent((ch) => { if (ch === 'items-changed') invalidate(); });
}

module.exports = { register, invalidate, normName, compute };
