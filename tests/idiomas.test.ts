// SPDX-License-Identifier: MPL-2.0
/**
 * Regras dos textos (DEC-P010): todo idioma tem os mesmos arquivos e as mesmas
 * chaves do português; os {parametros} batem; nenhum texto vazio; toda chave
 * usada no código existe. Traduzir para outra língua = copiar `locales/en`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const pasta = join(raiz, 'locales');
const idiomas = readdirSync(pasta).filter((n) => statSync(join(pasta, n)).isDirectory());

function ler(idioma: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const arq of readdirSync(join(pasta, idioma)).filter((n) => n.endsWith('.json'))) {
    out[arq.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(pasta, idioma, arq), 'utf8')) as Record<string, string>;
  }
  return out;
}

const pt = ler('pt-BR');
const parametros = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function codigo(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist') continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) codigo(f, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(f);
  }
  return out;
}

describe('idiomas', () => {
  it('existem português e inglês', () => {
    expect(idiomas).toEqual(expect.arrayContaining(['pt-BR', 'en']));
  });

  for (const idioma of idiomas.filter((i) => i !== 'pt-BR')) {
    it(`${idioma} tem os mesmos arquivos, chaves e parâmetros do português`, () => {
      const outro = ler(idioma);
      expect(Object.keys(outro).sort()).toEqual(Object.keys(pt).sort());
      for (const [arq, msgs] of Object.entries(pt)) {
        expect(Object.keys(outro[arq]!).sort(), `${idioma}/${arq}.json`).toEqual(Object.keys(msgs).sort());
        for (const [k, v] of Object.entries(msgs)) {
          expect(parametros(outro[arq]![k]!), `${idioma}/${arq}.json → ${k}`).toEqual(parametros(v));
        }
      }
    });
  }

  it('nenhum texto vazio e todo idioma tem nome', () => {
    for (const idioma of idiomas) {
      const msgs = ler(idioma);
      expect(msgs['nucleo']?.['idioma.nome'], idioma).toBeTruthy();
      for (const [arq, m] of Object.entries(msgs)) for (const [k, v] of Object.entries(m)) expect(v.trim(), `${idioma}/${arq}.json → ${k}`).not.toBe('');
    }
  });

  it('toda chave escrita no código existe no português', () => {
    const faltando: string[] = [];
    for (const f of [...codigo(join(raiz, 'apps')), ...codigo(join(raiz, 'packages'))]) {
      if (f.endsWith('.test.ts')) continue;
      // O Maker chama t('chave') com as chaves do arquivo dele (locales/<idioma>/maker.json), sem o
      // prefixo do arquivo; o teste dele (apps/maker/test/i18n.test.ts) cobra essas chaves.
      if (/[\\/](apps[\\/]maker|packages[\\/]maker-[a-z]+)[\\/]/.test(f)) continue;
      const texto = readFileSync(f, 'utf8');
      for (const m of texto.matchAll(/\bt\(\s*'([a-z0-9_-]+)\.([a-z0-9_.-]+)'/g)) {
        const [arq, chave] = [m[1]!, m[2]!];
        const msgs = pt[arq];
        const existe = msgs !== undefined && (chave in msgs || `${chave}.other` in msgs);
        if (!existe) faltando.push(`${relative(raiz, f)}: ${arq}.${chave}`);
      }
    }
    expect(faltando).toEqual([]);
  });

  // o servidor (ponte/) só existe no repositório da plataforma
  it.skipIf(!existsSync(join(raiz, 'ponte', 'sql', 'esquema.sql')))('todo papel do banco tem nome nos idiomas (a chave é montada no código)', () => {
    const esquema = readFileSync(join(raiz, 'ponte', 'sql', 'esquema.sql'), 'utf8');
    const papeis = /papel ENUM\(([^)]*)\)/.exec(esquema)![1]!.split(',').map((s) => s.trim().replace(/'/g, ''));
    for (const p of papeis) expect(pt['nucleo']![`papel.${p}`], p).toBeTruthy();
  });
});
