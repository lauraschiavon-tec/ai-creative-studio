// Gera data/extra-models.json com modelos que existem na MuAPI mas ainda não estão no catálogo do
// Open-Generative-AI. Fonte: https://api.muapi.ai/openapi.json. Depois rode `npm run catalog` para mesclar.
import { writeFileSync } from 'node:fs';

const EXTRA = [
  { endpoint: 'gpt-image-2.5-flare-text-to-image', mode: 't2i', id: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare (rápido)' },
  { endpoint: 'gpt-image-2.5-sunburst-text-to-image', mode: 't2i', id: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst (preciso)' },
  { endpoint: 'gpt-image-2.5-flare-image-to-image', mode: 'i2i', id: 'gpt-image-2.5-flare-edit', name: 'GPT Image 2.5 Flare (rápido)' },
  { endpoint: 'gpt-image-2.5-sunburst-image-to-image', mode: 'i2i', id: 'gpt-image-2.5-sunburst-edit', name: 'GPT Image 2.5 Sunburst (preciso)' },
];
const SKIP = new Set(['webhook_url']);

const spec = await (await fetch('https://api.muapi.ai/openapi.json')).json();
const deref = (s) => (s?.$ref ? spec.components.schemas[s.$ref.split('/').pop()] : s);

const out = EXTRA.map((m) => {
  const op = spec.paths[`/api/v1/${m.endpoint}`]?.post;
  if (!op) throw new Error(`Endpoint não encontrado no OpenAPI: ${m.endpoint}`);
  const schema = deref(op.requestBody.content['application/json'].schema);
  const inputs = {};
  let maxImages = 0;
  for (const [k, raw] of Object.entries(schema.properties || {})) {
    const p = deref(raw);
    if (SKIP.has(k)) continue;
    if (k === 'images_list') { maxImages = p.maxItems || 10; continue; }
    inputs[k] = { name: k, type: p.type || 'string', title: p.title || k, ...(p.description ? { description: p.description } : {}),
      ...(p.enum ? { enum: p.enum } : {}), ...(p.default !== undefined ? { default: p.default } : {}) };
  }
  return {
    id: `${m.mode}:${m.id}`, modelId: m.id, mode: m.mode, name: m.name, endpoint: m.endpoint, provider: 'OpenAI', family: 'gpt-image-2.5',
    imageField: m.mode === 'i2i' ? 'images_list' : null, maxImages: m.mode === 'i2i' ? maxImages : 0,
    hasPrompt: true, promptRequired: (schema.required || []).includes('prompt'), inputs,
  };
});
writeFileSync('data/extra-models.json', JSON.stringify(out, null, 1));
console.log(out.map((m) => `${m.id} (${m.endpoint}) maxImages=${m.maxImages} promptRequired=${m.promptRequired}`).join('\n'));
