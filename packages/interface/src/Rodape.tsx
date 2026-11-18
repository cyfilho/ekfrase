// SPDX-License-Identifier: MPL-2.0

import logoEkfrase from '@ekfrase/nucleo/estilo/img/ekfrase-logo.png';
import { ambienteFechado } from './ambiente.ts';
import { site } from './enderecos.ts';
import { LINKS } from './config.ts';
import type { T } from './tipos.ts';

/**
 * O rodapé de todo app: a marca Ekfrase (dentro de um app ela aparece só aqui), a licença e o Apoiar.
 * **Dois tamanhos, os mesmos em todo app** (pedido do Alcy em 16/11/2026): dentro do app (online e offline) só a marca,
 * "Um app da família Ekfrase.", que leva a ekfrase.com, para não gastar tela. `completo` (a página inicial do site,
 * as telas de entrada dos apps e as páginas informativas) põe também Sobre, Contato, Privacidade, Termos, a licença
 * e o Apoiar. Mudar o rodapé é mudar aqui, nunca no app.
 * No próprio site do Ekfrase (o castelo), `familia={false}` tira o "Um app da família".
 * No ambiente fechado (Writer OS) não há link nenhum: a marca fica como texto, sem Sobre/Contato/Privacidade/
 * Termos nem Apoiar (o que importa vira tela própria no painel do sistema).
 */
export function RodapeEkfrase({ t, familia = true, completo = false }: { t: T; familia?: boolean; completo?: boolean }) {
  const fechado = ambienteFechado();
  const marca = (
    <>
      <img src={logoEkfrase} width={48} height={36} alt="" />
      <span>
        {t('nucleo.familia.parte')} <span class="ekf-nome-marca">Ekfrase</span>
        {t('nucleo.familia.fim')}
      </span>
    </>
  );
  return (
    <footer class={completo ? 'ekf-rodape' : 'ekf-rodape so-marca'}>
      {familia && (
        <p>
          {fechado ? (
            <span class="ekf-familia">{marca}</span>
          ) : (
            <a class="ekf-familia" href="/" title={t('nucleo.familia.titulo')}>
              {marca}
            </a>
          )}
        </p>
      )}
      {completo && !fechado && (
        <nav class="ekf-rodape-links" aria-label={t('nucleo.rodape.nav')}>
          <a href={site.pagina('sobre')}>{t('nucleo.rodape.sobre')}</a>
          <a href={site.pagina('contato')}>{t('nucleo.rodape.contato')}</a>
          <a href={site.pagina('privacidade')}>{t('nucleo.rodape.privacidade')}</a>
          <a href={site.pagina('termos')}>{t('nucleo.rodape.termos')}</a>
        </nav>
      )}
      {completo && <p>{t('nucleo.rodape.livre')}</p>}
      {completo && !fechado && LINKS.patreon && (
        <p>
          <a class="ekf-botao" href={LINKS.patreon} target="_blank" rel="noopener">
            {t('nucleo.apoiar.botao')}
          </a>{' '}
          <span>{t('nucleo.apoiar.frase')}</span>
        </p>
      )}
    </footer>
  );
}
