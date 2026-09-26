// Cinema Studio: opções de câmera e a transformação delas em prompt.
// Baseado no Open Generative AI (MIT): mesmas câmeras, lentes, distâncias focais e aberturas, e a mesma
// montagem de prompt (buildNanoBananaPrompt). Acrescentamos movimento de câmera para vídeo.
// Os textos dos prompts ficam em inglês de propósito: os modelos respondem melhor.

const A = '/assets/cinema/';

export const CAMERAS = [
  { id: 'Modular 8K Digital', prompt: 'modular 8K digital cinema camera', img: 'modular_8k_digital.webp' },
  { id: 'Full-Frame Cine Digital', prompt: 'full-frame digital cinema camera', img: 'full_frame_cine_digital.webp' },
  { id: 'Grand Format 70mm Film', prompt: 'grand format 70mm film camera', img: 'grand_format_70mm_film.webp' },
  { id: 'Studio Digital S35', prompt: 'Super 35 studio digital camera', img: 'studio_digital_s35.webp' },
  { id: 'Classic 16mm Film', prompt: 'classic 16mm film camera', img: 'classic_16mm_film.webp' },
  { id: 'Premium Large Format Digital', prompt: 'premium large-format digital cinema camera', img: 'premium_large_format_digital.webp' },
].map((c) => ({ ...c, img: A + c.img }));

export const LENSES = [
  { id: 'Creative Tilt Lens', prompt: 'creative tilt lens effect', img: 'creative_tilt_lens.webp' },
  { id: 'Compact Anamorphic', prompt: 'compact anamorphic lens', img: 'compact_anamorphic.webp' },
  { id: 'Extreme Macro', prompt: 'extreme macro lens', img: 'extreme_macro.webp' },
  { id: '70s Cinema Prime', prompt: '1970s cinema prime lens', img: '70s_cinema_prime.webp' },
  { id: 'Classic Anamorphic', prompt: 'classic anamorphic lens', img: 'classic_anamorphic.webp' },
  { id: 'Premium Modern Prime', prompt: 'premium modern prime lens', img: 'premium_modern_prime.webp' },
  { id: 'Warm Cinema Prime', prompt: 'warm-toned cinema prime lens', img: 'warm_cinema_prime.webp' },
  { id: 'Swirl Bokeh Portrait', prompt: 'swirl bokeh portrait lens', img: 'swirl_bokeh_portrait.webp' },
  { id: 'Vintage Prime', prompt: 'vintage prime lens', img: 'vintage_prime.webp' },
  { id: 'Halation Diffusion', prompt: 'halation diffusion filter', img: 'halation_diffusion.webp' },
  { id: 'Clinical Sharp Prime', prompt: 'ultra-sharp clinical prime lens', img: 'clinical_sharp_prime.webp' },
].map((c) => ({ ...c, img: A + c.img }));

export const FOCAL_LENGTHS = [
  { mm: 8, prompt: 'ultra-wide perspective', label: 'Ultra grande-angular' },
  { mm: 14, prompt: 'wide-angle perspective', label: 'Grande-angular' },
  { mm: 24, prompt: 'wide-angle dynamic perspective', label: 'Angular dinâmica' },
  { mm: 35, prompt: 'natural cinematic perspective', label: 'Cinemática natural' },
  { mm: 50, prompt: 'standard portrait perspective', label: 'Padrão' },
  { mm: 85, prompt: 'classic portrait perspective', label: 'Retrato clássico' },
];

export const APERTURES = [
  { id: 'f/1.4', prompt: 'shallow depth of field, creamy bokeh', label: 'Fundo bem desfocado', img: A + 'f_1_4.webp' },
  { id: 'f/4', prompt: 'balanced depth of field', label: 'Profundidade equilibrada', img: A + 'f_4.webp' },
  { id: 'f/11', prompt: 'deep focus clarity, sharp foreground to background', label: 'Tudo nítido', img: A + 'f_11.webp' },
];

// Só para vídeo.
export const MOVEMENTS = [
  { id: 'static', label: 'Estático', prompt: 'static locked-off camera' },
  { id: 'dolly-in', label: 'Dolly in', prompt: 'slow dolly in towards the subject' },
  { id: 'dolly-out', label: 'Dolly out', prompt: 'slow dolly out away from the subject' },
  { id: 'pan-left', label: 'Pan à esquerda', prompt: 'smooth pan to the left' },
  { id: 'pan-right', label: 'Pan à direita', prompt: 'smooth pan to the right' },
  { id: 'tilt-up', label: 'Tilt para cima', prompt: 'smooth tilt up' },
  { id: 'tilt-down', label: 'Tilt para baixo', prompt: 'smooth tilt down' },
  { id: 'orbit', label: 'Órbita', prompt: 'camera orbiting around the subject' },
  { id: 'tracking', label: 'Tracking', prompt: 'tracking shot following the subject' },
  { id: 'handheld', label: 'Câmera na mão', prompt: 'handheld documentary camera movement' },
  { id: 'crane', label: 'Grua', prompt: 'crane shot rising up' },
  { id: 'drone', label: 'Drone aéreo', prompt: 'aerial drone shot' },
  { id: 'zoom-in', label: 'Zoom in', prompt: 'slow cinematic zoom in' },
];

export const NEGATIVE_PROMPT = 'blurry, low quality, distortion, bad composition'; // igual ao projeto original

export const DEFAULT_CAMERA = {
  camera: CAMERAS[1].id,
  lens: LENSES[5].id,
  focal: 35,
  aperture: 'f/4',
  movement: 'static',
};

const find = (list, id) => list.find((x) => x.id === id);

// Mesma montagem do projeto original: prompt base + câmera + lente/focal + abertura + tags de qualidade.
// Vídeo: troca as tags de foto por tags de filme e acrescenta o movimento de câmera.
export function buildCinemaPrompt(base, cam, kind = 'image') {
  const camera = find(CAMERAS, cam.camera)?.prompt || cam.camera;
  const lens = find(LENSES, cam.lens)?.prompt || cam.lens;
  const perspective = FOCAL_LENGTHS.find((f) => f.mm === cam.focal)?.prompt || '';
  const depth = find(APERTURES, cam.aperture)?.prompt || '';
  const movement = kind === 'video' ? find(MOVEMENTS, cam.movement)?.prompt : '';
  const parts = [
    base,
    `shot on a ${camera}`,
    `using a ${lens} at ${cam.focal}mm ${perspective ? `(${perspective})` : ''}`,
    `aperture ${cam.aperture}`,
    depth,
    movement ? `camera movement: ${movement}` : '',
    'cinematic lighting',
    'natural color science',
    'high dynamic range',
    kind === 'video' ? 'cinematic film look, ultra-detailed, smooth motion' : 'professional photography, ultra-detailed, 8K resolution',
  ];
  return parts.filter((p) => p && p.trim() !== '').join(', ');
}
