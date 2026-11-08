// SPDX-License-Identifier: MPL-2.0

import { defineConfig } from 'vite';

/**
 * No ar, o Maker mora em ekfrase.com/maker/ e a ponte em ekfrase.com/api/ (a
 * conta e os mundos na nuvem). No computador, /api vai ao `php -S` da porta
 * 8090. A casca (topo, entrada, rodapé, nuvem) é em Preact; o editor, não. Os
 * ladrilhos são desenhados em Web Workers (formato ES module).
 */
export default defineConfig({
  base: '/maker/',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8090' } },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
