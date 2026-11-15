// SPDX-License-Identifier: MPL-2.0

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';

/**
 * O Writer como PWA (só no build; `npm run writer` não tem service worker):
 * - põe no `index.html` o link do manifest;
 * - grava um manifest POR IDIOMA, com o nome e a descrição tirados de `locales/<idioma>/writer.json`
 *   (nenhum texto aqui): `manifest.<idioma>.webmanifest`, e `manifest.webmanifest` = o pt-BR. O
 *   `main.tsx` aponta o link para o do idioma da pessoa (e troca quando ela troca de idioma), e
 *   quem instala em inglês instala com nome e descrição em inglês;
 * - grava `sw.js` = a lista de todos os arquivos do build + uma versão (hash do conteúdo de todos)
 *   + o código de `pwa/sw.js`. Mudou qualquer arquivo, muda o `sw.js`, e o navegador se atualiza.
 */
const AQUI = fileURLToPath(new URL('.', import.meta.url));
const RAIZ = resolve(AQUI, '..', '..', '..');
/** O .woff fica de fora: todo navegador com service worker lê .woff2. */
const FORA = /(^sw\.js$|\.map$|\.woff$)/;

function arquivosDe(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...arquivosDe(f));
    else out.push(f);
  }
  return out;
}

export function pwa(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'ekfrase-writer-pwa',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    transformIndexHtml() {
      return [{ tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' }];
    },
    writeBundle() {
      const saida = resolve(config.root, config.build.outDir);
      const locales = join(RAIZ, 'locales');
      const manifestDe = (idioma: string): string => {
        const textos = JSON.parse(readFileSync(join(locales, idioma, 'writer.json'), 'utf8')) as Record<string, string>;
        const manifest = {
          name: textos['pwa.nome'],
          short_name: textos['nome'],
          description: textos['entrada.descricao'],
          lang: idioma,
          start_url: './',
          scope: './',
          display: 'standalone',
          background_color: '#1b2440',
          theme_color: '#1b2440',
          icons: [
            { src: 'icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: 'icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        };
        return `${JSON.stringify(manifest, null, 2)}\n`;
      };
      const idiomas = readdirSync(locales).filter((n) => statSync(join(locales, n)).isDirectory() && existsSync(join(locales, n, 'writer.json')));
      for (const idioma of idiomas) writeFileSync(join(saida, `manifest.${idioma}.webmanifest`), manifestDe(idioma));
      writeFileSync(join(saida, 'manifest.webmanifest'), manifestDe('pt-BR'));

      const lista = arquivosDe(saida)
        .map((f) => relative(saida, f).split(sep).join('/'))
        .filter((a) => !FORA.test(a))
        .sort();
      const h = createHash('sha256');
      for (const a of lista) h.update(a).update(readFileSync(join(saida, a)));
      const versao = h.digest('hex').slice(0, 12);
      const arquivos = lista;
      const codigo = readFileSync(join(AQUI, 'sw.js'), 'utf8');
      writeFileSync(join(saida, 'sw.js'), `${codigo.split('\n')[0]}\nself.WRITER_OFFLINE = ${JSON.stringify({ versao, arquivos })};\n${codigo.split('\n').slice(1).join('\n')}`);
      config.logger.info(`  sw.js: versão ${versao}, ${arquivos.length} arquivos para usar sem internet`);
    },
  };
}
