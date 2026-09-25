import 'server-only';
import catalog from '../../data/catalog.json';

const models = catalog.image;
const byId = new Map(models.map((m) => [m.id, m]));
export const getImageModel = (id) => byId.get(id);
export const listImageModels = () => models;

const HIDDEN = new Set(['prompt', 'image_url', 'images_list', 'image', 'sync_mode']);

// Valida/normaliza os parâmetros enviados pelo cliente contra o schema do modelo.
// Só passam chaves declaradas no modelo: o cliente nunca injeta campos arbitrários.
export function buildParams(model, raw = {}) {
  const out = {};
  for (const [key, def] of Object.entries(model.inputs)) {
    if (HIDDEN.has(key) || key === model.imageField || def.type === 'array') continue;
    let v = raw[key];
    if (v === undefined || v === '' || v === null) continue;
    switch (def.type) {
      case 'boolean': v = v === true || v === 'true'; break;
      case 'int': case 'integer': case 'number': case 'float': {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(`Valor inválido em "${def.title || key}".`);
        if (def.minValue !== undefined && n < def.minValue) throw new Error(`"${def.title || key}" deve ser ≥ ${def.minValue}.`);
        if (def.maxValue !== undefined && n > def.maxValue) throw new Error(`"${def.title || key}" deve ser ≤ ${def.maxValue}.`);
        v = def.type === 'int' || def.type === 'integer' ? Math.round(n) : n; break;
      }
      default: v = String(v).slice(0, 4000);
    }
    if (def.enum && !def.enum.includes(v)) throw new Error(`Opção inválida em "${def.title || key}".`);
    out[key] = v;
  }
  return out;
}
