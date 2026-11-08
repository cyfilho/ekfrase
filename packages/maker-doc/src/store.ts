// SPDX-License-Identifier: MPL-2.0

/**
 * `DocStore`: camada fina sobre o Yjs (DEC-024). O resto do Ékfrase só fala com esta classe,
 * para que trocar o CRDT no futuro mexa num arquivo só.
 *
 * Estrutura dentro do Yjs (formato do arquivo, DEC-040):
 * - meta, world: Y.Map de valores JSON (o último a escrever vence, por campo).
 * - edits: Y.Map plana com chave "L:q:r/propriedade" → valor. Plana de propósito: com um mapa
 *   por célula, dois pares que criassem o mesmo mapa ao mesmo tempo perderiam edições um do outro.
 * - entities, features, annotations: Y.Map<id, Y.Map>; componentes e props em Y.Map próprios.
 * - plugins: Y.Map<id, { version, source }>.
 */

import * as Y from 'yjs';
import { MAX_LEVEL, cell as makeCell, cellKey, parent, parseCellKey, type Cell } from '@ekfrase/maker-core';
import type { ApplyResult, Command } from './commands';
import { DocError } from './errors';
import {
  NO_GENERATOR,
  SCHEMA_VERSION,
  checkId,
  checkPoint,
  checkProperty,
  checkString,
  checkWorld,
  cloneJson,
  type Annotation,
  type DocSnapshot,
  type Entity,
  type Feature,
  type GeneratorRef,
  type JsonObject,
  type JsonValue,
  type Meta,
  type PluginRef,
  type PointKm,
  type World,
} from './schema';

const INIT_ORIGIN = 'ekfrase:init';
const REMOTE_ORIGIN = 'ekfrase:remote';
const ANNOTATION_KINDS = new Set(['measurement', 'note']);

export interface DocStoreOptions {
  /** Gerador de ids (padrão: crypto.randomUUID, 128 bits aleatórios). */
  readonly newId?: () => string;
}

export interface NewDocument {
  readonly name: string;
  readonly createdWith: string;
  readonly seed: string;
  readonly extentKm: { readonly ns: number; readonly ew: number };
  readonly s0M?: number;
  readonly generator?: GeneratorRef;
  readonly style?: string;
}

export interface EffectiveEdit {
  readonly value: JsonValue;
  /** Célula onde a edição foi feita: a própria ou o ancestral mais próximo. */
  readonly from: Cell;
}

function defaultNewId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!c?.randomUUID) throw new DocError('invalid-id');
  return c.randomUUID();
}

function editKey(c: Cell, prop: string): string {
  return `${cellKey(c)}/${prop}`;
}

function validCell(c: Cell): Cell {
  return makeCell(c.level, c.q, c.r);
}

function checkObject(value: JsonValue): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new DocError('invalid-value');
  for (const k of Object.keys(value)) checkProperty(k);
  return cloneJson(value);
}

function sortedRecord<T>(entries: Iterable<[string, T]>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) out[k] = v;
  return out;
}

function mapToObject(m: Y.Map<unknown>): JsonObject {
  return sortedRecord([...m.entries()] as [string, JsonValue][]);
}

export class DocStore {
  private readonly doc: Y.Doc;
  private readonly meta: Y.Map<unknown>;
  private readonly worldMap: Y.Map<unknown>;
  private readonly edits: Y.Map<JsonValue>;
  private readonly entities: Y.Map<Y.Map<unknown>>;
  private readonly features: Y.Map<Y.Map<unknown>>;
  private readonly annotations: Y.Map<Y.Map<unknown>>;
  private readonly plugins: Y.Map<PluginRef>;
  private readonly undoManager: Y.UndoManager;
  /** Origem das transações deste usuário: só elas entram no desfazer. */
  private readonly origin = { local: true };
  private readonly newId: () => string;

