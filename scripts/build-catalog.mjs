// Gera data/catalog.json a partir do catálogo do Open-Generative-AI (MIT).
import { t2iModels, i2iModels } from './_studio_src/models.js';
import { writeFileSync } from 'node:fs';

const KEEP = ['type', 'title', 'description', 'enum', 'default', 'minValue', 'maxValue', 'step', 'maxItems', 'examples'];
const simplify = (m, mode) => {
  const inputs = {};
  for (const [k, v] of Object.entries(m.inputs || {})) {
    const o = { name: k };
    for (const p of KEEP) if (v[p] !== undefined) o[p] = v[p];
    inputs[k] = o;
  }
  return {
    id: `${mode}:${m.id}`, modelId: m.id, mode, name: m.name, endpoint: m.endpoint || m.id,
    provider: m.provider_name || m.provider || '', family: m.family || null,
    imageField: mode === 'i2i' ? (m.imageField || 'image_url') : null,
    maxImages: mode === 'i2i' ? (m.maxImages || 1) : 0,
    hasPrompt: m.hasPrompt !== false, inputs,
  };
};
const image = [...t2iModels.map(m => simplify(m, 't2i')), ...i2iModels.map(m => simplify(m, 'i2i'))];
writeFileSync('data/catalog.json', JSON.stringify({ image }, null, 1));
console.log('t2i', t2iModels.length, 'i2i', i2iModels.length);
