import { apiSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX = 10 * 1024 * 1024;

export async function POST(req) {
  const s = await apiSession();
  if (s.error) return s.error;
  const file = (await req.formData()).get('file');
  if (!file || typeof file === 'string') return Response.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return Response.json({ error: 'Formato não suportado. Use PNG, JPG ou WebP.' }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: 'Arquivo maior que 10 MB.' }, { status: 400 });

  const path = `${s.user.id}/${crypto.randomUUID()}.${ext}`;
  const sb = supabaseAdmin();
  const { error } = await sb.storage.from('atelie-uploads').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (error) return Response.json({ error: 'Falha ao salvar o arquivo.' }, { status: 500 });
  const { data } = await sb.storage.from('atelie-uploads').createSignedUrl(path, 3600);
  return Response.json({ path, previewUrl: data?.signedUrl, name: file.name, size: file.size });
}
