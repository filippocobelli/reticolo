import { useEffect, useState } from 'react';
import { api, onEvent } from '../api.js';
import './settings.css';

function Progress({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return <div className="st-progress"><div style={{ width: `${pct}%` }} /></div>;
}

export default function AISettings() {
  const [defs, setDefs] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [msg, setMsg] = useState(null);
  const [testing, setTesting] = useState(false);
  const [prog, setProg] = useState(null);
  const [emb, setEmb] = useState(null);

  useEffect(() => {
    api.ai.providers().then(setDefs).catch(e => setMsg({ ok: false, text: e.message }));
    api.ai.getConfig().then(setCfg);
    window.rtc.invoke('ai:status').then(s => { setProg(s); setEmb(s.embed); }).catch(() => {});
    return onEvent((ch, p) => {
      if (ch === 'ai-progress') setProg(p);
      if (ch === 'ai-embed-progress') setEmb(p);
    });
  }, []);

  if (!defs || !cfg) return <div className="panel muted">Caricamento…</div>;

  const save = async (partial) => { try { setCfg(await api.ai.setConfig(partial)); } catch (e) { setMsg({ ok: false, text: e.message }); } };
  const prov = defs.providers.find(p => p.id === cfg.provider) || defs.providers[0];
  const embProviders = defs.providers.filter(p => p.embeddings);
  const embProv = embProviders.find(p => p.id === cfg.embed.provider) || embProviders[0];
  const keyInfo = cfg.keys[prov.id] || {};
  const embKeyInfo = cfg.keys[embProv.id] || {};
  const needsOllama = cfg.provider === 'ollama' || cfg.embed.provider === 'ollama';

  const saveKey = async (id, value) => { await save({ keys: { [id]: value } }); setKeyDraft(''); setMsg({ ok: true, text: value ? 'Chiave salvata' : 'Chiave rimossa' }); };

  const test = async () => {
    setTesting(true); setMsg(null);
    try { const r = await api.ai.test(); setMsg({ ok: r.ok, text: r.message }); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    setTesting(false);
  };

  const embedAll = async () => {
    try { const r = await api.ai.embedAll(); setEmb({ running: r.total > 0, done: 0, total: r.total }); if (!r.total) setMsg({ ok: true, text: 'Tutti gli elementi hanno già un embedding.' }); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
  };

  return (
    <div className="col">
      <div className="st-privacy">
        L'intelligenza artificiale è facoltativa. Nessun dato lascia il computer finché non avvii tu un'azione
        (“Tagga con IA”, “Calcola embeddings”, ricerca semantica). Vengono inviati solo l'anteprima, il nome del file
        e la cartella, con la tua chiave. Con Ollama tutto resta in locale.
      </div>

      <div className="panel st-section">
        <h3>Tag e descrizioni automatiche</h3>
        <div className="st-grid">
          <label>Provider</label>
          <select value={cfg.provider} onChange={e => { setKeyDraft(''); save({ provider: e.target.value }); }}>
            {defs.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {prov.needsKey && <>
            <label>Chiave API</label>
            <div className="st-inline">
              <input type="password" value={keyDraft} placeholder={keyInfo.set ? `Salvata (${keyInfo.hint})` : 'Incolla la chiave'}
                onChange={e => setKeyDraft(e.target.value)} />
              <button className="btn primary" disabled={!keyDraft} onClick={() => saveKey(prov.id, keyDraft)}>Salva</button>
              {keyInfo.set && <button className="btn" onClick={() => saveKey(prov.id, null)}>Rimuovi</button>}
              {prov.keyUrl && <a className="muted" href={prov.keyUrl} target="_blank" rel="noreferrer">Ottieni chiave</a>}
            </div>
          </>}

          {prov.id === 'codex' && <>
            <label>Codex CLI</label>
            <div className="st-inline">
              <span className={`badge`}>{defs.codexAvailable ? 'Trovato nel PATH' : 'Non trovato'}</span>
              <input type="text" defaultValue={cfg.codexPath || ''} placeholder="Percorso personalizzato (facoltativo)"
                onBlur={e => save({ codexPath: e.target.value.trim() })} />
            </div>
            <span />
            <div className="muted" style={{ fontSize: 12 }}>Usa il tuo piano ChatGPT: installa con <code>npm i -g @openai/codex</code> ed esegui <code>codex login</code>.</div>
          </>}

          <label>Modello</label>
          <input type="text" list={`models-${prov.id}`} key={`m-${prov.id}`} defaultValue={cfg.models[prov.id] ?? ''}
            placeholder={prov.defaultModel || 'predefinito di Codex'} onBlur={e => save({ models: { [prov.id]: e.target.value.trim() } })} />
          <datalist id={`models-${prov.id}`}>{prov.models.filter(Boolean).map(m => <option key={m} value={m} />)}</datalist>

          {needsOllama && <>
            <label>URL Ollama</label>
            <input type="text" defaultValue={cfg.ollamaUrl} onBlur={e => save({ ollamaUrl: e.target.value.trim() || 'http://localhost:11434' })} />
          </>}

          <label>Lingua dei tag</label>
          <select value={cfg.language} onChange={e => save({ language: e.target.value })}>
            {Object.entries(defs.languages).map(([k, v]) => <option key={k} value={k}>{v[0].toUpperCase() + v.slice(1)}</option>)}
          </select>

          <label>Numero massimo di tag</label>
          <input type="number" min="1" max="20" defaultValue={cfg.maxTags} onBlur={e => save({ maxTags: Number(e.target.value) })} />

          <label>Richieste in parallelo</label>
          <input type="number" min="1" max="4" defaultValue={cfg.concurrency} onBlur={e => save({ concurrency: Number(e.target.value) })} />

          <label>Applica come tag</label>
          <label className="st-inline" style={{ opacity: 1 }}>
            <input type="checkbox" checked={!!cfg.applyAsTags} onChange={e => save({ applyAsTags: e.target.checked })} />
            <span>Aggiungi i tag suggeriti anche ai tag della libreria</span>
          </label>
        </div>

        <div className="st-inline" style={{ marginTop: 12 }}>
          <button className="btn" onClick={test} disabled={testing}>{testing ? 'Verifica…' : 'Prova connessione'}</button>
          {!cfg.encryption && <span className="muted" style={{ fontSize: 12 }}>Cifratura di sistema non disponibile: le chiavi sono salvate in chiaro nel database locale.</span>}
        </div>
        {msg && <div className={`st-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

        {prog && prog.total > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="st-inline">
              <span>{prog.running ? `Analisi in corso: ${prog.done}/${prog.total}` : `Completati ${prog.done}/${prog.total}`}</span>
              {prog.current && prog.running && <span className="muted">{prog.current}</span>}
              {prog.running && <button className="btn" onClick={() => api.ai.cancel()}>Annulla</button>}
            </div>
            <Progress done={prog.done} total={prog.total} />
            {prog.errors && prog.errors.length > 0 && (
              <div className="st-errors">{prog.errors.map((e, i) => <div key={i}>⚠ {e.name}: {e.error}</div>)}</div>
            )}
          </div>
        )}
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Per avviare l'analisi seleziona uno o più modelli e scegli “Tagga con IA”.</div>
      </div>

      <div className="panel st-section">
        <h3>Ricerca semantica</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Trova i modelli per significato (“supporto per cuffie”, “drago”) anche se il nome del file non lo contiene.
          Funziona meglio dopo aver generato tag e descrizioni.
        </div>
        <div className="st-grid">
          <label>Provider embeddings</label>
          <select value={embProv.id} onChange={e => save({ embed: { provider: e.target.value, model: '' } })}>
            {embProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label>Modello embeddings</label>
          <input type="text" key={`e-${embProv.id}`} list={`emb-${embProv.id}`} defaultValue={cfg.embed.model || ''} placeholder={embProv.defaultEmbedModel}
            onBlur={e => save({ embed: { model: e.target.value.trim() } })} />
          <datalist id={`emb-${embProv.id}`}>{(embProv.embedModels || []).map(m => <option key={m} value={m} />)}</datalist>
          {embProv.needsKey && <>
            <label>Chiave {embProv.name}</label>
            <div className="st-inline">
              {embKeyInfo.set ? <span className="badge">Salvata ({embKeyInfo.hint})</span> : <span className="muted">Nessuna chiave: impostala scegliendo {embProv.name} come provider qui sopra.</span>}
            </div>
          </>}
        </div>
        <div className="st-inline" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={embedAll} disabled={emb && emb.running}>Calcola embeddings</button>
          {emb && emb.running && <button className="btn" onClick={() => window.rtc.invoke('ai:embedCancel')}>Interrompi</button>}
          {emb && emb.total > 0 && <span className="muted">{emb.done}/{emb.total}</span>}
        </div>
        {emb && emb.total > 0 && <Progress done={emb.done} total={emb.total} />}
        {emb && emb.error && <div className="st-msg err">{emb.error}</div>}
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Cambiando provider o modello gli embeddings vanno ricalcolati.</div>
      </div>
    </div>
  );
}
