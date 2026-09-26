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

## Áreas da ferramenta
- **Imagem / Vídeo** (`components/Studio.jsx`): formulário dinâmico por endpoint; modo Automático escolhe texto ou imagem conforme a entrada.
- **Lip Sync** (`components/LipSyncStudio.jsx`): usa os endpoints de lip sync do catálogo de vídeo. A voz vem de um áudio enviado ou de um texto
  (gera a voz com um modelo TTS e usa o resultado como áudio do lip sync; são duas gerações, ambas no histórico e nos custos).
- **Cinema** (`components/CinemaStudio.jsx`, `config/cinema.js`): o mesmo Studio com controles de câmera/lente/focal/abertura (e movimento, em vídeo)
  transformados no prompt, como no Open Generative AI. As escolhas ficam gravadas no histórico.
- Peças compartilhadas em `components/gen/` (geração + polling, estimativa, seletor de modelos, parâmetros, resultado).

## Estado do catálogo (validado em Sandbox)
Todos os 562 endpoints de imagem e vídeo do OpenAPI foram exercitados em Sandbox: 536 concluem. Os demais dependem da MuAPI/conta:
endpoints listados no OpenAPI que respondem 404 (ex.: `veo3.1-extend-video`, `grok-imagine-extend`, `*-vip-extend`), um que recusa a chave
(`seedance-2.0-watermark-remover`), mocks de Sandbox sem arquivo (`luma-modify-video`, `runway-aleph-v2v`) e treinadores de LoRA, que pedem uma URL de dataset.
Confirme com a chave de Produção antes de contar com esses.

## Modo teste (Sandbox) x Produção
No topo do site há a caixa **"Modo teste (Sandbox)"**. Marcada: usa a chave de teste da MuAPI (sem custo, resultados de exemplo).
Desmarcada (pede confirmação): usa a chave real e **gasta crédito**. O selo fica vermelho ("PRODUÇÃO · gasta crédito").
- `MUAPI_ENV=sandbox`: o app inteiro fica em Sandbox e a caixa é travada para todos.
- `MUAPI_ENV=production`: cada usuário escolhe pela caixa. O padrão é Sandbox (seguro); `MUAPI_DEFAULT_MODE=production` inverte o padrão.
- Usuário **"só Sandbox"** (`npm run create-user -- email user "Nome" --sandbox`): caixa sempre marcada e travada; nunca gasta crédito.
  A flag fica em `app_metadata.sandbox_only` (só o administrador altera).
