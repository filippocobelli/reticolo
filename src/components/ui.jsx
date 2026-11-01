import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { onEvent } from '../api.js';

// ---------- eventi dal processo principale ----------
export function useEvent(channels, fn, deps = []) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    const set = new Set([].concat(channels));
    return onEvent((ch, p) => { if (set.has(ch)) ref.current(p, ch); });
  }, deps); // eslint-disable-line
}

// ---------- toast + menu + dialoghi ----------
const UICtx = createContext(null);
export const useUI = () => useContext(UICtx);

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [menu, setMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const toast = useCallback((text, type = 'info', ms = 3500) => {
    const id = Math.random();
    setToasts(t => [...t, { id, text, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ms);
  }, []);
  const error = useCallback((e) => toast(String(e && e.message || e), 'error', 6000), [toast]);
  const openMenu = useCallback((e, items) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, items }); }, []);
  const prompt = useCallback((title, def = '', opts = {}) => new Promise((res) => setModal({ kind: 'prompt', title, def, opts, res })), []);
  const confirm = useCallback((title, text, opts = {}) => new Promise((res) => setModal({ kind: 'confirm', title, text, opts, res })), []);
  const close = (v) => { modal && modal.res(v); setModal(null); };

  useEffect(() => {
    if (!menu) return;
    const h = () => setMenu(null);
    window.addEventListener('click', h); window.addEventListener('blur', h);
    return () => { window.removeEventListener('click', h); window.removeEventListener('blur', h); };
  }, [menu]);

  return (
    <UICtx.Provider value={{ toast, error, openMenu, prompt, confirm }}>
      {children}
      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}
      {modal && <Modal modal={modal} close={close} />}
      <div className="toasts">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.text}</div>)}</div>
    </UICtx.Provider>
  );
}

function Menu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  return (
    <div className="menu" ref={ref} style={pos} onClick={e => e.stopPropagation()}>
      {items.filter(Boolean).map((it, i) => it === '-' ? <div key={i} className="sep" /> :
        it.header ? <div key={i} className="mh">{it.header}</div> :
        <div key={i} className={`mi ${it.disabled ? 'disabled' : ''}`} onClick={() => { onClose(); it.onClick && it.onClick(); }}>
          {it.icon && <span className="ico">{it.icon}</span>}{it.label}
        </div>)}
    </div>
  );
}

function Modal({ modal, close }) {
  const [val, setVal] = useState(modal.def || '');
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close(modal.kind === 'confirm' ? false : null)}>
      <div className="modal">
        <h2>{modal.title}</h2>
        {modal.text && <p className="muted">{modal.text}</p>}
        {modal.kind === 'prompt' && <input autoFocus style={{ width: '100%' }} value={val} placeholder={modal.opts.placeholder || ''}
          onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') close(val); if (e.key === 'Escape') close(null); }} />}
        <div className="row end">
          <button className="btn" onClick={() => close(modal.kind === 'confirm' ? false : null)}>Annulla</button>
          <button className={`btn ${modal.opts.danger ? 'danger' : 'primary'}`} autoFocus={modal.kind === 'confirm'} onClick={() => close(modal.kind === 'confirm' ? true : val)}>{modal.opts.ok || 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- utilità ----------
export const fmtSize = (b) => { if (b == null) return ''; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return `${b.toFixed(b < 10 && i ? 1 : 0)} ${u[i]}`; };
export const fmtDate = (t) => t ? new Date(t).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : '';
export const fmtDims = (d) => d ? d.map(n => (Math.round(n * 10) / 10).toLocaleString('it-IT')).join(' × ') + ' mm' : '';
export const fmtMin = (m) => { if (m == null || isNaN(m)) return '—'; const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h}h ${mm}m` : `${mm}m`; };
export const fmtNum = (n) => n == null ? '' : Number(n).toLocaleString('it-IT');
export const FORMAT_COLORS = { stl: '#5aa9ff', '3mf': '#3ccf8e', obj: '#c38bff', step: '#f3c04c', stp: '#f3c04c', gcode: '#ff7a3d', gco: '#ff7a3d', zip: '#9aa3b2', rar: '#9aa3b2', '7z': '#9aa3b2', dxf: '#ff5d9e', lbrn: '#ff5d9e', lbrn2: '#ff5d9e', xcs: '#ff5d9e', glb: '#4fd1c5', ply: '#4fd1c5', fbx: '#c38bff', '3dm': '#f3c04c', f3d: '#f3c04c' };

export function Logo({ size = 22 }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" stroke="#ff7a3d" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 7l9 5 9-5M12 12v10M7.5 4.5l9 5M16.5 4.5l-9 5" stroke="#ff9a66" strokeWidth="1" opacity=".7" />
    </svg>
  );
}
