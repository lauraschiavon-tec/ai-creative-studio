# Ateliê — estúdio criativo interno

Interface própria (Next.js) sobre a MuAPI. Todas as chamadas à MuAPI e ao Supabase com privilégios passam pelo servidor;
o navegador só recebe a chave **publicável** do Supabase.

## Primeira execução
1. `cp .env.example .env.local` e preencha (MuAPI, Supabase).
2. Supabase → SQL Editor → rode `supabase/migrations/001_init.sql`.
3. Supabase → Authentication → Providers → Email → **desative "Allow new users to sign up"** (cadastro fechado).
4. `npm run setup-storage` (cria os buckets privados) e `npm run create-user -- voce@empresa.com SENHA admin "Seu Nome"`.
5. `npm run dev` → http://localhost:3000

## Modos da MuAPI
`MUAPI_ENV=sandbox` usa a chave de teste (sem custo, resultados de exemplo). `MUAPI_ENV=production` usa a chave real.

## Catálogo de modelos
`data/catalog.json` é gerado a partir do repositório Open-Generative-AI (`npm run catalog`, exige a pasta `scripts/_studio_src`).
O servidor valida todo parâmetro contra esse schema antes de chamar a MuAPI.

## Deploy
Docker: `docker compose up -d --build` (com `.env.production`). Node/PM2: ver `ecosystem.config.cjs`. Coloque Nginx/Caddy com HTTPS na frente.
