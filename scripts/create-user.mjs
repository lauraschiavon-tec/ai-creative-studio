// Cria um usuário do Ateliê (cadastro fechado).
// Uso: npm run create-user -- email senha [admin|user] ["Nome"]
// Se o e-mail já existe no Supabase Auth (ex.: usuário de outro sistema do mesmo projeto),
// apenas concede acesso ao Ateliê, sem alterar a senha dele.
import { createClient } from '@supabase/supabase-js';

const [email, password, role = 'user', name] = process.argv.slice(2);
if (!email || !password || !['admin', 'user'].includes(role)) {
  console.error('Uso: npm run create-user -- email senha [admin|user] ["Nome"]');
  process.exit(1);
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

let userId;
const created = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: name ? { full_name: name } : {} });
if (created.error) {
  if (!/already|registered|exists/i.test(created.error.message)) { console.error('Erro:', created.error.message); process.exit(1); }
  const { data } = await sb.auth.admin.listUsers({ perPage: 1000 });
  userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  if (!userId) { console.error('Usuário existe mas não foi encontrado.'); process.exit(1); }
  console.log('E-mail já existia no Auth: senha mantida, acesso ao Ateliê concedido.');
} else {
  userId = created.data.user.id;
}

const { error } = await sb.from('atelie_profiles').upsert({ id: userId, email, full_name: name || email.split('@')[0], role, active: true });
if (error) { console.error('Erro ao criar perfil (o SQL 001_init.sql já foi executado?):', error.message); process.exit(1); }
console.log(`Pronto: ${email} (${role})`);