  private constructor(doc: Y.Doc, options: DocStoreOptions) {
    this.doc = doc;
    this.meta = doc.getMap('meta');
    this.worldMap = doc.getMap('world');
    this.edits = doc.getMap('edits');
    this.entities = doc.getMap('entities');
    this.features = doc.getMap('features');
    this.annotations = doc.getMap('annotations');
    this.plugins = doc.getMap('plugins');
    this.newId = options.newId ?? defaultNewId;
    this.undoManager = new Y.UndoManager(
      [this.meta, this.worldMap, this.edits, this.entities, this.features, this.annotations, this.plugins],
      { trackedOrigins: new Set([this.origin]), captureTimeout: 0 },
    );
  }

  // ---------- criação ----------

  static create(init: NewDocument, options: DocStoreOptions = {}): DocStore {
    const world = checkWorld({
      seed: init.seed,
      extentKm: init.extentKm,
      s0M: init.s0M ?? 1,
      generator: init.generator ?? NO_GENERATOR,
      style: init.style ?? 'pixel',
    });
    const meta: Meta = {
      schemaVersion: SCHEMA_VERSION,
      name: checkString(init.name),
      createdWith: checkString(init.createdWith, 128),
    };
    const store = new DocStore(new Y.Doc(), options);
    store.doc.transact(() => {
      for (const [k, v] of Object.entries(meta)) store.meta.set(k, v);
      for (const [k, v] of Object.entries(world)) store.worldMap.set(k, v);
    }, INIT_ORIGIN);
    return store;
  }

