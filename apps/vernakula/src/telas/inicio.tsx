// SPDX-License-Identifier: MPL-2.0

import type { Conta } from '../api.ts';
import { t } from '../textos.ts';
import { podeEditarTextos } from './textos-escola.tsx';

export function Inicio({ conta, aoSair }: { conta: Conta; aoSair: () => void }) {
  const escola = conta.organizacoes[0];
  return (
    <section class="painel">
      <h1>{t('vernakula.inicio.ola', { nome: conta.nome.split(' ')[0] ?? conta.nome })}</h1>
      {escola && <p class="lema">{escola.nome}</p>}
      <p>{t('vernakula.inicio.papeis')}</p>
      <ul class="etiquetas">
        {conta.papeis.map((p) => (
          <li key={p}>{t(`nucleo.papel.${p}`)}</li>
        ))}
      </ul>
      <p class="obras">{t('vernakula.inicio.obras')}</p>
      <nav class="acoes" aria-label={t('vernakula.menu.rotulo')}>
        <a class="botao" href="#/conta">
          {t('vernakula.menu.conta')}
        </a>
        {podeEditarTextos(conta) && (
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
