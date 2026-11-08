// SPDX-License-Identifier: MPL-2.0

/**
 * Tradução sem dependências (DEC-026). Os textos vivem só em `locales/*.json`,
 * com chaves planas e `{parametros}`; plural por `Intl.PluralRules` (chave.one, chave.other…).
 */

import type { CoreErrorCode } from '@ekfrase/maker-core';
import type { DocErrorCode } from '@ekfrase/maker-doc';
import type { BiomeId, GenErrorCode } from '@ekfrase/maker-gen';
import en from '../../../locales/en/maker.json';
import ptBR from '../../../locales/pt-BR/maker.json';

type Messages = Readonly<Record<string, string>>;

export const LOCALES = { 'pt-BR': ptBR as Messages, en: en as Messages } as const;
export type Locale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: Locale = 'pt-BR';

export type Params = Readonly<Record<string, string | number>>;

let current: Locale = DEFAULT_LOCALE;
let pluralRules = new Intl.PluralRules(current);
let numberFormat = new Intl.NumberFormat(current);
const listeners = new Set<() => void>();

export function isLocale(value: string): value is Locale {
  return Object.hasOwn(LOCALES, value);
}

/** Primeiro idioma suportado da lista de preferências (ex.: navigator.languages). */
export function detectLocale(preferred: readonly string[]): Locale {
  // A ordem das preferências manda: "pt-PT, en" escolhe português, não inglês.
  for (const tag of preferred) {
    if (isLocale(tag)) return tag;
    const base = tag.toLowerCase().split('-')[0];
    const match = (Object.keys(LOCALES) as Locale[]).find((l) => l.toLowerCase().split('-')[0] === base);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  pluralRules = new Intl.PluralRules(locale);
  numberFormat = new Intl.NumberFormat(locale);
  for (const f of listeners) f();
}

export function onLocaleChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Texto traduzido. Uma chave inexistente devolve a própria chave (e os testes impedem isso). */
export function t(key: string, params: Params = {}, locale: Locale = current): string {
  const messages = LOCALES[locale];
  let message = messages[key];
  const count = params['count'];
  if (message === undefined && typeof count === 'number') {
    // ".zero" opcional vale antes da regra do idioma (o CLDR trata 0 como singular em português).
    const rules = locale === current ? pluralRules : new Intl.PluralRules(locale);
    message =
      (count === 0 ? messages[`${key}.zero`] : undefined) ??
      messages[`${key}.${rules.select(count)}`] ??
      messages[`${key}.other`];
  }
  if (message === undefined) return key;
  return message.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return typeof value === 'number' ? numberFormat.format(value) : value;
  });
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(current, options).format(value);
}

/** Distância com unidade do `Intl`: metros abaixo de 1 km, quilômetros acima. */
export function formatDistance(metres: number): string {
  const abs = Math.abs(metres);
  if (abs < 1000) {
    return formatNumber(metres, { style: 'unit', unit: 'meter', maximumFractionDigits: abs < 10 ? 2 : abs < 100 ? 1 : 0 });
  }
  const km = metres / 1000;
  const absKm = Math.abs(km);
  return formatNumber(km, { style: 'unit', unit: 'kilometer', maximumFractionDigits: absKm < 10 ? 2 : absKm < 100 ? 1 : 0 });
}

/** Chaves dos códigos de erro do núcleo; o tipo obriga a cobrir todos os códigos. */
export const CORE_ERROR_KEYS: Readonly<Record<CoreErrorCode, string>> = {
  'not-an-integer': 'error.core.not-an-integer',
  'level-out-of-range': 'error.core.level-out-of-range',
  'coordinate-out-of-range': 'error.core.coordinate-out-of-range',
  'digit-out-of-range': 'error.core.digit-out-of-range',
  'no-children-below-level-0': 'error.core.no-children-below-level-0',
  'no-parent-above-max-level': 'error.core.no-parent-above-max-level',
  'level-mismatch': 'error.core.level-mismatch',
  'invalid-cell-key': 'error.core.invalid-cell-key',
  'invalid-spacing': 'error.core.invalid-spacing',
};

/** Chaves dos códigos de erro do documento e do arquivo. */
export const DOC_ERROR_KEYS: Readonly<Record<DocErrorCode, string>> = {
  'invalid-value': 'error.doc.invalid-value',
  'invalid-property': 'error.doc.invalid-property',
  'invalid-id': 'error.doc.invalid-id',
  'duplicate-id': 'error.doc.duplicate-id',
  'unknown-entity': 'error.doc.unknown-entity',
  'unknown-feature': 'error.doc.unknown-feature',
  'unknown-annotation': 'error.doc.unknown-annotation',
  'unknown-plugin': 'error.doc.unknown-plugin',
  'invalid-command': 'error.doc.invalid-command',
  'not-an-ekfrase-file': 'error.doc.not-an-ekfrase-file',
  'other-app': 'error.doc.other-app',
  'file-too-large': 'error.doc.file-too-large',
  'missing-manifest': 'error.doc.missing-manifest',
  'invalid-manifest': 'error.doc.invalid-manifest',
  'unsupported-format-version': 'error.doc.unsupported-format-version',
  'missing-document': 'error.doc.missing-document',
  'corrupt-document': 'error.doc.corrupt-document',
};

export const GEN_ERROR_KEYS: Readonly<Record<GenErrorCode, string>> = {
  'unknown-generator': 'error.gen.unknown-generator',
  'invalid-parameter': 'error.gen.invalid-parameter',
  'invalid-world': 'error.gen.invalid-world',
};

export const BIOME_KEYS: Readonly<Record<BiomeId, string>> = {
  ocean: 'biome.ocean',
  tundra: 'biome.tundra',
  desert: 'biome.desert',
  plain: 'biome.plain',
  forest: 'biome.forest',
  swamp: 'biome.swamp',
};

/** Aplica traduções aos elementos com data-i18n, data-i18n-title e data-i18n-aria-label. */
export function translateDom(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset['i18n']!);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset['i18nTitle']!);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    el.setAttribute('aria-label', t(el.dataset['i18nAriaLabel']!));
  }
}
