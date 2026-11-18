// SPDX-License-Identifier: MPL-2.0

import { useEffect } from 'preact/hooks';

/**
 * Os PEDIDOS às janelas gerais do app (a paleta, a lista de atalhos, os ajustes, a ideia rápida):
 * qualquer tela pede, a casca (App.tsx) abre. E a história em que a pessoa está agora, para a ideia
 * rápida já nascer ligada a ela.
 */
export type Pedido = 'paleta' | 'atalhos' | 'ajustes' | 'ideia' | 'levar' | 'sistema' | 'conta';

const ouvintes = new Set<(p: Pedido) => void>();

export function pedir(p: Pedido): void {
  for (const f of [...ouvintes]) f(p);
}

export function aoPedido(f: (p: Pedido) => void): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

let historiaAtual: string | null = null;

/** A história da tela aberta (ou `null` na estante e no banco de ideias geral). */
export const historiaDeAgora = (): string | null => historiaAtual;

/** A tela diz em que história a pessoa está enquanto ela estiver aberta. */
export function useHistoriaDeAgora(id: string | null | undefined): void {
  useEffect(() => {
    historiaAtual = id ?? null;
    return () => {
      if (historiaAtual === (id ?? null)) historiaAtual = null;
    };
  }, [id]);
}
