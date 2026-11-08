// SPDX-License-Identifier: MPL-2.0

/**
 * O mundo do Maker no arquivo `.ekfr` da família Ekfrase (`docs/formato-ekfr.md`; envelope
 * `app: "maker"`, `tipo: "mundo"`, `formato` = FORMAT_VERSION). Dentro do ZIP, depois do envelope:
 * - `manifest.json`: { formatVersion, generator: "id@versão", requires: [{ id, version }], app }
 * - `doc.crdt`: estado binário do Yjs
 * - `preview.png`: miniatura (opcional; nome reservado pelo envelope)
 * - `assets/`: reservado para arquivos embutidos.
 * Os `.ekfrase` antigos (sem envelope) continuam abrindo.
 *
 * Promessa de estabilidade: `formatVersion` em semver; versões antigas sempre abrem (com migração);
 * uma versão com major maior que a nossa é recusada com um código de erro, nunca lida pela metade.
 */

import { EXTENSAO, ErroArquivo, TIPO_MIDIA, gravarEkfr, lerEkfr } from '@ekfrase/arquivo/ekfr';
import { strFromU8, strToU8 } from 'fflate';
import { DocError } from './errors';
import type { DocSnapshot } from './schema';
import { DocStore, type DocStoreOptions } from './store';

export const FORMAT_VERSION = '1.0.0';
export const FILE_EXTENSION = EXTENSAO;
export const MEDIA_TYPE = TIPO_MIDIA;
/** O documento do Maker no envelope `.ekfr`. */
export const ENVELOPE_APP = 'maker';
export const ENVELOPE_TIPO = 'mundo';

export interface Manifest {
  readonly formatVersion: string;
  readonly generator: string;
  readonly requires: readonly { readonly id: string; readonly version: string }[];
  readonly app: string;
}

export interface SaveOptions {
  /** Aplicativo que gravou, ex.: "ekfrase-web@0.1.0". */
  readonly app: string;
  readonly preview?: Uint8Array;
}

export interface LoadedFile {
  readonly store: DocStore;
  readonly manifest: Manifest;
  readonly preview?: Uint8Array;
  /** Versão original quando o arquivo precisou de migração. */
  readonly migratedFrom?: string;
}

/**
 * Migrações do retrato JSON, da mais antiga para a mais nova. Hoje não há nenhuma (1.0.0 é a primeira).
 * Cada entrada leva de `from` para `to`; nunca editar uma migração publicada.
 */
export interface Migration {
  readonly from: string;
  readonly to: string;
  readonly migrate: (snapshot: DocSnapshot) => DocSnapshot;
}

export const MIGRATIONS: readonly Migration[] = [];

function parseSemver(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

export function manifestOf(store: DocStore, app: string): Manifest {
  const snap = store.snapshot();
  const g = snap.world.generator;
  return {
    formatVersion: FORMAT_VERSION,
    generator: `${g.id}@${g.version}`,
    requires: Object.entries(snap.plugins).map(([id, p]) => ({ id, version: p.version })),
    app,
  };
}

/** Grava o documento. Mesmo documento e mesmas opções dão os mesmos bytes. */
export function saveFile(store: DocStore, options: SaveOptions): Uint8Array {
  const name = store.getMeta().name;
  return gravarEkfr(
    { app: ENVELOPE_APP, tipo: ENVELOPE_TIPO, formato: FORMAT_VERSION, gravadoPor: options.app, ...(name ? { titulo: name } : {}) },
    { 'manifest.json': strToU8(JSON.stringify(manifestOf(store, options.app), null, 2) + '\n'), 'doc.crdt': store.encodeState() },
    options.preview ? { preview: options.preview } : {},
  );
}

/** As entradas do mundo (pelo envelope `.ekfr`, ou um `.ekfrase` antigo). Arquivo de outro app: `other-app`. */
function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    const f = lerEkfr(bytes);
    if (f.envelope.app !== ENVELOPE_APP || f.envelope.tipo !== ENVELOPE_TIPO) throw new DocError('other-app');
    return { ...f.arquivos };
  } catch (e) {
    if (e instanceof DocError) throw e;
    if (e instanceof ErroArquivo) {
      if (e.codigo === 'grande') throw new DocError('file-too-large');
      if (e.codigo === 'envelope-novo') throw new DocError('unsupported-format-version');
      if (e.codigo === 'envelope-invalido') throw new DocError('invalid-manifest');
    }
    throw new DocError('not-an-ekfrase-file');
  }
}

