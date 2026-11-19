// SPDX-License-Identifier: MPL-2.0

/**
 * O AJUSTE de cada app (docs/ATUALIZACOES.md §1): "Automáticas (recomendado)", o padrão, ou "Perguntar antes de
 * instalar"; e o relógio das buscas: ao abrir (ou quando a rede volta) e a cada 6 horas. Uma busca que falhou (sem
 * internet) tenta de novo mais cedo, e cada vez mais devagar, até o intervalo de sempre.
 */

export type ModoAtualizacoes = 'automaticas' | 'perguntar';

export const MODO_PADRAO: ModoAtualizacoes = 'automaticas';
export const INTERVALO_MS = 6 * 60 * 60 * 1000;

export const ehModo = (m: unknown): m is ModoAtualizacoes => m === 'automaticas' || m === 'perguntar';
export const lerModo = (m: unknown): ModoAtualizacoes => (ehModo(m) ? m : MODO_PADRAO);

/** Quanto esperar até a próxima busca: o intervalo, ou (depois de `falhas` seguidas) 1, 2, 4… min, até 30 min. */
export function proximaBusca(falhas: number, intervalo = INTERVALO_MS): number {
  if (falhas <= 0) return intervalo;
  return Math.min(intervalo, 30 * 60 * 1000, 60 * 1000 * 2 ** Math.min(falhas - 1, 10));
}
