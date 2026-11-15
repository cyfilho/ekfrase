// SPDX-License-Identifier: MPL-2.0

import logoEkfrase from '@ekfrase/nucleo/estilo/img/ekfrase-logo.png';
import { ambienteFechado } from './ambiente.ts';
import { LINKS } from './config.ts';
import type { T } from './tipos.ts';

/**
 * O rodapé de todo app: a marca Ekfrase (dentro de um app ela aparece só aqui), a licença e o Apoiar.
 * No próprio site do Ekfrase (o castelo), `familia={false}` tira o "Um app da família".
 * No ambiente fechado (Writer OS) não há link nenhum: a marca fica como texto, sem Sobre/Contato/Privacidade/
 * Termos nem Apoiar (o que importa vira tela própria no painel do sistema).
 */
export function RodapeEkfrase({ t, compacto = false, familia = true }: { t: T; compacto?: boolean; familia?: boolean }) {
  const fechado = ambienteFechado();
  const marca = (
    <>
      <img src={logoEkfrase} width={compacto ? 32 : 48} height={compacto ? 24 : 36} alt="" />
      <span>
        {t('nucleo.familia.parte')} <span class="ekf-nome-marca">Ekfrase</span>
      </span>
    </>
  );
  return (
    <footer class={compacto ? 'ekf-rodape compacto' : 'ekf-rodape'}>
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
      {!fechado && (
        <nav class="ekf-rodape-links" aria-label={t('nucleo.rodape.nav')}>
          <a href="/#/sobre">{t('nucleo.rodape.sobre')}</a>
          <a href="/#/contato">{t('nucleo.rodape.contato')}</a>
          <a href="/#/privacidade">{t('nucleo.rodape.privacidade')}</a>
          <a href="/#/termos">{t('nucleo.rodape.termos')}</a>
        </nav>
      )}
      <p>{t('nucleo.rodape.livre')}</p>
      {!fechado && LINKS.patreon && (
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
