'use client';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ParamField from './ParamField';
import { usd, credits, STATUS, isDone, PRIMARY } from './format';

const HIDDEN = new Set(['prompt', 'image_url', 'images_list', 'image', 'sync_mode']);
const MODES = [['t2i', 'Texto → Imagem'], ['i2i', 'Imagem → Imagem']];

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro inesperado. Tente novamente.');
  return data;
}

export default function Studio() {
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
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

  const models = useMemo(() => (catalog || []).filter((m) => m.mode === mode), [catalog, mode]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? models.filter((m) => `${m.name} ${m.provider}`.toLowerCase().includes(q)) : models;
  }, [models, search]);
  const model = useMemo(() => models.find((m) => m.id === modelId) || null, [models, modelId]);

  useEffect(() => { if (models.length && !models.some((m) => m.id === modelId)) setModelId(models[0].id); }, [models, modelId]);

  // Ao trocar de modelo: mostra só os parâmetros dele, com os valores padrão.
  useEffect(() => {
    if (!model) return;
    const d = {};
    for (const [k, def] of Object.entries(model.inputs)) if (!HIDDEN.has(k) && def.type !== 'array' && def.default !== undefined) d[k] = def.default;
    setParams(d); setFiles((f) => f.slice(0, model.maxImages || 0)); setEstimate(null);
  }, [model]);

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
    const tick = async () => {
      try { const g = await api(`/api/generations/${genId}`); if (!stop) setGen(g); if (!stop && !isDone(g.status)) timer = setTimeout(tick, 2500); }
      catch (e) { if (!stop) timer = setTimeout(tick, 5000); }
    };
    let timer = setTimeout(tick, 2000);
    return () => { stop = true; clearTimeout(timer); };
  }, [genId, genDone]);

  useEffect(() => {
    if (gen?.status === 'completed' && !counted.current.has(gen.id)) {
      counted.current.add(gen.id);
      setSessionCost((c) => ({ usd: c.usd + Number(gen.cost_usd || 0), credits: c.credits + Number(gen.cost_credits || 0), n: c.n + 1 }));
    }
  }, [gen]);

  const upload = useCallback(async (list) => {
    if (!model) return;
    setError(''); setUploading(true);
    try {
      for (const file of Array.from(list)) {
        if (files.length >= model.maxImages) { setError(`Este modelo aceita no máximo ${model.maxImages} imagem(ns).`); break; }
        const fd = new FormData(); fd.append('file', file);
        const up = await api('/api/uploads', { method: 'POST', body: fd });
        setFiles((f) => (f.length >= model.maxImages ? f : [...f, up]));
      }
    } catch (e) { setError(e.message); } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }, [model, files.length]);

  async function generate() {
    setError(''); setBusy(true);
    try {
      const g = await api('/api/generations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogId: model.id, prompt, params, inputFiles: files.map((f) => f.path) }),
      });
      setGen(g);
    } catch (e) { setError(e.message); setGen(null); } finally { setBusy(false); }
  }

  const needsImage = model?.mode === 'i2i';
  const canGenerate = model && !busy && !uploading && (!needsImage || files.length > 0) && (!model.hasPrompt || model.mode === 'i2i' || prompt.trim());
  const running = gen && !isDone(gen.status);

  if (loadError) return <div className="alert">{loadError}</div>;
  if (!catalog) return <p className="muted">Carregando modelos…</p>;

  return (
    <div className="studio">
      <div className="panel panel-pad stack">
        <section>
          <h3 className="step"><b>1</b> Tipo de geração</h3>
          <div className="seg">{MODES.map(([k, l]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); setSearch(''); }}>{l}</button>)}</div>
        </section>

        <section>
          <h3 className="step"><b>2</b> Modelo <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {models.length} disponíveis</span></h3>
          <input type="search" placeholder="Buscar modelo (Flux, Nano Banana, Seedream…)" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="models" role="listbox">
            {visible.map((m) => (
              <button key={m.id} className={`model ${m.id === modelId ? 'on' : ''}`} onClick={() => setModelId(m.id)}>
                <span>{m.name}</span><small>{m.provider}</small>
              </button>
            ))}
            {!visible.length && <div className="hint" style={{ padding: 12 }}>Nenhum modelo encontrado.</div>}
          </div>
        </section>

        {model && (
          <section className="stack">
            <h3 className="step"><b>3</b> Conteúdo e parâmetros</h3>

            {needsImage && (
              <div>
                <div className="lbl" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Imagem de referência <span className="muted" style={{ fontWeight: 400 }}>({files.length}/{model.maxImages})</span></div>
                {files.length < model.maxImages && (
                  <div className="drop" onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
                    {uploading ? 'Enviando…' : 'Clique ou arraste uma imagem (PNG, JPG, WebP · até 10 MB)'}
                  </div>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple={model.maxImages > 1} hidden onChange={(e) => upload(e.target.files)} />
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
              <label className="field"><span className="lbl">Prompt {needsImage && <span>opcional</span>}</span>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Descreva a imagem que você quer…" /></label>
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
              <p>Escolha um modelo, descreva o que precisa e clique em <b>Gerar</b>. O resultado aparece aqui, já com custo e opção de download.</p>
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
                <span>Modelo <b>{gen.model_name}</b></span>
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
