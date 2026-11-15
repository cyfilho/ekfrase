// SPDX-License-Identifier: MPL-2.0

import logoEkfrase from '@ekfrase/nucleo/estilo/img/ekfrase-logo.png';
import { LINKS } from './config.ts';
import type { T } from './tipos.ts';

/**
 * O rodapé de todo app: a marca Ekfrase (dentro de um app ela aparece só aqui), a licença e o Apoiar.
 * No próprio site do Ekfrase (o castelo), `familia={false}` tira o "Um app da família".
 */
export function RodapeEkfrase({ t, compacto = false, familia = true }: { t: T; compacto?: boolean; familia?: boolean }) {
  return (
    <footer class={compacto ? 'ekf-rodape compacto' : 'ekf-rodape'}>
      {familia && <p>
        <a class="ekf-familia" href="/" title={t('nucleo.familia.titulo')}>
          <img src={logoEkfrase} width={compacto ? 32 : 48} height={compacto ? 24 : 36} alt="" />
          <span>
            {t('nucleo.familia.parte')} <span class="ekf-nome-marca">Ekfrase</span>
          </span>
        </a>
      </p>}
      <nav class="ekf-rodape-links" aria-label={t('nucleo.rodape.nav')}>
        <a href="/#/sobre">{t('nucleo.rodape.sobre')}</a>
        <a href="/#/contato">{t('nucleo.rodape.contato')}</a>
        <a href="/#/privacidade">{t('nucleo.rodape.privacidade')}</a>
        <a href="/#/termos">{t('nucleo.rodape.termos')}</a>
      </nav>
      <p>{t('nucleo.rodape.livre')}</p>
      {LINKS.patreon && (
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
