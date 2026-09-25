'use client';
import { Fragment, useEffect, useState, useCallback } from 'react';
import { usd, credits, dateTime, STATUS, isDone } from './format';
import { MODE_LABEL } from '@/config/studios';

const STUDIO_FILTER = [['', 'Tudo'], ['image', 'Imagem'], ['video', 'Vídeo']];

function Media({ o, controls = true }) {
  if (o.kind === 'video') return <video src={o.url} controls={controls} muted={!controls} playsInline preload="metadata" />;
  if (o.kind === 'audio') return <audio src={o.url} controls style={{ width: '100%' }} />;
  return <img src={o.url} alt="" loading="lazy" />;
}

export default function HistoryList() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [more, setMore] = useState(true);
  const [open, setOpen] = useState(null);
  const [studio, setStudio] = useState('');

  const load = useCallback(async (before) => {
    try {
      const qs = new URLSearchParams({ limit: '24', ...(before ? { before } : {}), ...(studio ? { studio } : {}) });
      const res = await fetch(`/api/generations?${qs}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setMore(d.length === 24);
      setItems((cur) => (before ? [...(cur || []), ...d] : d));
    } catch (e) { setError(e.message || 'Falha ao carregar.'); }
  }, [studio]);
  useEffect(() => { setItems(null); load(); }, [load]);

  // Atualiza gerações ainda em andamento.
  useEffect(() => {
    if (!items?.some((i) => !isDone(i.status))) return;
    const t = setTimeout(() => load(), 4000);
    return () => clearTimeout(t);
  }, [items, load]);

  return (
    <>
      <div className="chips" style={{ marginBottom: 20 }}>
        {STUDIO_FILTER.map(([k, l]) => <button key={k} className={`chip ${studio === k ? 'on' : ''}`} onClick={() => setStudio(k)}>{l}</button>)}
      </div>
      {error && <div className="alert">{error}</div>}
      {!items && !error && <p className="muted">Carregando…</p>}
      {items && !items.length && <div className="panel panel-pad"><h2>Nada por aqui ainda.</h2><p className="muted">As gerações que você fizer aparecem nesta página.</p></div>}
      {items && !!items.length && (
        <>
          <div className="grid-cards">
            {items.map((g) => {
              const [label, tone] = STATUS[g.status] || [g.status, 'run'];
              const first = g.outputs?.[0];
              return (
                <button key={g.id} className="card" onClick={() => setOpen(g)}>
                  <div className="pic">{g.status === 'completed' && first && first.kind !== 'audio' ? <Media o={first} controls={false} /> : <span className={`badge ${tone}`}>{g.status === 'completed' ? 'Áudio' : label}</span>}</div>
                  <div className="body">
                    <div className="t">{g.model_name}</div>
                    <div className="row"><span>{MODE_LABEL[g.mode] || g.studio}</span><span className="mono">{usd(g.cost_usd)}</span></div>
                    <div className="row"><span>{dateTime(g.created_at)}</span></div>
                  </div>
                </button>
              );
            })}
          </div>
          {more && <p style={{ textAlign: 'center', marginTop: 24 }}><button className="btn" onClick={() => load(items[items.length - 1].created_at)}>Carregar mais</button></p>}
        </>
      )}
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
                <Media o={o} />
                <a className="btn" href={o.downloadUrl} download>Baixar{g.outputs.length > 1 ? ` ${i + 1}` : ''}</a>
              </div>
            ))}
            {!g.outputs?.length && <span className={`badge ${tone}`} style={{ justifySelf: 'start' }}>{label}</span>}
            {g.input_urls?.length > 0 && (
              <>
                <div className="step" style={{ margin: 0 }}>Mídias enviadas</div>
                <div className="thumbs">
                  {g.input_urls.map((u) => (
                    <div className={`thumb ${u.kind !== 'image' ? 'wide' : ''}`} key={u.url}>
                      {u.kind === 'video' ? <video src={u.url} controls preload="metadata" /> : u.kind === 'audio' ? <audio src={u.url} controls style={{ width: '100%' }} /> : <img src={u.url} alt="" />}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="stack">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <h2 style={{ fontSize: 26 }}>{g.model_name}</h2><button className="linkbtn" onClick={onClose}>Fechar</button>
            </div>
            {g.error && <div className="alert">{g.error}</div>}
            <dl className="kv">
              <dt>Status</dt><dd><span className={`badge ${tone}`}>{label}</span> {g.sandbox && <span className="badge sand">Sandbox</span>}</dd>
              <dt>Data e hora</dt><dd>{dateTime(g.created_at)}</dd>
              <dt>Tipo</dt><dd>{g.studio === 'video' ? 'Vídeo' : 'Imagem'} · {MODE_LABEL[g.mode] || g.mode}</dd>
              <dt>Endpoint</dt><dd className="mono">{g.endpoint}</dd>
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
