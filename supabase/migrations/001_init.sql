-- ai-creative — esquema inicial.
-- Rode uma vez: Supabase > SQL Editor > New query > cole tudo > Run.
--
-- Este projeto Supabase é compartilhado com outro sistema, então TUDO aqui usa o
-- prefixo "atelie_" e NÃO há gatilho em auth.users (não interfere nos outros usuários).
-- Só quem tem linha em atelie_profiles consegue entrar no ai-creative.

create table if not exists public.atelie_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'user' check (role in ('admin','user')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.atelie_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.atelie_profiles where id = auth.uid() and role = 'admin' and active);
$$;

create table if not exists public.atelie_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.atelie_profiles(id),
  studio text not null default 'image',
  mode text,
  model_id text not null,
  model_name text,
  endpoint text,
  prompt text,
  params jsonb not null default '{}'::jsonb,
  input_files jsonb not null default '[]'::jsonb,
  provider_request_id text,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  outputs jsonb not null default '[]'::jsonb,   -- [{ "path": "arquivo no Storage", "remote": "URL da MuAPI" }]
  error text,
  cost_usd numeric(12,6),
  cost_credits numeric(12,2),
  cost_estimated boolean not null default false,
  refunded boolean not null default false,
  sandbox boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists atelie_generations_user_created on public.atelie_generations (user_id, created_at desc);
create index if not exists atelie_generations_open on public.atelie_generations (status) where status in ('pending','processing');

alter table public.atelie_profiles enable row level security;
alter table public.atelie_generations enable row level security;

drop policy if exists "atelie_profiles: próprio ou admin" on public.atelie_profiles;
create policy "atelie_profiles: próprio ou admin" on public.atelie_profiles for select
  using (id = auth.uid() or public.atelie_is_admin());

drop policy if exists "atelie_generations: próprias ou admin" on public.atelie_generations;
create policy "atelie_generations: próprias ou admin" on public.atelie_generations for select
  using (user_id = auth.uid() or public.atelie_is_admin());
-- Sem policies de insert/update/delete: toda escrita passa pelo backend (service role).

-- Buckets privados (já criados por `npm run setup-storage`; aqui é idempotente).
insert into storage.buckets (id, name, public) values ('atelie-uploads','atelie-uploads',false), ('atelie-outputs','atelie-outputs',false)
on conflict (id) do nothing;
