'use client';
import { createBrowserClient } from '@supabase/ssr';

// URL e chave publicável chegam do servidor em runtime (props), não do bundle:
// assim o app funciona mesmo que o build não receba as variáveis NEXT_PUBLIC_*.
export const supabaseBrowser = (url, publishableKey) => createBrowserClient(url, publishableKey);
