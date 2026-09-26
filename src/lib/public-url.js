// URL pública da requisição (atrás do proxy do EasyPanel o req.url pode vir com o host interno).
export function publicUrl(req, path) {
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host') || req.nextUrl.host;
  const proto = (h.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')).split(',')[0].trim();
  return new URL(path, `${proto}://${host.split(',')[0].trim()}`);
}
