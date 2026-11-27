// SPDX-License-Identifier: MPL-2.0

/**
 * O KIT DE RECUPERAÇÃO: as 12 palavras (ARQUITETURA §5.2 e §5.3, DEC-P077).
 *
 * As 12 palavras SÃO a semente da pessoa (16 bytes = 128 bits, mais 4 bits de conferência): com elas, a identidade
 * inteira volta (`identidadeDaSemente`), sem servidor nenhum. É o BIP39, o padrão das carteiras, com a lista oficial
 * em português (2048 palavras sem acento; as 4 primeiras letras já bastam para saber qual é) e a inglesa. As duas
 * listas não têm palavra em comum, então o idioma se descobre pelas palavras.
 *
 * Ao ler o que a pessoa digitou: maiúsculas, acentos, vírgulas, hífens e espaços a mais não atrapalham, e as 4
 * primeiras letras de uma palavra bastam. A conferência do BIP39 pega quase todo erro de digitação (15 em 16).
 */
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist as ingles } from '@scure/bip39/wordlists/english.js';
import { wordlist as portugues } from '@scure/bip39/wordlists/portuguese.js';
import { randomBytes } from './bytes.ts';

export type IdiomaDoKit = 'pt' | 'en';

const LISTAS: Readonly<Record<IdiomaDoKit, readonly string[]>> = { pt: portugues, en: ingles };

/** O idioma do kit a partir do idioma da interface (`pt-BR` → `pt`; o resto, por enquanto, `en`). */
export function idiomaDoKit(idiomaDaInterface: string): IdiomaDoKit {
  return idiomaDaInterface.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export interface Kit {
  /** A semente da pessoa (16 bytes). */
  readonly semente: Uint8Array;
  /** As 12 palavras, em ordem. */
  readonly palavras: readonly string[];
  readonly idioma: IdiomaDoKit;
}

/** Um kit novo: semente sorteada e as 12 palavras dela. */
export function novoKit(idioma: IdiomaDoKit = 'pt'): Kit {
  const semente = randomBytes(16);
  return { semente, palavras: palavrasDaSemente(semente, idioma), idioma };
}

/** As 12 palavras de uma semente de 16 bytes. */
export function palavrasDaSemente(semente: Uint8Array, idioma: IdiomaDoKit = 'pt'): string[] {
  if (semente.length !== 16) throw new RangeError('a semente da pessoa tem 16 bytes');
  return entropyToMnemonic(semente, LISTAS[idioma] as string[]).split(' ');
}

export type ErroDoKit = 'quantidade' | 'palavra-desconhecida' | 'conferencia';

export type KitLido =
  | { readonly ok: true; readonly semente: Uint8Array; readonly idioma: IdiomaDoKit; readonly palavras: readonly string[] }
  | {
      readonly ok: false;
      readonly erro: ErroDoKit;
      /** Em `palavra-desconhecida`: as posições (0 a 11) das palavras que não estão na lista. */
      readonly posicoes?: readonly number[];
    };

/** Tira acentos, maiúsculas e o que separa as palavras. */
export function separarPalavras(texto: string): string[] {
  return texto
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((p) => p.length > 0);
}

/** A palavra da lista que a pessoa quis dizer: a própria, ou a única que começa com o que ela digitou (4 letras ou mais). */
function daLista(lista: readonly string[], digitada: string): string | undefined {
  if (lista.includes(digitada)) return digitada;
  if (digitada.length < 4) return undefined;
  const achadas = lista.filter((p) => p.startsWith(digitada));
  return achadas.length === 1 ? achadas[0] : undefined;
}

/** Lê o kit que a pessoa digitou (ou leu do QR/arquivo). */
export function lerKit(texto: string | readonly string[]): KitLido {
  const digitadas = typeof texto === 'string' ? separarPalavras(texto) : separarPalavras(texto.join(' '));
  if (digitadas.length !== 12) return { ok: false, erro: 'quantidade' };
  let melhor: { idioma: IdiomaDoKit; palavras: (string | undefined)[]; faltam: number[] } | undefined;
  for (const idioma of ['pt', 'en'] as const) {
    const palavras = digitadas.map((d) => daLista(LISTAS[idioma], d));
    const faltam = palavras.flatMap((p, i) => (p === undefined ? [i] : []));
    if (!melhor || faltam.length < melhor.faltam.length) melhor = { idioma, palavras, faltam };
  }
  if (!melhor || melhor.faltam.length > 0) return { ok: false, erro: 'palavra-desconhecida', posicoes: melhor?.faltam ?? [] };
  const palavras = melhor.palavras as string[];
  try {
    const semente = mnemonicToEntropy(palavras.join(' '), LISTAS[melhor.idioma] as string[]);
    if (semente.length !== 16) return { ok: false, erro: 'quantidade' };
    return { ok: true, semente, idioma: melhor.idioma, palavras };
  } catch {
    return { ok: false, erro: 'conferencia' };
  }
}
