// SPDX-License-Identifier: MPL-2.0

/**
 * As chaves de uma identidade (a pessoa ou um aparelho): um par Ed25519 para ASSINAR e um X25519 para CIFRAR, as
 * mesmas curvas do Reticulum (ARQUITETURA §5.1).
 *
 * - Os dois segredos saem de uma SEMENTE pelo HKDF-SHA256 (sal `ekfrase/identidade/v1`; info `assinar` e `cifrar`).
 *   A semente da pessoa tem 16 bytes e é o kit de recuperação (as 12 palavras, `kit.ts`); a de um aparelho tem 32
 *   bytes sorteados. Quem tem a semente refaz a identidade inteira.
 * - O ENDEREÇO é o SHA-256 de `cifrar ‖ assinar` (as públicas, nessa ordem) cortado em 16 bytes, em hex: a conta do
 *   Reticulum (`Identity.hash`), para que uma identidade Ekfrase sirva lá sem trocar nada (o segredo no formato dele é
 *   `cifrar ‖ assinar`, 64 bytes: `segredoReticulum`).
 * - Assinar leva sempre um CONTEXTO (`ekfrase/<contexto>` + byte 0 antes da mensagem): uma assinatura feita para um
 *   certificado nunca vale como a de um envelope, e vice-versa.
 * - Conferir é estrito (RFC 8032, sem as folgas do ZIP-215), como o `sodium` do PHP: a ponte e os apps aceitam
 *   exatamente as mesmas assinaturas.
 */
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { apagar, bytesToHex, concatBytes, doBase64urlCom, paraBase64url, randomBytes, utf8ToBytes } from './bytes.ts';

/** As públicas (32 bytes cada). */
export interface ChavesPublicas {
  readonly assinar: Uint8Array;
  readonly cifrar: Uint8Array;
}

/** As públicas em JSON (base64url sem `=`): como andam nos certificados, na ponte e nos arquivos. */
export type ChavesPublicasJson = {
  readonly assinar: string;
  readonly cifrar: string;
};

/** Uma identidade com os segredos: só existe aberta no aparelho (no disco, sempre dentro de um cofre). */
export interface Identidade {
  /** 32 letras hex (16 bytes): o endereço, igual ao `Identity.hash` do Reticulum. */
  readonly endereco: string;
  readonly publicas: ChavesPublicas;
  readonly segredos: {
    readonly assinar: Uint8Array;
    readonly cifrar: Uint8Array;
  };
}

const SAL_IDENTIDADE = utf8ToBytes('ekfrase/identidade/v1');
const INFO_ASSINAR = utf8ToBytes('assinar');
const INFO_CIFRAR = utf8ToBytes('cifrar');

/** Tamanhos aceitos de semente: 16 (a pessoa, o kit de 12 palavras) e 32 (um aparelho). */
export const TAMANHOS_DE_SEMENTE: readonly number[] = [16, 32];

/** Refaz a identidade a partir da semente (sempre a mesma identidade para a mesma semente). */
export function identidadeDaSemente(semente: Uint8Array): Identidade {
  if (!TAMANHOS_DE_SEMENTE.includes(semente.length)) throw new RangeError(`semente de ${semente.length} bytes (aceito: 16 ou 32)`);
  const assinar = hkdf(sha256, semente, SAL_IDENTIDADE, INFO_ASSINAR, 32);
  const cifrar = hkdf(sha256, semente, SAL_IDENTIDADE, INFO_CIFRAR, 32);
  const publicas = { assinar: ed25519.getPublicKey(assinar), cifrar: x25519.getPublicKey(cifrar) };
  return { endereco: enderecoDe(publicas), publicas, segredos: { assinar, cifrar } };
}

/** Uma semente nova de aparelho (32 bytes sorteados). */
export function novaSementeDeAparelho(): Uint8Array {
  return randomBytes(32);
}

/** O endereço das públicas: SHA-256(cifrar ‖ assinar), os 16 primeiros bytes, em hex. */
export function enderecoDe(publicas: ChavesPublicas): string {
  return bytesToHex(sha256(concatBytes(publicas.cifrar, publicas.assinar)).subarray(0, 16));
}

/** Um endereço bem escrito (32 letras hex minúsculas)? */
export function enderecoValido(texto: unknown): texto is string {
  return typeof texto === 'string' && /^[0-9a-f]{32}$/.test(texto);
}

export function publicasParaJson(p: ChavesPublicas): ChavesPublicasJson {
  return { assinar: paraBase64url(p.assinar), cifrar: paraBase64url(p.cifrar) };
}

/** Lê as públicas de um JSON de fora; `null` se faltar algo, o tamanho estiver errado ou a de assinar não for um ponto válido. */
export function publicasDoJson(j: unknown): ChavesPublicas | null {
  if (typeof j !== 'object' || j === null) return null;
  const o = j as Record<string, unknown>;
  const assinar = doBase64urlCom(o['assinar'], 32);
  const cifrar = doBase64urlCom(o['cifrar'], 32);
  if (!assinar || !cifrar) return null;
  if (!ed25519.utils.isValidPublicKey(assinar, false)) return null;
  if (ed25519.Point.fromBytes(assinar, false).isSmallOrder()) return null; // como o libsodium: chave de ordem pequena não serve
  return { assinar, cifrar };
}

/** O segredo no formato do Reticulum (`cifrar ‖ assinar`, 64 bytes), para a etapa X18. Apague depois de usar. */
export function segredoReticulum(id: Identidade): Uint8Array {
  return concatBytes(id.segredos.cifrar, id.segredos.assinar);
}

/** Esquece os segredos (zera os bytes). A identidade não serve mais para assinar nem abrir. */
export function esquecer(id: Identidade): void {
  apagar(id.segredos.assinar, id.segredos.cifrar);
}

// --- assinar e conferir --------------------------------------------------------------------------------------

const CONTEXTO_VALIDO = /^[a-z][a-z0-9-]{0,62}$/;

function comContexto(contexto: string, mensagem: Uint8Array): Uint8Array {
  if (!CONTEXTO_VALIDO.test(contexto)) throw new RangeError(`contexto inválido: "${contexto}"`);
  return concatBytes(utf8ToBytes(`ekfrase/${contexto}`), new Uint8Array([0]), mensagem);
}

/** Assina `mensagem` para um `contexto` (ex.: `certificado-aparelho`). 64 bytes. */
export function assinar(id: Identidade, contexto: string, mensagem: Uint8Array): Uint8Array {
  return ed25519.sign(comContexto(contexto, mensagem), id.segredos.assinar);
}

/** Confere a assinatura (estrita, RFC 8032). Nunca lança: dado de fora estragado é só `false`. */
export function conferirAssinatura(publicaDeAssinar: Uint8Array, contexto: string, mensagem: Uint8Array, assinatura: Uint8Array): boolean {
  if (assinatura.length !== 64 || publicaDeAssinar.length !== 32) return false;
  try {
    return ed25519.verify(assinatura, comContexto(contexto, mensagem), publicaDeAssinar, { zip215: false });
  } catch {
    return false;
  }
}
