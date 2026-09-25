'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setError('E-mail ou senha incorretos.'); setBusy(false); return; }
    router.replace('/'); router.refresh();
  }

  return (
    <div className="login">
      <section className="login-art">
        <span className="brand">Ateliê <small style={{ color: '#c9bfae' }}>estúdio interno</small></span>
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
          <label className="field"><span className="lbl">E-mail</span>
            <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span className="lbl">Senha</span>
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn primary block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
          <p className="hint">Sem acesso? Peça um convite ao administrador.</p>
        </form>
      </section>
    </div>
  );
}
