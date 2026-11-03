// Tema chiaro/scuro e colore d'accento. Salvati nel browser dell'app e comunicati al processo principale.
export const ACCENTS = [
  { id: 'arancione', label: 'Arancione', hex: '#ff7a3d' },
  { id: 'giallo', label: 'Giallo', hex: '#f2c400' },
  { id: 'rosso', label: 'Rosso', hex: '#e5484d' },
  { id: 'rosa', label: 'Rosa', hex: '#ff4f9a' },
  { id: 'viola', label: 'Viola', hex: '#9b6bff' },
  { id: 'blu', label: 'Blu', hex: '#4c8dff' },
  { id: 'turchese', label: 'Turchese', hex: '#14b8a6' },
  { id: 'verde', label: 'Verde', hex: '#2fbf71' },
];
export const MODES = [
  { id: 'dark', label: 'Scuro' },
  { id: 'light', label: 'Chiaro' },
  { id: 'system', label: 'Automatico' },
];
const DEFAULT = { mode: 'dark', accent: '#ff7a3d' };

const hexToRgb = (h) => { const n = parseInt(h.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (h, t, k) => { const a = hexToRgb(h), b = hexToRgb(t); return rgbToHex(...a.map((v, i) => v + (b[i] - v) * k)); };
const lum = (h) => { const c = hexToRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export function loadTheme() {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem('theme') || '{}') }; } catch { return { ...DEFAULT }; }
}

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
export function resolvedMode(t = loadTheme()) { return t.mode === 'system' ? (mq && mq.matches ? 'dark' : 'light') : t.mode; }

export function applyTheme(t = loadTheme(), { persist = false } = {}) {
  const root = document.documentElement;
  const mode = resolvedMode(t);
  root.dataset.theme = mode;
  let accent = /^#[0-9a-f]{6}$/i.test(t.accent) ? t.accent : DEFAULT.accent;
  // nel tema chiaro scurisce gli accenti troppo chiari perché restino leggibili sul fondo
  let text = accent;
  if (mode === 'light') { let k = 0; while (contrast(text, '#ffffff') < 3 && k < 0.6) { k += 0.08; text = mix(accent, '#000000', k); } }
  const s = root.style;
  s.setProperty('--accent', accent);
  s.setProperty('--accent-text', text);
  s.setProperty('--accent2', mode === 'dark' ? mix(accent, '#ffffff', 0.22) : mix(text, '#000000', 0.12));
  const [r, g, b] = hexToRgb(accent);
  s.setProperty('--accent-bg', `rgba(${r},${g},${b},${mode === 'dark' ? 0.15 : 0.12})`);
  s.setProperty('--accent-fg', contrast(accent, '#000000') >= contrast(accent, '#ffffff') ? '#14100c' : '#ffffff');
  if (persist) {
    try { localStorage.setItem('theme', JSON.stringify(t)); } catch {}
    try { window.rtc && window.rtc.invoke('app:setTheme', t.mode, mode); } catch {}
  }
  window.dispatchEvent(new CustomEvent('reticolo-theme', { detail: { ...t, resolved: mode } }));
  return mode;
}

export function initTheme() {
  applyTheme(loadTheme());
  if (mq) mq.addEventListener('change', () => { if (loadTheme().mode === 'system') applyTheme(loadTheme()); });
}

// colori correnti da passare a three.js
export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { viewerBg: v('--viewer-bg'), grid1: v('--grid1'), grid2: v('--grid2'), accent: v('--accent'), mode: document.documentElement.dataset.theme };
}

export function onThemeChange(fn) {
  const h = (e) => fn(e.detail);
  window.addEventListener('reticolo-theme', h);
  return () => window.removeEventListener('reticolo-theme', h);
}
