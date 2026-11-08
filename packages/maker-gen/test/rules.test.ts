// SPDX-License-Identifier: MPL-2.0

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('regras dos geradores (DEC-009)', () => {
  it('sem funções transcendentais, raiz, potência, Math.random, DOM nem relógio', () => {
    const forbidden =
      /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|pow|log|log2|log10|log1p|sqrt|cbrt|hypot|random|fround)\b|\*\*|\b(window|document|navigator|Date|performance)\b/;
    for (const f of readdirSync(srcDir).filter((n) => n.endsWith('.ts'))) {
      expect(code(readFileSync(join(srcDir, f), 'utf8')), f).not.toMatch(forbidden);
    }
  });
});
