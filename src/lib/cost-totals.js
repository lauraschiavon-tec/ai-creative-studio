// Somatório do painel de custos. Uma geração estornada NÃO é gasto: entra só na contagem/histórico do que foi reservado e devolvido.
export const costAcc = () => ({ generations: 0, completed: 0, failed: 0, usd: 0, credits: 0, refunded: 0, refunded_usd: 0, refunded_credits: 0 });

export function costAdd(a, r) {
  a.generations++;
  if (r.status === 'completed') a.completed++;
  if (r.status === 'failed') a.failed++;
  if (r.refunded) {
    a.refunded++;
    a.refunded_usd += Number(r.cost_reserved_usd || 0);
    a.refunded_credits += Number(r.cost_reserved_credits || 0);
    return;
  }
  a.usd += Number(r.cost_usd || 0);
  a.credits += Number(r.cost_credits || 0);
}
