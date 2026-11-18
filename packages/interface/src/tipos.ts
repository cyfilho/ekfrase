// SPDX-License-Identifier: MPL-2.0

import type { Parametros } from '@ekfrase/nucleo';
import { jogo } from './enderecos.ts';

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
  location.replace(jogo.sala(app));
  return true;
}

/**
 * Quem acessa `ekfrase.com/<app>/` cai na tela de entrada do app (a página das formas de usar), com ou sem
 * conta: sempre que o endereço é a própria pasta do app (nada depois de `/<app>/`) ou tem o `?inicio` (o botão do
 * modo jogo no hall da torre e o balcão). **O endereço fica sempre `ekfrase.com/<app>/`** (padrão de todo app): o
 * `?inicio` é só um sinal, apagado do endereço já na primeira leitura. A resposta vale até `limparEntradaPedida`
 * (o botão "Abrir" entra no app: `ekfrase.com/<app>/app`). Padrão dos endereços: `enderecos.ts`.
 */
let pedida: boolean | null = null;

/** O endereço é a pasta do app, sem nada depois (`/<app>` ou `/<app>/`)? */
const naPastaDoApp = (): boolean => location.pathname.split('/').filter(Boolean).length <= 1;

export function entradaPedida(): boolean {
  if (pedida !== null) return pedida;
  let sinal = false;
  try {
    const u = new URL(location.href);
    sinal = u.searchParams.has('inicio');
    if (sinal) {
      u.searchParams.delete('inicio');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    }
  } catch {
    /* sem endereço: nada */
  }
  pedida = sinal || naPastaDoApp();
  return pedida;
}

/** A pessoa entrou no app: a tela de entrada não volta nesta página, e o endereço passa a `/<app>/app`. */
export function limparEntradaPedida(): void {
  pedida = false;
  if (naPastaDoApp()) history.replaceState(history.state, '', `${location.pathname.replace(/\/?$/, '/')}app${location.search}`);
}
