'use client';
import { usd } from '../format';

export default function CostBar({ estimate, label = 'Custo estimado' }) {
  return (
    <div className="costbar">
      <span>{label}</span>
      <span className="big">
        {estimate === null ? '…' : estimate.available ? usd(estimate.usd)
          : <span className="muted" style={{ fontSize: 13, fontWeight: 400, fontFamily: 'var(--font-body)' }}>indisponível</span>}
      </span>
    </div>
  );
}
