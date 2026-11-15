// SPDX-License-Identifier: MPL-2.0

/**
 * O armazém da web e do celular: IndexedDB (via `idb`, ISC). UM BANCO POR DONO
 * (`ekfrase-writer:<dono>`): os textos de uma conta nunca aparecem para outra no mesmo aparelho.
 * Ao abrir, pede ao navegador para não apagar os dados sozinho (`navigator.storage.persist()`).
 */
import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { ArmazemComum, DONO_LOCAL, type Guardado, type LojaLocal, type OpcoesArmazem, type Transacao } from './armazem.ts';
import type { Colecao, EscritaDia, VersaoCena } from './modelo.ts';

const VERSAO_DO_BANCO = 1;
const LOJAS = ['registros', 'versoes_cena', 'escrita_dia', 'meta'] as const;

export const nomeDoBanco = (dono: string): string => `ekfrase-writer:${dono}`;

/** Pede armazenamento persistente (o navegador pode dizer não). `null` = o navegador não tem isso. */
export async function pedirPersistencia(): Promise<boolean | null> {
  try {
    const s = (globalThis as { navigator?: { storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> } } }).navigator?.storage;
    if (!s?.persist) return null;
    if (s.persisted && (await s.persisted())) return true;
    return await s.persist();
  } catch {
    return null;
  }
}

export class ArmazemIndexedDB extends ArmazemComum {
  private readonly banco: IDBPDatabase;
  /** O navegador prometeu não apagar os dados? (`null` = não deu para saber.) */
  readonly persistente: boolean | null;

  private constructor(banco: IDBPDatabase, opcoes: OpcoesArmazem, persistente: boolean | null) {
    super(opcoes);
    this.banco = banco;
    this.persistente = persistente;
  }

  /** Abre (ou cria) o banco do dono. Lança erro se o IndexedDB estiver bloqueado: use `ArmazemMemoria`. */
  static async abrir(opcoes: OpcoesArmazem = {}): Promise<ArmazemIndexedDB> {
    const banco = await openDB(nomeDoBanco(opcoes.dono ?? DONO_LOCAL), VERSAO_DO_BANCO, {
      upgrade(db) {
        const registros = db.createObjectStore('registros', { keyPath: 'id' });
        registros.createIndex('colecao', 'colecao');
        registros.createIndex('pendente', 'pendente');
        db.createObjectStore('versoes_cena', { keyPath: 'id' }).createIndex('cena', 'cena');
        db.createObjectStore('escrita_dia', { keyPath: 'data' });
        db.createObjectStore('meta');
      },
    });
    return new ArmazemIndexedDB(banco, opcoes, await pedirPersistencia());
  }

  /** Apaga o banco inteiro de um dono (para "sair e apagar deste aparelho"). */
  static async apagarBanco(dono: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const p = indexedDB.deleteDatabase(nomeDoBanco(dono));
      p.onsuccess = () => resolve();
      p.onerror = () => reject(p.error ?? new Error('indexedDB'));
      p.onblocked = () => resolve();
    });
  }

  protected async transacao<T>(escreve: boolean, f: (t: Transacao) => Promise<T>): Promise<T> {
    const tx: IDBPTransaction<unknown, typeof LOJAS, 'readonly' | 'readwrite'> = this.banco.transaction(LOJAS, escreve ? 'readwrite' : 'readonly');
    const registros = tx.objectStore('registros');
    const meta = tx.objectStore('meta');
    const gravar = <N extends (typeof LOJAS)[number]>(nome: N) => (tx as IDBPTransaction<unknown, typeof LOJAS, 'readwrite'>).objectStore(nome);
    const t: Transacao = {
      obter: async (id) => (await registros.get(id)) as Guardado | undefined,
      por: async (g) => void (await gravar('registros').put(g)),
      tirar: async (id) => void (await gravar('registros').delete(id)),
      daColecao: async (colecao: Colecao) => (await registros.index('colecao').getAll(colecao)) as Guardado[],
      pendentes: async () => (await registros.index('pendente').getAll(1)) as Guardado[],
      todos: async () => (await registros.getAll()) as Guardado[],
      lerMeta: async (chave) => (await meta.get(chave)) as unknown,
      porMeta: async (chave, valor) => void (await gravar('meta').put(valor, chave)),
      lerLocal: async (loja: LojaLocal, chave) => (await tx.objectStore(loja).get(chave)) as unknown,
      listarLocal: async (loja: LojaLocal, cena) =>
        (cena === undefined ? await tx.objectStore(loja).getAll() : await tx.objectStore('versoes_cena').index('cena').getAll(cena)) as unknown[],
      porLocal: async (loja: LojaLocal, valor: VersaoCena | EscritaDia) => void (await gravar(loja).put(valor)),
      tirarLocal: async (loja: LojaLocal, chave) => void (await gravar(loja).delete(chave)),
      limpar: async () => {
        for (const nome of LOJAS) await gravar(nome).clear();
      },
    };
    try {
      const saida = await f(t);
      await tx.done;
      return saida;
    } catch (e) {
      try {
        tx.abort();
      } catch {
        // a transação já tinha acabado
      }
      await tx.done.catch(() => undefined);
      throw e;
    }
  }

  fechar(): void {
    this.banco.close();
  }
}
