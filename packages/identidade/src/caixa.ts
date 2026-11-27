// SPDX-License-Identifier: MPL-2.0

/**
 * A CAIXA PARA UMA PESSOA: cifrar para a chave pública de alguém (a chave de um documento num convite, a semente
 * levada de um aparelho seu para outro). Só quem tem o segredo de `cifrar` daquela identidade abre.
 *
 * É o HPKE do RFC 9180 no modo base, com uma mensagem só: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 e
 * ChaCha20-Poly1305 (os ids 0x0020, 0x0001 e 0x0003). Não inventamos cifra: é o padrão da IETF para isto, com os
 * vetores oficiais no teste e implementações prontas em outras linguagens. A ideia é a mesma do `selo.ts` da casca
 * (uma chave de uso único, a troca X25519, o HKDF); o HPKE só a deixa padronizada.
 *
 * - O CONTEXTO entra como o `info` do HPKE: a caixa feita para "a chave do documento X, época 3" não abre como se
 *   fosse de outro documento ou de outra época (o servidor não consegue trocar uma pela outra).
 * - O formato: `enc (32 bytes) ‖ cifrado (mensagem + 16 bytes)`.
 * - A caixa não diz QUEM a fechou (como o `crypto_box_seal` do libsodium). Quando importa, quem fecha assina por
 *   fora (o envelope assinado, X3).
 */
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from './bytes.ts';
import type { Identidade } from './chaves.ts';

const KEM_ID = 0x0020;
const KDF_ID = 0x0001;
const AEAD_ID = 0x0003;
const N_ENC = 32;
const N_K = 32;
const N_N = 12;
const TAG = 16;

const dois = (n: number) => new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
const ROTULO_VERSAO = utf8ToBytes('HPKE-v1');
const SUITE_KEM = concatBytes(utf8ToBytes('KEM'), dois(KEM_ID));
const SUITE_HPKE = concatBytes(utf8ToBytes('HPKE'), dois(KEM_ID), dois(KDF_ID), dois(AEAD_ID));
const VAZIO = new Uint8Array(0);

function extrairRotulado(suite: Uint8Array, sal: Uint8Array, rotulo: string, ikm: Uint8Array): Uint8Array {
  return extract(sha256, concatBytes(ROTULO_VERSAO, suite, utf8ToBytes(rotulo), ikm), sal);
}

function expandirRotulado(suite: Uint8Array, prk: Uint8Array, rotulo: string, info: Uint8Array, tamanho: number): Uint8Array {
  return expand(sha256, prk, concatBytes(dois(tamanho), ROTULO_VERSAO, suite, utf8ToBytes(rotulo), info), tamanho);
}

/** DeriveKeyPair do RFC 9180 §7.1.3 (para X25519): só os vetores oficiais usam; a caixa sorteia a chave de uso único. */
export function _derivarParHpke(ikm: Uint8Array): { segredo: Uint8Array; publica: Uint8Array } {
  const prk = extrairRotulado(SUITE_KEM, VAZIO, 'dkp_prk', ikm);
  const segredo = expandirRotulado(SUITE_KEM, prk, 'sk', VAZIO, 32);
  return { segredo, publica: x25519.getPublicKey(segredo) };
}

function segredoCompartilhado(dh: Uint8Array, enc: Uint8Array, publicaDestino: Uint8Array): Uint8Array {
  const prk = extrairRotulado(SUITE_KEM, VAZIO, 'eae_prk', dh);
  return expandirRotulado(SUITE_KEM, prk, 'shared_secret', concatBytes(enc, publicaDestino), 32);
}

/** O "key schedule" do modo base (RFC 9180 §5.1): a chave e o nonce da mensagem número 0. */
function agenda(compartilhado: Uint8Array, info: Uint8Array): { chave: Uint8Array; nonce: Uint8Array } {
  const pskIdHash = extrairRotulado(SUITE_HPKE, VAZIO, 'psk_id_hash', VAZIO);
  const infoHash = extrairRotulado(SUITE_HPKE, VAZIO, 'info_hash', info);
  const contexto = concatBytes(new Uint8Array([0x00]), pskIdHash, infoHash);
  const segredo = extrairRotulado(SUITE_HPKE, compartilhado, 'secret', VAZIO);
  return {
    chave: expandirRotulado(SUITE_HPKE, segredo, 'key', contexto, N_K),
    nonce: expandirRotulado(SUITE_HPKE, segredo, 'base_nonce', contexto, N_N),
  };
}

