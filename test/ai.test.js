// Test del modulo IA con un server HTTP finto che imita i vari provider.
const { makeCtx, waitFor } = require('./helpers');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const ai = require('../electron/ai');

const reqs = [];
const ANSWER = { tags: ['Drago', 'fantasy', '#miniatura', 'fantasy'], description: 'Un drago alato da stampare.' };

function fakeVec(text) {
  const v = new Array(16).fill(0);
  for (const w of String(text).toLowerCase().split(/\W+/).filter(Boolean)) {
    let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v[h % 16] += 1;
  }
  return v;
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const json = body ? JSON.parse(body) : null;
    reqs.push({ url: req.url, headers: req.headers, body: json });
    const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = req.url;
    if (u.startsWith('/bad')) return send({ error: { message: 'chiave non valida' } }, 401);
    if (u.endsWith('/chat/completions')) return send({ choices: [{ message: { content: '```json\n' + JSON.stringify(ANSWER) + '\n```' } }] });
    if (u.endsWith('/embeddings')) return send({ data: json.input.map((t, i) => ({ index: i, embedding: fakeVec(t) })).reverse() });
    if (u === '/anthropic/v1/messages') return send({ content: [{ type: 'text', text: 'Ecco: ' + JSON.stringify(ANSWER) }] });
    if (u.startsWith('/gemini/v1beta/models/')) return send({ candidates: [{ content: { parts: [{ text: JSON.stringify(ANSWER) }] } }] });
    if (u === '/ollama/api/chat') return send({ message: { content: JSON.stringify(ANSWER) } });
    if (u === '/ollama/api/embed') return send({ embeddings: json.input.map(fakeVec) });
    if (u.startsWith('/bad')) return send({ error: { message: 'chiave non valida' } }, 401);
    send({ error: 'not found' }, 404);
  });
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = makeCtx();
  ai.register(ctx);
  const { db } = ctx;

  // --- parsing ---
  assert.deepEqual(ai.parseAIJson('```json\n{"tags":["A","b"],"description":"x"}\n```').tags, ['a', 'b']);
  assert.deepEqual(ai.parseAIJson('Risposta: {"tags": "uno, due", "description": "d",}').tags, ['uno', 'due']);
  assert.equal(ai.parseAIJson('tags: vaso, decorazione\ndescrizione: un vaso').description, 'un vaso');
  assert.equal(ai.parseAIJson(JSON.stringify({ tags: Array.from({ length: 20 }, (_, i) => 't' + i) }), 5).tags.length, 5);
  assert.throws(() => ai.parseAIJson('boh'));

  // --- dati di prova ---
  db.run("INSERT INTO sources(id,path,name) VALUES(1,'/lib','lib')");
  db.run("INSERT INTO items(id,source_id,path,dir,name,ext,kind,dims) VALUES(1,1,'/lib/mostri/drago_alato.stl','mostri','drago_alato.stl','stl','model','[50,40,30]')");
  db.run("INSERT INTO items(id,source_id,path,dir,name,ext,kind) VALUES(2,1,'/lib/casa/vaso_spirale.stl','casa','vaso_spirale.stl','stl','model')");
  db.run("INSERT INTO items(id,source_id,path,dir,name,ext,kind) VALUES(3,1,'/lib/casa/gancio.3mf','casa','gancio.3mf','3mf','model')");
  fs.writeFileSync(ctx.thumbPath(1), Buffer.from('89504e470d0a1a0a', 'hex'));

  // --- configurazione e cifratura ---
  const pub = await ctx.call('ai:setConfig', {
    provider: 'openai', keys: { openai: 'sk-openai-1234', openrouter: 'sk-or-9999', anthropic: 'sk-ant-5678', gemini: 'gm-0000' },
    baseUrls: { openai: `${base}/openai/v1`, openrouter: `${base}/openrouter/api/v1`, anthropic: `${base}/anthropic/v1`, gemini: `${base}/gemini/v1beta` },
    ollamaUrl: `${base}/ollama`, applyAsTags: true, maxTags: 3,
  });
  assert.equal(pub.keys.openai.set, true);
  assert.equal(pub.keys.openai.hint, '…1234');
  assert.ok(!JSON.stringify(pub).includes('sk-openai-1234'), 'la chiave non deve tornare in chiaro');
  const raw = db.get("SELECT value FROM settings WHERE key='ai'").value;
  assert.ok(!raw.includes('sk-openai-1234'), 'la chiave deve essere cifrata nel DB');

  async function runTag(provider, ids = [1]) {
    await ctx.call('ai:setConfig', { provider });
    reqs.length = 0;
    await ctx.call('ai:tag', ids);
    await waitFor(() => { const e = ctx.events.filter(x => x[0] === 'ai-progress').pop(); return e && !e[1].running && e[1].done >= ids.length; });
    return reqs;
  }

  // OpenAI
  let r = await runTag('openai');
  assert.equal(r[0].url, '/openai/v1/chat/completions');
  assert.equal(r[0].headers.authorization, 'Bearer sk-openai-1234');
  assert.equal(r[0].body.model, 'gpt-4.1-mini');
  assert.deepEqual(r[0].body.response_format, { type: 'json_object' });
  assert.equal(r[0].body.messages[1].content[1].type, 'image_url');
  assert.ok(r[0].body.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,'));
  assert.ok(r[0].body.messages[1].content[0].text.includes('drago_alato.stl'));
  let it = db.get('SELECT ai_desc, ai_tags, search FROM items WHERE id=1');
  assert.equal(it.ai_desc, ANSWER.description);
  assert.deepEqual(JSON.parse(it.ai_tags), ['drago', 'fantasy', 'miniatura']);
  assert.ok(it.search.includes('drago alato da stampare'));
  const tags = db.all('SELECT t.name FROM tags t JOIN item_tags x ON x.tag_id=t.id WHERE x.item_id=1 ORDER BY t.name').map(x => x.name);
  assert.deepEqual(tags, ['drago', 'fantasy', 'miniatura']);
  assert.ok(ctx.events.some(e => e[0] === 'items-changed' && e[1].ids[0] === 1));

  // OpenRouter
  r = await runTag('openrouter');
  assert.equal(r[0].url, '/openrouter/api/v1/chat/completions');
  assert.equal(r[0].headers.authorization, 'Bearer sk-or-9999');
  assert.equal(r[0].headers['x-title'], 'Reticolo');
  assert.equal(r[0].body.response_format, undefined);

  // Anthropic
  r = await runTag('anthropic');
  assert.equal(r[0].url, '/anthropic/v1/messages');
  assert.equal(r[0].headers['x-api-key'], 'sk-ant-5678');
  assert.equal(r[0].headers['anthropic-version'], '2023-06-01');
  assert.equal(r[0].body.messages[0].content[0].type, 'image');
  assert.equal(r[0].body.messages[0].content[0].source.media_type, 'image/png');
  assert.ok(r[0].body.system);

  // Gemini
  r = await runTag('gemini');
  assert.equal(r[0].url, '/gemini/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal(r[0].headers['x-goog-api-key'], 'gm-0000');
  assert.ok(r[0].body.contents[0].parts[0].inline_data.data);
  assert.equal(r[0].body.generationConfig.responseMimeType, 'application/json');

  // Ollama (item senza miniatura -> niente immagini)
  r = await runTag('ollama', [2, 3]);
  assert.equal(r.length, 2);
  assert.equal(r[0].url, '/ollama/api/chat');
  assert.equal(r[0].body.format, 'json');
  assert.equal(r[0].body.messages[1].images, undefined);
  assert.ok(r[0].body.messages[1].content.includes("Non è disponibile un'immagine"));

  // errore provider
  await ctx.call('ai:setConfig', { provider: 'openai', baseUrls: { openai: `${base}/bad` } });
  await ctx.call('ai:tag', [3]);
  await waitFor(() => { const e = ctx.events.filter(x => x[0] === 'ai-progress').pop(); return e && !e[1].running && e[1].errors.length; });
  const lastErr = ctx.events.filter(x => x[0] === 'ai-progress').pop()[1].errors[0];
  assert.ok(lastErr.error.includes('chiave non valida'));
  const t = await ctx.call('ai:test');
  assert.equal(t.ok, false);
  await ctx.call('ai:setConfig', { baseUrls: { openai: `${base}/openai/v1` } });
  assert.equal((await ctx.call('ai:test')).ok, true);

  // chiave mancante
  await ctx.call('ai:setConfig', { keys: { openai: '' } });
  assert.equal((await ctx.call('ai:test')).ok, false);

  // --- embeddings OpenRouter ---
  db.run("UPDATE items SET note='vaso per fiori' WHERE id=2");
  await ctx.call('ai:setConfig', { embed: { provider: 'openrouter', model: '' } });
  reqs.length = 0;
  const { total } = await ctx.call('ai:embedAll');
  assert.equal(total, 3);
  await waitFor(() => { const e = ctx.events.filter(x => x[0] === 'ai-embed-progress').pop(); return e && !e[1].running && e[1].done === 3; });
  assert.equal(reqs[0].url, '/openrouter/api/v1/embeddings');
  assert.equal(reqs[0].body.model, 'openai/text-embedding-3-small');
  assert.equal(reqs[0].body.dimensions, 512);
  assert.equal(db.get('SELECT COUNT(*) n FROM items WHERE embedding IS NOT NULL').n, 3);
  let res = await ctx.call('ai:semantic', 'drago', 5);
  assert.equal(res[0].id, 1, 'drago deve essere il primo');
  res = await ctx.call('ai:semantic', 'vaso fiori');
  assert.equal(res[0].id, 2);
  assert.ok(res[0].score >= res[1].score);

  // cambio modello -> invalidazione; Ollama
  await ctx.call('ai:setConfig', { embed: { provider: 'ollama', model: 'nomic-embed-text' } });
  reqs.length = 0;
  assert.equal((await ctx.call('ai:embedAll')).total, 3);
  await waitFor(() => { const e = ctx.events.filter(x => x[0] === 'ai-embed-progress').pop(); return e && !e[1].running && e[1].done === 3; });
  assert.equal(reqs[0].url, '/ollama/api/embed');
  res = await ctx.call('ai:semantic', 'gancio');
  assert.equal(res[0].id, 3);

  // provider elenco
  const pv = await ctx.call('ai:providers');
  assert.equal(pv.providers.length, 6);
  assert.equal(typeof pv.codexAvailable, 'boolean');

  // Codex CLI finto
  if (process.platform !== 'win32') {
    const binDir = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fakecodex-'));
    const bin = require('node:path').join(binDir, 'codex');
    fs.writeFileSync(bin, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 9.9.9"; exit 0; fi
out=""; img=""; prev=""
for a in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then out="$a"; fi
  if [ "$prev" = "-i" ]; then img="$a"; fi
  prev="$a"
done
[ -f "$img" ] || { echo "manca immagine" >&2; exit 3; }
echo '{"tags":["codex","prova"],"description":"da codex"}' > "$out"
`);
    fs.chmodSync(bin, 0o755);
    await ctx.call('ai:setConfig', { provider: 'codex', codexPath: bin, applyAsTags: false });
    assert.equal((await ctx.call('ai:test')).ok, true);
    await ctx.call('ai:tag', [1]);
    await waitFor(() => { const e = ctx.events.filter(x => x[0] === 'ai-progress').pop(); return e && !e[1].running && e[1].done >= 1; });
    assert.equal(db.get('SELECT ai_desc FROM items WHERE id=1').ai_desc, 'da codex');
  }

  // annullamento
  await ctx.call('ai:setConfig', { provider: 'ollama' });
  await ctx.call('ai:tag', [1, 2, 3]);
  await ctx.call('ai:cancel');
  await waitFor(() => { const e = ctx.events.filter(x => x[0] === 'ai-progress').pop(); return e && !e[1].running; });

  server.close();
  console.log('ai.test.js: OK');
})().catch(e => { console.error(e); process.exit(1); });
