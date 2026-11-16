// SPDX-License-Identifier: MPL-2.0

/**
 * O AMBIENTE FECHADO: no Writer OS (o pendrive) a pessoa nunca sai do app (PLANO §6.5), então nenhuma peça
 * comum pode levar ao site (rodapé, marca do topo, menu da conta, termos da criação de conta). O app liga
 * isto uma vez, antes de desenhar a primeira tela; fora do Writer OS fica desligado e nada muda.
 */
let fechado = false;

export function definirAmbienteFechado(v: boolean): void {
  fechado = v;
}

export const ambienteFechado = (): boolean => fechado;
