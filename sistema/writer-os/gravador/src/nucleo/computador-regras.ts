// SPDX-License-Identifier: MPL-2.0

/**
 * As REGRAS de preparar este computador para o Writer OS (PLANO §8c), sem nada do Node: a página do Gravador usa as
 * mesmas que o processo principal (`computador.ts`), para a tela dizer o que vai acontecer antes de pedir o UAC.
 */

export const GB = 1024 ** 3;
/** O que o "preparar" oferece (PLANO §8c) e o padrão. */
export const TAMANHOS_GB = [8, 16, 32] as const;
export const TAMANHO_PADRAO_GB = 16;
/** O Windows tem de continuar com pelo menos isto livre depois de diminuir (PLANO §8c). */
export const LIVRE_MINIMO_WINDOWS = 20 * GB;
/** O Writer OS instala a partir de 8 GB livres (o mesmo de `ekfrase-instalar.sh`). */
export const LIVRE_PARA_INSTALAR = 8 * GB;

export interface InfoComputador {
  /** O Windows deste computador, com o disco do sistema lido (fora do Windows, ou no simulado sem nada, `false`). */
  disponivel: boolean;
  uefi: boolean;
  disco: { numero: number; serial: string; nome: string; tamanho: number; setor: number; gpt: boolean; livreMaior: number } | null;
  windows: { letra: string; tamanho: number; livre: number } | null;
  /** Parece haver um Writer OS instalado neste disco (uma ESP de 1400 MiB e uma partição Linux). Quem remove confere pela GPT. */
  writer: boolean;
}

export type RecusaPreparar = 'nao-windows' | 'nao-uefi' | 'nao-gpt' | 'pouco-livre' | 'ja-tem-espaco' | 'ja-instalado';

/** Por que não dá para preparar este computador com `gb` GB (ou `null`: dá). */
export function recusaDoPreparar(info: InfoComputador, gb: number): RecusaPreparar | null {
  if (!info.disponivel || !info.disco || !info.windows) return 'nao-windows';
  if (!info.uefi) return 'nao-uefi';
  if (!info.disco.gpt) return 'nao-gpt';
  if (info.writer) return 'ja-instalado';
  if (info.disco.livreMaior >= LIVRE_PARA_INSTALAR) return 'ja-tem-espaco';
  if (info.windows.livre - gb * GB < LIVRE_MINIMO_WINDOWS) return 'pouco-livre';
  return null;
}

/** Os tamanhos que cabem (o Windows fica com 20 GB livres ou mais). */
export const tamanhosQueCabem = (info: InfoComputador): number[] => TAMANHOS_GB.filter((g) => !!info.windows && info.windows.livre - g * GB >= LIVRE_MINIMO_WINDOWS);
