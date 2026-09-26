import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { getMode } from '@/lib/mode';
import ModeToggle from './ModeToggle';
import SignOut from './SignOut';

export default async function AppShell({ active, admin = false, children }) {
  const { user, profile } = await requireSession({ admin });
  const mode = await getMode(user);
  const link = (href, key, label) => <Link href={href} className={active === key ? 'on' : ''}>{label}</Link>;
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">ai-creative <small>estúdio interno</small></Link>
        <nav className="nav">
          {link('/', 'image', 'Imagem')}
          {link('/video', 'video', 'Vídeo')}
          {link('/lipsync', 'lipsync', 'Lip Sync')}
          {link('/cinema', 'cinema', 'Cinema')}
          {link('/history', 'history', 'Histórico')}
          {profile.role === 'admin' && link('/admin', 'admin', 'Custos')}
        </nav>
        <div className="userbox">
          <ModeToggle sandbox={mode.sandbox} canChoose={mode.canChoose} reason={mode.reason} env={mode.env} />
          <span>{profile.full_name || profile.email}</span>
          <SignOut supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL} supabaseKey={process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY} />
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
