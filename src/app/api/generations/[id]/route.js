import { apiSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncGeneration, withSignedUrls } from '@/lib/generations';

export async function GET(_req, { params }) {
  const s = await apiSession();
  if (s.error) return s.error;
  const { id } = await params;
  const { data: row } = await supabaseAdmin().from('atelie_generations').select('*').eq('id', id).maybeSingle();
  if (!row || (row.user_id !== s.user.id && s.profile.role !== 'admin')) return Response.json({ error: 'Geração não encontrada.' }, { status: 404 });
  const synced = await syncGeneration(row);
  return Response.json((await withSignedUrls([synced]))[0]);
}
