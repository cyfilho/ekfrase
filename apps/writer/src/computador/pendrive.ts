// SPDX-License-Identifier: MPL-2.0

/**
 * IMPORTAR e SALVAR no Writer OS (PLANO §6.5 item 5, §7): sem o seletor de arquivos do Linux, a tela do
 * app (`PendriveOS.tsx`) mostra os pendrives e as pastas. Este arquivo é só o pedido: quem precisa de
 * um arquivo (Arquivos.tsx, `baixar` do ui.tsx) chama `importarDoPendrive` ou `salvarNoPendrive` e espera;
 * a tela, montada uma vez no `App`, responde.
 */

export interface ArquivoLido {
  nome: string;
  bytes: Uint8Array;
}

export type PedidoDePendrive =
  | { tipo: 'importar'; resolver: (r: ArquivoLido[] | null) => void }
  | { tipo: 'salvar'; nome: string; bytes: Uint8Array; resolver: (r: boolean) => void };

let atual: PedidoDePendrive | null = null;
const ouvintes = new Set<() => void>();

const avisar = () => {
  for (const f of [...ouvintes]) f();
};

export const pedidoDePendrive = (): PedidoDePendrive | null => atual;

export function aoPedidoDePendrive(f: () => void): () => void {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

/** Abre a tela dos pendrives para escolher arquivos; `null` = a pessoa desistiu. */
export function importarDoPendrive(): Promise<ArquivoLido[] | null> {
  return new Promise((resolver) => {
    fecharPedido();
    atual = { tipo: 'importar', resolver };
    avisar();
  });
}

/** Abre a tela dos pendrives para guardar um arquivo numa pasta; `true` = foi gravado. */
export function salvarNoPendrive(bytes: Uint8Array, nome: string): Promise<boolean> {
  return new Promise((resolver) => {
    fecharPedido();
    atual = { tipo: 'salvar', nome, bytes, resolver };
    avisar();
  });
}

/** A tela fechou (ou veio outro pedido): quem esperava recebe "desistiu". */
export function fecharPedido(): void {
  const p = atual;
  atual = null;
  if (p?.tipo === 'importar') p.resolver(null);
  else if (p?.tipo === 'salvar') p.resolver(false);
  avisar();
}

/** A tela terminou o pedido com este resultado. */
export function terminarPedido(r: ArquivoLido[] | boolean): void {
  const p = atual;
  atual = null;
  if (p?.tipo === 'importar') p.resolver(Array.isArray(r) ? r : null);
  else if (p?.tipo === 'salvar') p.resolver(r === true);
  avisar();
}
