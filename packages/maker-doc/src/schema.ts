// SPDX-License-Identifier: MPL-2.0

/**
 * Modelo de dados do documento (especificação §5; nomes de campo em inglês, DEC-039).
 * O documento guarda só semente, parâmetros e edições (porta aberta 1).
 * Distâncias e posições em quilômetros, com a unidade no nome do campo (DEC-015).
 */

import { DocError } from './errors';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Versão do esquema do documento (dentro do CRDT). Muda só com migração. */
export const SCHEMA_VERSION = 1;

/** Gerador ainda inexistente na Fase 2: os mundos registram "sem gerador". */
export const NO_GENERATOR: GeneratorRef = Object.freeze({ id: 'org.ekfrase.generator.none', version: '0.0.0', params: {} });

export interface GeneratorRef {
  readonly id: string;
  readonly version: string;
  readonly params: JsonObject;
}

export interface PointKm {
  readonly x: number;
  readonly y: number;
}

export interface Meta {
  readonly schemaVersion: number;
  readonly name: string;
  /** Aplicativo e versão que criaram o documento, ex.: "ekfrase-web@0.1.0". */
  readonly createdWith: string;
}

export interface World {
  /** Semente em texto (qualquer frase); o gerador a transforma em inteiros por hash. */
  readonly seed: string;
  /** Extensão norte-sul e leste-oeste. */
  readonly extentKm: { readonly ns: number; readonly ew: number };
  /** Espaçamento do nível 0 em metros (DEC-025). */
  readonly s0M: number;
  readonly generator: GeneratorRef;
  readonly style: string;
}

export interface Entity {
  readonly type: string;
  readonly posKm: PointKm;
  readonly components: JsonObject;
}

export interface Feature {
  readonly kind: string;
  readonly pointsKm: readonly PointKm[];
  readonly props: JsonObject;
}

export type AnnotationKind = 'measurement' | 'note';

export interface Annotation {
  readonly kind: AnnotationKind;
  readonly data: JsonObject;
}

export interface PluginRef {
  readonly version: string;
  readonly source: string;
}

/** Retrato do documento em JSON simples (exportação, testes, migrações). */
export interface DocSnapshot {
  readonly meta: Meta;
  readonly world: World;
  /** "L:q:r" → propriedade → valor (especificação §5). */
  readonly edits: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  readonly features: Readonly<Record<string, Feature>>;
  readonly entities: Readonly<Record<string, Entity>>;
  readonly annotations: Readonly<Record<string, Annotation>>;
  readonly plugins: Readonly<Record<string, PluginRef>>;
}

// ---------- validação ----------

const PROPERTY = /^[A-Za-z0-9_.-]{1,64}$/;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export function checkProperty(name: string): void {
  if (!PROPERTY.test(name)) throw new DocError('invalid-property');
}

export function checkId(id: string): void {
  if (!ID.test(id)) throw new DocError('invalid-id');
}

function isJson(value: unknown, depth: number): value is JsonValue {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => isJson(v, depth + 1));
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value).every((v) => isJson(v, depth + 1));
  }
  return false;
}

/** Valida e copia um valor JSON (o Yjs guarda a referência; a cópia evita alterações por fora). */
export function cloneJson<T extends JsonValue>(value: T): T {
  if (!isJson(value, 0)) throw new DocError('invalid-value');
  return JSON.parse(JSON.stringify(value)) as T;
}

export function checkPoint(p: PointKm): PointKm {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new DocError('invalid-value');
  return { x: p.x, y: p.y };
}

export function checkString(value: unknown, max = 256): string {
  if (typeof value !== 'string' || value.length > max) throw new DocError('invalid-value');
  return value;
}

export function checkWorld(w: World): World {
  checkString(w.seed, 1024);
  checkString(w.style, 128);
  checkString(w.generator.id, 128);
  checkString(w.generator.version, 64);
  const ext = w.extentKm;
  if (!ext || !(ext.ns > 0) || !(ext.ew > 0) || !Number.isFinite(ext.ns) || !Number.isFinite(ext.ew)) {
    throw new DocError('invalid-value');
  }
  if (!(w.s0M > 0) || !Number.isFinite(w.s0M)) throw new DocError('invalid-value');
  return {
    seed: w.seed,
    extentKm: { ns: ext.ns, ew: ext.ew },
    s0M: w.s0M,
    generator: { id: w.generator.id, version: w.generator.version, params: cloneJson(w.generator.params) },
    style: w.style,
  };
}
