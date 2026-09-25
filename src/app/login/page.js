import LoginForm from './LoginForm';

// Dinâmica: lê as variáveis públicas do Supabase em runtime (não no build).
export const dynamic = 'force-dynamic';

export default function Login() {
  return <LoginForm supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL} supabaseKey={process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY} />;
}
