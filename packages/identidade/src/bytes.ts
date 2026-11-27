// SPDX-License-Identifier: MPL-2.0

/**
 * Bytes: base64url sem `=` (o formato de toda chave e assinatura em JSON), hex, juntar, comparar e apagar.
 * O base64url é estrito: recusa letra fora do alfabeto, `=` e os bits de sobra diferentes de zero, para que cada
 * valor tenha UMA escrita só (o que se assina não pode ter duas formas).
 */
import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes };

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VALOR = new Map<string, number>([...ALFABETO].map((c, i) => [c, i]));

/** Bytes → base64url sem `=`. */
export function paraBase64url(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    s += ALFABETO[(n >> 18) & 63]! + ALFABETO[(n >> 12) & 63]! + ALFABETO[(n >> 6) & 63]! + ALFABETO[n & 63]!;
  }
  const resto = bytes.length - i;
  if (resto === 1) {
    const n = bytes[i]! << 16;
    s += ALFABETO[(n >> 18) & 63]! + ALFABETO[(n >> 12) & 63]!;
  } else if (resto === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    s += ALFABETO[(n >> 18) & 63]! + ALFABETO[(n >> 12) & 63]! + ALFABETO[(n >> 6) & 63]!;
  }
  return s;
}

/** base64url sem `=` → bytes; `null` se o texto não for a escrita canônica de algum valor. */
export function doBase64url(texto: string): Uint8Array | null {
  if (texto.length % 4 === 1) return null;
  const saida = new Uint8Array(Math.floor((texto.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (const c of texto) {
    const v = VALOR.get(c);
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      saida[o++] = (acc >> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  if (acc !== 0) return null; // bits de sobra: só zero (uma escrita por valor)
  return saida;
}

/** base64url com o tamanho certo, ou `null`. */
export function doBase64urlCom(texto: unknown, tamanho: number): Uint8Array | null {
  if (typeof texto !== 'string') return null;
  const b = doBase64url(texto);
  return b && b.length === tamanho ? b : null;
}

/** Compara sem parar na primeira diferença (o tempo não diz onde os bytes diferem). */
export function iguais(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

/** Zera os bytes (o JavaScript não garante que não sobrou cópia, mas tira o segredo do lugar que conhecemos). */
export function apagar(...partes: Uint8Array[]): void {
  for (const p of partes) p.fill(0);
}

/** Texto em UTF-8 → bytes, depois de normalizar em NFC (o mesmo texto vira sempre os mesmos bytes). */
export function textoNFC(texto: string): Uint8Array {
  return utf8ToBytes(texto.normalize('NFC'));
}
