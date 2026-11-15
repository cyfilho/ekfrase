// SPDX-License-Identifier: MPL-2.0

import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    // os *.spec.ts são roteiros do Playwright (tests/teclado.spec.ts, por `npm run teclado`), não do Vitest
    exclude: [...configDefaults.exclude, '**/*.spec.ts'],
    environment: 'node',
  },
});
