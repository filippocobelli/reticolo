// Database locale (SQLite integrato in Electron/Node: node:sqlite)
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sources(
  id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, name TEXT, added_at INTEGER, last_scan INTEGER, watch INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY,
  source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
  path TEXT UNIQUE NOT NULL,      -- percorso assoluto; per voci in archivio: <archivio>::<percorso interno>
  dir TEXT,                       -- cartella relativa alla sorgente (con '/' come separatore)
  name TEXT, ext TEXT, kind TEXT,
  size INTEGER, mtime INTEGER,
  qhash TEXT,                     -- impronta del contenuto (resta uguale se il file viene rinominato/spostato)
  geo_hash TEXT, tri_count INTEGER, dims TEXT,
  thumb INTEGER DEFAULT 0,        -- 0 da fare, 1 pronta, 2 non disponibile
  archive_id INTEGER,             -- se e' una voce dentro un archivio
  note TEXT, ai_desc TEXT, ai_tags TEXT, embedding BLOB,
  meta TEXT, cover TEXT,
  missing INTEGER DEFAULT 0,
  added_at INTEGER,
  search TEXT
);
CREATE INDEX IF NOT EXISTS ix_items_qhash ON items(qhash);
CREATE INDEX IF NOT EXISTS ix_items_geo ON items(geo_hash);
CREATE INDEX IF NOT EXISTS ix_items_src ON items(source_id, dir);
CREATE INDEX IF NOT EXISTS ix_items_kind ON items(kind, ext);
CREATE INDEX IF NOT EXISTS ix_items_arch ON items(archive_id);
CREATE TABLE IF NOT EXISTS tags(id INTEGER PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE NOT NULL, color TEXT);
CREATE TABLE IF NOT EXISTS item_tags(item_id INTEGER REFERENCES items(id) ON DELETE CASCADE, tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(item_id, tag_id));
CREATE TABLE IF NOT EXISTS collections(id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS collection_items(collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE, item_id INTEGER REFERENCES items(id) ON DELETE CASCADE, PRIMARY KEY(collection_id, item_id));
CREATE TABLE IF NOT EXISTS dup_reviews(a INTEGER, b INTEGER, status TEXT, PRIMARY KEY(a, b));
CREATE TABLE IF NOT EXISTS queue(
  id INTEGER PRIMARY KEY, item_id INTEGER REFERENCES items(id) ON DELETE SET NULL, title TEXT,
  status TEXT DEFAULT 'todo', minutes REAL, filament_g REAL, filament_m REAL, material TEXT, color TEXT,
  copies INTEGER DEFAULT 1, plate TEXT, notes TEXT, position INTEGER, created_at INTEGER, done_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
`;

class DB {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    this.cache = new Map();
  }
  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  all(sql, ...p) { return this.stmt(sql).all(...p); }
  get(sql, ...p) { return this.stmt(sql).get(...p); }
  run(sql, ...p) { return this.stmt(sql).run(...p); }
  exec(sql) { this.db.exec(sql); }
  tx(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // ---- impostazioni ----
  getSetting(key, def) {
    const r = this.get('SELECT value FROM settings WHERE key=?', key);
    if (!r) return def;
    try { return JSON.parse(r.value); } catch { return def; }
  }
  setSetting(key, value) {
    this.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
  }

  // ---- testo di ricerca ----
  refreshSearch(id) {
    const it = this.get('SELECT name, path, note, ai_desc, ai_tags, ext FROM items WHERE id=?', id);
    if (!it) return;
    const tags = this.all('SELECT t.name FROM tags t JOIN item_tags it ON it.tag_id=t.id WHERE it.item_id=?', id).map(r => r.name);
    const text = [it.name, it.path, it.ext, tags.join(' '), it.note || '', it.ai_desc || '', it.ai_tags || ''].join(' ').toLowerCase();
    this.run('UPDATE items SET search=? WHERE id=?', text, id);
  }

  getItem(id) {
    const it = this.get('SELECT * FROM items WHERE id=?', id);
    if (!it) return null;
    return decorate(this, it);
  }
}

function decorate(db, it) {
  const out = { ...it };
  delete out.embedding; delete out.search;
  out.dims = it.dims ? JSON.parse(it.dims) : null;
  out.meta = it.meta ? JSON.parse(it.meta) : {};
  out.ai_tags = it.ai_tags ? JSON.parse(it.ai_tags) : [];
  out.tags = db.all('SELECT t.id, t.name, t.color FROM tags t JOIN item_tags x ON x.tag_id=t.id WHERE x.item_id=? ORDER BY t.name', it.id);
  out.collections = db.all('SELECT c.id, c.name FROM collections c JOIN collection_items x ON x.collection_id=c.id WHERE x.item_id=?', it.id);
  out.hasEmbedding = !!it.embedding;
  return out;
}

module.exports = { DB, decorate };
