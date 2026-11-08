// SPDX-License-Identifier: MPL-2.0

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BIOME_KEYS,
  CORE_ERROR_KEYS,
  DOC_ERROR_KEYS,
  GEN_ERROR_KEYS,
  LOCALES, detectLocale, setLocale, t, type Locale } from '../src/i18n';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const webSrc = join(root, 'apps/maker/src');
const indexHtml = readFileSync(join(root, 'apps/maker/index.html'), 'utf8');
const sources = readdirSync(webSrc)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ file: f, text: readFileSync(join(webSrc, f), 'utf8') }));
// A casca (Preact, .tsx) também usa chaves do Maker; ela entra na conferência das CHAVES, mas não na
// de "frases no código" (os nomes de classe CSS dela têm espaços, e o texto vem todo dos idiomas).
const casca = readdirSync(webSrc)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ file: f, text: readFileSync(join(webSrc, f), 'utf8') }));

const locales = Object.keys(LOCALES) as Locale[];
const keysOf = (l: Locale): string[] => Object.keys(LOCALES[l]).sort();
const paramsOf = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
const PLURAL_SUFFIX = /\.(zero|one|two|few|many|other)$/;

// Remove comentários e nomes de comando (`type: 'world.update'`), que parecem chaves mas não são texto.
const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/\btype:\s*'[^']*'/g, '');

/** Literais de string do código (aspas simples, duplas e trechos fixos de template). */
function literals(text: string): string[] {
  const code = stripComments(text);
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    out.push(...raw.split(/\$\{[^}]*\}/));
  }
  return out;
}

const allKeys = new Set(keysOf('pt-BR'));
const namespaces = new Set([...allKeys].map((k) => k.split('.')[0]!));

function usedKeys(): Set<string> {
  const used = new Set<string>();
  for (const s of [...sources, ...casca]) {
    for (const lit of literals(s.text)) {
      if (/^[a-z][\w-]*(\.[\w-]+)+$/i.test(lit) && namespaces.has(lit.split('.')[0]!)) used.add(lit);
    }
  }
  for (const m of indexHtml.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)) used.add(m[1]!);
  return used;
}

afterEach(() => setLocale('pt-BR'));

describe('arquivos de idioma', () => {
  it('todos os idiomas têm exatamente as mesmas chaves', () => {
    for (const l of locales) expect(keysOf(l), l).toEqual(keysOf('pt-BR'));
  });

  it('nenhum texto vazio e os mesmos {parametros} em todos os idiomas', () => {
    for (const key of allKeys) {
      for (const l of locales) {
        const value = LOCALES[l][key]!;
        expect(value.trim(), `${l}:${key}`).not.toBe('');
        expect(paramsOf(value), `${l}:${key}`).toEqual(paramsOf(LOCALES['pt-BR'][key]!));
      }
    }
  });

  it('toda chave usada no código existe', () => {
    const used = usedKeys();
    expect(used.size).toBeGreaterThan(20);
    const missing = [...used].filter((k) => !allKeys.has(k) && !locales.every((l) => `${k}.other` in LOCALES[l]));
    expect(missing).toEqual([]);
  });

  it('toda chave existente é usada no código', () => {
    const used = usedKeys();
    const unused = [...allKeys].filter((k) => !used.has(k) && !used.has(k.replace(PLURAL_SUFFIX, '')));
    expect(unused).toEqual([]);
  });

  it('todo código de erro do núcleo e do documento tem tradução', () => {
    const all = [CORE_ERROR_KEYS, DOC_ERROR_KEYS, GEN_ERROR_KEYS, BIOME_KEYS].flatMap((m) => Object.values(m));
    for (const key of all) {
      expect(allKeys.has(key), key).toBe(true);
    }
  });
});

describe('nenhum texto de interface fora dos arquivos de idioma', () => {
  it('index.html não tem texto visível', () => {
    const visible = indexHtml
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
      .replace(/<[^>]+>/g, '');
    expect(visible.trim()).toBe('');
    // Atributos que viram texto para o usuário também precisam vir dos idiomas.
    expect(indexHtml).not.toMatch(/\s(title|aria-label|placeholder|alt)="[^"]*[A-Za-z]/);
  });

  it('o código não tem frases nem palavras acentuadas em strings', () => {
    const offenders: string[] = [];
    for (const s of sources) {
      for (const lit of literals(s.text)) {
        if (/[À-ÿ]/.test(lit) || /\b[A-Za-z]{2,}\s+[A-Za-z]{2,}\b/.test(lit)) offenders.push(`${s.file}: ${lit}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('t()', () => {
  it('troca parâmetros e formata números pelo idioma', () => {
    setLocale('pt-BR');
    expect(t('level.badge', { level: 3 })).toBe('Nível 3');
    expect(t('cell.address', { level: 2, q: -1234, r: 5 })).toBe('(2; -1.234; 5)');
    setLocale('en');
    expect(t('level.badge', { level: 3 })).toBe('Level 3');
    expect(t('cell.address', { level: 2, q: -1234, r: 5 })).toBe('(2, -1,234, 5)');
  });

  it('plural pelo Intl.PluralRules', () => {
    setLocale('pt-BR');
    expect(t('grid.visibleCells', { count: 1 })).toBe('1 célula visível');
    // Em português o CLDR trata 0 como singular ("one"); a forma ".zero" opcional tem prioridade.
    expect(t('grid.visibleCells', { count: 0 })).toBe('Nenhuma célula visível');
    expect(t('doc.edits', { count: 0 })).toBe('Nenhuma edição no documento');
    expect(t('grid.visibleCells', { count: 2 })).toBe('2 células visíveis');
    setLocale('en');
    expect(t('grid.visibleCells', { count: 1 })).toBe('1 visible cell');
    expect(t('grid.visibleCells', { count: 1500 })).toBe('1,500 visible cells');
  });

  it('idioma explícito e chave inexistente', () => {
    expect(t('app.subtitle', {}, 'en')).toBe('Maps and worlds');
    expect(t('app.subtitle', {}, 'pt-BR')).toBe('Mapas e mundos');
    expect(t('nao.existe')).toBe('nao.existe');
  });

  it('detecta o idioma do navegador', () => {
    expect(detectLocale(['en-US'])).toBe('en');
    expect(detectLocale(['pt-PT', 'en'])).toBe('pt-BR');
    expect(detectLocale(['fr-FR'])).toBe('pt-BR');
    expect(detectLocale(['fr', 'en-GB'])).toBe('en');
  });
});
