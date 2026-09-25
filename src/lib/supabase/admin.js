import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Service role: ignora RLS. Usar apenas em código de servidor, depois de checar o usuário.
let client;
export function supabaseAdmin() {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
