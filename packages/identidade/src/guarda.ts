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
 * - **O pedido assinado pelo aparelho** (X2c-4): sem a senha e sem sessão, um aparelho da pessoa assina, sobre um
 *   desafio da ponte, o pedido de ver o aviso da senha redefinida, de tirar outro aparelho ou de cancelar a redefinição.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, doBase64url, doBase64urlCom, paraBase64url, randomBytes, utf8ToBytes } from './bytes.ts';
import { bytesCanonicos, type ValorCanonico } from './canonico.ts';
import { assinar, conferirAssinatura, enderecoValido, type ChavesPublicas, type Identidade } from './chaves.ts';

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

// ---------- o pedido assinado pelo aparelho (X2c-4, ARQUITETURA §5.6) ----------

export const CONTEXTO_PEDIDO = 'pedido-aparelho';

/** O que um aparelho da pessoa pede à ponte sem a senha e sem sessão (a corrida contra quem tem o e-mail, M1). */
export type AcaoDoPedido = 'ver' | 'tirar' | 'cancelar';

export type PedidoDoAparelho = {
  readonly v: 1;
  /** O endereço da pessoa (a do certificado do aparelho). */
  readonly pessoa: string;
  /** O endereço do aparelho que assina. */
  readonly aparelho: string;
  readonly acao: AcaoDoPedido;
  /** O aparelho a tirar (só no `tirar`; nos outros, `null`). */
  readonly alvo: string | null;
  /** O desafio que a ponte sorteou para este pedido (64 letras hex, vale uma vez). */
  readonly desafio: string;
  readonly assinatura: string;
};

const ACOES: readonly string[] = ['ver', 'tirar', 'cancelar'];

/**
 * O aparelho assina o pedido (contexto `pedido-aparelho`, sobre o JSON canônico sem a `assinatura`). Lança
 * `RangeError` com endereço, ação ou desafio mal escritos, ou com o `alvo` fora da regra (só no `tirar`, e outro).
 */
export function assinarPedido(aparelho: Identidade, pessoa: string, acao: AcaoDoPedido, alvo: string | null, desafio: string): PedidoDoAparelho {
  const corpo = { v: 1 as const, pessoa, aparelho: aparelho.endereco, acao, alvo, desafio };
  if (!pedidoBemEscrito(corpo)) throw new RangeError('pedido inválido');
  return { ...corpo, assinatura: paraBase64url(assinar(aparelho, CONTEXTO_PEDIDO, bytesCanonicos(corpo))) };
}

function pedidoBemEscrito(p: Record<string, unknown>): boolean {
  const { pessoa, aparelho, acao, alvo, desafio } = p;
  if (p['v'] !== 1 || !enderecoValido(pessoa) || !enderecoValido(aparelho) || typeof acao !== 'string' || !ACOES.includes(acao)) return false;
  if (typeof desafio !== 'string' || !/^[0-9a-f]{64}$/.test(desafio)) return false;
  return acao === 'tirar' ? enderecoValido(alvo) && alvo !== aparelho : alvo === null;
}

/**
 * Confere o pedido com a pública de assinar do aparelho (a do certificado dele) e o desafio esperado. Exatamente os
 * campos do tipo: campo a mais ou a menos é `false`. Quem confere ainda olha se o aparelho vale (não revogado nem tirado).
 */
export function conferirPedido(pedido: unknown, publicaDoAparelho: Uint8Array, desafio: string): pedido is PedidoDoAparelho {
  if (!pedido || typeof pedido !== 'object' || Array.isArray(pedido)) return false;
  const p = pedido as Record<string, unknown>;
  const campos = Object.keys(p).sort().join(',');
  if (campos !== 'acao,alvo,aparelho,assinatura,desafio,pessoa,v' || !pedidoBemEscrito(p) || p['desafio'] !== desafio) return false;
  const assinatura = doBase64urlCom(p['assinatura'], 64);
  if (!assinatura) return false;
  const { assinatura: _, ...corpo } = p;
  return conferirAssinatura(publicaDoAparelho, CONTEXTO_PEDIDO, bytesCanonicos(corpo as ValorCanonico), assinatura);
}
