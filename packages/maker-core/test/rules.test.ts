// SPDX-License-Identifier: MPL-2.0

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const sources = readdirSync(srcDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ file: f, text: readFileSync(join(srcDir, f), 'utf8') }));

// Remove comentários para que a explicação das regras não conte como violação.
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('regras do núcleo (DEC-009)', () => {
  it('sem funções transcendentais, raiz, potência nem Math.random', () => {
    const forbidden =
      /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|pow|log|log2|log10|log1p|sqrt|cbrt|hypot|random)\b|\*\*/;
    for (const s of sources) expect(code(s.text), s.file).not.toMatch(forbidden);
  });

  it('sem DOM, rede nem relógio', () => {
    const forbidden = /\b(window|document|navigator|fetch|XMLHttpRequest|localStorage|Date\.now|performance)\b/;
    for (const s of sources) expect(code(s.text), s.file).not.toMatch(forbidden);
  });
});
