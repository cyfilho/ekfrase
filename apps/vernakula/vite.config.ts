// SPDX-License-Identifier: MPL-2.0

import { defineConfig } from 'vite';

/**
 * No ar, o Vernákula mora em ekfrase.com/vernakula/ e a ponte PHP em ekfrase.com/api/.
 * No computador, o mesmo desenho: o Vite serve /vernakula/ e repassa /api ao
 * `php -S` que o scripts/abrir.mjs liga na porta 8090.
 */
export default defineConfig({
  base: '/vernakula/',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  server: {
    host: '127.0.0.1',
    port: 5310,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8090' },
  },
  build: { target: 'es2022' },
});
