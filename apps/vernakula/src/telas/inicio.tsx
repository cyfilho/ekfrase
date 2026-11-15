// SPDX-License-Identifier: MPL-2.0

import type { Conta, Escola } from '../api.ts';
import { t } from '../textos.ts';
import { podeAdministrar } from './admin.tsx';
import { podeEditarTextos } from './textos-escola.tsx';

/**
 * O começo de quem entrou. As permissões não aparecem aqui (FB-0017): quem as vê é a administração;
 * a pessoa só vê o que elas liberam (o menu, os acessos). O nome da escola fica no topo.
 */
export function Inicio({ conta, escola, aoSair }: { conta: Conta; escola: Escola; aoSair: () => void }) {
  return (
    <section class="painel">
      <h1>{t('vernakula.inicio.ola', { nome: conta.nome.split(' ')[0] ?? conta.nome })}</h1>
      <p class="obras">{t('vernakula.inicio.obras')}</p>
      <nav class="acoes" aria-label={t('vernakula.menu.rotulo')}>
        <a class="botao" href="#/conta">
          {t('vernakula.menu.conta')}
        </a>
        {podeAdministrar(escola) && (
          <a class="botao" href="#/admin">
            {t('vernakula.menu.admin')}
          </a>
        )}
        <a class="botao" href="#/escolas">
          {t(conta.organizacoes.length > 1 ? 'vernakula.menu.trocar_escola' : 'vernakula.menu.escolas')}
        </a>
        {podeEditarTextos(escola) && (
          <a class="botao" href="#/textos">
            {t('vernakula.menu.textos')}
          </a>
        )}
        <button type="button" class="botao" onClick={aoSair}>
          {t('nucleo.conta.sair')}
        </button>
      </nav>
    </section>
  );
}
