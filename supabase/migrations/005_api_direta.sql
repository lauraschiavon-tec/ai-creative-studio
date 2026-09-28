-- ai-creative — seletor MuAPI / API direta.
-- Rode uma vez: Supabase > SQL Editor > New query > cole tudo > Run. Idempotente (pode rodar de novo).
-- OBRIGATÓRIO só para gerar pela API direta (a rota recusa com aviso claro se faltar). Gerações pela MuAPI não dependem dela.
--
-- provider: 'muapi' (padrão, todas as linhas antigas) ou o provedor da API direta: 'byteplus' | 'openai' | 'google' | 'kling'.
alter table public.atelie_generations add column if not exists provider text not null default 'muapi';
