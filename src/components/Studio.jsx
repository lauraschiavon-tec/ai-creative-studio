'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import ParamField from './ParamField';
import MediaField from './MediaField';
import { usd, credits, STATUS, isDone, PRIMARY } from './format';
import { STUDIOS, FEATURED, MODE_LABEL } from '@/config/studios';

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro inesperado. Tente novamente.');
  return data;
}

// Mantém o que o usuário já escolheu quando o novo modelo aceita o mesmo valor; senão usa o padrão do modelo.
function carryParams(prev, model) {
  const next = {};
  for (const [k, def] of Object.entries(model.inputs)) {
    const v = prev[k];
    const numeric = ['int', 'integer', 'number', 'float'].includes(def.type);
    const ok = v !== undefined && (def.enum ? def.enum.includes(v)
      : numeric ? typeof v === 'number' && (def.minValue === undefined || v >= def.minValue) && (def.maxValue === undefined || v <= def.maxValue)
      : def.type === 'boolean' ? typeof v === 'boolean' : typeof v === 'string');
    if (ok) next[k] = v;
    else if (def.default !== undefined) next[k] = def.default;
    else if (def.required && def.enum) next[k] = def.enum[0];            // obrigatório sem padrão: pré-seleciona a 1ª opção
    else if (def.required && numeric && def.minValue !== undefined) next[k] = def.minValue;
  }
  return next;
}

