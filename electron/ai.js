// Intelligenza artificiale facoltativa: tag/descrizioni e ricerca semantica.
// Nulla viene inviato senza un'azione esplicita dell'utente.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', needsKey: true, embeddings: true,
    defaultModel: 'google/gemini-2.5-flash',
    models: ['google/gemini-2.5-flash', 'openai/gpt-4.1-mini', 'anthropic/claude-haiku-5-5', 'qwen/qwen2.5-vl-72b-instruct', 'meta-llama/llama-4-scout'],
    defaultEmbedModel: 'openai/text-embedding-3-small', embedModels: ['openai/text-embedding-3-small', 'openai/text-embedding-3-large', 'qwen/qwen3-embedding-8b'],
    keyUrl: 'https://openrouter.ai/keys' },
  { id: 'openai', name: 'OpenAI', needsKey: true, embeddings: true,
    defaultModel: 'gpt-4.1-mini', models: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5-mini', 'gpt-4.1'],
    defaultEmbedModel: 'text-embedding-3-small', embedModels: ['text-embedding-3-small', 'text-embedding-3-large'],
    keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic (Claude)', needsKey: true, embeddings: false,
    defaultModel: 'claude-haiku-5-5', models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', name: 'Google Gemini', needsKey: true, embeddings: false,
    defaultModel: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
    keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'ollama', name: 'Ollama (locale)', needsKey: false, embeddings: true,
    defaultModel: 'qwen2.5vl', models: ['qwen2.5vl', 'llava', 'llama3.2-vision', 'gemma3', 'minicpm-v'],
    defaultEmbedModel: 'nomic-embed-text', embedModels: ['nomic-embed-text', 'mxbai-embed-large', 'bge-m3'] },
  { id: 'codex', name: 'Codex CLI (piano ChatGPT)', needsKey: false, embeddings: false,
    defaultModel: '', models: ['', 'gpt-5', 'gpt-5-codex'] },
];

const DEFAULT_BASE = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};

const LANGS = { it: 'italiano', en: 'inglese', es: 'spagnolo', fr: 'francese', de: 'tedesco', pt: 'portoghese' };

const DEFAULT_CONFIG = {
  provider: 'openrouter',
  models: {},
  keys: {},
  ollamaUrl: 'http://localhost:11434',
  language: 'it',
  maxTags: 8,
  applyAsTags: false,
  concurrency: 2,
  embed: { provider: 'openrouter', model: '' },
  baseUrls: {},
};

// ---------- cifratura chiavi ----------
function safeStorage() {
  try { const ss = require('electron').safeStorage; return ss && ss.isEncryptionAvailable() ? ss : null; } catch { return null; }
}
function encryptKey(plain) {
  if (!plain) return null;
  const ss = safeStorage();
  if (ss) return { enc: ss.encryptString(plain).toString('base64') };
  return { plain };
}
function decryptKey(stored) {
  if (!stored) return '';
  if (typeof stored === 'string') return stored;
  if (stored.plain) return stored.plain;
  if (stored.enc) {
    const ss = safeStorage();
    if (!ss) return '';
    try { return ss.decryptString(Buffer.from(stored.enc, 'base64')); } catch { return ''; }
  }
  return '';
}

