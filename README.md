# ai-creative — estúdio criativo interno

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

## Login (unificado com a Dashboard)
Os usuários, senhas e permissões são os da Dashboard (`dashboard_users`); o AI Studio só lê. Acesso = usuário ativo e (admin, ou `permissions` nula, ou permissão **AI Studio** = `/aistudio`).
- **SSO**: na Dashboard, o item "AI Studio" gera um ticket de 60s (uso único) e abre `/sso?ticket=…` aqui, já autenticado.
- **Login direto**: usuário + senha da Dashboard (`/api/auth/login`).
- A sessão (cookie `aic_session`, 12h) é revalidada contra `dashboard_users` a cada uso (cache de 15s): desativar ou tirar a permissão corta o acesso.
- O histórico e o custo continuam por usuário (`atelie_generations.user_id` = `dashboard_users.id`).
- Variáveis: `AISTUDIO_SSO_SECRET` (igual à do backend da Dashboard), `AISTUDIO_SESSION_SECRET` (opcional), `LEGACY_LOGIN` (`off` remove o login antigo por e-mail). Migration: `supabase/migrations/002_login_pela_dashboard.sql`.

## Acompanhamento das gerações (polling + webhook) e telemetria
- **Polling**: o navegador consulta `GET /api/generations/:id` a cada 3 s; o servidor consulta a MuAPI (`/predictions/{id}/result`).
  Erro de rede, 429 (respeita `Retry-After`) e 5xx são repetidos; **4xx com `status: failed` no corpo** (ex.: moderação) encerra a geração na hora,
  com o motivo da API na tela. O **POST de envio nunca é repetido** (evita geração/cobrança duplicada). Teto global: 45 min.
- **Webhook**: cada envio leva `?webhook=https://<host>/api/webhooks/muapi/<geração>/<token>`. Ao terminar, a MuAPI chama essa URL e a geração é finalizada
  (resultado copiado para o Storage) mesmo com a página fechada. O token é um HMAC por geração; o corpo do webhook só serve de gatilho (o resultado é
  conferido de novo na MuAPI) e a finalização é atômica/idempotente (`finalizing_at`), então webhook repetido ou simultâneo com o polling não processa duas vezes.
  Só é enviado quando o host é https público (em `localhost` não há webhook; o polling cobre). `MUAPI_WEBHOOK=off` desliga.
- **Telemetria**: coluna `atelie_generations.timeline` (migration `003_webhook_telemetria.sql`) e logs `[gen] {json}` no container:
  `request_id` (prepare_ms, submit_ms) → `status` (cada mudança queued/processing…) → `terminal` (quem viu: poll ou webhook, após quantos ms, `provider_execution_ms`)
  → `persisted` (persist_ms) → `finalized` (total_ms). A MuAPI só informa a duração total (`executionTime`); o tempo em `queued` só aparece se o status for observado.
- **Custo efetivo x reservado**: a MuAPI informa cobrança/reembolso nos headers `x-muapi-cost-usd/-credits/-refunded` (também nos 400 de job falho, sem `cost` no corpo). `cost_usd`/`cost_credits` = o que foi **cobrado** (0 quando estornado, `refunded=true`; é o que o painel soma); `cost_reserved_usd/_credits` = valor original reservado no envio (migration `004_custo_efetivo.sql`, opcional). Falha sem informação de reembolso mantém o valor e fica `cost_estimated=true`. Falhas antigas: `npm run reconcile-refunds` (simulação) / `-- --apply`.
- **Testes**: `npm test` (Node, sem consumir crédito: usa mocks/fetch falso e store em memória).

## API direta (seletor MuAPI / API direta)
Só os modelos abaixo têm o seletor; **todo o resto do catálogo continua só na MuAPI**. O seletor só aparece se a chave do provedor estiver no servidor (`.env.example`). Exige a migration `005_api_direta.sql` (coluna `provider`).

| Modelo (endpoints da MuAPI) | Provedor | Modelo oficial | Chave |
|---|---|---|---|
| Seedream 5.0 (`seedream-5.0`, `-edit`, `-pro`, `-pro-edit`) | BytePlus | `seedream-5-0-260128` (Lite), `dola-seedream-5-0-pro-260628` | `BYTEPLUS_API_KEY` |
| Seedance 2.5 (`seedance-2.5-text-to-video`, `-image-to-video`) | BytePlus | `dreamina-seedance-2-5-260628` (só até 720p, sem Draft) | `BYTEPLUS_API_KEY` |
| GPT Image 2.5 (`gpt-image-2.5-flare|sunburst-text-to-image|image-to-image`) | OpenAI | `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst` | `OPENAI_API_KEY` |
| Nano Banana Pro (`nano-banana-pro`, `-edit`) | Google | `gemini-3-pro-image` | `GEMINI_API_KEY` |
| Gemini Omni Flash (`gemini-omni-flash-1-1-text-to-video`, `-image-to-video`) | Google | `gemini-omni-1.1-flash` (duração definida pelo modelo, sem seed) | `GEMINI_API_KEY` |
| Kling 3.0 Standard/Pro/4K (`kling-v3.0-{standard,pro,4k}-{text,image}-to-video`) | Kling | `kling-v3` (`mode` std/pro/4k) | `KLING_API_KEY` |

- **Código**: `src/lib/direct/` (um adaptador por provedor; `index.js` tem o mapa modelo → provedor). A geração usa o mesmo núcleo da MuAPI (`generations-core.js`): finalização atômica, custo, telemetria, histórico.
- **Sem Sandbox**: a API direta cobra na conta do provedor. Com o "Modo teste" ligado a rota recusa e pede para usar a MuAPI.
- **Provedores síncronos** (OpenAI, Google, Seedream) rodam em segundo plano no servidor e um vigia termina a geração mesmo com a página fechada; se o servidor reiniciar no meio, a geração vira "interrompida". **Assíncronos** (Seedance, Kling) são consultados por polling.
- **Custo**: tokens/unidades devolvidos pelo provedor × tarifa (`src/lib/direct/pricing.js`). Onde só há tabela, a geração fica `cost_estimated`. O painel de custos separa MuAPI x API direta.
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
