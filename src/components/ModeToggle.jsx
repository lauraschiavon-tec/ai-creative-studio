'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const LOCK = { app: 'O app inteiro está em modo teste.', user: 'Sua conta é somente de teste.' };

// Caixa "Modo teste (Sandbox)". Marcada = sem custo, resultados de exemplo. Desmarcada = gasta crédito real.
export default function ModeToggle({ sandbox, canChoose, reason }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function change(next) {
    if (!next && !window.confirm('Desligar o modo teste?\n\nAs próximas gerações vão gastar CRÉDITOS REAIS da conta da empresa e o resultado será o de verdade.')) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sandbox: next }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível trocar o modo.');
      router.refresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <label className={`modebox ${sandbox ? 'test' : 'live'}`} title={canChoose ? 'Marcado: sem custo, resultados de exemplo. Desmarcado: gasta crédito real.' : LOCK[reason]}>
      <input type="checkbox" checked={sandbox} disabled={!canChoose || busy} onChange={(e) => change(e.target.checked)} />
      <span>{sandbox ? 'Modo teste (Sandbox)' : 'PRODUÇÃO · gasta crédito'}</span>
      {!canChoose && <small>🔒</small>}
      {error && <em role="alert">{error}</em>}
    </label>
  );
}
