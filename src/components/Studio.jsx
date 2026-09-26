'use client';
import { useEffect, useMemo, useState } from 'react';
import MediaField from './MediaField';
import ModelPicker from './gen/ModelPicker';
import ParamsForm from './gen/ParamsForm';
import ResultPanel from './gen/ResultPanel';
import CostBar from './gen/CostBar';
import { carryParams } from './gen/params';
import { api, useGeneration, useEstimate } from './gen/useGeneration';
import { STUDIOS, FEATURED, MODE_LABEL } from '@/config/studios';

// Estúdio genérico (Imagem / Vídeo), guiado pelo schema de cada endpoint do catálogo.
// Props opcionais usadas pelo Cinema Studio:
//   beforePrompt   → controles extras (câmera, lente…) antes do prompt; pode ser função (promptDigitado) => nó
//   composePrompt  → (promptBase) => prompt final enviado ao modelo
//   meta           → objeto guardado junto dos parâmetros no histórico (ex.: { _cinema: {...} })
//   defaultParams  → padrões extras (ex.: negative_prompt), aplicados só se o modelo tiver o campo
//   featuredFirst  → chaves de recomendados que devem aparecer primeiro
export default function Studio({ studio, beforePrompt, composePrompt, meta, defaultParams, featuredFirst = [], emptyTitle, emptyText, promptPlaceholder }) {
  const cfg = STUDIOS[studio];
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('auto');
  const [selection, setSelection] = useState(null); // { type: 'featured', key } | { type: 'model', id }
  const [search, setSearch] = useState('');
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState({});
  const [media, setMedia] = useState({});
  const g = useGeneration();

  useEffect(() => {
    api(`/api/catalog?studio=${studio}`).then((d) => setCatalog(d.models)).catch((e) => setLoadError(e.message));
  }, [studio]);

  const byId = useMemo(() => new Map((catalog || []).map((m) => [m.id, m])), [catalog]);
  const modeIds = mode === 'auto' ? cfg.auto : [mode];

  // Recomendados que têm endpoint no modo atual (resolvidos pelo catálogo sincronizado).
  const featuredList = useMemo(() => {
    const list = FEATURED[studio]
      .map((f) => ({ ...f, models: Object.fromEntries(Object.entries(f.modes).map(([m, ep]) => [m, byId.get(ep)]).filter(([, v]) => v)) }))
      .filter((f) => modeIds.some((m) => f.models[m]));
    const rank = (f) => { const i = featuredFirst.indexOf(f.key); return i < 0 ? 999 : i; };
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [studio, byId, mode, featuredFirst.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const listAll = useMemo(() => (catalog || []).filter((m) => modeIds.includes(m.mode)), [catalog, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seleção efetiva (com fallback quando o modo muda e a seleção deixa de existir).
  const pickedFeatured = selection?.type === 'featured' ? featuredList.find((f) => f.key === selection.key) : null;
  const pickedModel = selection?.type === 'model' ? listAll.find((m) => m.id === selection.id) : null;
  const activeFeatured = pickedFeatured || (!pickedModel ? featuredList[0] || null : null);
  const listModel = pickedModel || (!activeFeatured ? listAll[0] || null : null);

  const autoMode = mode === 'auto' && !!activeFeatured;
  const [firstMode, secondMode] = cfg.auto;
  const defs = useMemo(() => {
    if (autoMode) return (activeFeatured.models[secondMode] || activeFeatured.models[firstMode])?.media || [];
    if (activeFeatured) return activeFeatured.models[mode]?.media || [];
    return listModel?.media || [];
  }, [autoMode, activeFeatured, listModel, mode, firstMode, secondMode]);
  const hasFiles = defs.some((d) => (media[d.name] || []).length > 0);

  // Endpoint automático: com mídia de referência usa o modo "com entrada" (ex.: edição); sem mídia, o de texto.
  const model = useMemo(() => {
    if (activeFeatured) {
      if (autoMode) return (hasFiles && activeFeatured.models[secondMode]) || activeFeatured.models[firstMode] || activeFeatured.models[secondMode];
      return activeFeatured.models[mode];
    }
    return listModel;
  }, [activeFeatured, autoMode, hasFiles, listModel, mode, firstMode, secondMode]);

  const modelKey = model?.id;
  useEffect(() => { if (model) setParams((p) => carryParams(p, model, defaultParams)); }, [modelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const estimate = useEstimate(studio, model, params, prompt);

  async function generate() {
    const sent = {};
    for (const d of model.media) if ((media[d.name] || []).length) sent[d.name] = media[d.name].map((f) => f.path);
    const finalPrompt = composePrompt ? composePrompt(prompt) : prompt;
    await g.run({
      studio, catalogId: model.id, prompt: finalPrompt, media: sent,
      params: { ...params, ...(meta || {}), ...(meta ? { _basePrompt: prompt } : {}) },
    });
  }

  const promptNeeded = model?.hasPrompt && model.promptRequired;
  const anyFile = model ? model.media.some((d) => (media[d.name] || []).length > 0) : false;
  const missingMedia = model ? (model.media.some((d) => d.required && !(media[d.name] || []).length)
    || (model.needsMedia && !anyFile && !params.draft_request_id)) : false;
  const canGenerate = model && !g.busy && !missingMedia && (!promptNeeded || prompt.trim());
  const verb = studio === 'video' ? 'vídeo' : 'imagem';

  if (loadError) return <div className="alert">{loadError}</div>;
  if (!catalog) return <p className="muted">Carregando modelos…</p>;

  const pickMode = (m) => { setMode(m); setSelection(null); setSearch(''); };
  return (
    <div className="studio">
      <div className="panel panel-pad stack">
        <section>
          <h3 className="step"><b>1</b> Tipo de geração</h3>
          <div className="chips">
            <button className={`chip ${mode === 'auto' ? 'on' : ''}`} onClick={() => pickMode('auto')}>Automático</button>
            {cfg.modes.map(([id, label]) => <button key={id} className={`chip ${mode === id ? 'on' : ''}`} onClick={() => pickMode(id)}>{label}</button>)}
          </div>
          {mode === 'auto' && <p className="hint">Usa texto → {verb}; se você enviar uma mídia de referência, troca sozinho para o endpoint com entrada.</p>}
        </section>

        <section>
          <h3 className="step"><b>2</b> Modelo</h3>
          <ModelPicker featured={featuredList} activeFeaturedKey={activeFeatured?.key} onPickFeatured={(key) => setSelection({ type: 'featured', key })}
            models={listAll} search={search} onSearch={setSearch} activeModelId={listModel?.id} onPickModel={(id) => setSelection({ type: 'model', id })}
            tag={mode === 'auto' ? (m) => MODE_LABEL[m.mode] : undefined} placeholder="Buscar modelo (Kling, Veo, Flux, Ideogram…)"
            hint={activeFeatured && model && (
              <p className="hint" style={{ marginTop: 10 }}>
                {autoMode ? (hasFiles ? 'Com mídia de referência: ' : 'Sem mídia de referência: ') : ''}usando <b>{model.name}</b> <span className="mono">({model.endpoint})</span>
              </p>
            )} />
          {!activeFeatured && !listAll.length && <p className="hint">Nenhum modelo neste tipo de geração.</p>}
        </section>

        {model && (
          <section className="stack">
            <h3 className="step"><b>3</b> Conteúdo e parâmetros</h3>
            {model.needsMedia && !autoMode && <div className="notice">Este modelo exige ao menos uma mídia de referência.</div>}
            {defs.map((d) => (
              <MediaField key={d.name} def={d} showRequired={!autoMode} files={media[d.name] || []} onError={g.setError}
                onChange={(list) => setMedia((m) => ({ ...m, [d.name]: list }))} />
            ))}
            {typeof beforePrompt === 'function' ? beforePrompt(prompt) : beforePrompt}
            {model.hasPrompt && (
              <label className="field"><span className="lbl">Prompt {!promptNeeded && <span>opcional</span>}</span>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
                  placeholder={promptPlaceholder || (hasFiles ? 'Descreva o que fazer com a mídia enviada…' : `Descreva o ${verb} que você quer…`)} /></label>
            )}
            <ParamsForm model={model} params={params} setParams={setParams} />
            {model.limited && <div className="notice">Este modelo tem campos que a interface ainda não suporta; a geração pode ser recusada pela MuAPI.</div>}
          </section>
        )}

        <hr className="rule" />
        <section className="stack">
          <CostBar estimate={estimate} />
          {g.error && <div className="alert" role="alert">{g.error}</div>}
          <button className="btn primary block" disabled={!canGenerate} onClick={generate}>{g.busy ? 'Gerando…' : 'Gerar'}</button>
        </section>
      </div>

      <ResultPanel gen={g.gen} sessionCost={g.sessionCost} emptyTitle={emptyTitle} emptyText={emptyText}
        note={studio === 'video' ? 'Vídeos levam alguns minutos. Pode sair: o resultado fica no Histórico.' : undefined} />
    </div>
  );
}
