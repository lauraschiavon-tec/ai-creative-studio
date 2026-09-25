// Cria um usuário do Ateliê (cadastro fechado).
// Uso: npm run create-user -- email [admin|user] ["Nome"]
// A senha é pedida no terminal (sem eco) — não vai para argumentos, histórico do shell nem Git.
// Alternativa não interativa: defina ATELIE_PASSWORD no ambiente.
// Se o e-mail já existe no Supabase Auth (ex.: usuário de outro sistema do mesmo projeto),
// apenas concede acesso ao Ateliê, sem alterar a senha dele.
import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';

const [email, role = 'user', name] = process.argv.slice(2);
if (!email || !['admin', 'user'].includes(role)) {
  console.error('Uso: npm run create-user -- email [admin|user] ["Nome"]');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); }; // não ecoa a digitação
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

let password = process.env.ATELIE_PASSWORD;
if (!password) {
  if (!process.stdin.isTTY) { console.error('Rode em um terminal interativo ou defina ATELIE_PASSWORD.'); process.exit(1); }
  password = await askHidden('Senha (mín. 8 caracteres): ');
  if (password !== (await askHidden('Repita a senha: '))) { console.error('As senhas não coincidem.'); process.exit(1); }
}
if (password.length < 8) { console.error('A senha precisa ter ao menos 8 caracteres.'); process.exit(1); }

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
