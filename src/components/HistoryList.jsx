'use client';
import { Fragment, useEffect, useState, useCallback } from 'react';
import { usd, credits, dateTime, STATUS, isDone } from './format';

export default function HistoryList() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [more, setMore] = useState(true);
  const [open, setOpen] = useState(null);

  const load = useCallback(async (before) => {
    try {
      const res = await fetch(`/api/generations?limit=24${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setMore(d.length === 24);
      setItems((cur) => (before ? [...(cur || []), ...d] : d));
    } catch (e) { setError(e.message || 'Falha ao carregar.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Atualiza gerações ainda em andamento.
  useEffect(() => {
    if (!items?.some((i) => !isDone(i.status))) return;
    const t = setTimeout(() => load(), 4000);
    return () => clearTimeout(t);
  }, [items, load]);

  if (error) return <div className="alert">{error}</div>;
  if (!items) return <p className="muted">Carregando…</p>;
  if (!items.length) return <div className="panel panel-pad"><h2>Nada por aqui ainda.</h2><p className="muted">As gerações que você fizer aparecem nesta página.</p></div>;

  return (
    <>
      <div className="grid-cards">
        {items.map((g) => {
          const [label, tone] = STATUS[g.status] || [g.status, 'run'];
          const thumb = g.outputs?.[0]?.url;
          return (
            <button key={g.id} className="card" onClick={() => setOpen(g)}>
              <div className="pic">{g.status === 'completed' && thumb && !/\.(mp4|webm|mov)/i.test(thumb) ? <img src={thumb} alt="" loading="lazy" /> : <span className={`badge ${tone}`}>{label}</span>}</div>
              <div className="body">
                <div className="t">{g.model_name}</div>
                <div className="row"><span>{dateTime(g.created_at)}</span><span className="mono">{usd(g.cost_usd)}</span></div>
              </div>
            </button>
          );
        })}
      </div>
      {more && <p style={{ textAlign: 'center', marginTop: 24 }}><button className="btn" onClick={() => load(items[items.length - 1].created_at)}>Carregar mais</button></p>}
      {open && <Detail g={items.find((i) => i.id === open.id) || open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Detail({ g, onClose }) {
  const [label, tone] = STATUS[g.status] || [g.status, 'run'];
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const params = Object.entries(g.params || {});
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="panel modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-grid">
          <div>
            {g.outputs?.map((o, i) => (
              <div key={i} style={{ display: 'grid', gap: 8 }}>
                {/\.(mp4|webm|mov)/i.test(o.url) ? <video src={o.url} controls /> : <img src={o.url} alt="" />}
                <a className="btn" href={o.downloadUrl} download>Baixar{g.outputs.length > 1 ? ` ${i + 1}` : ''}</a>
              </div>
            ))}
            {!g.outputs?.length && <span className={`badge ${tone}`} style={{ justifySelf: 'start' }}>{label}</span>}
            {g.input_urls?.length > 0 && <><div className="step" style={{ margin: 0 }}>Imagens enviadas</div><div className="thumbs">{g.input_urls.map((u) => <div className="thumb" key={u}><img src={u} alt="" /></div>)}</div></>}
          </div>
          <div className="stack">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <h2 style={{ fontSize: 26 }}>{g.model_name}</h2><button className="linkbtn" onClick={onClose}>Fechar</button>
            </div>
            {g.error && <div className="alert">{g.error}</div>}
            <dl className="kv">
              <dt>Status</dt><dd><span className={`badge ${tone}`}>{label}</span> {g.sandbox && <span className="badge sand">Sandbox</span>}</dd>
              <dt>Data e hora</dt><dd>{dateTime(g.created_at)}</dd>
              <dt>Tipo</dt><dd>{g.mode === 'i2i' ? 'Imagem → Imagem' : 'Texto → Imagem'}</dd>
              <dt>Custo</dt><dd className="mono">{usd(g.cost_usd)} · {credits(g.cost_credits)}{g.cost_estimated ? ' (estimado)' : ''}{g.refunded ? ' · estornado' : ''}</dd>
              <dt>ID</dt><dd className="mono">{g.provider_request_id || '—'}</dd>
            </dl>
            {g.prompt && <div><div className="step" style={{ margin: '0 0 6px' }}>Prompt</div><p style={{ margin: 0 }}>{g.prompt}</p></div>}
            {!!params.length && <div><div className="step" style={{ margin: '0 0 6px' }}>Parâmetros usados</div>
              <dl className="kv">{params.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono">{String(v)}</dd></Fragment>)}</dl></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