function parseManifest(raw: Uint8Array | undefined): Manifest {
  if (!raw) throw new DocError('missing-manifest');
  let m: unknown;
  try {
    m = JSON.parse(strFromU8(raw));
  } catch {
    throw new DocError('invalid-manifest');
  }
  const o = m as Partial<Manifest> | null;
  if (
    !o ||
    typeof o !== 'object' ||
    !parseSemver(o.formatVersion) ||
    typeof o.generator !== 'string' ||
    typeof o.app !== 'string' ||
    !Array.isArray(o.requires) ||
    !o.requires.every((r) => r && typeof r.id === 'string' && typeof r.version === 'string')
  ) {
    throw new DocError('invalid-manifest');
  }
  return { formatVersion: o.formatVersion!, generator: o.generator, requires: o.requires, app: o.app };
}

/** Lê só o manifesto (para saber gerador e plugins antes de abrir). */
export function readManifest(bytes: Uint8Array): Manifest {
  return parseManifest(unzip(bytes)['manifest.json']);
}

export interface LoadOptions extends DocStoreOptions {
  /** Só para testes; o padrão é a lista oficial `MIGRATIONS`. */
  readonly migrations?: readonly Migration[];
}

export function loadFile(bytes: Uint8Array, options: LoadOptions = {}): LoadedFile {
  const entries = unzip(bytes);
  const manifest = parseManifest(entries['manifest.json']);
  const version = parseSemver(manifest.formatVersion)!;
  const current = parseSemver(FORMAT_VERSION)!;
  if (version[0] > current[0]) throw new DocError('unsupported-format-version');

  const crdt = entries['doc.crdt'];
  if (!crdt) throw new DocError('missing-document');
  let store = DocStore.fromUpdate(crdt, options);

  let migratedFrom: string | undefined;
  if (compareSemver(version, current) < 0) {
    let snapshot = store.snapshot();
    let at = manifest.formatVersion;
    // Cadeia em ordem: cada migração começa exatamente onde a anterior parou.
    for (const m of options.migrations ?? MIGRATIONS) {
      if (m.from === at) {
        snapshot = m.migrate(snapshot);
        at = m.to;
      }
    }
    if (at !== manifest.formatVersion) {
      store.destroy();
      store = DocStore.fromSnapshot(snapshot, options);
      migratedFrom = manifest.formatVersion;
    }
  }

  const preview = entries['preview.png'];
  return {
    store,
    manifest,
    ...(preview ? { preview } : {}),
    ...(migratedFrom ? { migratedFrom } : {}),
  };
}

// ---------- JSON legível ----------

export interface JsonExport {
  readonly format: 'ekfrase-json';
  readonly formatVersion: string;
  readonly manifest: Manifest;
  readonly document: DocSnapshot;
}

/** Exportação em JSON legível (§6). Não guarda o histórico do CRDT. */
export function exportJson(store: DocStore, app: string): string {
  const out: JsonExport = {
    format: 'ekfrase-json',
    formatVersion: FORMAT_VERSION,
    manifest: manifestOf(store, app),
    document: store.snapshot(),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

export function importJson(text: string, options: DocStoreOptions = {}): DocStore {
  let data: Partial<JsonExport>;
  try {
    data = JSON.parse(text) as Partial<JsonExport>;
  } catch {
    throw new DocError('not-an-ekfrase-file');
  }
  if (data.format !== 'ekfrase-json' || !data.document) throw new DocError('not-an-ekfrase-file');
  const version = parseSemver(data.formatVersion);
  if (!version) throw new DocError('invalid-manifest');
  if (version[0] > parseSemver(FORMAT_VERSION)![0]) throw new DocError('unsupported-format-version');
  try {
    return DocStore.fromSnapshot(data.document, options);
  } catch (e) {
    if (e instanceof DocError) throw e;
    throw new DocError('corrupt-document');
  }
}
