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
  voice_id: 'ID da voz', language_code: 'Idioma', emotion: 'Emoção', speed: 'Velocidade', pitch: 'Tom', volume: 'Volume', stability: 'Estabilidade', similarity_boost: 'Similaridade', language_boost: 'Idioma (reforço)',
  aspect_ratio: 'Proporção', duration: 'Duração (s)', generate_audio: 'Gerar áudio', camera_fixed: 'Câmera fixa', mode: 'Modo', high_bitrate: 'Alta taxa de bits', draft: 'Rascunho (mais barato)', resolution: 'Resolução', quality: 'Qualidade', num_images: 'Nº de imagens', width: 'Largura',
  height: 'Altura', seed: 'Seed', negative_prompt: 'Prompt negativo', output_format: 'Formato de saída', guidance_scale: 'Guidance',
  num_inference_steps: 'Passos', strength: 'Intensidade', style: 'Estilo', safety_tolerance: 'Tolerância de segurança',
  enable_safety_checker: 'Filtro de segurança', prompt_enhancer: 'Melhorar prompt', enable_prompt_expansion: 'Expandir prompt',
};
export const paramLabel = (key, def) => LABELS[key] || def?.title || key.replace(/_/g, ' ');
export const PRIMARY = ['aspect_ratio', 'resolution', 'duration', 'quality', 'generate_audio', 'num_images', 'num_videos', 'width', 'height'];
