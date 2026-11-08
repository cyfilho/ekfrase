// SPDX-License-Identifier: MPL-2.0

/**
 * Sessão do documento aberto no visualizador: o `DocStore`, se há alterações não salvas,
 * e gravar/abrir arquivos `.ekfr` (e abrir os `.ekfrase` antigos). Toda mudança continua passando por `store.apply`.
 */

import {
  DocStore,
  FILE_EXTENSION,
  MEDIA_TYPE,
  exportJson,
  loadFile,
  saveFile,
  type ApplyResult,
  type Command,
} from '@ekfrase/maker-doc';
import { DEFAULT_GENERATOR } from '@ekfrase/maker-gen';
import pkg from '../package.json';

export const APP_ID = `ekfrase-web@${pkg.version}`;

export function randomSeed(): string {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return Array.from(words, (w) => w.toString(16).padStart(8, '0')).join('');
}

/** Nome de arquivo a partir do nome do mundo, sem os caracteres que o Windows recusa. */
export function fileNameFor(name: string, extension: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 120);
  return (clean || 'ekfrase') + extension;
}

export function download(data: Uint8Array | string, fileName: string, type: string): void {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class DocumentSession {
  store: DocStore;
  dirty = false;
  private detach: () => void = () => {};
  private readonly listeners = new Set<() => void>();

  constructor(name: string) {
    this.store = DocumentSession.blank(name);
    this.attach(this.store);
  }

  private static blank(name: string): DocStore {
    return DocStore.create({
      name,
      createdWith: APP_ID,
      seed: randomSeed(),
      extentKm: { ns: 1200, ew: 1600 },
      generator: { id: DEFAULT_GENERATOR.id, version: DEFAULT_GENERATOR.version, params: {} },
    });
  }

  private attach(store: DocStore): void {
    this.detach();
    this.store = store;
    this.detach = store.onUpdate((_update, local) => {
      if (local) this.dirty = true;
      this.emit();
    });
  }

  private replace(store: DocStore): void {
    const old = this.store;
    this.attach(store);
    old.destroy();
    this.dirty = false;
    this.emit();
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private emit(): void {
    for (const f of this.listeners) f();
  }

  apply(command: Command): ApplyResult {
    return this.store.apply(command);
  }

  /** Vários comandos como um único passo de desfazer (ex.: uma pincelada). */
  applyAll(commands: readonly Command[]): ApplyResult[] {
    return this.store.applyAll(commands);
  }

  /** Tudo o que for aplicado entre begin e end vira um único passo de desfazer. */
  beginGroup(): void {
    this.store.beginGroup();
  }

  endGroup(): void {
    this.store.endGroup();
  }

  newDocument(name: string): void {
    this.replace(DocumentSession.blank(name));
  }

  /** Abre um arquivo. Lança DocError com o código se o arquivo for inválido. */
  open(bytes: Uint8Array): void {
    this.replace(loadFile(bytes).store);
  }

  /** O arquivo .ekfr do documento, sem baixar (para a nuvem). */
  bytes(preview?: Uint8Array): Uint8Array {
    return saveFile(this.store, { app: APP_ID, ...(preview ? { preview } : {}) });
  }

  /** Salvo em outro lugar (a nuvem): some o aviso de alterações não salvas. */
  markSaved(): void {
    this.dirty = false;
    this.emit();
  }

  /** Exportar: baixa o arquivo .ekfr. */
  save(preview?: Uint8Array): string {
    const bytes = this.bytes(preview);
    const fileName = fileNameFor(this.store.getMeta().name, FILE_EXTENSION);
    download(bytes, fileName, MEDIA_TYPE);
    this.dirty = false;
    this.emit();
    return fileName;
  }

  exportJson(): string {
    const fileName = fileNameFor(this.store.getMeta().name, '.json');
    download(exportJson(this.store, APP_ID), fileName, 'application/json');
    return fileName;
  }
}
