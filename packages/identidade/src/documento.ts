// SPDX-License-Identifier: MPL-2.0

/**
 * A CHAVE DE DOCUMENTO POR ÉPOCA (ARQUITETURA §6.3 e §6.4).
 *
 * Cada documento tem uma chave de 32 bytes sorteada; tudo o que viaja dele (as mudanças, as bases, a presença) vai
 * cifrado com ela, e o servidor guarda sem abrir. Quando alguém SAI do documento, nasce uma ÉPOCA nova, com outra
 * chave sorteada, entregue só a quem fica (pela caixa, `entregarChave`): a pessoa que saiu continua com o que já viu,
 * mas não lê o que vem depois. A época 0 é a primeira.
 *
 * - Cifra: XChaCha20-Poly1305 com nonce sorteado de 24 bytes (não corre o risco de repetir). Formato: `nonce ‖ cifrado`.
 * - O documento e a época entram SEMPRE nos dados associados, antes do `aad` de quem chama: um pedaço cifrado de um
 *   documento não abre como se fosse de outro, nem de outra época, mesmo que o envelope por fora esqueça de dizer.
 * - A chave entregue numa caixa leva o contexto `chave-doc:<doc>:<época>`: o servidor não troca a entrega de um
 *   documento pela de outro.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { concatBytes, randomBytes, utf8ToBytes } from './bytes.ts';
import { abrirCaixa, fecharCaixa } from './caixa.ts';
import type { Identidade } from './chaves.ts';

export interface ChaveDeDocumento {
  /** O id do documento (o UUID v7 do `Documento`, X3). */
  readonly doc: string;
  readonly epoca: number;
  /** 32 bytes. */
  readonly chave: Uint8Array;
}

const ID_VALIDO = /^[A-Za-z0-9._-]{1,128}$/;
const EPOCA_MAXIMA = 0xffffffff;
const NONCE = 24;
const TAG = 16;

function conferirDocEpoca(doc: string, epoca: number): void {
  if (!ID_VALIDO.test(doc)) throw new RangeError(`id de documento inválido: "${doc}"`);
  if (!Number.isSafeInteger(epoca) || epoca < 0 || epoca > EPOCA_MAXIMA) throw new RangeError(`época inválida: ${epoca}`);
}

/** Uma chave nova (sorteada) para o documento, na época dada. */
export function novaChaveDeDocumento(doc: string, epoca = 0): ChaveDeDocumento {
  conferirDocEpoca(doc, epoca);
  return { doc, epoca, chave: randomBytes(32) };
}

/** Monta uma chave que já existe (ex.: lida do armazém). */
export function chaveDeDocumento(doc: string, epoca: number, chave: Uint8Array): ChaveDeDocumento {
  conferirDocEpoca(doc, epoca);
  if (chave.length !== 32) throw new RangeError('a chave de documento tem 32 bytes');
  return { doc, epoca, chave };
}

function associados(c: ChaveDeDocumento, aad: Uint8Array): Uint8Array {
  const epoca = new Uint8Array(4);
  new DataView(epoca.buffer).setUint32(0, c.epoca);
  return concatBytes(utf8ToBytes(`ekfrase/doc/v1\u0000${c.doc}\u0000`), epoca, aad);
}

/** Cifra com a chave do documento: `nonce (24) ‖ cifrado (+16)`. */
export function cifrarComChave(c: ChaveDeDocumento, dados: Uint8Array, aad: Uint8Array = new Uint8Array(0)): Uint8Array {
  const nonce = randomBytes(NONCE);
  return concatBytes(nonce, xchacha20poly1305(c.chave, nonce, associados(c, aad)).encrypt(dados));
}

/** Decifra; `null` se a chave, o documento, a época ou o `aad` forem outros, ou se os bytes foram mexidos. */
export function decifrarComChave(c: ChaveDeDocumento, cifrado: Uint8Array, aad: Uint8Array = new Uint8Array(0)): Uint8Array | null {
  if (cifrado.length < NONCE + TAG) return null;
  try {
    return xchacha20poly1305(c.chave, cifrado.subarray(0, NONCE), associados(c, aad)).decrypt(cifrado.subarray(NONCE));
  } catch {
    return null;
  }
}

const contextoDaEntrega = (doc: string, epoca: number) => `chave-doc:${doc}:${epoca}`;

/** Fecha a chave numa caixa para a pública de `cifrar` de quem vai recebê-la (o convite, a época nova). */
export function entregarChave(c: ChaveDeDocumento, publicaDeCifrar: Uint8Array): Uint8Array {
  return fecharCaixa(publicaDeCifrar, contextoDaEntrega(c.doc, c.epoca), c.chave);
}

/** Abre a entrega de uma chave; `null` se não for para esta identidade, para este documento ou para esta época. */
export function receberChave(id: Identidade, doc: string, epoca: number, caixa: Uint8Array): ChaveDeDocumento | null {
  try {
    conferirDocEpoca(doc, epoca);
  } catch {
    return null;
  }
  const chave = abrirCaixa(id, contextoDaEntrega(doc, epoca), caixa);
  return chave && chave.length === 32 ? { doc, epoca, chave } : null;
}

/** As chaves de um documento, por época. A atual é a de número maior. */
export class Chaveiro {
  readonly #chaves = new Map<number, ChaveDeDocumento>();
  readonly doc: string;

  constructor(doc: string) {
    conferirDocEpoca(doc, 0);
    this.doc = doc;
  }

  /** Guarda uma chave deste documento (uma época que já existe e chegou por uma entrega, por exemplo). */
  guardar(c: ChaveDeDocumento): void {
    if (c.doc !== this.doc) throw new RangeError('chave de outro documento');
    this.#chaves.set(c.epoca, c);
  }

  daEpoca(epoca: number): ChaveDeDocumento | undefined {
    return this.#chaves.get(epoca);
  }

  /** A chave da época mais nova que este aparelho tem. */
  atual(): ChaveDeDocumento | undefined {
    let maior: ChaveDeDocumento | undefined;
    for (const c of this.#chaves.values()) if (!maior || c.epoca > maior.epoca) maior = c;
    return maior;
  }

  /** Abre uma época nova (alguém saiu): sorteia a chave da época seguinte à mais nova e a guarda. */
  novaEpoca(): ChaveDeDocumento {
    const c = novaChaveDeDocumento(this.doc, (this.atual()?.epoca ?? -1) + 1);
    this.#chaves.set(c.epoca, c);
    return c;
  }

  epocas(): number[] {
    return [...this.#chaves.keys()].sort((a, b) => a - b);
  }
}
