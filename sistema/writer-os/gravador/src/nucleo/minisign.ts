// SPDX-License-Identifier: MPL-2.0

/**
 * O LACRE DA EKFRASE: a assinatura minisign (https://jedisct1.github.io/minisign/) da imagem, conferida
 * com o `crypto` do Node (Ed25519 + BLAKE2b-512), sem programa de fora. Só o formato "pré-hash" (`ED`,
 * o padrão do minisign desde a 0.10): a assinatura cobre o BLAKE2b-512 do arquivo, então não é preciso
 * ter a imagem inteira na memória. A assinatura "global" cobre também o comentário de confiança.
 *
 * Chave pública: 2 bytes "Ed" + 8 do id + 32 da chave. Assinatura: 2 bytes do algoritmo + 8 do id +
 * 64 da assinatura; linha "trusted comment: …"; e os 64 bytes da assinatura global.
 */
import { blake2b as blake2bJs } from '@noble/hashes/blake2.js';
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * O BLAKE2b-512: o do Node quando há; o Electron (BoringSSL) não tem, então o do @noble/hashes (MIT,
 * auditado, JS puro; uns 50 MB/s, ~12 s para a imagem inteira).
 */
function novoBlake2b(): { update(b: Uint8Array): void; digest(): Buffer } {
  try {
    const h = createHash('blake2b512');
    return { update: (b) => void h.update(b), digest: () => h.digest() };
  } catch {
    const h = blake2bJs.create({ dkLen: 64 });
    return { update: (b) => void h.update(b), digest: () => Buffer.from(h.digest()) };
  }
}

export interface ChavePublica {
  id: string;
  chave: KeyObject;
}

const linhas = (t: string) =>
  t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** O id em texto, como o minisign mostra (hexadecimal, do byte mais alto para o mais baixo). */
const idTexto = (b: Buffer): string => Buffer.from(b).reverse().toString('hex').toUpperCase();

export function lerChavePublica(texto: string): ChavePublica {
  const l = linhas(texto).filter((x) => !x.startsWith('untrusted comment:'));
  const b = Buffer.from(l[0] ?? '', 'base64');
  if (b.length !== 42 || b.subarray(0, 2).toString('latin1') !== 'Ed') throw new Error('chave minisign inválida');
  const chave = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b.subarray(10).toString('base64url') }, format: 'jwk' });
  return { id: idTexto(b.subarray(2, 10)), chave };
}

export type Conferencia = { ok: true; comentario: string } | { ok: false; motivo: 'formato' | 'outra-chave' | 'antiga' | 'assinatura' };

/** Confere a assinatura (`.minisig`) contra o BLAKE2b-512 do arquivo. */
export function conferirAssinatura(chave: ChavePublica, assinatura: string, blake2b: Buffer): Conferencia {
  const l = linhas(assinatura);
  if (l.length < 4 || !l[0]!.startsWith('untrusted comment:') || !l[2]!.startsWith('trusted comment: ')) return { ok: false, motivo: 'formato' };
  const s = Buffer.from(l[1]!, 'base64');
  const global = Buffer.from(l[3]!, 'base64');
  if (s.length !== 74 || global.length !== 64) return { ok: false, motivo: 'formato' };
  const algoritmo = s.subarray(0, 2).toString('latin1');
  if (algoritmo === 'Ed') return { ok: false, motivo: 'antiga' };
  if (algoritmo !== 'ED') return { ok: false, motivo: 'formato' };
  if (idTexto(s.subarray(2, 10)) !== chave.id) return { ok: false, motivo: 'outra-chave' };
  const sig = s.subarray(10);
  const comentario = l[2]!.slice('trusted comment: '.length);
  if (!verify(null, blake2b, chave.chave, sig)) return { ok: false, motivo: 'assinatura' };
  if (!verify(null, Buffer.concat([sig, Buffer.from(comentario, 'utf8')]), chave.chave, global)) return { ok: false, motivo: 'assinatura' };
  return { ok: true, comentario };
}

export interface Hashes {
  sha256: string;
  blake2b: Buffer;
  tamanho: number;
}

/** O SHA-256 (o `.sha256` do CI) e o BLAKE2b-512 (o lacre) de um arquivo, numa leitura só. */
export async function hashesDoArquivo(arquivo: string, aoLer?: (feito: number) => void): Promise<Hashes> {
  const sha = createHash('sha256');
  const blake = novoBlake2b();
  let tamanho = 0;
  for await (const pedaco of createReadStream(arquivo, { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) {
    sha.update(pedaco);
    blake.update(pedaco);
    tamanho += pedaco.length;
    aoLer?.(tamanho);
  }
  return { sha256: sha.digest('hex'), blake2b: blake.digest(), tamanho };
}

/** Só o SHA-256 (rápido em todo lugar; o que amarra o arquivo depois que o lacre foi conferido). */
export async function sha256DoArquivo(arquivo: string): Promise<string> {
  const sha = createHash('sha256');
  for await (const pedaco of createReadStream(arquivo, { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) sha.update(pedaco);
  return sha.digest('hex');
}

/** O hash de um arquivo `.sha256` ("<hash>  <nome>" ou só o hash). */
export function lerSha256(texto: string): string | null {
  const m = /^\s*([0-9a-fA-F]{64})\b/.exec(texto);
  return m ? m[1]!.toLowerCase() : null;
}
