'use client';
import { paramLabel } from './format';

// Renderiza um parâmetro a partir do schema do modelo (enum, boolean, número, texto).
export default function ParamField({ name, def, value, onChange }) {
  const label = paramLabel(name, def);
  const hint = def.description && def.description.length < 140 ? def.description : null;
  const numeric = ['int', 'integer', 'number', 'float'].includes(def.type);

  if (def.enum) {
    return (
      <div className="field">
        <div className="lbl">{label}</div>
        {def.enum.length <= 5 && def.enum.join('').length < 34 ? (
          <div className="seg small">
            {def.enum.map((o) => (
              <button type="button" key={String(o)} className={value === o ? 'on' : ''} onClick={() => onChange(o)}>{String(o)}</button>
            ))}
          </div>
        ) : (
          <select value={value ?? ''} onChange={(e) => onChange(typeof def.enum[0] === 'number' ? Number(e.target.value) : e.target.value)}>
            {def.enum.map((o) => <option key={String(o)} value={o}>{String(o)}</option>)}
          </select>
        )}
      </div>
    );
  }
  if (def.type === 'boolean') {
    return (
      <div className="field">
        <label className="switch"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />{label}</label>
        {hint && <div className="hint">{hint}</div>}
      </div>
    );
  }
  if (numeric) {
    const bounded = def.minValue !== undefined && def.maxValue !== undefined && (def.maxValue - def.minValue) / (def.step || 1) <= 4096;
    return (
      <div className="field">
        <div className="lbl">{label}<span>{value ?? ''}</span></div>
        {bounded ? (
          <input type="range" min={def.minValue} max={def.maxValue} step={def.step || (def.type === 'float' || def.type === 'number' ? 0.1 : 1)}
            value={value ?? def.default ?? def.minValue} onChange={(e) => onChange(Number(e.target.value))} />
        ) : (
          <input type="number" value={value ?? ''} min={def.minValue} max={def.maxValue} step={def.step || 'any'}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
        )}
        {hint && <div className="hint">{hint}</div>}
      </div>
    );
  }
  return (
    <div className="field">
      <div className="lbl">{label}</div>
      <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
