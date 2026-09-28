-- ai-creative — custo efetivo x custo reservado.
-- Rode uma vez: Supabase > SQL Editor > New query > cole tudo > Run. Idempotente (pode rodar de novo).
-- OPCIONAL para o deploy: sem esta migration o app continua funcionando (zera o custo dos jobs estornados normalmente),
-- só não guarda o valor original reservado nem mostra "reservado e devolvido" no painel de custos.
--
-- cost_usd / cost_credits            = efetivamente COBRADO (é o que o painel soma). 0 quando a MuAPI estorna a geração falha.
-- cost_reserved_usd / _credits       = valor original reservado no envio (histórico; nunca entra no total gasto).
-- refunded (já existia, migration 001) = a MuAPI informou reembolso (header x-muapi-cost-refunded ou corpo cost.refunded).
alter table public.atelie_generations add column if not exists cost_reserved_usd numeric(12,6);
alter table public.atelie_generations add column if not exists cost_reserved_credits numeric(12,2);

-- Linhas antigas: o custo gravado era o valor reservado no envio.
update public.atelie_generations
   set cost_reserved_usd = cost_usd, cost_reserved_credits = cost_credits
 where cost_reserved_usd is null and cost_usd is not null;

-- Depois de rodar esta migration, corrija as falhas antigas que foram estornadas pela MuAPI mas ficaram com custo:
--   npm run reconcile-refunds            (simulação: só lista)
--   npm run reconcile-refunds -- --apply (grava)
