'use client';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function SignOut({ supabaseUrl, supabaseKey }) {
  const router = useRouter();
  return (
    <button className="linkbtn" onClick={async () => { await supabaseBrowser(supabaseUrl, supabaseKey).auth.signOut(); router.replace('/login'); router.refresh(); }}>
      Sair
    </button>
  );
}
