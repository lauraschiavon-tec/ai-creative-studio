import 'server-only';
import { MuapiError } from '../muapi';
import { seedream, seedance } from './byteplus';
import { openai } from './openai';
import { googleImage, googleOmni } from './google';
import { kling } from './kling';

// Seletor "MuAPI / API direta": só os endpoints abaixo têm API direta; todo o resto do catálogo continua só na MuAPI.
// A chave é o `endpoint` do catálogo da MuAPI (o mesmo do histórico). A versão do modelo direto é a mesma da MuAPI.
export const PROVIDERS = {
  byteplus: { label: 'BytePlus', env: 'BYTEPLUS_API_KEY' },
  openai: { label: 'OpenAI', env: 'OPENAI_API_KEY' },
  google: { label: 'Google', env: 'GEMINI_API_KEY' },
  kling: { label: 'Kling', env: 'KLING_API_KEY' },
};
const ADAPTERS = { seedream, seedance, openai, 'google-image': googleImage, omni: googleOmni, kling };

const SEEDREAM_LITE = 'seedream-5-0-260128', SEEDREAM_PRO = 'dola-seedream-5-0-pro-260628', SEEDANCE = 'dreamina-seedance-2-5-260628';
const kl = (name, mode, kind, label) => [`kling-v3.0-${name}-${kind === 'text2video' ? 'text' : 'image'}-to-video`, { provider: 'kling', adapter: 'kling', model_name: 'kling-v3', mode, kind, label }];

export const DIRECT_MODELS = {
  'seedream-5.0': { provider: 'byteplus', adapter: 'seedream', model: SEEDREAM_LITE, tier: 'lite', label: 'Seedream 5.0 Lite' },
  'seedream-5.0-edit': { provider: 'byteplus', adapter: 'seedream', model: SEEDREAM_LITE, tier: 'lite', label: 'Seedream 5.0 Lite' },
  'seedream-5.0-pro': { provider: 'byteplus', adapter: 'seedream', model: SEEDREAM_PRO, tier: 'pro', label: 'Seedream 5.0 Pro' },
  'seedream-5.0-pro-edit': { provider: 'byteplus', adapter: 'seedream', model: SEEDREAM_PRO, tier: 'pro', label: 'Seedream 5.0 Pro' },
  'gpt-image-2.5-flare-text-to-image': { provider: 'openai', adapter: 'openai', model: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare' },
  'gpt-image-2.5-flare-image-to-image': { provider: 'openai', adapter: 'openai', model: 'gpt-image-2.5-flare', edit: true, label: 'GPT Image 2.5 Flare' },
  'gpt-image-2.5-sunburst-text-to-image': { provider: 'openai', adapter: 'openai', model: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst' },
  'gpt-image-2.5-sunburst-image-to-image': { provider: 'openai', adapter: 'openai', model: 'gpt-image-2.5-sunburst', edit: true, label: 'GPT Image 2.5 Sunburst' },
  'nano-banana-pro': { provider: 'google', adapter: 'google-image', model: 'gemini-3-pro-image', label: 'Nano Banana Pro' },
  'nano-banana-pro-edit': { provider: 'google', adapter: 'google-image', model: 'gemini-3-pro-image', edit: true, label: 'Nano Banana Pro' },
  'seedance-2.5-text-to-video': { provider: 'byteplus', adapter: 'seedance', model: SEEDANCE, label: 'Seedance 2.5', note: 'Na API direta o Seedance vai até 720p e não tem Draft.' },
  'seedance-2.5-image-to-video': { provider: 'byteplus', adapter: 'seedance', model: SEEDANCE, label: 'Seedance 2.5', note: 'Na API direta o Seedance vai até 720p e não tem Draft.' },
  'gemini-omni-flash-1-1-text-to-video': { provider: 'google', adapter: 'omni', model: 'gemini-omni-1.1-flash', label: 'Gemini Omni Flash 1.1', note: 'Na API direta a duração é definida pelo modelo (3–10 s) e não há seed.' },
  'gemini-omni-flash-1-1-image-to-video': { provider: 'google', adapter: 'omni', model: 'gemini-omni-1.1-flash', label: 'Gemini Omni Flash 1.1', note: 'Na API direta a duração é definida pelo modelo (3–10 s) e não há seed.' },
  ...Object.fromEntries([
    kl('standard', 'std', 'text2video', 'Kling 3.0 Standard'), kl('standard', 'std', 'image2video', 'Kling 3.0 Standard'),
    kl('pro', 'pro', 'text2video', 'Kling 3.0 Pro'), kl('pro', 'pro', 'image2video', 'Kling 3.0 Pro'),
    kl('4k', '4k', 'text2video', 'Kling 3.0 4K'), kl('4k', '4k', 'image2video', 'Kling 3.0 4K'),
  ]),
};

export const directConfig = (endpoint) => DIRECT_MODELS[endpoint] || null;
export const providerConfigured = (provider) => !!process.env[PROVIDERS[provider]?.env]?.trim();
export const providerLabel = (provider) => PROVIDERS[provider]?.label || provider;
export const isDirectRow = (row) => !!row?.provider && row.provider !== 'muapi' && !!DIRECT_MODELS[row.endpoint];

// Informação enviada ao navegador: só aparece o seletor se a chave do provedor estiver configurada no servidor.
export function directInfo(endpoint) {
  const c = directConfig(endpoint);
  return c && providerConfigured(c.provider) ? { provider: c.provider, providerLabel: providerLabel(c.provider), label: c.label, note: c.note || null } : null;
}

const adapterOf = (cfg) => ADAPTERS[cfg.adapter];

// Envia a geração ao provedor. Devolve { requestId, cost } (cost no mesmo formato da MuAPI: { amount_usd, amount_credits, refunded, estimated }).
export async function directSubmit(cfg, ctx) {
  if (!providerConfigured(cfg.provider)) throw new MuapiError(`A API direta (${providerLabel(cfg.provider)}) não está configurada no servidor.`, 500);
  return adapterOf(cfg).submit({ cfg, ...ctx });
}

export const directEstimate = (cfg, payload) => adapterOf(cfg).estimate(cfg, payload);

// Consulta usada pelo núcleo de geração (polling/vigia) para linhas de API direta.
export function directGetResult(row, requestId) {
  return adapterOf(DIRECT_MODELS[row.endpoint]).getResult(requestId);
}
