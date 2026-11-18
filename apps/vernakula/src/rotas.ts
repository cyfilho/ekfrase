// SPDX-License-Identifier: MPL-2.0

import { entradaDoApp, irPara as irParaEndereco, aoMudarEndereco, noApp, paginaDoApp, partesDoEndereco } from '@ekfrase/interface';
import { useEffect, useState } from 'preact/hooks';

/**
 * As telas por endereço limpo (DEC-P069, `docs/ENDERECOS.md`): o botão Voltar do celular e do navegador funciona,
 * e dá para guardar o link de uma tela.
 *
 *   /vernakula/                    'entrada'    a entrada (online, computador)
 *   /vernakula/<página>            públicas, de quem ainda não entrou: entrar, criar, esqueci,
 *                                  redefinir/<código do e-mail>, convite/<código do e-mail>
 *   /vernakula/app                 'inicio'     o app: a tela principal de quem entrou
 *   /vernakula/app/<tela>          conta, textos, escolas, pedir, admin
 */
export type Rota = 'entrada' | 'inicio' | 'entrar' | 'criar' | 'conta' | 'textos' | 'esqueci' | 'redefinir' | 'escolas' | 'pedir' | 'admin' | 'convite';

const PUBLICAS: readonly Rota[] = ['entrar', 'criar', 'esqueci', 'redefinir', 'convite'];
const NO_APP: readonly Rota[] = ['conta', 'textos', 'escolas', 'pedir', 'admin'];

export interface Endereco {
  rota: Rota;
  parametro: string;
}

function lerEndereco(): Endereco {
  const [primeira, segunda = ''] = partesDoEndereco('vernakula') ?? [];
  if (primeira === undefined) return { rota: 'entrada', parametro: '' };
  if (primeira === 'app') return { rota: (NO_APP as readonly string[]).includes(segunda) ? (segunda as Rota) : 'inicio', parametro: '' };
  if ((PUBLICAS as readonly string[]).includes(primeira)) return { rota: primeira as Rota, parametro: segunda };
  return { rota: 'entrada', parametro: '' };
}

/** O endereço de uma tela (para `href` e `irPara`). */
export function enderecoDe(rota: Rota, parametro = ''): string {
  if (rota === 'entrada') return entradaDoApp('vernakula');
  if (rota === 'inicio') return noApp('vernakula');
  if ((PUBLICAS as readonly string[]).includes(rota)) return paginaDoApp('vernakula', parametro ? `${rota}/${parametro}` : rota);
  return noApp('vernakula', rota);
}

/** Os endereços antigos (`#/x`, de antes de 18/11/2026) viram os novos: páginas públicas fora do app, o resto dentro. */
export function traduzirHashAntigo(resto: string): string {
  const [r = ''] = resto.split('/');
  if ((PUBLICAS as readonly string[]).includes(r)) return paginaDoApp('vernakula', resto);
  return noApp('vernakula', r === 'inicio' ? '' : resto);
}

export function irPara(rota: Rota, parametro = ''): void {
  irParaEndereco(enderecoDe(rota, parametro));
}

export function useEndereco(): Endereco {
  const [e, setE] = useState<Endereco>(lerEndereco());
  useEffect(
    () =>
      aoMudarEndereco(() => {
        setE(lerEndereco());
        window.scrollTo(0, 0);
      }),
    [],
  );
  return e;
}
