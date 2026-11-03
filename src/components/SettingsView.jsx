import React, { useEffect, useState } from 'react';
import { api, KOFI_URL, REPO_URL, SITE_URL } from '../api.js';
import { ACCENTS, MODES, loadTheme, applyTheme } from '../theme.js';
import { useUI, useEvent, fmtDate, fmtSize } from './ui.jsx';
import AISettings from './AISettings.jsx';
import SlicerSettings from './SlicerSettings.jsx';

function ShortcutInput({ value, onSave }) {
  const [v, setV] = useState(value || '');
  const [rec, setRec] = useState(false);
  const onKey = (e) => {
    if (!rec) return;
    e.preventDefault();
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
    const parts = [];
    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    const k = e.key.length === 1 ? e.key.toUpperCase() : e.key === ' ' ? 'Space' : e.key;
    parts.push(k);
    const acc = parts.join('+'); setV(acc); setRec(false); onSave(acc);
  };
  return (
    <div className="row">
      <input readOnly value={rec ? 'Premi la combinazione…' : v} onKeyDown={onKey} onFocus={() => setRec(true)} onBlur={() => setRec(false)} style={{ width: 260 }} />
      <button className="btn sm" onClick={() => { setV(''); onSave(''); }}>Disattiva</button>
    </div>
  );
}

function Sources() {
  const ui = useUI();
  const [list, setList] = useState([]);
  const load = () => api.sources.list().then(setList);
  useEffect(() => { load(); }, []);
  useEvent(['sources-changed'], load);
  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 10 }}><h2 style={{ margin: 0 }}>Sorgenti</h2><div className="spacer" />
        <button className="btn sm" onClick={() => api.scan.rescan()}>↻ Riscansiona tutto</button>
        <button className="btn sm primary" onClick={() => api.sources.add().catch(ui.error)}>＋ Aggiungi cartella</button></div>
      <p className="small muted">Cartelle locali, dischi esterni o condivisioni NAS (montale prima nel sistema). Reticolo legge i file senza caricarli, spostarli o rinominarli.</p>
      {list.length === 0 ? <div className="muted">Nessuna sorgente.</div> : <div className="list">
        {list.map(s => <div key={s.id} className="list-item">
          <div className="grow"><div style={{ fontWeight: 600 }}>{s.name}</div><div className="mono muted">{s.path}</div>
            <div className="small muted">{s.count} modelli · ultima scansione {s.last_scan ? fmtDate(s.last_scan) : 'mai'}</div></div>
          <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={!!s.watch} onChange={e => api.sources.setWatch(s.id, e.target.checked).then(load)} /> Sorveglia</label>
          <button className="btn sm" onClick={() => api.scan.rescan(s.id)}>↻</button>
          <button className="btn sm danger" onClick={async () => { if (await ui.confirm('Rimuovere la sorgente?', 'I file su disco non vengono toccati.', { ok: 'Rimuovi', danger: true })) api.sources.remove(s.id); }}>Rimuovi</button>
        </div>)}
      </div>}
    </div>
  );
}

function Backup() {
  const ui = useUI();
  const [s, setS] = useState(null);
  const [list, setList] = useState([]);
  const load = () => { api.backup.settings().then(setS); api.backup.list().then(setList); };
  useEffect(() => { load(); }, []);
  useEvent(['backup-done'], load);
  if (!s) return null;
  const upd = (patch) => api.backup.setSettings(patch).then(setS);
  return (
    <div className="panel">
      <h2>Backup</h2>
      <p className="small muted">Salva tag, raccolte, note, copertine, coda di stampa e revisioni dei duplicati. Al ripristino gli elementi vengono riconosciuti anche se rinominati o spostati.</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn primary" onClick={async () => { const r = await api.backup.create().catch(ui.error); if (r) { ui.toast(`Backup salvato (${r.items} elementi)`, 'ok'); load(); } }}>Crea backup…</button>
        <button className="btn" onClick={async () => { const r = await api.backup.restore().catch(ui.error); if (r) ui.toast(`Ripristinati ${r.matched} elementi${r.unmatched ? `, ${r.unmatched} non trovati` : ''}`, 'ok'); }}>Ripristina da file…</button>
      </div>
      <div className="row">
        <div className="field"><label>Backup automatico</label>
          <select value={s.auto} onChange={e => upd({ auto: e.target.value })}><option value="off">Disattivato</option><option value="daily">Giornaliero</option><option value="weekly">Settimanale</option></select></div>
        <div className="field"><label>Copie da conservare</label><input type="number" min={1} max={100} value={s.keep} onChange={e => upd({ keep: Number(e.target.value) || 10 })} style={{ width: 90 }} /></div>
        <div className="field grow"><label>Cartella</label><div className="row"><input readOnly value={s.dir} className="grow" />
          <button className="btn sm" onClick={async () => { const r = await window.rtc.invoke('backup:pickDir').catch(() => null); if (r) upd({ dir: r }); }}>Cambia…</button></div></div>
      </div>
      {s.last && <div className="small muted">Ultimo backup automatico: {fmtDate(s.last)}</div>}
      {list.length > 0 && <div className="list" style={{ marginTop: 10 }}>{list.slice(0, 6).map(b => <div key={b.path} className="list-item">
        <div className="grow"><div>{b.name}</div><div className="small muted">{fmtDate(b.mtime)} · {fmtSize(b.size)}</div></div>
        <button className="btn sm" onClick={async () => { if (await ui.confirm('Ripristinare questo backup?', 'I dati vengono uniti a quelli attuali.')) { const r = await api.backup.restore(b.path).catch(ui.error); if (r) ui.toast(`Ripristinati ${r.matched} elementi`, 'ok'); } }}>Ripristina</button>
      </div>)}</div>}
    </div>
  );
}

