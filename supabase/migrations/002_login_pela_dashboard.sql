-- ai-creative — login unificado com a Dashboard (usuários = dashboard_users).
-- Rode uma vez: Supabase > SQL Editor > New query > cole tudo > Run. É ADITIVO e reversível:
-- não apaga nem altera auth.users, atelie_profiles nem nenhuma geração.
--
-- O que muda: atelie_generations.user_id passa a guardar o ID do usuário da Dashboard
-- (dashboard_users.id). Por isso a chave estrangeira para atelie_profiles (que aponta
-- para auth.users) é removida. Gerações antigas continuam com o user_id de antes.

-- 1) Backup (as cópias ficam com RLS ligado e sem policy: ninguém lê pela API pública).
create table if not exists public.atelie_generations_bkp_20260926 as table public.atelie_generations;
create table if not exists public.atelie_profiles_bkp_20260926 as table public.atelie_profiles;
alter table public.atelie_generations_bkp_20260926 enable row level security;
alter table public.atelie_profiles_bkp_20260926 enable row level security;

-- 2) Remove a FK de user_id -> atelie_profiles(id), seja qual for o nome dela.
do $$
declare c text;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
    where con.conrelid = 'public.atelie_generations'::regclass
      and con.contype = 'f'
      and a.attname = 'user_id'
  loop
    execute format('alter table public.atelie_generations drop constraint %I', c);
  end loop;
end $$;

-- ROLLBACK (só se precisar voltar ao login antigo; NOT VALID mantém as linhas já gravadas com ID da Dashboard):
--   alter table public.atelie_generations
--     add constraint atelie_generations_user_id_fkey foreign key (user_id) references public.atelie_profiles(id) not valid;
-- Restaurar dados, se algum dia necessário: insert ... select * from public.atelie_generations_bkp_20260926.
