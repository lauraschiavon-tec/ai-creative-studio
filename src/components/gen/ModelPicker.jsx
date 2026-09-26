'use client';
import { useState } from 'react';

// Seletor de modelos: "Recomendados" (destaques) + "Todos os modelos" (catálogo completo do modo, com busca).
export default function ModelPicker({ featured = [], activeFeaturedKey, onPickFeatured, models, search, onSearch, activeModelId, onPickModel, tag, hint, placeholder = 'Buscar modelo…' }) {
  const [showAll, setShowAll] = useState(false);
  const q = search.trim().toLowerCase();
  const visible = q ? models.filter((m) => `${m.name} ${m.provider} ${m.id}`.toLowerCase().includes(q)) : models;
  return (
    <>
      {!!featured.length && (
        <div className="feats" role="listbox" aria-label="Modelos recomendados">
          {featured.map((f) => (
            <button key={f.key} className={`feat ${activeFeaturedKey === f.key ? 'on' : ''}`} onClick={() => onPickFeatured(f.key)}>
              <span className="tag">Recomendado</span><b>{f.label}</b><small>{f.provider}{f.note ? ` · ${f.note}` : ''}</small>
            </button>
          ))}
        </div>
      )}
      {hint}
      <details className="adv" style={{ marginTop: 14 }} open={showAll || (!activeFeaturedKey && !!activeModelId)} onToggle={(e) => setShowAll(e.currentTarget.open)}>
        <summary>Todos os modelos ({models.length})</summary>
        <input type="search" placeholder={placeholder} value={search} onChange={(e) => onSearch(e.target.value)} />
        <div className="models" role="listbox" aria-label="Todos os modelos">
          {visible.map((m) => (
            <button key={m.id} className={`model ${!activeFeaturedKey && activeModelId === m.id ? 'on' : ''}`} onClick={() => onPickModel(m.id)}>
              <span>{m.name}</span><small>{m.provider}{tag ? ` · ${tag(m)}` : ''}</small>
            </button>
          ))}
          {!visible.length && <div className="hint" style={{ padding: 12 }}>Nenhum modelo encontrado.</div>}
        </div>
      </details>
    </>
  );
}
