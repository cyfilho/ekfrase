// SPDX-License-Identifier: MPL-2.0

/**
 * AS VERSÕES E O CANAL (docs/ATUALIZACOES.md §3). Uma versão é `X.Y.Z` (a estável) ou `X.Y.Z-teste.N` (uma de teste,
 * que só um app montado de uma tag de teste vê). A estável de uma versão vale MAIS que todas as de teste dela:
 * `0.2.0` > `0.2.0-teste.9` > `0.2.0-teste.1` > `0.1.4`.
 */

export type Canal = 'estavel' | 'teste';

const ESTAVEL = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
const TESTE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})-teste\.(\d{1,6})$/;

export const ehVersao = (v: unknown): v is string => typeof v === 'string' && (ESTAVEL.test(v) || TESTE.test(v));
export const ehDeTeste = (v: string): boolean => TESTE.test(v);

/** [maior, menor, correção, teste]: a estável tem o "teste" infinito (vence as de teste dela). */
function partes(v: string): number[] | null {
  const m = ESTAVEL.exec(v) ?? TESTE.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? Infinity : Number(m[4])] : null;
}

/** 1 se `a` é mais nova que `b`, -1 se mais velha, 0 se igual. Uma versão inválida é a mais velha de todas. */
export function compararVersoes(a: string, b: string): number {
  const x = partes(a);
  const y = partes(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  return 0;
}

export const maisNova = (a: string, b: string): boolean => compararVersoes(a, b) > 0;

/** O canal vê esta versão? O estável só vê as estáveis; o de teste vê as duas. */
export const canalAceita = (canal: Canal, v: string): boolean => ehVersao(v) && (canal === 'teste' || !ehDeTeste(v));

/** O canal de um app pela versão dele (o app montado de uma tag `…-teste.N` é do canal de teste). */
export const canalDaVersao = (v: string): Canal => (ehDeTeste(v) ? 'teste' : 'estavel');
