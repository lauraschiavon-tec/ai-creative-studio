// Preços das APIs diretas (USD). Onde o provedor informa o consumo (tokens/unidades) o custo é calculado com ele; a tabela abaixo
// serve para a ESTIMATIVA antes de gerar e como reserva. Valores marcados "confirmar" vêm de fontes secundárias: conferir no console.
export const RATES = {
  // BytePlus ModelArk
  seedance: { perMillionTokens: 10.70, perSecond: { '480p': 0.1028, '720p': 0.2312 } }, // sem entrada de vídeo. Confirmar no console (2.5 ainda não aparece na tabela pública)
  seedreamImage: { lite: 0.045, pro: null },                                             // por imagem; Pro: confirmar (null = sem estimativa)
  // OpenAI GPT Image 2.5 (tokens, por 1M)
  openai: { textIn: 5, imageIn: 8, imageOut: 30 },
  // Google Gemini API
  nanoBananaPro: { '1K': 0.134, '2K': 0.134, '4K': 0.24 },                               // por imagem
  omniPerSecond: 0.10,                                                                    // ≈ US$ 17,50/1M tokens × 5.792 tokens/s (720p)
  // Kling Open Platform: preço por "unit" (pacote pré-pago); o consumo por segundo depende de modo/áudio → só há custo se a API informar
  klingUnitUsd: 0.14,
};

export const round4 = (n) => Math.round(n * 10000) / 10000;
