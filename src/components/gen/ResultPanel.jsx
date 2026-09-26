'use client';
import { usd, credits, STATUS, isDone } from '../format';

// Tela de resultado: vazio → gerando → falha → concluído (preview, download, modelo e custo) + custo da sessão.
export default function ResultPanel({ gen, sessionCost, emptyTitle = 'Sua mesa está vazia.', emptyText, phase, note, extraCost }) {
  return (
    <div className="stack">
      <div className="panel canvas">
        {!gen && (
          <div className="canvas-empty">
            <h2>{emptyTitle}</h2>
            <p>{emptyText || <>Escolha o modelo, descreva o que precisa e clique em <b>Gerar</b>. O resultado aparece aqui, com custo e download.</>}</p>
          </div>
        )}
        {gen && !isDone(gen.status) && (
          <div className="developing">
            <div className="lbl">{phase || 'Revelando…'}<small>{STATUS[gen.status]?.[0]} · {gen.model_name}</small>{note && <small>{note}</small>}</div>
          </div>
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
                  {o.kind === 'video' ? <video src={o.url} controls playsInline />
                    : o.kind === 'audio' ? <audio src={o.url} controls style={{ width: '100%' }} />
                    : <img src={o.url} alt={gen.prompt || gen.model_name} />}
                  <figcaption className="out-actions">
                    <span className="muted">{gen.outputs.length > 1 ? `Resultado ${i + 1}` : gen.model_name}</span>
                    <a className="btn" href={o.downloadUrl} download>Baixar</a>
                  </figcaption>
                </figure>
              ))}
            </div>
            <div className="meta">
              <span>Modelo <b>{gen.model_name}</b> <span className="mono">({gen.endpoint})</span></span>
              <span>Custo <b className="mono">{usd(gen.cost_usd)}</b> · <span className="mono">{credits(gen.cost_credits)}</span></span>
              {extraCost && <span>{extraCost}</span>}
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
  );
}
