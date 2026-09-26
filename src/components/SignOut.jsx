'use client';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function SignOut({ supabaseUrl, supabaseKey }) {
  const router = useRouter();
  async function out() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); // sessão da Dashboard
    await supabaseBrowser(supabaseUrl, supabaseKey).auth.signOut().catch(() => {}); // login antigo (fallback)
    router.replace('/login'); router.refresh();
  }
  return <button className="linkbtn" onClick={out}>Sair</button>;
}
