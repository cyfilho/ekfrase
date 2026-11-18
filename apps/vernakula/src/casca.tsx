// SPDX-License-Identifier: MPL-2.0

import { AcoesTopo, RodapeEkfrase, jogo } from '@ekfrase/interface';
import logoVernakula from './img/logo-vernakula.png';
import { enderecoDe } from './rotas.ts';
import { t, tr } from './textos.ts';

/**
 * O topo: a logo e o nome do Vernákula (a marca Ekfrase fica só no rodapé), com o nome da escola em
 * que a pessoa entrou logo abaixo (FB-0017), e os botões-ícone de sempre: passeio (a torre do
 * Vernákula no castelo, DEC-P040), idioma, tema, feedback e a conta.
 */
export function Cabecalho({ escola, entrou }: { escola?: string | undefined; entrou: boolean }) {
  return (
    <header class="topo">
      <a class="marca" href={enderecoDe(entrou ? 'inicio' : 'entrada')}>
        <img src={logoVernakula} width={48} height={48} alt="" />
        <span class="marca-nomes">
          <span>{t('vernakula.nome_curto')}</span>
          {escola && <small class="marca-escola">{escola}</small>}
        </span>
      </a>
      <AcoesTopo t={t} tr={tr} app="vernakula" passeio={jogo.sala('vernakula')} aoSair={() => location.reload()} />
    </header>
  );
}

export function Rodape() {
  return <RodapeEkfrase t={t} />;
}