// ---------- prompt e parsing ----------
function buildPrompt(item, cfg, hasImage) {
  const lang = LANGS[cfg.language] || cfg.language || 'italiano';
  const max = cfg.maxTags || 8;
  const lines = [
    'Analizza questo file di una libreria di modelli per stampa 3D, taglio laser e CNC.',
    `Nome file: ${item.name}`,
    `Cartella: ${item.dir || '/'}`,
    `Formato: ${(item.ext || '').toUpperCase()}`,
  ];
  if (item.dims) {
    try { const d = typeof item.dims === 'string' ? JSON.parse(item.dims) : item.dims; if (d) lines.push(`Dimensioni (mm): ${d.map(v => Number(v).toFixed(1)).join(' x ')}`); } catch { /* ignora */ }
  }
  lines.push(hasImage ? "L'immagine allegata è un'anteprima del modello." : "Non è disponibile un'immagine: basati su nome e cartella.");
  lines.push(
    'Restituisci SOLO un oggetto JSON con questa forma: {"tags": ["..."], "description": "..."}',
    `- "tags": al massimo ${max} tag brevi in ${lang}, tutti minuscoli, che descrivano soggetto, uso, stile e categoria. Non includere il formato del file.`,
    `- "description": una o due frasi in ${lang} che descrivano l'oggetto.`,
  );
  return lines.join('\n');
}
const SYSTEM = 'Sei un catalogatore di modelli per stampa 3D, taglio laser e CNC. Rispondi esclusivamente con JSON valido, senza testo aggiuntivo.';

