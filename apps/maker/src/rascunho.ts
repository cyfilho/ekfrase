// SPDX-License-Identifier: MPL-2.0

/**
 * O RASCUNHO do Maker (FB-0001), como no Persis: o mundo aberto fica guardado neste navegador
 * (IndexedDB) a cada mudança, um por conta (`conta-<id>`; sem servidor, `local`). Recarregar a página
 * abre o rascunho em vez de um mundo novo. Junto vai o documento da nuvem a que ele pertence e se há
 * mudanças que a nuvem ainda não tem.
 */

const BANCO = 'ekfrase-maker';
const LOJA = 'rascunho';

export interface Rascunho {
  bytes: Uint8Array;
  /** O documento da nuvem (null = ainda não foi para a nuvem). */
  nuvemId: number | null;
  /** Há mudanças que a nuvem ainda não tem. */
  sujo: boolean;
  quando: number;
}

const chave = (conta: number | null) => (conta === null ? 'local' : `conta-${conta}`);

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, falha) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(LOJA);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}

async function pedido<T>(modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir();
  try {
    return await new Promise<T>((ok, falha) => {
      const tx = db.transaction(LOJA, modo);
      const r = f(tx.objectStore(LOJA));
      tx.oncomplete = () => ok(r.result);
      tx.onerror = () => falha(tx.error);
    });
  } finally {
    db.close();
  }
}

/** O rascunho desta conta, ou null (nenhum, ou o navegador não guarda: janela privada etc.). */
export async function lerRascunho(conta: number | null): Promise<Rascunho | null> {
  try {
    const r = await pedido<Rascunho | undefined>('readonly', (s) => s.get(chave(conta)) as IDBRequest<Rascunho | undefined>);
    return r && r.bytes instanceof Uint8Array ? r : null;
  } catch {
    return null;
  }
}

export async function gravarRascunho(conta: number | null, r: Rascunho): Promise<void> {
  try {
    await pedido('readwrite', (s) => s.put(r, chave(conta)));
  } catch {
    // sem armazenamento: segue só com a nuvem
  }
}
