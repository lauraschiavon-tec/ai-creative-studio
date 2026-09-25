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
`data/catalog.json` é gerado direto do **OpenAPI atual da MuAPI** (`npm run catalog`; não depende mais do repositório Open-Generative-AI).
Cada endpoint vira um modelo com seu schema (parâmetros, enums, limites) e campos de mídia (imagem/vídeo/áudio); o servidor valida
todo pedido contra esse schema antes de chamar a MuAPI. Rode `npm run catalog` de tempos em tempos para trazer modelos novos.
Modelos em destaque ("Recomendados") ficam em `src/config/studios.js`; todo o resto continua em "Todos os modelos".

## Deploy
Docker: `docker compose up -d --build` (com `.env.production`). Node/PM2: ver `ecosystem.config.cjs`. Coloque Nginx/Caddy com HTTPS na frente.

## Estado do catálogo (validado em Sandbox)
Todos os 562 endpoints de imagem e vídeo do OpenAPI foram exercitados em Sandbox: 536 concluem. Os demais dependem da MuAPI/conta:
endpoints listados no OpenAPI que respondem 404 (ex.: `veo3.1-extend-video`, `grok-imagine-extend`, `*-vip-extend`), um que recusa a chave
(`seedance-2.0-watermark-remover`), mocks de Sandbox sem arquivo (`luma-modify-video`, `runway-aleph-v2v`) e treinadores de LoRA, que pedem uma URL de dataset.
Confirme com a chave de Produção antes de contar com esses.
