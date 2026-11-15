// SPDX-License-Identifier: MPL-2.0

/**
 * Contar palavras (Unicode; português e inglês). Uma palavra é uma sequência de letras e números,
 * podendo ter apóstrofo ou hífen NO MEIO: "guarda-chuva", "d'água" e "don't" contam 1 cada.
 * Travessão, pontuação e os símbolos do Markdown não contam.
 */
const PALAVRA = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export function contarPalavras(texto: string): number {
  return texto.match(PALAVRA)?.length ?? 0;
}
