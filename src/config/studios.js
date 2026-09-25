// Configuração dos estúdios (segura para o cliente). O catálogo em si vem de data/catalog.json,
// gerado do OpenAPI da MuAPI (`npm run catalog`).

// "auto" = a interface escolhe o endpoint pelo tipo de entrada: sem mídia de referência usa o 1º modo, com mídia usa o 2º.
export const STUDIOS = {
  image: {
    label: 'Imagem',
    auto: ['t2i', 'i2i'],
    modes: [
      ['t2i', 'Texto → Imagem'],
      ['i2i', 'Imagem → Imagem'],
      ['tools', 'Melhorar e ferramentas'],
    ],
  },
  video: {
    label: 'Vídeo',
    auto: ['t2v', 'i2v'],
    modes: [
      ['t2v', 'Texto → Vídeo'],
      ['i2v', 'Imagem → Vídeo'],
      ['flf', 'Primeiro e último quadro'],
      ['ref', 'Referências (omni)'],
      ['v2v', 'Editar e efeitos'],
      ['extend', 'Estender vídeo'],
      ['motion', 'Controle de movimento'],
      ['lipsync', 'Lip sync e avatares'],
      ['storyboard', 'Storyboard'],
    ],
  },
};
export const MODE_LABEL = Object.fromEntries(Object.values(STUDIOS).flatMap((s) => s.modes));

// Modelos que a empresa mais usa: aparecem primeiro como "Recomendados". NÃO limitam nada: todo o catálogo
// da MuAPI continua em "Todos os modelos". Cada item liga o modelo aos endpoints de cada modo (conferidos no OpenAPI).
export const FEATURED = {
  image: [
    { key: 'seedream-5', label: 'Seedream 5.0', provider: 'ByteDance', note: 'Standard',
      modes: { t2i: 'seedream-5.0', i2i: 'seedream-5.0-edit' } },
    { key: 'seedream-5-pro', label: 'Seedream 5.0 Pro', provider: 'ByteDance', note: 'Pro',
      modes: { t2i: 'seedream-5.0-pro', i2i: 'seedream-5.0-pro-edit' } },
    { key: 'gpt-image-25-flare', label: 'GPT Image 2.5 Flare', provider: 'OpenAI', note: 'rápido',
      modes: { t2i: 'gpt-image-2.5-flare-text-to-image', i2i: 'gpt-image-2.5-flare-image-to-image' } },
    { key: 'gpt-image-25-sunburst', label: 'GPT Image 2.5 Sunburst', provider: 'OpenAI', note: 'preciso',
      modes: { t2i: 'gpt-image-2.5-sunburst-text-to-image', i2i: 'gpt-image-2.5-sunburst-image-to-image' } },
    { key: 'nano-banana-pro', label: 'Nano Banana Pro', provider: 'Google', note: '',
      modes: { t2i: 'nano-banana-pro', i2i: 'nano-banana-pro-edit' } },
  ],
  video: [
    { key: 'kling-3-standard', label: 'Kling 3.0 Standard', provider: 'Kuaishou', note: 'Standard',
      modes: { t2v: 'kling-v3.0-standard-text-to-video', i2v: 'kling-v3.0-standard-image-to-video' } },
    { key: 'kling-3-pro', label: 'Kling 3.0 Pro', provider: 'Kuaishou', note: 'Pro',
      modes: { t2v: 'kling-v3.0-pro-text-to-video', i2v: 'kling-v3.0-pro-image-to-video', motion: 'kling-v3.0-pro-motion-control' } },
    { key: 'seedance-25', label: 'Seedance 2.5', provider: 'ByteDance', note: '',
      modes: { t2v: 'seedance-2.5-text-to-video', i2v: 'seedance-2.5-image-to-video', flf: 'seedance-2.5-first-last-frame',
        ref: 'seedance-2.5-omni-reference', v2v: 'seedance-2.5-video-edit', extend: 'seedance-2.5-video-extend' } },
    { key: 'gemini-omni-flash-11', label: 'Gemini Omni Flash 1.1', provider: 'Google', note: 'mais novo',
      modes: { t2v: 'gemini-omni-flash-1-1-text-to-video', i2v: 'gemini-omni-flash-1-1-image-to-video',
        ref: 'gemini-omni-flash-1-1-reference-to-video', v2v: 'gemini-omni-flash-1-1-edit' } },
  ],
};
