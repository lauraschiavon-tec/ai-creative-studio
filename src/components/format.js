export const usd = (v) => {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  return `US$ ${n.toFixed(n !== 0 && Math.abs(n) < 1 ? 4 : 2)}`;
};
export const credits = (v) => (v === null || v === undefined ? '—' : `${Number(v)} cr`);
export const dateTime = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const STATUS = {
  pending: ['Na fila', 'run'], processing: ['Gerando', 'run'], completed: ['Concluída', 'ok'], failed: ['Falhou', 'err'],
};
export const isDone = (s) => s === 'completed' || s === 'failed';

const LABELS = {
  aspect_ratio: 'Proporção', resolution: 'Resolução', quality: 'Qualidade', num_images: 'Nº de imagens', width: 'Largura',
  height: 'Altura', seed: 'Seed', negative_prompt: 'Prompt negativo', output_format: 'Formato de saída', guidance_scale: 'Guidance',
  num_inference_steps: 'Passos', strength: 'Intensidade', style: 'Estilo', safety_tolerance: 'Tolerância de segurança',
  enable_safety_checker: 'Filtro de segurança', prompt_enhancer: 'Melhorar prompt', enable_prompt_expansion: 'Expandir prompt',
};
export const paramLabel = (key, def) => LABELS[key] || def?.title || key.replace(/_/g, ' ');
export const PRIMARY = ['aspect_ratio', 'resolution', 'quality', 'num_images', 'width', 'height'];
