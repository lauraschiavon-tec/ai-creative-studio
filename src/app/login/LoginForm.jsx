'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function LoginForm({ supabaseUrl, supabaseKey, legacy, initialError }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const id = email.trim();
    // Login antigo (fallback): identificador com "@" = e-mail do Supabase. Usuário da Dashboard nunca tem "@".
    if (legacy && id.includes('@')) {
      const { error } = await supabaseBrowser(supabaseUrl, supabaseKey).auth.signInWithPassword({ email: id, password });
      if (error) { setError('E-mail ou senha incorretos.'); setBusy(false); return; }
      router.replace('/'); router.refresh();
      return;
    }
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: id, password }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      setError(data.error || 'Não foi possível entrar. Tente novamente.');
      setBusy(false);
      return;
    }
    router.replace('/'); router.refresh();
  }

  return (
    <div className="login">
      <section className="login-art">
        <span className="brand">ai-creative <small style={{ color: '#c9bfae' }}>estúdio interno</small></span>
        <div>
          <h1>Da ideia à <em>imagem</em>, sem sair da mesa.</h1>
          <p style={{ marginTop: 22 }}>Ferramenta interna da equipe para criar imagens e vídeos com os melhores modelos, com histórico e custo de cada geração.</p>
        </div>
        <span className="muted mono" style={{ color: '#8f8676' }}>Acesso restrito à equipe</span>
        <i className="frame" /><i className="frame b" />
      </section>
      <section className="login-form">
        <form onSubmit={submit} className="stack">
          <h2 style={{ fontSize: 32 }}>Entrar</h2>
          <label className="field"><span className="lbl">Usuário</span>
            <input type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span className="lbl">Senha</span>
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn primary block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
          <p className="hint">Use o mesmo usuário e senha da Dashboard. Sem acesso? Peça ao administrador da Dashboard.</p>
        </form>
      </section>
    </div>
  );
}
