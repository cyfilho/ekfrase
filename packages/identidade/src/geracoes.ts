// SPDX-License-Identifier: MPL-2.0

/**
 * A CHAVE DE CAIXA DA PESSOA, POR GERAÇÕES (X2, a decisão do risco "aparelho roubado" do ARQUITETURA §17; §5.6).
 *
 * Quem manda uma chave de documento para a pessoa (um convite, X4) fecha a caixa para a chave de caixa dela, e não
 * para a de `cifrar` da identidade. Essa chave tem GERAÇÕES:
 * - a geração `g` sai da semente da pessoa: `HKDF-SHA256(semente, sal "ekfrase/caixa/v1", info "geracao:<g>")`, o
 *   segredo de um X25519. O kit (as 12 palavras) refaz todas as gerações: nada se perde com ele;
 * - a pessoa DECLARA a geração atual num JSON assinado (contexto `caixa-da-pessoa`); a ponte guarda a última, e quem
 *   manda uma chave confere a assinatura antes de fechar a caixa (a ponte não consegue trocar a chave por uma dela);
 * - cada aparelho guarda as gerações que recebeu (nunca a semente: ela só fica aberta por instantes, §5.6). Ao revogar
 *   um aparelho, nasce a geração seguinte, entregue só aos aparelhos que ficam; o revogado não a recebe e não consegue
 *   tirá-la (não tem a semente). O que chegar dali em diante, ele não abre.
 *
 * A primeira geração é a 1. A chave de `cifrar` da identidade (o endereço, o Reticulum) não recebe entregas.
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { doBase64urlCom, paraBase64url, utf8ToBytes } from './bytes.ts';
import { abrirCaixaComSegredo } from './caixa.ts';
import { bytesCanonicos } from './canonico.ts';
import { assinar, conferirAssinatura, enderecoDe, identidadeDaSemente, publicasDoJson, publicasParaJson, type ChavesPublicas, type ChavesPublicasJson } from './chaves.ts';

export const CONTEXTO_DECLARACAO_DE_CAIXA = 'caixa-da-pessoa';
/** A maior geração aceita (uma por revogação: sobra muito). */
export const GERACAO_MAXIMA = 1_000_000;

const SAL_CAIXA = utf8ToBytes('ekfrase/caixa/v1');

export interface ChaveDeCaixa {
  readonly geracao: number;
  /** O segredo X25519 (32 bytes): fica no aparelho, como as chaves de documento. */
  readonly segredo: Uint8Array;
  readonly publica: Uint8Array;
}

const geracaoValida = (g: unknown): g is number => typeof g === 'number' && Number.isSafeInteger(g) && g >= 1 && g <= GERACAO_MAXIMA;
const quandoValido = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** A geração `g` da chave de caixa, tirada da semente da pessoa (16 bytes). */
export function chaveDeCaixa(sementeDaPessoa: Uint8Array, geracao: number): ChaveDeCaixa {
  if (sementeDaPessoa.length !== 16) throw new RangeError('a semente da pessoa tem 16 bytes');
  if (!geracaoValida(geracao)) throw new RangeError('geração inválida');
  const segredo = hkdf(sha256, sementeDaPessoa, SAL_CAIXA, utf8ToBytes(`geracao:${geracao}`), 32);
  return { geracao, segredo, publica: x25519.getPublicKey(segredo) };
}

/**
 * A pública X25519 de um segredo de geração (32 bytes) que chegou na caixa de entrada: o aparelho a compara com a
 * `cifrar` da declaração daquela geração antes de guardar o segredo. `null` se o segredo não servir.
 */
export function publicaDaGeracao(segredo: Uint8Array): Uint8Array | null {
  if (segredo.length !== 32) return null;
  try {
    return x25519.getPublicKey(segredo);
  } catch {
    return null;
  }
}

/** Abre uma caixa que veio para esta geração (`fecharCaixa` com a pública dela). */
export function abrirComChaveDeCaixa(c: ChaveDeCaixa, contexto: string, caixa: Uint8Array): Uint8Array | null {
  return abrirCaixaComSegredo(c.segredo, contexto, caixa);
}

export interface DeclaracaoDeCaixa {
  readonly v: 1;
  readonly pessoa: ChavesPublicasJson;
  readonly geracao: number;
  /** A pública X25519 da geração (base64url). */
  readonly cifrar: string;
  readonly quando: number;
  readonly assinatura: string;
}

/** A pessoa declara a geração `g` (assinada com a chave dela). */
export function declararCaixa(sementeDaPessoa: Uint8Array, geracao: number, quando: number = Date.now()): DeclaracaoDeCaixa {
  if (!quandoValido(quando)) throw new RangeError('data inválida');
  const pessoa = identidadeDaSemente(sementeDaPessoa);
  const chave = chaveDeCaixa(sementeDaPessoa, geracao);
  const corpo = { v: 1, pessoa: publicasParaJson(pessoa.publicas), geracao, cifrar: paraBase64url(chave.publica), quando } as const;
  return { ...corpo, assinatura: paraBase64url(assinar(pessoa, CONTEXTO_DECLARACAO_DE_CAIXA, bytesCanonicos(corpo))) };
}

export type DeclaracaoConferida = { readonly pessoa: string; readonly publicasDaPessoa: ChavesPublicas; readonly geracao: number; readonly cifrar: Uint8Array; readonly quando: number };

const ehObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const CAMPOS = ['v', 'pessoa', 'geracao', 'cifrar', 'quando', 'assinatura'];

/** Confere uma declaração (formato e assinatura da pessoa); `null` se não servir. Nunca lança. */
export function conferirDeclaracaoDeCaixa(d: unknown): DeclaracaoConferida | null {
  if (!ehObjeto(d) || Object.keys(d).length !== CAMPOS.length || !CAMPOS.every((c) => c in d) || d['v'] !== 1) return null;
  const pessoa = publicasDoJson(d['pessoa']);
  const cifrar = doBase64urlCom(d['cifrar'], 32);
  const assinatura = doBase64urlCom(d['assinatura'], 64);
  const { geracao, quando } = d;
  if (!pessoa || !cifrar || !assinatura || !geracaoValida(geracao) || !quandoValido(quando)) return null;
  const corpo = { v: 1, pessoa: publicasParaJson(pessoa), geracao, cifrar: paraBase64url(cifrar), quando };
  if (!conferirAssinatura(pessoa.assinar, CONTEXTO_DECLARACAO_DE_CAIXA, bytesCanonicos(corpo), assinatura)) return null;
  return { pessoa: enderecoDe(pessoa), publicasDaPessoa: pessoa, geracao, cifrar, quando };
}

/** O contexto da caixa que entrega a geração `g` a um aparelho da pessoa. */
export const contextoDeGeracao = (g: number): string => `caixa-da-pessoa:${g}`;
