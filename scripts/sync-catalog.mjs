// Gera data/catalog.json a partir do OpenAPI ATUAL da MuAPI (fonte da verdade). Não usa mais o repositório Open-Generative-AI.
// Uso: npm run catalog            (baixa https://api.muapi.ai/openapi.json)
//      npm run catalog -- --offline   (usa scripts/.openapi.json já baixado)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const SPEC_URL = 'https://api.muapi.ai/openapi.json';
const CACHE = 'scripts/.openapi.json';
const offline = process.argv.includes('--offline') && existsSync(CACHE);

const spec = offline ? JSON.parse(readFileSync(CACHE, 'utf8')) : await (await fetch(SPEC_URL)).json();
if (!offline) writeFileSync(CACHE, JSON.stringify(spec));
const S = spec.components.schemas;

const deref = (s) => { while (s && s.$ref) s = S[s.$ref.split('/').pop()]; return s; };
// anyOf [X, null] → X (campos opcionais/anuláveis)
const unwrap = (raw) => {
  const s = deref(raw);
  if (s?.anyOf) {
    const nn = s.anyOf.map(deref).filter((x) => x && x.type !== 'null');
    if (nn.length === 1) return { ...nn[0], title: s.title ?? nn[0].title, default: s.default ?? nn[0].default, description: s.description ?? nn[0].description };
  }
  return s;
};

// ── Classificação: tag do OpenAPI → estúdio + modo ─────────────────────────────
function classify(tag, slug) {
  if (tag === 'Audio') return /tts|speech/.test(slug) && !/clone/.test(slug) ? ['audio', 'tts'] : null; // só voz (usada no Lip Sync com texto)
  const VIDEO_TAGS = ['Video: Text-to-Video', 'Video: Image-to-Video', 'Video: Edit & Effects'];
  if (VIDEO_TAGS.includes(tag)) {
    if (/infinitetalk|speech-to-video|lip-?sync|omnihuman|avatar|talking/.test(slug)) return ['video', 'lipsync']; // o nome do endpoint é mais confiável que a tag para os sub-modos
    if (/first-last|last-frame|first-frame|start-end|-flf/.test(slug)) return ['video', 'flf'];
    if (/motion-control|motion-transfer/.test(slug)) return ['video', 'motion'];
    if (/extend/.test(slug)) return ['video', 'extend'];
    if (/omni-reference|reference-to-video/.test(slug)) return ['video', 'ref'];
  }
  switch (tag) {
    case 'Image: Text-to-Image': return ['image', 't2i'];
    case 'Image: Edit & Reference': return ['image', 'i2i'];
    case 'Image: Enhance': return ['image', 'tools'];
    case 'Video: Text-to-Video': return ['video', 't2v'];
    case 'Video: Image-to-Video': return ['video', 'i2v'];
    case 'Video: Edit & Effects': return ['video', 'v2v'];
    case 'Video: Lipsync': case 'Video: Avatars': return ['video', 'lipsync'];
    case 'Video: Storyboard': return ['video', 'storyboard'];
    default: return null;
  }
}

// ── Campos de mídia (upload) ───────────────────────────────────────────────────
const NOT_MEDIA = new Set(['webhook_url', 'draft_request_id', 'request_id', 'audio_ids', 'character_ids', 'lora_url', 'trigger_word', 'data', 'num_images', 'num_videos']);
function mediaKind(name, s) {
  if (NOT_MEDIA.has(name) || s.enum) return null;
  const isStr = s.type === 'string';
  const isStrArr = s.type === 'array' && deref(s.items)?.type === 'string';
  if (!isStr && !isStrArr) return null;
  if (/(^|_)(video|videos)(_url|_urls|_files|_list)?$|^reference_videos?$|^reference_video_urls?$/.test(name)) return 'video';
  if (/(^|_)(audio|audios)(_url|_urls|_files|_list)$|^reference_audios?$/.test(name)) return 'audio';
  if (/image|frame|^mask_url$|^swap_url$/.test(name)) return 'image';
  return null;
}

const MEDIA_MODES = new Set(['i2i', 'i2v', 'flf', 'ref', 'v2v', 'extend', 'motion', 'lipsync', 'tools']);

