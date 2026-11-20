// SPDX-License-Identifier: MPL-2.0

/**
 * Servir os arquivos do app (parte do Motor, sem importar o Electron): o que a janela (`janela.ts`, pelo
 * `app://`) entrega. Nunca
 * fora da pasta; o caminho sem extensão que não é arquivo (uma tela do app: `/writer/app/ideias`) recebe o
 * `index.html`, como o `.htaccess` do site; com extensão (um .js que falta) = nada.
 *
 * E o registro do que foi barrado (`travas.bloqueado`), que os testes leem.
 */
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

export interface Bloqueio {
  tipo: 'navegar' | 'janela' | 'tecla' | 'permissao' | 'webview' | 'rede-pagina' | 'rede' | 'devtools' | 'ponte';
  alvo: string;
}

/** O que foi bloqueado (para os testes; a casca não mostra). */
export const travas = { bloqueado: [] as Bloqueio[] };
export const anotar = (b: Bloqueio): void => {
  travas.bloqueado.push(b);
  if (travas.bloqueado.length > 500) travas.bloqueado.splice(0, 100);
};

/** O tipo de cada arquivo servido. */
export const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** A política de conteúdo das páginas do app (nada de fora; só o que veio no pacote). */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export interface ArquivoDoApp {
  corpo: Buffer;
  tipo: string;
}

/**
 * O arquivo de um caminho do app (`/writer/assets/x.js` com a base `/writer/` → `<pasta>/assets/x.js`), ou `null`.
 * `caminho` já vem decodificado e sem a busca (`?…`).
 */
export async function arquivoDoApp(pasta: string, base: string, caminho: string): Promise<ArquivoDoApp | null> {
  const raiz = normalize(pasta);
  const b = (base || '/').replace(/\/?$/, '/');
  let c = caminho;
  if (b !== '/' && c.startsWith(b)) c = `/${c.slice(b.length)}`;
  if (c === '/' || c === '') c = '/index.html';
  const arquivo = normalize(join(raiz, c));
  if (arquivo !== raiz && !arquivo.startsWith(raiz + sep)) return null;
  const ler = async (f: string): Promise<ArquivoDoApp> => ({ corpo: await readFile(f), tipo: TIPOS[extname(f).toLowerCase()] ?? 'application/octet-stream' });
  try {
    return await ler(arquivo);
  } catch {
    if (extname(c) !== '') return null;
    try {
      return await ler(join(raiz, 'index.html'));
    } catch {
      return null;
    }
  }
}
