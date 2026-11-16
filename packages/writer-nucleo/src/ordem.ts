// SPDX-License-Identifier: MPL-2.0

/**
 * ÍNDICE FRACIONÁRIO para o campo `ordem` (docs/writer/protocolo/README.md §6): textos que se
 * ordenam como texto (`a0` < `a0V` < `a1`). Entre duas chaves sempre cabe outra, então mover uma
 * cena muda UM registro só, e dois aparelhos que reordenam não brigam.
 *
 * É o algoritmo conhecido de "fractional indexing" em base 62 (0-9, A-Z, a-z): a chave tem uma
 * parte inteira de tamanho variável (a 1ª letra diz o tamanho: `a` = 1 dígito, `b` = 2… `A` = 1
 * dígito para trás, `B` = 2…) e uma parte fracionária, sem zero no fim.
 */

export const DIGITOS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITOS[0]!;
const MENOR_INTEIRO = `A${ZERO.repeat(26)}`;

const valor = (c: string): number => {
  const i = DIGITOS.indexOf(c);
  if (i < 0) throw new Error(`ordem com caractere inválido: ${c}`);
  return i;
};

/** O texto do meio entre duas frações (`b` nulo = sem limite em cima). `a < b`. */
function meio(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + meio(a.slice(n), b.slice(n));
  }
  const da = a ? valor(a[0]!) : 0;
  const db = b !== null ? valor(b[0]!) : DIGITOS.length;
  if (db - da > 1) return DIGITOS[Math.round(0.5 * (da + db))]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITOS[da]! + meio(a.slice(1), null);
}

function tamanhoDoInteiro(cabeca: string): number {
  if (cabeca >= 'a' && cabeca <= 'z') return cabeca.charCodeAt(0) - 97 + 2;
  if (cabeca >= 'A' && cabeca <= 'Z') return 90 - cabeca.charCodeAt(0) + 2;
  throw new Error(`ordem inválida: começa com ${cabeca}`);
}

function inteiroDe(chave: string): string {
  const n = tamanhoDoInteiro(chave[0] ?? '');
  if (n > chave.length) throw new Error(`ordem inválida: ${chave}`);
  return chave.slice(0, n);
}

/** Uma chave de ordem bem formada? */
export function ehOrdem(chave: unknown): chave is string {
  if (typeof chave !== 'string' || chave === '' || chave === MENOR_INTEIRO) return false;
  try {
    const i = inteiroDe(chave);
    for (const c of chave) valor(c);
    return !chave.slice(i.length).endsWith(ZERO);
  } catch {
    return false;
  }
}

function conferir(chave: string): void {
  if (!ehOrdem(chave)) throw new Error(`ordem inválida: ${chave}`);
}

function incrementar(x: string): string | null {
  const cabeca = x[0]!;
  const digs = x.slice(1).split('');
  let vai = true;
  for (let i = digs.length - 1; vai && i >= 0; i--) {
    const d = valor(digs[i]!) + 1;
    if (d === DIGITOS.length) digs[i] = ZERO;
    else {
      digs[i] = DIGITOS[d]!;
      vai = false;
    }
  }
  if (!vai) return cabeca + digs.join('');
  if (cabeca === 'Z') return `a${ZERO}`;
  if (cabeca === 'z') return null;
  const h = String.fromCharCode(cabeca.charCodeAt(0) + 1);
  if (h > 'a') digs.push(ZERO);
  else digs.pop();
  return h + digs.join('');
}

function decrementar(x: string): string | null {
  const cabeca = x[0]!;
  const digs = x.slice(1).split('');
  let empresta = true;
  for (let i = digs.length - 1; empresta && i >= 0; i--) {
    const d = valor(digs[i]!) - 1;
    if (d === -1) digs[i] = DIGITOS[DIGITOS.length - 1]!;
    else {
      digs[i] = DIGITOS[d]!;
      empresta = false;
    }
  }
  if (!empresta) return cabeca + digs.join('');
  if (cabeca === 'a') return `Z${DIGITOS[DIGITOS.length - 1]!}`;
  if (cabeca === 'A') return null;
  const h = String.fromCharCode(cabeca.charCodeAt(0) - 1);
  if (h < 'Z') digs.push(DIGITOS[DIGITOS.length - 1]!);
  else digs.pop();
  return h + digs.join('');
}

/**
 * Uma chave entre `a` e `b` (`null` = sem vizinho daquele lado). `entre(null, null)` = `a0`.
 * Lança erro se `a >= b` ou se alguma chave for malformada.
 */
export function entre(a: string | null, b: string | null): string {
  if (a !== null) conferir(a);
  if (b !== null) conferir(b);
  if (a !== null && b !== null && a >= b) throw new Error(`ordem: ${a} não vem antes de ${b}`);
  if (a === null) {
    if (b === null) return `a${ZERO}`;
    const ib = inteiroDe(b);
    const fb = b.slice(ib.length);
    if (ib === MENOR_INTEIRO) return ib + meio('', fb);
    if (ib < b) return ib;
    const menos = decrementar(ib);
    if (menos === null) throw new Error('ordem: não cabe mais nada antes');
    // o menor inteiro sozinho não é chave (não caberia nada antes dele): ganha uma fração
    return menos === MENOR_INTEIRO ? menos + meio('', null) : menos;
  }
  if (b === null) {
    const ia = inteiroDe(a);
    const mais = incrementar(ia);
    return mais === null ? ia + meio(a.slice(ia.length), null) : mais;
  }
  const ia = inteiroDe(a);
  const fa = a.slice(ia.length);
  const ib = inteiroDe(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + meio(fa, fb);
  const mais = incrementar(ia);
  if (mais === null) throw new Error('ordem: não cabe mais nada depois');
  return mais < b ? mais : ia + meio(fa, null);
}

/** `n` chaves em ordem crescente, todas entre `a` e `b`. */
export function variasEntre(a: string | null, b: string | null, n: number): string[] {
  const saida: string[] = [];
  let anterior = a;
  for (let i = 0; i < n; i++) {
    anterior = entre(anterior, b);
    saida.push(anterior);
  }
  return saida;
}

/**
 * A ordem da CÓPIA DE CONFLITO de uma cena: logo depois da original, calculada só a partir dela
 * (todo aparelho chega à mesma chave). É a chave da cena com o dígito do meio (`V`) no fim.
 */
export const logoDepois = (ordem: string): string => `${ordem}V`;

/** Compara dois registros pela ordem; no empate, pelo id (a ordem é sempre total e estável). */
export function porOrdem(a: { ordem: string; id: string }, b: { ordem: string; id: string }): number {
  return a.ordem < b.ordem ? -1 : a.ordem > b.ordem ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