// ── Nomes legíveis ──────────────────────────────────────────────────────────────
const PROVIDERS = [
  [/^(kling)/, 'Kuaishou'], [/^(seedance|seedream|bytedance|omnihuman|seed-)/, 'ByteDance'], [/^(veo|gemini|imagen|nano-banana|lyria|google)/, 'Google'],
  [/^(sora|gpt|openai|dall)/, 'OpenAI'], [/^(flux)/, 'Black Forest Labs'], [/^(wan|alibaba|qwen|happyhorse)/, 'Alibaba'], [/^(hailuo|minimax|speech-|music-)/, 'MiniMax'],
  [/^(luma|ray)/, 'Luma'], [/^(runway|gen4|gen-4)/, 'Runway'], [/^(pixverse)/, 'PixVerse'], [/^(vidu)/, 'Vidu'], [/^(ltx)/, 'Lightricks'], [/^(hunyuan)/, 'Tencent'],
  [/^(midjourney|mj)/, 'Midjourney'], [/^(ideogram)/, 'Ideogram'], [/^(recraft)/, 'Recraft'], [/^(pika)/, 'Pika'], [/^(grok|xai)/, 'xAI'], [/^(sync|lipsync)/, 'Sync'],
  [/^(infinitetalk)/, 'InfiniteTalk'], [/^(stable|sd3|sdxl)/, 'Stability AI'], [/^(higgsfield)/, 'Higgsfield'],
];
const provider = (slug) => PROVIDERS.find(([re]) => re.test(slug))?.[1] || slug.split('-')[0].replace(/^./, (c) => c.toUpperCase());
const MODE_WORDS = /[- ](text[- ]to[- ](video|image)|image[- ]to[- ](video|image)|t2v|i2v|t2i|i2i)$/;
function prettyName(slug) {
  const base = slug.replace(MODE_WORDS, '');
  const toks = [];
  for (const t of base.split('-')) { // "2-5" → "2.5", "veo3-1" → "veo3.1"
    const prev = toks[toks.length - 1];
    if (/^\d$/.test(t) && prev && /\d$/.test(prev)) toks[toks.length - 1] = `${prev}.${t}`; else toks.push(t);
  }
  return toks.map((t) => {
    if (/^\d+p$/.test(t)) return t;                       // 480p, 1080p
    if (/^\d+k$/i.test(t)) return t.toUpperCase();        // 4k → 4K
    if (/^v?\d/.test(t)) return t.replace(/^v(\d)/, 'v$1'); // 3.0, v3
    if (['ai', 'hd', 'vip', 'lora', 'llm', 'ocr', 'tts', 'gpt', 'flf', 'ugc'].includes(t)) return t.toUpperCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }).join(' ');
}
const cleanTitle = (k, s) => (s.title && s.title.toLowerCase() !== k.replace(/_/g, ' ') ? s.title : k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));

// ── Construção do catálogo ──────────────────────────────────────────────────────
const out = { image: [], video: [], audio: [] };
const problems = [];
for (const [path, item] of Object.entries(spec.paths)) {
  const op = item.post;
  if (!op || !path.startsWith('/api/v1/')) continue;
  const slug = path.slice('/api/v1/'.length);
  if (slug.includes('/') || slug.includes('{')) continue; // só endpoints de geração diretos
  const cls = (op.tags || []).map((t) => classify(t, slug)).find(Boolean);
  if (!cls) continue;
  const body = op.requestBody?.content?.['application/json']?.schema;
  const schema = deref(body);
  if (!schema?.properties) { problems.push(`${slug}: sem schema`); continue; }
  const required = new Set(schema.required || []);

  const inputs = {}; const media = []; let limited = false;
  for (const [k, raw] of Object.entries(schema.properties)) {
    if (k === 'webhook_url' || k === 'prompt') continue;
    const s = unwrap(raw);
    const kind = mediaKind(k, s);
    if (kind) {
      const isArr = s.type === 'array';
      media.push({ name: k, kind, array: isArr, required: required.has(k), title: cleanTitle(k, s), ...(s.description ? { description: String(s.description).slice(0, 200) } : {}),
        ...(isArr && s.maxItems ? { maxItems: s.maxItems } : {}), ...(isArr && s.minItems ? { minItems: s.minItems } : {}) });
      continue;
    }
    if (s.type === 'object' || s.type === 'array') { if (required.has(k)) limited = true; continue; } // não renderizável na UI genérica
    inputs[k] = { name: k, type: s.type || 'string', title: cleanTitle(k, s),
      ...(s.description ? { description: String(s.description).slice(0, 220) } : {}),
      ...(s.enum ? { enum: s.enum } : {}), ...(s.default !== undefined && s.default !== null ? { default: s.default } : {}),
      ...(s.minimum !== undefined ? { minValue: s.minimum } : {}), ...(s.maximum !== undefined ? { maxValue: s.maximum } : {}),
      ...(s.multipleOf ? { step: s.multipleOf } : {}), ...(required.has(k) ? { required: true } : {}) };
  }
  let [studio, mode] = cls;
  if (studio === 'image' && media.some((m) => m.kind === 'video' && m.required)) { studio = 'video'; mode = 'v2v'; } // ferramenta de vídeo listada em imagem
  else if (studio === 'image' && mode === 't2i' && media.some((m) => m.kind === 'image' && m.required)) mode = 'i2i';
  out[studio].push({
    id: slug, endpoint: slug, studio, mode, name: prettyName(slug), provider: provider(slug), tier: /\(([^)]+)\)\s*$/.exec(op.summary || '')?.[1] || null,
    description: String(op.description || '').split('\n')[0].slice(0, 240),
    hasPrompt: 'prompt' in schema.properties, promptRequired: required.has('prompt'), limited,
    // O OpenAPI não marca como obrigatória a mídia de vários modelos (ex.: image_url do Seedance 2.5 i2v), mas a API exige ao menos uma.
    needsMedia: MEDIA_MODES.has(mode) && media.length > 0 && !media.some((m) => m.required), media, inputs,
  });
}
for (const s of ['image', 'video', 'audio']) out[s].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

writeFileSync('data/catalog.json', JSON.stringify({ source: SPEC_URL, apiVersion: spec.info?.version, generatedAt: new Date().toISOString(), ...out }));
const count = (l) => l.reduce((a, m) => ((a[m.mode] = (a[m.mode] || 0) + 1), a), {});
console.log(`Fonte: ${offline ? 'cache local' : SPEC_URL}`);
console.log('image', out.image.length, count(out.image));
console.log('video', out.video.length, count(out.video));
console.log('audio', out.audio.length, out.audio.map((m) => m.id + (m.limited ? '(limitado)' : '')).join(', '));
console.log('limitados (campo obrigatório não renderizável):', [...out.image, ...out.video].filter((m) => m.limited).length);
if (problems.length) console.log('avisos:', problems.slice(0, 10));
