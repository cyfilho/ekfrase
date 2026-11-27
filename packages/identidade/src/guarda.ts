// SPDX-License-Identifier: MPL-2.0

/**
 * O que o aparelho guarda da pessoa e como ele prova quem é (X2, ARQUITETURA §5.6).
 *
 * - **A guarda dividida** ("confirme no outro aparelho"): o aparelho guarda a semente da pessoa CIFRADA com uma chave
 *   sorteada (a "guarda"), e a guarda fica SÓ na ponte. Nenhum dos dois sozinho abre a semente: quem rouba o aparelho
 *   tem a cópia cifrada; quem invade o servidor tem a guarda. Revogar o aparelho apaga a guarda (a cópia vira lixo).
 *   A ponte só entrega a guarda para atender um pedido de um aparelho novo da mesma conta, e avisa por e-mail. É
 *   assim que quem esqueceu a senha e não tem o kit recupera tudo por outro aparelho seu (a P1).
 * - **O código do aparelho:** 6 algarismos tirados das públicas do aparelho novo; as duas telas mostram o mesmo, e a
 *   pessoa confere que está aprovando o aparelho certo (não protege de um servidor mal-intencionado, que no site já
 *   entrega o próprio código da página; o Motor pareia com o PAKE do §9.3).
 * - **A prova da sessão:** o aparelho assina o desafio que a ponte sorteou para a sessão (contexto `sessao-aparelho`);
 *   assim a ponte liga a sessão ao aparelho (revogar o aparelho tira a sessão dele) sem confiar só na palavra dele.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, doBase64url, doBase64urlCom, paraBase64url, randomBytes, utf8ToBytes } from './bytes.ts';
import { assinar, enderecoValido, type ChavesPublicas, type Identidade } from './chaves.ts';

export type Guardado = {
  readonly v: 1;
  /** 24 bytes, base64url. */
  readonly nonce: string;
  /** A semente cifrada (16 + 16 bytes), base64url. */
  readonly cifrado: string;
};

const associadosDaGuarda = (aparelho: string) => concatBytes(utf8ToBytes('ekfrase/guarda/v1\u0000'), utf8ToBytes(aparelho));

/**
 * Cifra a semente da pessoa para este aparelho: a `guarda` (32 bytes) vai à ponte e é apagada daqui; o `guardado`
 * fica no aparelho. A cópia só abre com a guarda e para este mesmo aparelho (o endereço vai nos dados associados).
 */
export function guardarSemente(sementeDaPessoa: Uint8Array, aparelho: string): { guarda: Uint8Array; guardado: Guardado } {
  if (sementeDaPessoa.length !== 16) throw new RangeError('a semente da pessoa tem 16 bytes');
  if (!enderecoValido(aparelho)) throw new RangeError('endereço de aparelho inválido');
  const guarda = randomBytes(32);
  const nonce = randomBytes(24);
  const cifrado = xchacha20poly1305(guarda, nonce, associadosDaGuarda(aparelho)).encrypt(sementeDaPessoa);
  return { guarda, guardado: { v: 1, nonce: paraBase64url(nonce), cifrado: paraBase64url(cifrado) } };
}

/** Abre a cópia com a guarda que a ponte entregou; `null` se não servir. */
export function abrirGuardado(guardado: unknown, guarda: Uint8Array, aparelho: string): Uint8Array | null {
  if (typeof guardado !== 'object' || guardado === null || guarda.length !== 32) return null;
  const o = guardado as Record<string, unknown>;
  const nonce = doBase64urlCom(o['nonce'], 24);
  const cifrado = typeof o['cifrado'] === 'string' ? doBase64url(o['cifrado']) : null;
  if (o['v'] !== 1 || !nonce || !cifrado || cifrado.length !== 32 || !enderecoValido(aparelho)) return null;
  try {
    return xchacha20poly1305(guarda, nonce, associadosDaGuarda(aparelho)).decrypt(cifrado);
  } catch {
    return null;
  }
}

/** O código de 6 algarismos do aparelho ("123 456"), igual nas duas telas. */
export function codigoDoAparelho(publicas: ChavesPublicas): string {
  const h = sha256(concatBytes(utf8ToBytes('ekfrase/codigo-aparelho/v1\u0000'), publicas.cifrar, publicas.assinar));
  const n = ((h[0]! << 24) >>> 0) + (h[1]! << 16) + (h[2]! << 8) + h[3]!;
  const s = String(n % 1_000_000).padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

export const CONTEXTO_SESSAO = 'sessao-aparelho';

/** O aparelho prova que é ele: assina o desafio da sessão (o texto que a ponte mandou). */
export function provarSessao(aparelho: Identidade, desafio: string): string {
  if (!/^[0-9a-f]{64}$/.test(desafio)) throw new RangeError('desafio inválido');
  return paraBase64url(assinar(aparelho, CONTEXTO_SESSAO, utf8ToBytes(desafio)));
}
