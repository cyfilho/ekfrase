// SPDX-License-Identifier: MPL-2.0

import { defineConfig } from 'vite';
import { pwa } from './pwa/plugin.ts';

/**
 * No ar, o Writer mora em ekfrase.com/writer/ e a ponte PHP em ekfrase.com/api/. No computador, o
 * mesmo desenho: /api vai ao `php -S` da porta 8090.
 */
export default defineConfig({
  base: '/writer/',
  plugins: [pwa()],
  // um preact só: com as junções do npm em "c:\" minúsculo, o Windows achava duas cópias (e os hooks quebravam)
  resolve: { dedupe: ['preact'] },
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  server: {
    host: '127.0.0.1',
    port: 5350,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8090' },
  },
  build: { target: 'es2022' },
});
