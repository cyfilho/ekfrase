// SPDX-License-Identifier: MPL-2.0

import { defineConfig } from 'vite';

/**
 * No ar, a Biblioteca mora em ekfrase.com/biblioteca/ (o acervo em /biblioteca/acervo/, gerado por
 * scripts/biblioteca.ts) e a ponte PHP em ekfrase.com/api/. No computador, o mesmo desenho: /api vai
 * ao `php -S` da porta 8090.
 */
export default defineConfig({
  base: '/biblioteca/',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  server: {
    host: '127.0.0.1',
    port: 5330,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8090' },
  },
  build: { target: 'es2022' },
});
