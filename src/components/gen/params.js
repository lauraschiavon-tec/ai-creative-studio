// Mantém o que o usuário já escolheu quando o novo modelo aceita o mesmo valor; senão usa o padrão do modelo.
export function carryParams(prev, model, defaults = {}) {
  const next = {};
  for (const [k, def] of Object.entries(model.inputs)) {
    const v = prev[k];
    const numeric = ['int', 'integer', 'number', 'float'].includes(def.type);
    const ok = v !== undefined && (def.enum ? def.enum.includes(v)
      : numeric ? typeof v === 'number' && (def.minValue === undefined || v >= def.minValue) && (def.maxValue === undefined || v <= def.maxValue)
      : def.type === 'boolean' ? typeof v === 'boolean' : typeof v === 'string');
    if (ok) next[k] = v;
    else if (def.default !== undefined) next[k] = def.default;
    else if (def.required && def.enum) next[k] = def.enum[0];            // obrigatório sem padrão: pré-seleciona a 1ª opção
    else if (def.required && numeric && def.minValue !== undefined) next[k] = def.minValue;
    if (next[k] === undefined && defaults[k] !== undefined) next[k] = defaults[k]; // padrões do estúdio (ex.: negative_prompt do Cinema)
  }
  return next;
}
