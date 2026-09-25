// Modelos que a empresa realmente usa: aparecem primeiro, como "Recomendados".
// Cada item liga um modelo a seus endpoints por tipo de entrada; a interface escolhe sozinha:
//   sem imagem de referência → `text`  |  com imagem de referência → `image`.
// Os endpoints abaixo foram conferidos no OpenAPI da MuAPI (set/2026). Nenhum modelo é removido do catálogo:
// tudo que não está aqui continua em "Todos os modelos".
export const FEATURED = {
  image: [
    { key: 'seedream-5', label: 'Seedream 5.0', provider: 'ByteDance', note: 'Standard',
      text: 'seedream-5.0', image: 'seedream-5.0-edit' },
    { key: 'seedream-5-pro', label: 'Seedream 5.0 Pro', provider: 'ByteDance', note: 'Pro',
      text: 'seedream-5.0-pro', image: 'seedream-5.0-pro-edit' },
    { key: 'gpt-image-25-flare', label: 'GPT Image 2.5 Flare', provider: 'OpenAI', note: 'rápido',
      text: 'gpt-image-2.5-flare-text-to-image', image: 'gpt-image-2.5-flare-image-to-image' },
    { key: 'gpt-image-25-sunburst', label: 'GPT Image 2.5 Sunburst', provider: 'OpenAI', note: 'preciso',
      text: 'gpt-image-2.5-sunburst-text-to-image', image: 'gpt-image-2.5-sunburst-image-to-image' },
    { key: 'nano-banana-pro', label: 'Nano Banana Pro', provider: 'Google', note: '',
      text: 'nano-banana-pro', image: 'nano-banana-pro-edit' },
  ],
  // Reservado para o Vídeo Studio (ainda não construído).
  video: [
    { key: 'kling-3-standard', label: 'Kling 3.0 Standard', provider: 'Kuaishou', note: 'Standard',
      text: 'kling-v3.0-standard-text-to-video', image: 'kling-v3.0-standard-image-to-video' },
    { key: 'kling-3-pro', label: 'Kling 3.0 Pro', provider: 'Kuaishou', note: 'Pro',
      text: 'kling-v3.0-pro-text-to-video', image: 'kling-v3.0-pro-image-to-video' },
    { key: 'seedance-25', label: 'Seedance 2.5', provider: 'ByteDance', note: '',
      text: 'seedance-2.5-text-to-video', image: 'seedance-2.5-image-to-video' },
    { key: 'gemini-omni-flash-11', label: 'Gemini Omni Flash 1.1', provider: 'Google', note: '',
      text: 'gemini-omni-flash-1-1-text-to-video', image: 'gemini-omni-flash-1-1-image-to-video' },
  ],
};
