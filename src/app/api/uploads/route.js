import { apiSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

const MB = 1024 * 1024;
const KINDS = {
  image: { types: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }, max: 10 * MB, label: 'PNG, JPG ou WebP' },
  video: { types: { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }, max: 50 * MB, label: 'MP4, MOV ou WebM' },
  audio: { types: { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg' }, max: 25 * MB, label: 'MP3, WAV, M4A, AAC ou OGG' },
};

export async function POST(req) {
  const s = await apiSession();
  if (s.error) return s.error;
  const form = await req.formData();
  const kind = String(form.get('kind') || 'image');
  const cfg = KINDS[kind];
  if (!cfg) return Response.json({ error: 'Tipo de arquivo inválido.' }, { status: 400 });
  const file = form.get('file');
  if (!file || typeof file === 'string') return Response.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
  const ext = cfg.types[file.type];
  if (!ext) return Response.json({ error: `Formato não suportado. Use ${cfg.label}.` }, { status: 400 });
  if (file.size > cfg.max) return Response.json({ error: `Arquivo maior que ${cfg.max / MB} MB.` }, { status: 400 });

  const path = `${s.user.id}/${crypto.randomUUID()}.${ext}`;
  const sb = supabaseAdmin();
  const { error } = await sb.storage.from('atelie-uploads').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (error) return Response.json({ error: 'Falha ao salvar o arquivo.' }, { status: 500 });
  const { data } = await sb.storage.from('atelie-uploads').createSignedUrl(path, 3600);
  return Response.json({ path, kind, previewUrl: data?.signedUrl, name: file.name, size: file.size });
}
