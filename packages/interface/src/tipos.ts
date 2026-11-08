// SPDX-License-Identifier: MPL-2.0

import type { Parametros } from '@ekfrase/nucleo';

/** O tradutor que cada app passa às peças (as chaves daqui são do núcleo: `nucleo.*`). */
export type T = (chave: string, p?: Parametros) => string;

/** O passeio pelo castelo (DEC-P039): escolhido na entrada do Ekfrase e lembrado neste aparelho. */
const CHAVE_PASSEIO = 'ekfrase.passeio';

/** 'sim', 'nao' ou null (ainda não escolheu: a entrada do castelo pergunta). */
export function passeioEscolhido(): 'sim' | 'nao' | null {
  try {
    const v = localStorage.getItem(CHAVE_PASSEIO);
    return v === 'sim' || v === 'nao' ? v : null;
  } catch {
    return null;
  }
}

export function gravarPasseio(ligado: boolean): void {
  try {
    localStorage.setItem(CHAVE_PASSEIO, ligado ? 'sim' : 'nao');
  } catch {
    // sem armazenamento: vale até fechar
  }
}

const CHAVE_SESSAO = 'ekfrase.visita';
let primeiraPagina: boolean | null = null;

/**
 * Esta é a primeira página do Ekfrase nesta aba (a pessoa acabou de chegar, por um link direto ou
 * digitando o endereço)? Ir de uma página do Ekfrase para outra (do castelo para um app) não conta.
 */
export function chegouAgora(): boolean {
  if (primeiraPagina === null) {
    try {
      primeiraPagina = !sessionStorage.getItem(CHAVE_SESSAO);
      sessionStorage.setItem(CHAVE_SESSAO, '1');
    } catch {
      primeiraPagina = false;
    }
  }
  return primeiraPagina;
}

/**
 * Link direto de um app, com a conta: a pessoa aparece no modo em que estava da última vez. Se era o
 * modo jogo, vai às salas da torre do app no castelo (e devolve true). Sem conta, a tela inicial do
 * app fica (ela é o hall do modo normal).
 */
export function voltarAoModoDoApp(app: string): boolean {
  if (!chegouAgora() || passeioEscolhido() !== 'sim') return false;
  location.replace(`/#/torre/${app}/salas`);
  return true;
}
