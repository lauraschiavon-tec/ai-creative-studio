import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
for (const id of ['atelie-uploads', 'atelie-outputs']) {
  const { error } = await sb.storage.createBucket(id, { public: false });
  console.log(id, error ? error.message : 'criado');
}
