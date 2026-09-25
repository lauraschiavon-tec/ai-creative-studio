import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { isSandbox } from '@/lib/muapi';
import SignOut from './SignOut';

const SOON = ['Lip Sync', 'Cinema'];

export default async function AppShell({ active, admin = false, children }) {
  const { profile } = await requireSession({ admin });
  const link = (href, key, label) => <Link href={href} className={active === key ? 'on' : ''}>{label}</Link>;
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">Ateliê <small>estúdio interno</small></Link>
        <nav className="nav">
          {link('/', 'image', 'Imagem')}
          {link('/video', 'video', 'Vídeo')}
          {SOON.map((n) => <span key={n} title="Próxima etapa">{n}<em>em breve</em></span>)}
          {link('/history', 'history', 'Histórico')}
          {profile.role === 'admin' && link('/admin', 'admin', 'Custos')}
        </nav>
        <div className="userbox">
          {isSandbox() && <span className="badge sand" title="Modo de teste: nada é cobrado e os resultados são de exemplo">Sandbox</span>}
          <span>{profile.full_name || profile.email}</span>
          <SignOut supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL} supabaseKey={process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY} />
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
