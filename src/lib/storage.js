import 'server-only';
import { supabaseAdmin } from './supabase/admin';

// O projeto Supabase é compartilhado e pode responder "Too many connections" em picos.
// Operações de Storage tentam de novo (com espera crescente) antes de desistir.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withRetry(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    if (!last?.error) return last;
    if (i < attempts - 1) await sleep(400 * (i + 1));
  }
  return last;
}

export const signedUrl = (bucket, path, ttl, opts) =>
  withRetry(() => supabaseAdmin().storage.from(bucket).createSignedUrl(path, ttl, opts));

export const putObject = (bucket, path, body, opts) =>
  withRetry(() => supabaseAdmin().storage.from(bucket).upload(path, body, opts));
