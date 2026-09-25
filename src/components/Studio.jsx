'use client';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ParamField from './ParamField';
import { usd, credits, STATUS, isDone, PRIMARY } from './format';
import { FEATURED } from '@/config/featured';

const HIDDEN = new Set(['prompt', 'image_url', 'images_list', 'image', 'sync_mode']);
const MODES = [['t2i', 'Texto → Imagem'], ['i2i', 'Imagem → Imagem']];

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
    if (HIDDEN.has(k) || def.type === 'array') continue;
    const v = prev[k];
    const numeric = ['int', 'integer', 'number', 'float'].includes(def.type);
    const ok = v !== undefined && (def.enum ? def.enum.includes(v)
      : numeric ? typeof v === 'number' && (def.minValue === undefined || v >= def.minValue) && (def.maxValue === undefined || v <= def.maxValue)
      : def.type === 'boolean' ? typeof v === 'boolean' : typeof v === 'string');
    if (ok) next[k] = v; else if (def.default !== undefined) next[k] = def.default;
  }
  return next;
}

export default function Studio() {
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [featuredKey, setFeaturedKey] = useState(FEATURED.image[0].key); // null = escolhido em "Todos os modelos"
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState('t2i');
  const [search, setSearch] = useState('');
  const [modelId, setModelId] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState({});
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [gen, setGen] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [sessionCost, setSessionCost] = useState({ usd: 0, credits: 0, n: 0 });
  const fileRef = useRef(null);
  const counted = useRef(new Set());

  useEffect(() => { api('/api/catalog').then((d) => setCatalog(d.image)).catch((e) => setLoadError(e.message)); }, []);

  // Recomendados: resolve, pelo endpoint, o modelo de texto e o de imagem de cada item.
  const featured = useMemo(() => {
    if (!catalog) return [];
    const find = (endpoint, m) => catalog.find((c) => c.endpoint === endpoint && c.mode === m) || null;
    return FEATURED.image
      .map((f) => ({ ...f, textModel: find(f.text, 't2i'), imageModel: find(f.image, 'i2i') }))
      .filter((f) => f.textModel || f.imageModel);
  }, [catalog]);
  const activeFeatured = featured.find((f) => f.key === featuredKey) || null;

  const listModels = useMemo(() => (catalog || []).filter((m) => m.mode === mode), [catalog, mode]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? listModels.filter((m) => `${m.name} ${m.provider}`.toLowerCase().includes(q)) : listModels;
  }, [listModels, search]);

  // Endpoint automático: com imagem de referência usa o modelo de edição; sem imagem, o de texto.
  const model = useMemo(() => {
    if (activeFeatured) return (files.length && activeFeatured.imageModel) || activeFeatured.textModel || activeFeatured.imageModel;
    return (catalog || []).find((m) => m.id === modelId) || null;
  }, [activeFeatured, files.length, catalog, modelId]);
  const maxImages = (activeFeatured ? activeFeatured.imageModel?.maxImages : model?.maxImages) || 0;
  const imageRequired = !activeFeatured && model?.mode === 'i2i';

  useEffect(() => { if (!activeFeatured && listModels.length && !listModels.some((m) => m.id === modelId)) setModelId(listModels[0].id); }, [activeFeatured, listModels, modelId]);
  useEffect(() => { setFiles((f) => (f.length > maxImages ? f.slice(0, maxImages) : f)); }, [maxImages]);

  const modelKey = model?.id;
  useEffect(() => { if (model) { setParams((p) => carryParams(p, model)); setEstimate(null); } }, [modelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields = useMemo(() => {
    if (!model) return { main: [], adv: [] };
    const all = Object.entries(model.inputs).filter(([k, def]) => !HIDDEN.has(k) && k !== model.imageField && def.type !== 'array');
    return { main: all.filter(([k]) => PRIMARY.includes(k)), adv: all.filter(([k]) => !PRIMARY.includes(k)) };
  }, [model]);

  // Estimativa de custo (debounce) — best-effort.
  useEffect(() => {
    if (!model) return;
    setEstimate(null);
    const t = setTimeout(() => {
      api('/api/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalogId: model.id, prompt, params }) })
        .then(setEstimate).catch(() => setEstimate({ available: false }));
    }, 700);
    return () => clearTimeout(t);
  }, [model, params, prompt]);

  // Acompanha a geração até terminar.
  const genId = gen?.id;
  const genDone = gen ? isDone(gen.status) : true;
  useEffect(() => {
    if (!genId || genDone) return;
    let stop = false;
    let timer;
    const tick = async () => {
      try { const g = await api(`/api/generations/${genId}`); if (!stop) setGen(g); if (!stop && !isDone(g.status)) timer = setTimeout(tick, 2500); }
      catch (e) { if (!stop) timer = setTimeout(tick, 5000); }
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

  const upload = useCallback(async (list) => {
    if (!maxImages) return;
    setError(''); setUploading(true);
    try {
      let count = files.length;
      for (const file of Array.from(list)) {
        if (count >= maxImages) { setError(`Este modelo aceita no máximo ${maxImages} imagem(ns) de referência.`); break; }
        const fd = new FormData(); fd.append('file', file);
        const up = await api('/api/uploads', { method: 'POST', body: fd });
        count++;
        setFiles((f) => (f.length >= maxImages ? f : [...f, up]));
      }
    } catch (e) { setError(e.message); } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }, [maxImages, files.length]);

  async function generate() {
    setError(''); setBusy(true);
    try {
      const g = await api('/api/generations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogId: model.id, prompt, params, inputFiles: model.mode === 'i2i' ? files.map((f) => f.path) : [] }),
      });
      setGen(g);
    } catch (e) { setError(e.message); setGen(null); } finally { setBusy(false); }
  }

  const promptNeeded = model?.hasPrompt && (model.mode === 't2i' || model.promptRequired);
  const canGenerate = model && !busy && !uploading && (!imageRequired || files.length > 0) && (!promptNeeded || prompt.trim());
  const running = gen && !isDone(gen.status);
  const pick = (id) => { setFeaturedKey(null); setModelId(id); };

  if (loadError) return <div className="alert">{loadError}</div>;
  if (!catalog) return <p className="muted">Carregando modelos…</p>;

  return (
    <div className="studio">
      <div className="panel panel-pad stack">
        <section>
          <h3 className="step"><b>1</b> Modelo</h3>
          <div className="feats" role="listbox" aria-label="Modelos recomendados">
            {featured.map((f) => (
              <button key={f.key} className={`feat ${f.key === featuredKey ? 'on' : ''}`} onClick={() => setFeaturedKey(f.key)}>
                <span className="tag">Recomendado</span>
                <b>{f.label}</b>
                <small>{f.provider}{f.note ? ` · ${f.note}` : ''}</small>
              </button>
            ))}
          </div>

          {activeFeatured && model && (
            <p className="hint" style={{ marginTop: 10 }}>
              {files.length ? 'Com imagem de referência: usando o modelo de edição' : 'Sem imagem de referência: usando geração por texto'}
              {' '}<span className="mono">({model.endpoint})</span>
            </p>
          )}

          <details className="adv" style={{ marginTop: 14 }} open={showAll || (!activeFeatured && !!model)} onToggle={(e) => setShowAll(e.currentTarget.open)}>
            <summary>Todos os modelos ({catalog.length})</summary>
            <div className="seg small" style={{ marginBottom: 10 }}>
              {MODES.map(([k, l]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); setSearch(''); }}>{l}</button>)}
            </div>
            <input type="search" placeholder="Buscar modelo (Flux, Ideogram, Recraft…)" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="models" role="listbox" aria-label="Todos os modelos">
              {visible.map((m) => (
                <button key={m.id} className={`model ${!activeFeatured && m.id === modelId ? 'on' : ''}`} onClick={() => pick(m.id)}>
                  <span>{m.name}</span><small>{m.provider}</small>
                </button>
              ))}
              {!visible.length && <div className="hint" style={{ padding: 12 }}>Nenhum modelo encontrado.</div>}
            </div>
          </details>
        </section>

        {model && (
          <section className="stack">
            <h3 className="step"><b>2</b> Conteúdo e parâmetros</h3>

            {maxImages > 0 && (
              <div>
                <div className="lbl" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Imagem de referência{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>({files.length}/{maxImages}){!imageRequired && ' · opcional'}</span>
                </div>
                {files.length < maxImages && (
                  <div className="drop" onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
                    {uploading ? 'Enviando…' : 'Clique ou arraste uma imagem (PNG, JPG, WebP · até 10 MB)'}
                  </div>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple={maxImages > 1} hidden onChange={(e) => upload(e.target.files)} />
                {!!files.length && (
                  <div className="thumbs">
                    {files.map((f) => (
                      <div className="thumb" key={f.path}><img src={f.previewUrl} alt={f.name} />
                        <button aria-label="Remover" onClick={() => setFiles((l) => l.filter((x) => x.path !== f.path))}>×</button></div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {model.hasPrompt && (
              <label className="field"><span className="lbl">Prompt {!promptNeeded && <span>opcional</span>}</span>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={files.length ? 'Descreva a edição que você quer…' : 'Descreva a imagem que você quer…'} /></label>
            )}

            {fields.main.map(([k, def]) => <ParamField key={k} name={k} def={def} value={params[k]} onChange={(v) => setParams((p) => ({ ...p, [k]: v }))} />)}
            {!!fields.adv.length && (
              <details className="adv"><summary>Opções avançadas ({fields.adv.length})</summary>
                <div className="stack">{fields.adv.map(([k, def]) => <ParamField key={k} name={k} def={def} value={params[k]} onChange={(v) => setParams((p) => ({ ...p, [k]: v }))} />)}</div>
              </details>
            )}
          </section>
        )}

        <hr className="rule" />
        <section className="stack">
          <div className="costbar">
            <span>Custo estimado</span>
            <span className="big">{estimate === null ? '…' : estimate.available ? usd(estimate.usd) : <span className="muted" style={{ fontSize: 13, fontWeight: 400, fontFamily: 'var(--font-body)' }}>indisponível</span>}</span>
          </div>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn primary block" disabled={!canGenerate} onClick={generate}>{busy ? 'Enviando…' : running ? 'Gerar outra' : 'Gerar'}</button>
        </section>
      </div>

      <div className="stack">
        <div className="panel canvas">
          {!gen && (
            <div className="canvas-empty">
              <h2>Sua mesa está vazia.</h2>
              <p>Escolha um modelo, descreva o que precisa e clique em <b>Gerar</b>. Se enviar uma imagem de referência, usamos automaticamente o modelo de edição.</p>
            </div>
          )}
          {gen && !isDone(gen.status) && (
            <div className="developing"><div className="lbl">Revelando…<small>{STATUS[gen.status]?.[0]} · {gen.model_name}</small></div></div>
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
                    {/\.(mp4|webm|mov)/i.test(o.url) ? <video src={o.url} controls /> : <img src={o.url} alt={gen.prompt || gen.model_name} />}
                    <figcaption className="out-actions"><span className="muted">{gen.outputs.length > 1 ? `Imagem ${i + 1}` : gen.model_name}</span>
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