  /** Abre a partir do estado binário do Yjs (o `doc.crdt` do arquivo). */
  static fromUpdate(update: Uint8Array, options: DocStoreOptions = {}): DocStore {
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, update, REMOTE_ORIGIN);
    } catch {
      throw new DocError('corrupt-document');
    }
    const store = new DocStore(doc, options);
    store.checkIntegrity();
    return store;
  }

  /** Recria um documento (com histórico novo) a partir de um retrato JSON: importação e migrações. */
  static fromSnapshot(snapshot: DocSnapshot, options: DocStoreOptions = {}): DocStore {
    const store = DocStore.create(
      {
        name: snapshot.meta.name,
        createdWith: snapshot.meta.createdWith,
        seed: snapshot.world.seed,
        extentKm: snapshot.world.extentKm,
        s0M: snapshot.world.s0M,
        generator: snapshot.world.generator,
        style: snapshot.world.style,
      },
      options,
    );
    store.doc.transact(() => {
      for (const [key, props] of Object.entries(snapshot.edits)) {
        const c = parseCellKey(key);
        for (const [prop, value] of Object.entries(props)) store.prepare({ type: 'edit.set', cell: c, prop, value })();
      }
      for (const [id, entity] of Object.entries(snapshot.entities)) store.prepare({ type: 'entity.add', id, entity })();
      for (const [id, feature] of Object.entries(snapshot.features)) store.prepare({ type: 'feature.add', id, feature })();
      for (const [id, annotation] of Object.entries(snapshot.annotations)) {
        store.prepare({ type: 'annotation.add', id, annotation })();
      }
      for (const [id, plugin] of Object.entries(snapshot.plugins)) store.prepare({ type: 'plugin.require', id, plugin })();
    }, INIT_ORIGIN);
    return store;
  }

  private checkIntegrity(): void {
    const version = this.meta.get('schemaVersion');
    if (typeof version !== 'number' || typeof this.meta.get('name') !== 'string') {
      throw new DocError('corrupt-document');
    }
    if (version > SCHEMA_VERSION) throw new DocError('unsupported-format-version');
    try {
      this.world();
    } catch {
      throw new DocError('corrupt-document');
    }
  }

  // ---------- comandos ----------

  /** Aplica um comando como um passo de desfazer deste usuário. Valida tudo antes de mudar algo. */
  apply(command: Command): ApplyResult {
    const run = this.prepare(command);
    let result: ApplyResult = {};
    this.doc.transact(() => {
      result = run();
    }, this.origin);
    return result;
  }

  /**
   * Aplica vários comandos como **um único** passo de desfazer (ex.: uma pincelada).
   * Todos são validados contra o estado atual antes de qualquer mudança; se um falhar, nada muda.
   * Por isso os comandos do lote precisam ser independentes entre si (ex.: não criar e mover a mesma entidade).
   */
  applyAll(commands: readonly Command[]): ApplyResult[] {
    const runs = commands.map((c) => this.prepare(c));
    const results: ApplyResult[] = [];
    if (runs.length === 0) return results;
    this.doc.transact(() => {
      for (const run of runs) results.push(run());
    }, this.origin);
    return results;
  }

  /** Valida o comando e devolve a mutação pronta; nada muda se a validação falhar. */
  private prepare(command: Command): () => ApplyResult {
    switch (command.type) {
      case 'meta.rename': {
        const name = checkString(command.name);
        return () => (this.meta.set('name', name), {});
      }
      case 'world.update': {
        const next = checkWorld({ ...this.world(), ...command.patch });
        return () => {
          const current = this.world();
          for (const [k, v] of Object.entries(next)) {
            if (JSON.stringify(current[k as keyof World]) !== JSON.stringify(v)) this.worldMap.set(k, v);
          }
          return {};
        };
      }
      case 'edit.set': {
        checkProperty(command.prop);
        const key = editKey(validCell(command.cell), command.prop);
        const value = cloneJson(command.value);
        return () => (this.edits.set(key, value), {});
      }
      case 'edit.clear': {
        checkProperty(command.prop);
        const key = editKey(validCell(command.cell), command.prop);
        return () => (this.edits.delete(key), {});
      }
      case 'entity.add': {
        const id = command.id ?? this.newId();
        checkId(id);
        if (this.entities.has(id)) throw new DocError('duplicate-id');
        const type = checkString(command.entity.type, 128);
        const pos = checkPoint(command.entity.posKm);
        const components = checkObject(command.entity.components);
        return () => {
          const m = new Y.Map<unknown>();
          m.set('type', type);
          m.set('posKm', pos);
          const comps = new Y.Map<unknown>();
          for (const [k, v] of Object.entries(components)) comps.set(k, v);
          m.set('components', comps);
          this.entities.set(id, m);
          return { id };
        };
      }
      case 'entity.move': {
        const m = this.need(this.entities, command.id, 'unknown-entity');
        const pos = checkPoint(command.posKm);
        return () => (m.set('posKm', pos), {});
      }
      case 'entity.setComponent': {
        const comps = this.need(this.entities, command.id, 'unknown-entity').get('components') as Y.Map<unknown>;
        checkProperty(command.name);
        const value = cloneJson(command.value);
        return () => (comps.set(command.name, value), {});
      }
      case 'entity.removeComponent': {
        const comps = this.need(this.entities, command.id, 'unknown-entity').get('components') as Y.Map<unknown>;
        checkProperty(command.name);
        return () => (comps.delete(command.name), {});
      }
      case 'entity.remove': {
        this.need(this.entities, command.id, 'unknown-entity');
        return () => (this.entities.delete(command.id), {});
      }
      case 'feature.add': {
        const id = command.id ?? this.newId();
        checkId(id);
        if (this.features.has(id)) throw new DocError('duplicate-id');
        const kind = checkString(command.feature.kind, 128);
        const points = command.feature.pointsKm.map(checkPoint);
        const props = checkObject(command.feature.props);
        return () => {
          const m = new Y.Map<unknown>();
          m.set('kind', kind);
          m.set('pointsKm', points);
          const p = new Y.Map<unknown>();
          for (const [k, v] of Object.entries(props)) p.set(k, v);
          m.set('props', p);
          this.features.set(id, m);
          return { id };
        };
      }
      case 'feature.setPoints': {
        const m = this.need(this.features, command.id, 'unknown-feature');
        const points = command.pointsKm.map(checkPoint);
        return () => (m.set('pointsKm', points), {});
      }
      case 'feature.setProp': {
        const props = this.need(this.features, command.id, 'unknown-feature').get('props') as Y.Map<unknown>;
        checkProperty(command.name);
        const value = cloneJson(command.value);
        return () => (props.set(command.name, value), {});
      }
      case 'feature.remove': {
        this.need(this.features, command.id, 'unknown-feature');
        return () => (this.features.delete(command.id), {});
      }
      case 'annotation.add': {
        const id = command.id ?? this.newId();
        checkId(id);
        if (this.annotations.has(id)) throw new DocError('duplicate-id');
        if (!ANNOTATION_KINDS.has(command.annotation.kind)) throw new DocError('invalid-value');
        const kind = command.annotation.kind;
        const data = checkObject(command.annotation.data);
        return () => {
          const m = new Y.Map<unknown>();
          m.set('kind', kind);
          m.set('data', data);
          this.annotations.set(id, m);
          return { id };
        };
      }
      case 'annotation.remove': {
        this.need(this.annotations, command.id, 'unknown-annotation');
        return () => (this.annotations.delete(command.id), {});
      }
      case 'plugin.require': {
        checkId(command.id);
        const plugin: PluginRef = {
          version: checkString(command.plugin.version, 64),
          source: checkString(command.plugin.source, 1024),
        };
        return () => (this.plugins.set(command.id, plugin), {});
      }
      case 'plugin.drop': {
        if (!this.plugins.has(command.id)) throw new DocError('unknown-plugin');
        return () => (this.plugins.delete(command.id), {});
      }
      default:
        throw new DocError('invalid-command');
    }
  }

  private need(map: Y.Map<Y.Map<unknown>>, id: string, code: 'unknown-entity' | 'unknown-feature' | 'unknown-annotation') {
    const m = map.get(id);
    if (!(m instanceof Y.Map)) throw new DocError(code);
    return m;
  }

  // ---------- desfazer / refazer (só os comandos deste usuário) ----------

  /**
   * Agrupa os comandos aplicados até `endGroup` num só passo de desfazer, mesmo vindo aos poucos
   * (ex.: uma pincelada que vai sendo gravada enquanto o usuário arrasta).
   */
  beginGroup(): void {
    this.undoManager.stopCapturing();
    this.undoManager.captureTimeout = Number.MAX_SAFE_INTEGER;
  }

  endGroup(): void {
    this.undoManager.captureTimeout = 0;
    this.undoManager.stopCapturing();
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  undo(): boolean {
    return this.undoManager.undo() !== null;
  }

  redo(): boolean {
    return this.undoManager.redo() !== null;
  }

  clearHistory(): void {
    this.undoManager.clear();
  }

  // ---------- leitura ----------

  getMeta(): Meta {
    return {
      schemaVersion: this.meta.get('schemaVersion') as number,
      name: this.meta.get('name') as string,
      createdWith: this.meta.get('createdWith') as string,
    };
  }

  world(): World {
    const w = this.worldMap;
    return checkWorld({
      seed: w.get('seed') as string,
      extentKm: w.get('extentKm') as World['extentKm'],
      s0M: w.get('s0M') as number,
      generator: w.get('generator') as GeneratorRef,
      style: w.get('style') as string,
    });
  }

  getEdit(c: Cell, prop: string): JsonValue | undefined {
    return this.edits.get(editKey(c, prop));
  }

  /**
   * Valor que vale para a célula (especificação §4, sobrescritas): a edição própria;
   * senão a do ancestral mais próximo; senão nenhuma (fica o gerado).
   */
  effectiveEdit(c: Cell, prop: string): EffectiveEdit | undefined {
    let cur = c;
    for (;;) {
      const value = this.edits.get(editKey(cur, prop));
      if (value !== undefined) return { value, from: cur };
      if (cur.level >= MAX_LEVEL) return undefined;
      cur = parent(cur);
    }
  }

  editCount(): number {
    return this.edits.size;
  }

  /** Todas as edições de uma propriedade (ex.: os biomas pintados), em ordem de chave. */
  editsOf(prop: string): { cell: Cell; value: JsonValue }[] {
    const suffix = `/${prop}`;
    const out: { key: string; cell: Cell; value: JsonValue }[] = [];
    for (const [key, value] of this.edits.entries()) {
      if (!key.endsWith(suffix)) continue;
      const cellPart = key.slice(0, key.length - suffix.length);
      out.push({ key: cellPart, cell: parseCellKey(cellPart), value });
    }
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return out.map(({ cell, value }) => ({ cell, value }));
  }

  /** Entidades de um tipo (ex.: nomes de lugares), em ordem de id. */
  entitiesOfType(type: string): { id: string; entity: Entity }[] {
    const out: { id: string; entity: Entity }[] = [];
    for (const [id, m] of this.entities.entries()) {
      if (m instanceof Y.Map && m.get('type') === type) out.push({ id, entity: this.readEntity(m) });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  getEntity(id: string): Entity | undefined {
    const m = this.entities.get(id);
    return m instanceof Y.Map ? this.readEntity(m) : undefined;
  }

  private readEntity(m: Y.Map<unknown>): Entity {
    return {
      type: m.get('type') as string,
      posKm: m.get('posKm') as PointKm,
      components: mapToObject(m.get('components') as Y.Map<unknown>),
    };
  }

  private readFeature(m: Y.Map<unknown>): Feature {
    return {
      kind: m.get('kind') as string,
      pointsKm: m.get('pointsKm') as PointKm[],
      props: mapToObject(m.get('props') as Y.Map<unknown>),
    };
  }

  private readAnnotation(m: Y.Map<unknown>): Annotation {
    return { kind: m.get('kind') as Annotation['kind'], data: m.get('data') as JsonObject };
  }

  /** Retrato JSON com chaves em ordem: igual para documentos iguais. */
  snapshot(): DocSnapshot {
    const edits = new Map<string, [string, JsonValue][]>();
    for (const [key, value] of this.edits.entries()) {
      const slash = key.indexOf('/');
      const cellPart = key.slice(0, slash);
      const list = edits.get(cellPart) ?? [];
      list.push([key.slice(slash + 1), value]);
      edits.set(cellPart, list);
    }
    const objects = <T>(map: Y.Map<Y.Map<unknown>>, read: (m: Y.Map<unknown>) => T) =>
      sortedRecord([...map.entries()].map(([id, m]) => [id, read(m)] as [string, T]));
    return {
      meta: this.getMeta(),
      world: this.world(),
      edits: sortedRecord([...edits.entries()].map(([k, list]) => [k, sortedRecord(list)] as [string, Record<string, JsonValue>])),
      features: objects(this.features, (m) => this.readFeature(m)),
      entities: objects(this.entities, (m) => this.readEntity(m)),
      annotations: objects(this.annotations, (m) => this.readAnnotation(m)),
      plugins: sortedRecord([...this.plugins.entries()].map(([id, p]) => [id, { version: p.version, source: p.source }] as [string, PluginRef])),
    };
  }

  /**
   * Chave de compatibilidade para sincronizar (§5, handshake): gerador@versão e plugins@versão.
   * Dois pares só sincronizam se as chaves forem iguais; senão o mapa gerado divergiria.
   */
  syncKey(): string {
    const g = this.world().generator;
    const plugins = Object.entries(this.snapshot().plugins).map(([id, p]) => `${id}@${p.version}`);
    return [`${g.id}@${g.version}`, ...plugins].join('|');
  }

  // ---------- sincronização (o provedor de rede é plugável, Fase 8) ----------

  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  stateVector(): Uint8Array {
    return Y.encodeStateVector(this.doc);
  }

  /** O que falta ao par que tem o vetor de estado `remoteVector`. */
  encodeDiff(remoteVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, remoteVector);
  }

  applyRemote(update: Uint8Array): void {
    try {
      Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
    } catch {
      throw new DocError('corrupt-document');
    }
  }

  /** Avisa a cada mudança (local, remota, desfazer). `local` = feita por este usuário. */
  onUpdate(listener: (update: Uint8Array, local: boolean) => void): () => void {
    const handler = (update: Uint8Array, origin: unknown): void => {
      listener(update, origin === this.origin || origin === this.undoManager);
    };
    this.doc.on('update', handler);
    return () => this.doc.off('update', handler);
  }

  destroy(): void {
    this.undoManager.destroy();
    this.doc.destroy();
  }
}
