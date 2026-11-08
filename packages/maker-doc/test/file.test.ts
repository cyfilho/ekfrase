// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  DocError,
  FORMAT_VERSION,
  exportJson,
  importJson,
  loadFile,
  readManifest,
  saveFile,
  type Migration,
} from '../src';
import { newStore, richStore } from './helpers';

const APP = 'ekfrase-test@0.0.0';

function code(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    return e instanceof DocError ? e.code : `not-doc-error: ${String(e)}`;
  }
  return undefined;
}

describe('ida e volta do arquivo .ekfr', () => {
  it('gravar e abrir devolve exatamente o mesmo documento', () => {
    const original = richStore();
    const loaded = loadFile(saveFile(original, { app: APP }));
    expect(loaded.store.snapshot()).toEqual(original.snapshot());
    expect(loaded.migratedFrom).toBeUndefined();
  });

  it('abrir e gravar de novo é estável: os bytes não mudam mais', () => {
    // O documento em edição guarda valores substituídos para poder desfazer; o arquivo reaberto
    // não tem histórico de desfazer e os descarta. Por isso a comparação começa na primeira reabertura.
    const first = saveFile(loadFile(saveFile(richStore(), { app: APP })).store, { app: APP });
    const second = saveFile(loadFile(first).store, { app: APP });
    expect(second).toEqual(first);
  });

  it('mantém o estado do CRDT, não só o retrato', () => {
    const original = richStore();
    const loaded = loadFile(saveFile(original, { app: APP })).store;
    // Mesmo vetor de estado: nenhum dos dois tem algo que falte ao outro.
    expect(loaded.stateVector()).toEqual(original.stateVector());
    const before = original.snapshot();
    original.applyRemote(loaded.encodeState());
    loaded.applyRemote(original.encodeState());
    expect(original.snapshot()).toEqual(before);
    expect(loaded.snapshot()).toEqual(before);
  });

  it('o manifesto registra formato, gerador, plugins e aplicativo', () => {
    const m = readManifest(saveFile(richStore(), { app: APP }));
    expect(m).toEqual({
      formatVersion: FORMAT_VERSION,
      generator: 'org.ekfrase.generator.none@0.0.0',
      requires: [{ id: 'org.ekfrase.transport.medieval', version: '1.0.0' }],
      app: APP,
    });
  });

  it('guarda e devolve a miniatura', () => {
    const preview = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const loaded = loadFile(saveFile(newStore(), { app: APP, preview }));
    expect(loaded.preview).toEqual(preview);
  });

  it('o ZIP tem só as entradas esperadas', () => {
    const entries = Object.keys(unzipSync(saveFile(newStore(), { app: APP }))).sort();
    expect(entries).toEqual(['doc.crdt', 'ekfr.json', 'manifest.json', 'mimetype']);
  });
});

describe('JSON legível', () => {
  it('exportar e importar devolve o mesmo retrato', () => {
    const original = richStore();
    const text = exportJson(original, APP);
    expect(JSON.parse(text).format).toBe('ekfrase-json');
    expect(importJson(text).snapshot()).toEqual(original.snapshot());
  });

  it('a exportação é estável (mesmo documento, mesmo texto)', () => {
    expect(exportJson(richStore(), APP)).toBe(exportJson(richStore(), APP));
  });
});

describe('arquivos de versões antigas abrem', () => {
  it('a referência da versão 1.0.0 (gravada na Fase 2) abre igual ao esperado', () => {
    const bytes = readFileSync(new URL('./fixtures/v1.0.0.ekfrase', import.meta.url));
    const expected = JSON.parse(readFileSync(new URL('./fixtures/v1.0.0.expected.json', import.meta.url), 'utf8'));
    const loaded = loadFile(new Uint8Array(bytes));
    expect(loaded.manifest.formatVersion).toBe('1.0.0');
    expect(loaded.store.snapshot()).toEqual(expected);
  });

  it('migra um arquivo mais antigo pela cadeia de migrações', () => {
    const store = newStore();
    const files = unzipSync(saveFile(store, { app: APP }));
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    manifest.formatVersion = '0.9.0';
    const old = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'doc.crdt': files['doc.crdt']! });
    const migrations: Migration[] = [
      { from: '0.8.0', to: '0.9.0', migrate: () => { throw new Error('não deveria rodar'); } },
      { from: '0.9.0', to: '1.0.0', migrate: (s) => ({ ...s, meta: { ...s.meta, name: s.meta.name + ' (migrado)' } }) },
    ];
    const loaded = loadFile(old, { migrations });
    expect(loaded.migratedFrom).toBe('0.9.0');
    expect(loaded.store.getMeta().name).toBe('Terras de Ékfrase (migrado)');
  });

  it('uma versão menor mais nova (1.x) ainda abre', () => {
    const files = unzipSync(saveFile(newStore(), { app: APP }));
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    manifest.formatVersion = '1.4.0';
    const newer = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'doc.crdt': files['doc.crdt']! });
    expect(loadFile(newer).store.getMeta().name).toBe('Terras de Ékfrase');
  });
});

describe('arquivos inválidos devolvem códigos de erro', () => {
  const crdt = newStore().encodeState();
  const manifest = (over: Record<string, unknown> = {}) =>
    strToU8(JSON.stringify({ formatVersion: '1.0.0', generator: 'x@1.0.0', requires: [], app: APP, ...over }));

  it('não é ZIP', () => {
    expect(code(() => loadFile(strToU8('olá, mundo')))).toBe('not-an-ekfrase-file');
  });

  it('sem manifesto, manifesto inválido ou sem documento', () => {
    expect(code(() => loadFile(zipSync({ 'doc.crdt': crdt })))).toBe('missing-manifest');
    expect(code(() => loadFile(zipSync({ 'manifest.json': strToU8('{'), 'doc.crdt': crdt })))).toBe('invalid-manifest');
    expect(code(() => loadFile(zipSync({ 'manifest.json': manifest({ formatVersion: 'um' }), 'doc.crdt': crdt })))).toBe(
      'invalid-manifest',
    );
    expect(code(() => loadFile(zipSync({ 'manifest.json': manifest() })))).toBe('missing-document');
  });

  it('versão de formato com major mais novo é recusada', () => {
    expect(code(() => loadFile(zipSync({ 'manifest.json': manifest({ formatVersion: '2.0.0' }), 'doc.crdt': crdt })))).toBe(
      'unsupported-format-version',
    );
  });

  it('documento corrompido', () => {
    expect(code(() => loadFile(zipSync({ 'manifest.json': manifest(), 'doc.crdt': new Uint8Array([1, 2, 3, 4, 5]) })))).toBe(
      'corrupt-document',
    );
    expect(code(() => loadFile(zipSync({ 'manifest.json': manifest(), 'doc.crdt': new Uint8Array([0, 0]) })))).toBe(
      'corrupt-document',
    );
  });

  it('JSON que não é do Ékfrase', () => {
    expect(code(() => importJson('{"a":1}'))).toBe('not-an-ekfrase-file');
    expect(code(() => importJson('não é json'))).toBe('not-an-ekfrase-file');
  });
});