/** O selo do HPKE em uma mensagem (`SealBase`); `efemero` só para os vetores (normalmente sorteado). */
export function _selarHpke(publicaDestino: Uint8Array, info: Uint8Array, aad: Uint8Array, mensagem: Uint8Array, efemero?: Uint8Array): { enc: Uint8Array; cifrado: Uint8Array } {
  const segredoEfemero = efemero ?? x25519.utils.randomSecretKey();
  const enc = x25519.getPublicKey(segredoEfemero);
  const dh = x25519.getSharedSecret(segredoEfemero, publicaDestino); // lança se a pública for de ordem pequena (dá zero)
  const { chave, nonce } = agenda(segredoCompartilhado(dh, enc, publicaDestino), info);
  return { enc, cifrado: chacha20poly1305(chave, nonce, aad).encrypt(mensagem) };
}

/** Abre o que `_selarHpke` fez (`OpenBase`); `null` se não abrir. */
export function _abrirHpke(segredoDestino: Uint8Array, enc: Uint8Array, info: Uint8Array, aad: Uint8Array, cifrado: Uint8Array): Uint8Array | null {
  try {
    const dh = x25519.getSharedSecret(segredoDestino, enc);
    const { chave, nonce } = agenda(segredoCompartilhado(dh, enc, x25519.getPublicKey(segredoDestino)), info);
    return chacha20poly1305(chave, nonce, aad).decrypt(cifrado);
  } catch {
    return null;
  }
}

const CONTEXTO_VALIDO = /^[a-z][a-z0-9-]{0,62}(:[A-Za-z0-9._-]{1,128}){0,4}$/;

function infoDe(contexto: string): Uint8Array {
  if (!CONTEXTO_VALIDO.test(contexto)) throw new RangeError(`contexto de caixa inválido: "${contexto}"`);
  return utf8ToBytes(`ekfrase/caixa/${contexto}`);
}

/**
 * Fecha `dados` para quem tem o segredo desta pública de `cifrar`. O `contexto` diz para que é (ex.:
 * `chave-doc:<id>:<época>`) e precisa ser o mesmo ao abrir. Lança se a pública não servir (de ordem pequena).
 */
export function fecharCaixa(publicaDeCifrar: Uint8Array, contexto: string, dados: Uint8Array): Uint8Array {
  if (publicaDeCifrar.length !== 32) throw new RangeError('pública de cifrar com tamanho errado');
  const { enc, cifrado } = _selarHpke(publicaDeCifrar, infoDe(contexto), VAZIO, dados);
  return concatBytes(enc, cifrado);
}

/** Abre a caixa com a identidade de quem a recebeu. `null` se não for para ela, se o contexto for outro ou se foi mexida. */
export function abrirCaixa(id: Identidade, contexto: string, caixa: Uint8Array): Uint8Array | null {
  return abrirCaixaComSegredo(id.segredos.cifrar, contexto, caixa);
}

/** O mesmo, com o segredo de cifrar direto (a chave de caixa de uma geração, `geracoes.ts`). */
export function abrirCaixaComSegredo(segredoDeCifrar: Uint8Array, contexto: string, caixa: Uint8Array): Uint8Array | null {
  if (caixa.length < N_ENC + TAG || segredoDeCifrar.length !== 32) return null;
  let info: Uint8Array;
  try {
    info = infoDe(contexto);
  } catch {
    return null;
  }
  return _abrirHpke(segredoDeCifrar, caixa.subarray(0, N_ENC), info, VAZIO, caixa.subarray(N_ENC));
}

/** Quantos bytes a caixa acrescenta à mensagem (32 do `enc` + 16 da etiqueta). */
export const SOBRA_DA_CAIXA = N_ENC + TAG;
