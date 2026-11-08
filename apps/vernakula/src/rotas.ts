// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'preact/hooks';

/**
 * As telas por endereço (#/conta, #/textos…): o botão Voltar do celular e do
 * navegador funciona, e dá para guardar o link de uma tela. Algumas levam um
 * parâmetro depois da barra (#/redefinir/<código do e-mail>).
 */
export type Rota = 'inicio' | 'entrar' | 'conta' | 'textos' | 'esqueci' | 'redefinir';
const ROTAS: readonly Rota[] = ['inicio', 'entrar', 'conta', 'textos', 'esqueci', 'redefinir'];

export interface Endereco {
  rota: Rota;
  parametro: string;
}

function lerEndereco(): Endereco {
  const [r = '', parametro = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return { rota: (ROTAS as readonly string[]).includes(r) ? (r as Rota) : 'inicio', parametro };
}

export function irPara(rota: Rota): void {
  location.hash = rota === 'inicio' ? '' : `/${rota}`;
}

export function useEndereco(): Endereco {
  const [e, setE] = useState<Endereco>(lerEndereco());
  useEffect(() => {
    const mudou = () => {
      setE(lerEndereco());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', mudou);
    return () => removeEventListener('hashchange', mudou);
  }, []);
  return e;
}
