import { redirect } from 'next/navigation';
import { getSession, legacyEnabled } from '@/lib/auth';
import LoginForm from './LoginForm';

// Dinâmica: lê as variáveis públicas do Supabase em runtime (não no build).
export const dynamic = 'force-dynamic';

const ERROS = {
  sso: 'Não foi possível entrar pela Dashboard (link expirado ou já usado). Abra o AI Studio pela Dashboard de novo ou entre com seu usuário e senha.',
  sem_acesso: 'Você não tem acesso ao AI Studio. Peça ao administrador da Dashboard.',
  desativado: 'Usuário desativado.',
};

export default async function Login({ searchParams }) {
  if (await getSession()) redirect('/');
  const { erro } = await searchParams;
  return (
    <LoginForm
      supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL}
      supabaseKey={process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
      legacy={legacyEnabled()}
      initialError={ERROS[erro] || ''}
    />
  );
}
