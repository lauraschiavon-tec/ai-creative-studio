-- ai-creative — webhook da MuAPI + telemetria de tempos.
-- Rode uma vez: Supabase > SQL Editor > New query > cole tudo > Run. Idempotente (pode rodar de novo).
-- Rode ANTES (ou junto) do redeploy. O app funciona sem esta migration, mas sem telemetria no banco e sem a trava anti-duplicidade.

-- Linha do tempo de cada geração (JSON): request_received_at, prepare_ms, submit_ms, request_id_at, status_seen[{s,at}],
-- provider_created_at, provider_execution_ms, terminal_seen_at, terminal_source (poll|webhook), terminal_after_ms,
-- persist_ms, result_ready_at, total_ms, failure{kind,http_status,reason}, webhook (bool).
alter table public.atelie_generations add column if not exists timeline jsonb not null default '{}'::jsonb;

-- Trava de finalização: quem finaliza primeiro (polling ou webhook) grava aqui; o outro desiste. Expira sozinha (3 min) se o servidor cair no meio.
alter table public.atelie_generations add column if not exists finalizing_at timestamptz;