function Appearance() {
  const [t, setT] = useState(loadTheme);
  const set = (patch) => { const n = { ...t, ...patch }; setT(n); applyTheme(n, { persist: true }); };
  const custom = !ACCENTS.some(a => a.hex.toLowerCase() === String(t.accent).toLowerCase());
  return (
    <div className="panel">
      <h2>Aspetto</h2>
      <div className="field"><label>Tema</label>
        <div className="seg">{MODES.map(m => <button key={m.id} className={t.mode === m.id ? 'on' : ''} onClick={() => set({ mode: m.id })}>{m.label}</button>)}</div>
        <div className="hint">"Automatico" segue l'aspetto chiaro/scuro del sistema.</div>
      </div>
      <div className="field"><label>Colore d'accento</label>
        <div className="swatches">
          {ACCENTS.map(a => <button key={a.id} className={`swatch-btn ${String(t.accent).toLowerCase() === a.hex ? 'on' : ''}`} style={{ background: a.hex }} title={a.label} aria-label={a.label} onClick={() => set({ accent: a.hex })} />)}
          <label className="row" style={{ gap: 6, marginLeft: 6 }} title="Colore personalizzato">
            <input type="color" value={t.accent} onChange={e => set({ accent: e.target.value })} />
            <span className={custom ? '' : 'muted'}>Personalizzato</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function About({ info }) {
  return (
    <div className="panel">
      <h2>Informazioni</h2>
      <p style={{ marginTop: 0 }}>Reticolo è <b>gratuito</b>. Se ti è utile e vuoi sostenerne lo sviluppo, puoi offrirmi un caffè su Ko-fi.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <a className="kofi-btn" href={KOFI_URL} target="_blank" rel="noreferrer">☕ Sostieni su Ko-fi</a>
        <a className="btn" href={SITE_URL} target="_blank" rel="noreferrer">Sito</a>
        <a className="btn" href={REPO_URL} target="_blank" rel="noreferrer">Codice su GitHub</a>
        <a className="btn" href={REPO_URL + '/releases/latest'} target="_blank" rel="noreferrer">Aggiornamenti</a>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Idea e test di Filippo Cobelli; il codice è scritto con l'intelligenza artificiale (Claude).{info ? ` Versione ${info.version}.` : ''}</p>
    </div>
  );
}

export default function SettingsView() {
  const ui = useUI();
  const [st, setSt] = useState(null);
  const [info, setInfo] = useState(null);
  useEffect(() => { api.settings.get().then(setSt); api.app.info().then(setInfo); }, []);
  if (!st) return <div className="content" />;
  const set = (patch) => { setSt({ ...st, ...patch }); api.settings.set(patch); };
  return (
    <div className="content"><div className="settings-grid">
      <h1>Impostazioni</h1>
      <Appearance />
      <div className="panel">
        <h2>Generale</h2>
        <div className="field"><label>Scorciatoia globale per portare Reticolo in primo piano</label>
          <ShortcutInput value={st.globalShortcut ?? 'CommandOrControl+Shift+M'} onSave={(acc) => api.app.setShortcut(acc).then(() => ui.toast('Scorciatoia aggiornata', 'ok'))} /></div>
        <label className="check"><input type="checkbox" checked={st.scanOnStartup ?? true} onChange={e => set({ scanOnStartup: e.target.checked })} /> Controlla le sorgenti all'avvio</label>
        <label className="check"><input type="checkbox" checked={st.watchFolders ?? true} onChange={e => set({ watchFolders: e.target.checked })} /> Aggiorna automaticamente quando i file cambiano</label>
        <label className="check"><input type="checkbox" checked={st.watchPolling ?? false} onChange={e => set({ watchPolling: e.target.checked })} /> Usa il controllo periodico (consigliato per NAS e unità di rete)</label>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => api.thumbs.regenerate().then(() => ui.toast('Rigenerazione miniature avviata'))}>Rigenera tutte le miniature</button>
          <button className="btn sm" onClick={async () => { const n = await api.items.purgeMissing(); ui.toast(`${n} elementi rimossi dall'indice`, 'ok'); }}>Pulisci elementi non più trovati</button>
        </div>
      </div>
      <Sources />
      <SlicerSettings />
      <AISettings />
      <Backup />
      <About info={info} />
      {info && <div className="small muted">Reticolo {info.version} · {info.platform} · dati in <span className="mono">{info.userData}</span></div>}
    </div></div>
  );
}
