// SPDX-License-Identifier: MPL-2.0

/**
 * A ENTREGA: um app (ou o roteador do site) passa um `.ekfr` para o app dono dele. Todos os apps moram
 * no mesmo endereço (ekfrase.com), então dividem o mesmo IndexedDB: quem entrega guarda os bytes com
 * uma chave aleatória e abre `/<app>/#/abrir/<chave>`; o app lê (`receber`) e a entrega some. Uma
 * entrega esquecida vence em 10 minutos.
 */

const BANCO = 'ekfrase-entrega';
const LOJA = 'arquivos';
const VALIDADE = 10 * 60 * 1000;

interface Entrega {
  chave: string;
  nome: string;
  bytes: Uint8Array;
  quando: number;
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, falha) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(LOJA, { keyPath: 'chave' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}

function pedido<T>(db: IDBDatabase, modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((ok, falha) => {
    const tx = db.transaction(LOJA, modo);
    const r = f(tx.objectStore(LOJA));
    tx.oncomplete = () => ok(r.result);
    tx.onerror = () => falha(tx.error);
  });
}

/** O endereço que abre a entrega no app (`/<app>/#/abrir/<chave>`). */
export const enderecoDaEntrega = (enderecoDoApp: string, chave: string) => `${enderecoDoApp}#/abrir/${chave}`;

/** A chave de uma entrega no endereço (`#/abrir/<chave>`), ou null. */
export function chaveNoEndereco(hash = location.hash): string | null {
  return /^#\/abrir\/([a-f0-9-]{36})$/.exec(hash)?.[1] ?? null;
}

/** Guarda o arquivo para o outro app e devolve a chave. */
export async function entregar(bytes: Uint8Array, nome: string): Promise<string> {
  const db = await abrir();
  const chave = crypto.randomUUID();
  const agora = Date.now();
  // aproveita para jogar fora entregas velhas
  const todas = await pedido<Entrega[]>(db, 'readonly', (s) => s.getAll() as IDBRequest<Entrega[]>);
  for (const e of todas) if (agora - e.quando > VALIDADE) await pedido(db, 'readwrite', (s) => s.delete(e.chave));
  await pedido(db, 'readwrite', (s) => s.put({ chave, nome, bytes, quando: agora } satisfies Entrega));
  db.close();
  return chave;
}

/** Recebe (e apaga) uma entrega. Null se não existe ou venceu. */
export async function receber(chave: string): Promise<{ nome: string; bytes: Uint8Array } | null> {
  const db = await abrir();
  const e = await pedido<Entrega | undefined>(db, 'readonly', (s) => s.get(chave) as IDBRequest<Entrega | undefined>);
  if (e) await pedido(db, 'readwrite', (s) => s.delete(chave));
  db.close();
  if (!e || Date.now() - e.quando > VALIDADE) return null;
  return { nome: e.nome, bytes: e.bytes };
}
