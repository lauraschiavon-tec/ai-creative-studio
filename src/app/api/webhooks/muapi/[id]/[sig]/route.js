import { store } from '@/lib/generation-store';
import { syncGenerationDetailed, logEvent } from '@/lib/generations';
import { handleWebhook } from '@/lib/webhook';

export const dynamic = 'force-dynamic';

// Callback da MuAPI (registrado por geração no envio, via ?webhook=). Sem sessão: a autenticação é o token HMAC da URL.
// Fica fora do middleware (o matcher exclui /api). Só aceita POST.
export async function POST(req, { params }) {
  const { id, sig } = await params;
  const payload = await req.json().catch(() => ({}));
  try {
    const r = await handleWebhook({ id, sig, payload }, { service: { syncGenerationDetailed }, store, log: logEvent });
    return Response.json(r.body, { status: r.status });
  } catch (e) {
    console.error('[webhook]', id, e?.message);
    return Response.json({ ok: false, error: 'internal' }, { status: 500 }); // 5xx: a MuAPI reenvia
  }
}
