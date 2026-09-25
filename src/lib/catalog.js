import 'server-only';
import catalog from '../../data/catalog.json';

const STUDIOS = ['image', 'video'];
const index = new Map();
for (const s of STUDIOS) for (const m of catalog[s]) index.set(`${s}:${m.id}`, m);

export const isStudio = (s) => STUDIOS.includes(s);
export const getModel = (studio, id) => index.get(`${studio}:${id}`);
export const listModels = (studio) => catalog[studio] || [];
export const catalogMeta = { source: catalog.source, apiVersion: catalog.apiVersion, generatedAt: catalog.generatedAt };

// Valida/normaliza os parâmetros enviados pelo cliente contra o schema do modelo (vindo do OpenAPI).
// Só passam chaves declaradas no modelo: o cliente nunca injeta campos arbitrários.
export function buildParams(model, raw = {}) {
  const out = {};
  for (const [key, def] of Object.entries(model.inputs)) {
    const label = def.title || key;
    let v = raw[key];
    if (v === undefined || v === null || v === '') {
      if (def.required && def.default === undefined) throw new Error(`Preencha "${label}".`);
      continue;
    }
    if (def.enum) { // aceita "5" para o enum 5
      const hit = def.enum.find((e) => String(e) === String(v));
      if (hit === undefined) throw new Error(`Opção inválida em "${label}".`);
      out[key] = hit;
      continue;
    }
    switch (def.type) {
      case 'boolean': v = v === true || v === 'true'; break;
      case 'int': case 'integer': case 'number': case 'float': {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(`Valor inválido em "${label}".`);
        if (def.minValue !== undefined && n < def.minValue) throw new Error(`"${label}" deve ser ≥ ${def.minValue}.`);
        if (def.maxValue !== undefined && n > def.maxValue) throw new Error(`"${label}" deve ser ≤ ${def.maxValue}.`);
        v = def.type === 'number' || def.type === 'float' ? n : Math.round(n);
        break;
      }
      default: v = String(v).slice(0, 4000);
    }
    out[key] = v;
  }
  return out;
}