export default function Studio({ studio }) {
  const cfg = STUDIOS[studio];
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('auto');
  const [selection, setSelection] = useState(null); // { type: 'featured', key } | { type: 'model', id }
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState({});
  const [media, setMedia] = useState({});
  const [gen, setGen] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [sessionCost, setSessionCost] = useState({ usd: 0, credits: 0, n: 0 });
  const counted = useRef(new Set());

  useEffect(() => {
    api(`/api/catalog?studio=${studio}`).then((d) => setCatalog(d.models)).catch((e) => setLoadError(e.message));
  }, [studio]);

  const byId = useMemo(() => new Map((catalog || []).map((m) => [m.id, m])), [catalog]);
  const modeIds = mode === 'auto' ? cfg.auto : [mode];

  // Recomendados que têm endpoint no modo atual (resolvidos pelo catálogo sincronizado).
  const featuredList = useMemo(() => FEATURED[studio]
    .map((f) => ({ ...f, models: Object.fromEntries(Object.entries(f.modes).map(([m, ep]) => [m, byId.get(ep)]).filter(([, v]) => v)) }))
    .filter((f) => modeIds.some((m) => f.models[m])), [studio, byId, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const listAll = useMemo(() => (catalog || []).filter((m) => modeIds.includes(m.mode)), [catalog, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? listAll.filter((m) => `${m.name} ${m.provider} ${m.id}`.toLowerCase().includes(q)) : listAll;
  }, [listAll, search]);

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
  useEffect(() => { if (model) { setParams((p) => carryParams(p, model)); setEstimate(null); } }, [modelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields = useMemo(() => {
    if (!model) return { main: [], adv: [] };
    const all = Object.entries(model.inputs);
    return { main: all.filter(([k]) => PRIMARY.includes(k)), adv: all.filter(([k]) => !PRIMARY.includes(k)) };
  }, [model]);

  // Estimativa de custo (debounce) — best-effort.
  useEffect(() => {
    if (!model) return;
    setEstimate(null);
    const t = setTimeout(() => {
      api('/api/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studio, catalogId: model.id, prompt, params }) })
        .then(setEstimate).catch(() => setEstimate({ available: false }));
    }, 700);
    return () => clearTimeout(t);
  }, [model, params, prompt, studio]);

  // Acompanha a geração até terminar.
  const genId = gen?.id;
  const genDone = gen ? isDone(gen.status) : true;
  useEffect(() => {
    if (!genId || genDone) return;
    let stop = false; let timer;
    const tick = async () => {
      try { const g = await api(`/api/generations/${genId}`); if (!stop) setGen(g); if (!stop && !isDone(g.status)) timer = setTimeout(tick, 3000); }
      catch { if (!stop) timer = setTimeout(tick, 6000); }
    };
    timer = setTimeout(tick, 2000);
    return () => { stop = true; clearTimeout(timer); };
  }, [genId, genDone]);

  useEffect(() => {
    if (gen?.status === 'completed' && !counted.current.has(gen.id)) {
      counted.current.add(gen.id);
      setSessionCost((c) => ({ usd: c.usd + Number(gen.cost_usd || 0), credits: c.credits + Number(gen.cost_credits || 0), n: c.n + 1 }));
    }
  }, [gen]);

  async function generate() {
    setError(''); setBusy(true);
    try {
      const sent = {};
      for (const d of model.media) if ((media[d.name] || []).length) sent[d.name] = media[d.name].map((f) => f.path);
      setGen(await api('/api/generations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studio, catalogId: model.id, prompt, params, media: sent }),
      }));
    } catch (e) { setError(e.message); setGen(null); } finally { setBusy(false); }
  }

  const promptNeeded = model?.hasPrompt && model.promptRequired;
  const anyFile = model ? model.media.some((d) => (media[d.name] || []).length > 0) : false;
  const missingMedia = model ? (model.media.some((d) => d.required && !(media[d.name] || []).length)
    || (model.needsMedia && !anyFile && !params.draft_request_id)) : false;
  const canGenerate = model && !busy && !missingMedia && (!promptNeeded || prompt.trim());
  const running = gen && !isDone(gen.status);
  const verb = studio === 'video' ? 'vídeo' : 'imagem';

  if (loadError) return <div className="alert">{loadError}</div>;
  if (!catalog) return <p className="muted">Carregando modelos…</p>;

  return (
    <div className="studio">
      <div className="panel panel-pad stack">
        <section>
          <h3 className="step"><b>1</b> Tipo de geração</h3>
          <div className="chips">
            <button className={`chip ${mode === 'auto' ? 'on' : ''}`} onClick={() => { setMode('auto'); setSelection(null); setSearch(''); }}>Automático</button>
            {cfg.modes.map(([id, label]) => (
              <button key={id} className={`chip ${mode === id ? 'on' : ''}`} onClick={() => { setMode(id); setSelection(null); setSearch(''); }}>{label}</button>
            ))}
          </div>
          {mode === 'auto' && <p className="hint">Usa texto → {verb}; se você enviar uma mídia de referência, troca sozinho para o endpoint com entrada.</p>}
        </section>

        <section>
          <h3 className="step"><b>2</b> Modelo</h3>
          {!!featuredList.length && (
            <div className="feats" role="listbox" aria-label="Modelos recomendados">
              {featuredList.map((f) => (
                <button key={f.key} className={`feat ${activeFeatured?.key === f.key ? 'on' : ''}`} onClick={() => setSelection({ type: 'featured', key: f.key })}>
                  <span className="tag">Recomendado</span>
                  <b>{f.label}</b>
                  <small>{f.provider}{f.note ? ` · ${f.note}` : ''}</small>
                </button>
              ))}
            </div>
          )}
          {activeFeatured && model && (
            <p className="hint" style={{ marginTop: 10 }}>
              {autoMode ? (hasFiles ? 'Com mídia de referência: ' : 'Sem mídia de referência: ') : ''}usando <b>{model.name}</b> <span className="mono">({model.endpoint})</span>
            </p>
          )}

          <details className="adv" style={{ marginTop: 14 }} open={showAll || (!activeFeatured && !!listModel)} onToggle={(e) => setShowAll(e.currentTarget.open)}>
            <summary>Todos os modelos ({listAll.length})</summary>
            <input type="search" placeholder="Buscar modelo (Kling, Veo, Flux, Ideogram…)" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="models" role="listbox" aria-label="Todos os modelos">
              {visible.map((m) => (
                <button key={m.id} className={`model ${!activeFeatured && listModel?.id === m.id ? 'on' : ''}`} onClick={() => setSelection({ type: 'model', id: m.id })}>
                  <span>{m.name}</span><small>{m.provider}{mode === 'auto' ? ` · ${MODE_LABEL[m.mode]}` : ''}</small>
                </button>
              ))}
              {!visible.length && <div className="hint" style={{ padding: 12 }}>Nenhum modelo encontrado.</div>}
            </div>
          </details>
          {!activeFeatured && !listAll.length && <p className="hint">Nenhum modelo neste tipo de geração.</p>}
        </section>

        {model && (
          <section className="stack">
            <h3 className="step"><b>3</b> Conteúdo e parâmetros</h3>

            {model.needsMedia && !autoMode && <div className="notice">Este modelo exige ao menos uma mídia de referência.</div>}
            {defs.map((d) => (
              <MediaField key={d.name} def={d} showRequired={!autoMode} files={media[d.name] || []} onError={setError}
                onChange={(list) => setMedia((m) => ({ ...m, [d.name]: list }))} />
            ))}

            {model.hasPrompt && (
              <label className="field"><span className="lbl">Prompt {!promptNeeded && <span>opcional</span>}</span>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
                  placeholder={hasFiles ? `Descreva o que fazer com a mídia enviada…` : `Descreva o ${verb} que você quer…`} /></label>
            )}

            {fields.main.map(([k, def]) => <ParamField key={k} name={k} def={def} value={params[k]} onChange={(v) => setParams((p) => ({ ...p, [k]: v }))} />)}
            {!!fields.adv.length && (
              <details className="adv"><summary>Opções avançadas ({fields.adv.length})</summary>
                <div className="stack">{fields.adv.map(([k, def]) => <ParamField key={k} name={k} def={def} value={params[k]} onChange={(v) => setParams((p) => ({ ...p, [k]: v }))} />)}</div>
              </details>
            )}
            {model.limited && <div className="notice">Este modelo tem campos que a interface ainda não suporta; a geração pode ser recusada pela MuAPI.</div>}
          </section>
        )}

        <hr className="rule" />
        <section className="stack">
          <div className="costbar">
            <span>Custo estimado</span>
            <span className="big">{estimate === null ? '…' : estimate.available ? usd(estimate.usd) : <span className="muted" style={{ fontSize: 13, fontWeight: 400, fontFamily: 'var(--font-body)' }}>indisponível</span>}</span>
          </div>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn primary block" disabled={!canGenerate} onClick={generate}>{busy ? 'Enviando…' : running ? 'Gerar outro' : 'Gerar'}</button>
        </section>
      </div>

      <div className="stack">
        <div className="panel canvas">
          {!gen && (
            <div className="canvas-empty">
              <h2>Sua mesa está vazia.</h2>
              <p>Escolha o tipo, o modelo, descreva o que precisa e clique em <b>Gerar</b>. O resultado aparece aqui, com custo e download.</p>
            </div>
          )}
          {gen && !isDone(gen.status) && (
            <div className="developing"><div className="lbl">Revelando…<small>{STATUS[gen.status]?.[0]} · {gen.model_name}</small>
              {studio === 'video' && <small>Vídeos levam alguns minutos. Pode sair: o resultado fica no Histórico.</small>}</div></div>
          )}
          {gen?.status === 'failed' && (
            <div style={{ maxWidth: 460 }} className="stack">
              <div className="alert" role="alert"><b>Não foi possível gerar.</b><br />{gen.error}</div>
              {gen.refunded && <div className="notice">O valor desta geração foi estornado.</div>}
            </div>
          )}
          {gen?.status === 'completed' && (
            <div style={{ width: '100%' }}>
              <div className="outs">
                {gen.outputs.map((o, i) => (
                  <figure className="out" key={i} style={{ margin: 0 }}>
                    {o.kind === 'video' ? <video src={o.url} controls playsInline /> : o.kind === 'audio' ? <audio src={o.url} controls style={{ width: '100%' }} /> : <img src={o.url} alt={gen.prompt || gen.model_name} />}
                    <figcaption className="out-actions"><span className="muted">{gen.outputs.length > 1 ? `Resultado ${i + 1}` : gen.model_name}</span>
                      <a className="btn" href={o.downloadUrl} download>Baixar</a></figcaption>
                  </figure>
                ))}
              </div>
              <div className="meta">
                <span>Modelo <b>{gen.model_name}</b> <span className="mono">({gen.endpoint})</span></span>
                <span>Custo <b className="mono">{usd(gen.cost_usd)}</b> · <span className="mono">{credits(gen.cost_credits)}</span></span>
                {gen.sandbox && <span className="badge sand">Sandbox · resultado de exemplo</span>}
              </div>
            </div>
          )}
        </div>
        <div className="costbar">
          <span>Nesta sessão · {sessionCost.n} {sessionCost.n === 1 ? 'geração' : 'gerações'}</span>
          <span className="big">{usd(sessionCost.usd)} <span className="muted mono" style={{ fontSize: 13 }}>· {sessionCost.credits} cr</span></span>
        </div>
      </div>
    </div>
  );
}
