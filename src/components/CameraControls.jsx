'use client';
import { CAMERAS, LENSES, FOCAL_LENGTHS, APERTURES, MOVEMENTS, buildCinemaPrompt } from '@/config/cinema';

function Tiles({ items, value, onChange, label }) {
  return (
    <div className="tiles" role="listbox" aria-label={label}>
      {items.map((it) => (
        <button key={it.id} type="button" className={`tile ${value === it.id ? 'on' : ''}`} onClick={() => onChange(it.id)} title={it.id}>
          <img src={it.img} alt="" loading="lazy" />
          <span>{it.id}</span>
        </button>
      ))}
    </div>
  );
}

// Controles visuais de câmera. As escolhas viram texto no prompt (ver config/cinema.js).
export default function CameraControls({ value, onChange, kind, basePrompt }) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  const finalPrompt = buildCinemaPrompt(basePrompt || '…', value, kind);
  return (
    <div className="camera stack" style={{ '--gap': '16px' }}>
      <div className="field"><div className="lbl">Câmera</div><Tiles items={CAMERAS} value={value.camera} onChange={set('camera')} label="Câmera" /></div>
      <div className="field"><div className="lbl">Lente</div><Tiles items={LENSES} value={value.lens} onChange={set('lens')} label="Lente" /></div>
      <div className="field">
        <div className="lbl">Distância focal<span>{value.focal} mm</span></div>
        <div className="seg small">
          {FOCAL_LENGTHS.map((f) => <button type="button" key={f.mm} className={value.focal === f.mm ? 'on' : ''} onClick={() => set('focal')(f.mm)} title={f.label}>{f.mm}</button>)}
        </div>
        <div className="hint">{FOCAL_LENGTHS.find((f) => f.mm === value.focal)?.label}</div>
      </div>
      <div className="field">
        <div className="lbl">Abertura</div>
        <div className="tiles small" role="listbox" aria-label="Abertura">
          {APERTURES.map((a) => (
            <button key={a.id} type="button" className={`tile ${value.aperture === a.id ? 'on' : ''}`} onClick={() => set('aperture')(a.id)}>
              <img src={a.img} alt="" loading="lazy" /><span>{a.id}<br /><small>{a.label}</small></span>
            </button>
          ))}
        </div>
      </div>
      {kind === 'video' && (
        <div className="field">
          <div className="lbl">Movimento de câmera</div>
          <div className="chips">
            {MOVEMENTS.map((m) => <button type="button" key={m.id} className={`chip ${value.movement === m.id ? 'on' : ''}`} onClick={() => set('movement')(m.id)}>{m.label}</button>)}
          </div>
        </div>
      )}
      <details className="adv"><summary>Ver o prompt final que será enviado</summary><p className="mono" style={{ margin: 0, lineHeight: 1.5 }}>{finalPrompt}</p></details>
    </div>
  );
}
