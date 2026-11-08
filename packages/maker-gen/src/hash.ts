// SPDX-License-Identifier: MPL-2.0

/**
 * Aleatoriedade determinista por hash de inteiros (DEC-009). Math.imul e os deslocamentos de bits
 * têm resultado exato definido pela especificação do JavaScript, igual em todos os navegadores.
 * Nunca mudar estas funções: os geradores publicados dependem delas bit a bit.
 */

/** FNV-1a de 32 bits sobre as unidades UTF-16 do texto (a semente é texto, §5). */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mistura três inteiros de 32 bits num inteiro sem sinal de 32 bits. */
export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

const INV_2_32 = 1 / 4294967296;

/** Valor em [0, 1) a partir de um hash de 32 bits. */
export function unit(h: number): number {
  return h * INV_2_32;
}