function parseAIJson(text, maxTags = 8) {
  if (text == null) throw new Error('Risposta vuota');
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let obj = null;
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    const slice = t.slice(a, b + 1);
    try { obj = JSON.parse(slice); } catch {
      try { obj = JSON.parse(slice.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"')); } catch { obj = null; }
    }
  }
  if (!obj) {
    // ripiego: "tags: a, b, c" / "description: ..."
    const tm = t.match(/tags?\s*[:=]\s*(.+)/i);
    const dm = t.match(/descri(?:zione|ption)\s*[:=]\s*(.+)/i);
    if (!tm && !dm) throw new Error('Risposta non interpretabile');
    obj = { tags: tm ? tm[1].split(/[,;]/) : [], description: dm ? dm[1] : '' };
  }
  let tags = obj.tags ?? obj.tag ?? obj.keywords ?? [];
  if (typeof tags === 'string') tags = tags.split(/[,;]/);
  const seen = new Set();
  tags = (Array.isArray(tags) ? tags : [])
    .map(x => String(x).toLowerCase().replace(/^#/, '').replace(/[\r\n"]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(x => x && x.length <= 40 && !seen.has(x) && seen.add(x))
    .slice(0, maxTags);
  const description = String(obj.description ?? obj.descrizione ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
  return { tags, description };
}

// ---------- chiamate ai provider ----------
async function postJSON(url, headers, body, signal, timeoutMs = 120000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('Timeout')), timeoutMs);
  const onAbort = () => ac.abort(new Error('Annullato'));
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ac.signal });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* no json */ }
    if (!r.ok) {
      const msg = json && (json.error?.message || json.error || json.message) || text.slice(0, 300);
      throw new Error(`HTTP ${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    if (!json) throw new Error('Risposta non JSON');
    return json;
  } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); }
}

function baseUrl(cfg, id) {
  if (id === 'ollama') return (cfg.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
  return (cfg.baseUrls && cfg.baseUrls[id] || DEFAULT_BASE[id]).replace(/\/+$/, '');
}
function modelFor(cfg, id) {
  const p = PROVIDERS.find(x => x.id === id);
  return (cfg.models && cfg.models[id]) || (p ? p.defaultModel : '');
}

async function chat(cfg, { prompt, imageB64, mime = 'image/png', signal, keyFor }) {
  const id = cfg.provider;
  const model = modelFor(cfg, id);
  const key = keyFor(id);
  const p = PROVIDERS.find(x => x.id === id);
  if (!p) throw new Error(`Provider sconosciuto: ${id}`);
  if (p.needsKey && !key) throw new Error(`Manca la chiave API per ${p.name}`);

  if (id === 'openai' || id === 'openrouter') {
    const content = [{ type: 'text', text: prompt }];
    if (imageB64) content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${imageB64}` } });
    const body = { model, temperature: 0.2, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }] };
    const headers = { authorization: `Bearer ${key}` };
    if (id === 'openai') body.response_format = { type: 'json_object' };
    if (id === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/reticolo-app'; headers['X-Title'] = 'Reticolo'; }
    const j = await postJSON(`${baseUrl(cfg, id)}/chat/completions`, headers, body, signal);
    const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return Array.isArray(c) ? c.map(x => x.text || '').join('') : c;
  }
  if (id === 'anthropic') {
    const content = [];
    if (imageB64) content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: imageB64 } });
    content.push({ type: 'text', text: prompt });
    const j = await postJSON(`${baseUrl(cfg, id)}/messages`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: 700, system: SYSTEM, messages: [{ role: 'user', content }] }, signal);
    return (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
  }
  if (id === 'gemini') {
    const parts = [];
    if (imageB64) parts.push({ inline_data: { mime_type: mime, data: imageB64 } });
    parts.push({ text: prompt });
    const j = await postJSON(`${baseUrl(cfg, id)}/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key },
      { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }, signal);
    const cand = j.candidates && j.candidates[0];
    return cand && cand.content && (cand.content.parts || []).map(x => x.text || '').join('');
  }
  if (id === 'ollama') {
    const msg = { role: 'user', content: prompt };
    if (imageB64) msg.images = [imageB64];
    const j = await postJSON(`${baseUrl(cfg, id)}/api/chat`, {}, { model, stream: false, format: 'json', options: { temperature: 0.2 }, messages: [{ role: 'system', content: SYSTEM }, msg] }, signal, 300000);
    return j.message && j.message.content;
  }
  if (id === 'codex') return codexChat(cfg, { prompt, imageB64, signal, model });
  throw new Error(`Provider non gestito: ${id}`);
}

// ---------- Codex CLI ----------
function findInPath(names, env = process.env) {
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  if (process.platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.npm-global/bin'));
  if (process.platform === 'win32' && env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
  for (const d of dirs) for (const n of names) {
    const p = path.join(d, n);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* ignora */ }
  }
  return null;
}
function codexPath(cfg) {
  if (cfg && cfg.codexPath && fs.existsSync(cfg.codexPath)) return cfg.codexPath;
  return findInPath(process.platform === 'win32' ? ['codex.cmd', 'codex.exe', 'codex.ps1', 'codex'] : ['codex']);
}
function runProcess(cmd, args, { signal, timeoutMs = 240000, input } = {}) {
  return new Promise((resolve, reject) => {
    const shell = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(cmd);
    const child = spawn(cmd, args, { shell, windowsHide: true, env: process.env });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const kill = () => { try { child.kill(); } catch { /* ignora */ } };
    const t = setTimeout(() => { kill(); reject(new Error('Codex: timeout')); }, timeoutMs);
    if (signal) signal.addEventListener('abort', () => { kill(); reject(new Error('Annullato')); }, { once: true });
    child.on('error', e => { clearTimeout(t); reject(e); });
    child.on('close', code => {
      clearTimeout(t);
      if (code === 0) resolve({ out, err });
      else reject(new Error(`Codex terminato con codice ${code}: ${(err || out).slice(-400)}`));
    });
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}
async function codexChat(cfg, { prompt, imageB64, signal, model }) {
  const bin = codexPath(cfg);
  if (!bin) throw new Error('Codex CLI non trovato nel PATH (installa con: npm i -g @openai/codex, poi "codex login")');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticolo-codex-'));
  const outFile = path.join(dir, 'last.txt');
  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-last-message', outFile];
  if (model) args.push('-m', model);
  if (imageB64) { const img = path.join(dir, 'preview.png'); fs.writeFileSync(img, Buffer.from(imageB64, 'base64')); args.push('-i', img); }
  args.push('--', `${SYSTEM}\n\n${prompt}`);
  try {
    const { out } = await runProcess(bin, args, { signal });
    let text = '';
    try { text = fs.readFileSync(outFile, 'utf8'); } catch { text = out; }
    return text || out;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ---------- embeddings ----------
async function embedTexts(cfg, texts, keyFor, signal) {
  const e = cfg.embed || {};
  const id = e.provider || 'openrouter';
  const p = PROVIDERS.find(x => x.id === id);
  if (!p || !p.embeddings) throw new Error('Provider di embeddings non valido');
  const model = e.model || p.defaultEmbedModel;
  if (id === 'ollama') {
    const j = await postJSON(`${baseUrl(cfg, 'ollama')}/api/embed`, {}, { model, input: texts }, signal, 300000);
    if (!Array.isArray(j.embeddings)) throw new Error('Risposta embeddings non valida');
    return j.embeddings;
  }
  const key = keyFor(id);
  if (!key) throw new Error(`Manca la chiave API per ${p.name} (ricerca semantica)`);
  const body = { model, input: texts };
  if (/text-embedding-3/.test(model)) body.dimensions = 512;
  const headers = { authorization: `Bearer ${key}` };
  if (id === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/reticolo-app'; headers['X-Title'] = 'Reticolo'; }
  const j = await postJSON(`${baseUrl(cfg, id)}/embeddings`, headers, body, signal);
  if (!Array.isArray(j.data)) throw new Error('Risposta embeddings non valida');
  return j.data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => d.embedding);
}

function normalize(vec) {
  const f = Float32Array.from(vec);
  let n = 0; for (let i = 0; i < f.length; i++) n += f[i] * f[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < f.length; i++) f[i] /= n;
  return f;
}
function blobToVec(b) {
  if (!b) return null;
  const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
  return new Float32Array(u8.slice().buffer);
}
function dot(a, b) { const n = Math.min(a.length, b.length); let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }

function embedTextFor(db, it) {
  const tags = db.all('SELECT t.name FROM tags t JOIN item_tags x ON x.tag_id=t.id WHERE x.item_id=?', it.id).map(r => r.name);
  let ai = [];
  try { ai = it.ai_tags ? JSON.parse(it.ai_tags) : []; } catch { /* ignora */ }
  const name = String(it.name || '').replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ');
  return [name, [...new Set([...tags, ...ai])].join(', '), it.ai_desc || '', it.note || '', it.dir || ''].filter(Boolean).join('\n').slice(0, 2000);
}

// ---------- modulo ----------
function register(ctx) {
  const db = ctx.db;
  const getCfg = () => {
    const c = db.getSetting('ai', {}) || {};
    return { ...DEFAULT_CONFIG, ...c, models: { ...(c.models || {}) }, keys: { ...(c.keys || {}) }, embed: { ...DEFAULT_CONFIG.embed, ...(c.embed || {}) }, baseUrls: { ...(c.baseUrls || {}) } };
  };
  const keyFor = (cfg) => (id) => decryptKey(cfg.keys[id]);

  const publicCfg = () => {
    const c = getCfg();
    const keys = {};
    for (const p of PROVIDERS) {
      const k = decryptKey(c.keys[p.id]);
      keys[p.id] = k ? { set: true, hint: `…${k.slice(-4)}` } : { set: false };
    }
    return { ...c, keys, encryption: !!safeStorage() };
  };

  ctx.handle('ai:providers', () => ({ providers: PROVIDERS, languages: LANGS, codexAvailable: !!codexPath(getCfg()) }));
  ctx.handle('ai:getConfig', () => publicCfg());
  ctx.handle('ai:setConfig', (partial = {}) => {
    const c = getCfg();
    const next = { ...c };
    for (const k of ['provider', 'ollamaUrl', 'language', 'maxTags', 'applyAsTags', 'concurrency', 'codexPath']) if (k in partial) next[k] = partial[k];
    if (partial.models) next.models = { ...c.models, ...partial.models };
    if (partial.embed) next.embed = { ...c.embed, ...partial.embed };
    if (partial.baseUrls) next.baseUrls = { ...c.baseUrls, ...partial.baseUrls };
    if (partial.keys) {
      next.keys = { ...c.keys };
      for (const [id, v] of Object.entries(partial.keys)) {
        if (v === null || v === '') delete next.keys[id];
        else if (typeof v === 'string') next.keys[id] = encryptKey(v.trim());
      }
    }
    next.maxTags = Math.max(1, Math.min(20, Number(next.maxTags) || 8));
    next.concurrency = Math.max(1, Math.min(4, Number(next.concurrency) || 2));
    db.setSetting('ai', next);
    return publicCfg();
  });

  ctx.handle('ai:test', async () => {
    const cfg = getCfg();
    if (cfg.provider === 'codex') {
      const bin = codexPath(cfg);
      if (!bin) return { ok: false, message: 'Codex CLI non trovato nel PATH' };
      try { const { out } = await runProcess(bin, ['--version'], { timeoutMs: 20000 }); return { ok: true, message: `Codex trovato: ${out.trim() || bin}` }; }
      catch (e) { return { ok: false, message: e.message }; }
    }
    try {
      const txt = await chat(cfg, { prompt: 'Test di connessione. Rispondi con questo JSON: {"tags":["test"],"description":"ok"}', keyFor: keyFor(cfg) });
      const r = parseAIJson(txt);
      return { ok: true, message: `Connessione riuscita (${modelFor(cfg, cfg.provider)}). Risposta: ${r.description || r.tags.join(', ')}` };
    } catch (e) { return { ok: false, message: e.message }; }
  });

  // ----- coda di tagging -----
  const st = { queue: [], running: 0, done: 0, total: 0, errors: [], current: null, controllers: new Set(), active: false };
  const progress = () => ctx.emit('ai-progress', { done: st.done, total: st.total, current: st.current, errors: st.errors.slice(-20), running: st.active });

  async function tagOne(id, cfg, signal) {
    const it = db.get('SELECT * FROM items WHERE id=?', id);
    if (!it) return;
    st.current = it.name; progress();
    let imageB64 = null, mime = 'image/png';
    const candidates = [it.cover, ctx.thumbPath(id)].filter(Boolean);
    for (const p of candidates) {
      try { if (fs.existsSync(p)) { imageB64 = fs.readFileSync(p).toString('base64'); mime = /\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.webp$/i.test(p) ? 'image/webp' : 'image/png'; break; } } catch { /* ignora */ }
    }
    const prompt = buildPrompt(it, cfg, !!imageB64);
    const txt = await chat(cfg, { prompt, imageB64, mime, signal, keyFor: keyFor(cfg) });
    const { tags, description } = parseAIJson(txt, cfg.maxTags);
    db.tx(() => {
      db.run('UPDATE items SET ai_desc=?, ai_tags=?, embedding=NULL WHERE id=?', description, JSON.stringify(tags), id);
      if (cfg.applyAsTags) {
        for (const t of tags) {
          db.run('INSERT OR IGNORE INTO tags(name) VALUES(?)', t);
          const row = db.get('SELECT id FROM tags WHERE name=?', t);
          if (row) db.run('INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES(?,?)', id, row.id);
        }
      }
    });
    db.refreshSearch(id);
    vecCache = null;
    ctx.emit('items-changed', { ids: [id] });
  }

  async function worker(cfg) {
    while (st.queue.length && st.active) {
      const id = st.queue.shift();
      const ac = new AbortController();
      st.controllers.add(ac);
      try { await tagOne(id, cfg, ac.signal); }
      catch (e) {
        if (!st.active) break;
        const row = db.get('SELECT name FROM items WHERE id=?', id);
        st.errors.push({ id, name: row ? row.name : String(id), error: String(e.message || e) });
      } finally { st.controllers.delete(ac); }
      st.done++; progress();
    }
  }

  async function runQueue() {
    if (st.running) return;
    st.active = true;
    const cfg = getCfg();
    const n = Math.max(1, Math.min(4, cfg.concurrency || 2));
    st.running = n;
    await Promise.all(Array.from({ length: n }, () => worker(cfg)));
    st.running = 0; st.active = false; st.current = null;
    progress();
    if (st.queue.length) return runQueue(); // elementi aggiunti dopo un annullamento
  }

  ctx.handle('ai:tag', (itemIds) => {
    const ids = (Array.isArray(itemIds) ? itemIds : [itemIds]).map(Number).filter(Boolean);
    if (!st.running) { st.done = 0; st.total = 0; st.errors = []; }
    const pending = new Set(st.queue);
    let added = 0;
    for (const id of ids) if (!pending.has(id)) { st.queue.push(id); pending.add(id); added++; }
    st.total += added;
    progress();
    runQueue().catch(e => console.error('[ai]', e));
    return { queued: added, total: st.total };
  });

  ctx.handle('ai:cancel', () => {
    st.queue = []; st.active = false;
    for (const ac of st.controllers) ac.abort();
    progress();
    return true;
  });

  ctx.handle('ai:status', () => ({ done: st.done, total: st.total, running: st.active, errors: st.errors.slice(-20), embed: { ...emb } }));

  // ----- embeddings -----
  let vecCache = null;
  const emb = { running: false, done: 0, total: 0, error: null };
  const embProgress = () => ctx.emit('ai-embed-progress', { ...emb });
  const embSignature = (cfg) => { const p = PROVIDERS.find(x => x.id === cfg.embed.provider); return `${cfg.embed.provider}:${cfg.embed.model || (p && p.defaultEmbedModel) || ''}`; };

  function ensureSignature(cfg) {
    const sig = embSignature(cfg);
    if (db.getSetting('ai.embedModel', null) !== sig) {
      db.run('UPDATE items SET embedding=NULL');
      db.setSetting('ai.embedModel', sig);
      vecCache = null;
    }
  }

  async function embedAll() {
    if (emb.running) return;
    const cfg = getCfg();
    ensureSignature(cfg);
    const rows = db.all('SELECT id, name, dir, note, ai_desc, ai_tags FROM items WHERE missing=0 AND embedding IS NULL');
    Object.assign(emb, { running: true, done: 0, total: rows.length, error: null });
    embProgress();
    const B = 64;
    try {
      for (let i = 0; i < rows.length && emb.running; i += B) {
        const chunk = rows.slice(i, i + B);
        const vecs = await embedTexts(cfg, chunk.map(r => embedTextFor(db, r)), keyFor(cfg));
        db.tx(() => {
          chunk.forEach((r, k) => {
            const v = vecs[k]; if (!v) return;
            db.run('UPDATE items SET embedding=? WHERE id=?', Buffer.from(normalize(v).buffer), r.id);
          });
        });
        emb.done += chunk.length; embProgress();
      }
    } catch (e) { emb.error = String(e.message || e); }
    emb.running = false; vecCache = null; embProgress();
  }

  ctx.handle('ai:embedAll', () => {
    const cfg = getCfg();
    ensureSignature(cfg);
    const total = db.get('SELECT COUNT(*) n FROM items WHERE missing=0 AND embedding IS NULL').n;
    embedAll().catch(e => console.error('[ai embed]', e));
    return { total };
  });
  ctx.handle('ai:embedCancel', () => { emb.running = false; return true; });

  ctx.handle('ai:semantic', async (query, limit = 60) => {
    const q = String(query || '').trim();
    if (!q) return [];
    const cfg = getCfg();
    ensureSignature(cfg);
    if (!vecCache) {
      vecCache = db.all('SELECT id, embedding FROM items WHERE missing=0 AND embedding IS NOT NULL').map(r => ({ id: r.id, v: blobToVec(r.embedding) }));
    }
    if (!vecCache.length) throw new Error('Nessun embedding calcolato: usa "Calcola embeddings" nelle impostazioni IA');
    const [qv] = await embedTexts(cfg, [q], keyFor(cfg));
    const qn = normalize(qv);
    return vecCache.map(r => ({ id: r.id, score: dot(qn, r.v) }))
      .sort((a, b) => b.score - a.score).slice(0, Math.max(1, Number(limit) || 60));
  });
}

module.exports = { register, PROVIDERS, parseAIJson, buildPrompt, chat, embedTexts, encryptKey, decryptKey, normalize, blobToVec };
