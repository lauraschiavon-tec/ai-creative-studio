// Resolve os imports "de bundler" do src/ (alias "@/" e caminhos sem extensão) para poder testar com o Node puro.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = path.resolve(fileURLToPath(new URL('../src/', import.meta.url)));
const SRC_URL = pathToFileURL(SRC + path.sep).href;
const TRIES = ['', '.js', '.jsx', '.mjs', '/index.js'];

export async function resolve(specifier, context, next) {
  let target = null;
  if (specifier.startsWith('@/')) target = path.join(SRC, specifier.slice(2));
  else if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith(SRC_URL)) target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  if (target) {
    for (const ext of TRIES) {
      const f = target + ext;
      if (existsSync(f) && statSync(f).isFile()) return next(pathToFileURL(f).href, context);
    }
  }
  return next(specifier, context);
}
