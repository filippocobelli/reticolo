// Controlli di input condivisi dai generatori
export function Slider({ label, value, min, max, step = 1, unit = 'mm', onChange }) {
  return (
    <div className="field">
      <label>{label} <span className="val">{Number(value).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)}{unit ? ` ${unit}` : ''}</span></label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}
export function Check({ label, value, onChange }) {
  return (
    <label className="row" style={{ gap: 8, alignItems: 'center', margin: '6px 0' }}>
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} /> {label}
    </label>
  );
}
export function Select({ label, value, options, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
export function Color({ label, value, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
