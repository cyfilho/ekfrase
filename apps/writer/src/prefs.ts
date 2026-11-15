// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'preact/hooks';

/**
 * As preferências deste aparelho (não vão à nuvem): os modos da folha de escrever, o tamanho da
 * letra e a escolha de escrever sem conta. Ficam no `localStorage`; sem ele, valem até fechar.
 */
export interface Prefs {
  /** Modo máquina de escrever: a linha atual fica no meio da tela. */
  maquina: boolean;
  /** Modo foco: o parágrafo atual em destaque, o resto apagado. */
  foco: boolean;
  /** Tamanho da letra da folha, em px. */
  letra: number;
  /** Escrever sem nenhum menu: o topo e o rodapé da folha só voltam com o mouse na borda ou com uma tecla. */
  semMenus: boolean;
  /** A pessoa escolheu escrever sem conta (a tela inicial não aparece mais). */
  semConta: boolean;
}

export const LETRA_MIN = 15;
export const LETRA_MAX = 28;
const PADRAO: Prefs = { maquina: false, foco: false, letra: 19, semConta: false, semMenus: false };
const CHAVE = 'ekfrase.writer.prefs';

const naFaixa = (n: number): number => Math.min(LETRA_MAX, Math.max(LETRA_MIN, Math.round(n)));

function ler(): Prefs {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Partial<Prefs>;
    const letra = typeof bruto.letra === 'number' && Number.isFinite(bruto.letra) ? naFaixa(bruto.letra) : PADRAO.letra;
    return { maquina: bruto.maquina === true, foco: bruto.foco === true, letra, semConta: bruto.semConta === true, semMenus: bruto.semMenus === true };
  } catch {
    return { ...PADRAO };
  }
}

let atual = ler();
const ouvintes = new Set<() => void>();

export const prefs = (): Prefs => atual;

export function mudarPrefs(parte: Partial<Prefs>): void {
  atual = { ...atual, ...parte };
  atual.letra = naFaixa(atual.letra);
  try {
    localStorage.setItem(CHAVE, JSON.stringify(atual));
  } catch {
    // sem armazenamento: vale até fechar
  }
  for (const f of [...ouvintes]) f();
}

export function usePrefs(): Prefs {
  const [, setV] = useState(0);
  useEffect(() => {
    const f = () => setV((n) => n + 1);
    ouvintes.add(f);
    return () => {
      ouvintes.delete(f);
    };
  }, []);
  return atual;
}
