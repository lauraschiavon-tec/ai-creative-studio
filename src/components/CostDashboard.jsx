'use client';
import { useEffect, useState } from 'react';
import { usd } from './format';

const months = () => {
  const out = [['', 'Todo o período']];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push([v, d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })]);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
};

export default function CostDashboard() {
  const [month, setMonth] = useState(months()[1][0]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    fetch(`/api/admin/costs${month ? `?month=${month}` : ''}`).then(async (r) => {
      const d = await r.json(); if (!r.ok) throw new Error(d.error); setData(d);
    }).catch((e) => setError(e.message));
  }, [month]);

  return (
    <>
      <div className="pagehead">
        <h1>Custos</h1>
        <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 220 }}>
          {months().map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {error && <div className="alert">{error}</div>}
      {!data && !error && <p className="muted">Carregando…</p>}
      {data && (
        <>
          <div className="kpis">
            <div className="panel kpi"><div className="l">Gasto total da empresa</div><div className="v">{usd(data.total.real.usd)}</div><div className="muted mono">{data.total.real.credits} créditos</div></div>
            <div className="panel kpi"><div className="l">Gerações</div><div className="v">{data.total.real.generations}</div><div className="muted">{data.total.real.completed} concluídas · {data.total.real.failed} falhas</div></div>
            <div className="panel kpi"><div className="l">Custo médio por geração</div><div className="v">{usd(data.total.real.completed ? data.total.real.usd / data.total.real.completed : 0)}</div></div>
          </div>
          {data.total.sandbox.generations > 0 && <div className="notice" style={{ marginBottom: 22 }}>{data.total.sandbox.generations} gerações de teste (Sandbox) não entram nos totais acima.</div>}
          <div className="stack">
            <Table title="Por usuário" rows={data.users} label={(r) => r.name || r.email || r.id.slice(0, 8)} sub={(r) => r.email} />
            <Table title="Por estúdio" rows={data.studios} label={(r) => ({ image: 'Imagem', video: 'Vídeo' }[r.name] || r.name)} />
            <Table title="Por modelo" rows={data.models} label={(r) => r.name} />
          </div>
        </>
      )}
    </>
  );
}

function Table({ title, rows, label, sub }) {
  return (
    <section className="panel">
      <div className="panel-pad" style={{ paddingBottom: 6 }}><h2 style={{ fontSize: 22 }}>{title}</h2></div>
      <table className="t">
        <thead><tr><th>Nome</th><th className="n">Gerações</th><th className="n">Falhas</th><th className="n">Créditos</th><th className="n">Custo (USD)</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id || r.name}><td>{label(r)}{sub && <div className="hint" style={{ marginTop: 0 }}>{sub(r)}</div>}</td>
              <td className="n">{r.generations}</td><td className="n">{r.failed}</td><td className="n">{r.credits}</td><td className="n">{usd(r.usd)}</td></tr>
          ))}
          {!rows.length && <tr><td colSpan="5" className="muted">Sem dados no período.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
