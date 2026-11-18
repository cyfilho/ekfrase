// SPDX-License-Identifier: MPL-2.0

/**
 * A PÁGINA DO WRITER OS (`ekfrase.com/writer/os`; PLANO §8b): "Baixar o Gravador" (o .exe
 * portátil e o AppImage do Release mais novo do Writer OS, no repositório público), o que ele faz em
 * três passos, o aviso do SmartScreen (sem certificado: DEC-P064) e, para quem prefere o Rufus ou o
 * Etcher, o GRAVAR.md. Abre também sem conta. No mesmo visual da tela inicial (`PaginaApp`) e ligada a
 * partir do hall (`/writer/`).
 */
import { LINKS, PaginaApp, entradaDoApp } from '@ekfrase/interface';
import { useEffect, useRef } from 'preact/hooks';
import logo from '../img/logo-writer.png';
import { t, tr } from '../textos.ts';
import { enderecoDe, LISTA_DE_RELEASES, useRelease } from './releases.ts';

const GRAVAR_MD = `${LINKS.codigo}/blob/main/sistema/writer-os/imagem/GRAVAR.md`;

export function BaixarOS() {
  const rel = useRelease('writer-os-v', ['Ekfrase-Gravador.exe', 'Ekfrase-Gravador.AppImage']);
  const naoPublicado = rel === null;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLElement>('h1')?.focus(), []);
  return (
    <div ref={ref}>
      <PaginaApp t={t} tr={tr} app="writer" logo={logo} titulo={t('writer.os-pagina.titulo')} dataTeste="tela-baixar-os">
        <section class="ekf-pagina">
          <p>{t('writer.os-pagina.texto')}</p>
          <ol>
            <li>{t('writer.os-pagina.passo-1')}</li>
            <li>{t('writer.os-pagina.passo-2')}</li>
            <li>{t('writer.os-pagina.passo-3')}</li>
          </ol>
          {naoPublicado ? (
            <p class="ekf-aviso" data-teste="os-nao-publicado">
              {t('writer.os-pagina.nao-publicado')}
            </p>
          ) : (
            <>
              <div class="ekf-linha">
                <a class="ekf-botao principal" href={enderecoDe(rel, 'Ekfrase-Gravador.exe')} data-teste="baixar-gravador-windows">
                  {t('writer.os-pagina.windows')}
                </a>
                <a class="ekf-botao" href={enderecoDe(rel, 'Ekfrase-Gravador.AppImage')} data-teste="baixar-gravador-linux">
                  {t('writer.os-pagina.linux')}
                </a>
              </div>
              {rel && rel !== 'sem-resposta' && <p class="ekf-nota">{t('writer.os-pagina.versao', { versao: rel.versao })}</p>}
            </>
          )}
        </section>
        <section class="ekf-pagina">
          <h2>{t('writer.os-pagina.midias.titulo')}</h2>
          <p>{t('writer.os-pagina.midias.texto')}</p>
          <h2>{t('writer.baixar.windows.titulo')}</h2>
          <p>{t('writer.os-pagina.smartscreen')}</p>
          <ol>
            <li>{t('writer.baixar.windows.1')}</li>
            <li>{t('writer.baixar.windows.2')}</li>
            <li>{t('writer.baixar.windows.3')}</li>
          </ol>
          <p>{t('writer.os-pagina.permissao')}</p>
        </section>
        <section class="ekf-pagina">
          <h2>{t('writer.os-pagina.rufus.titulo')}</h2>
          <p>
            {t('writer.os-pagina.rufus.texto')}{' '}
            <a href={GRAVAR_MD} rel="noopener" data-teste="link-gravar-md">
              {t('writer.os-pagina.rufus.link')}
            </a>
          </p>
          <p>
            <a href={LISTA_DE_RELEASES} rel="noopener">
              {t('writer.os-pagina.todas')}
            </a>
          </p>
        </section>
        <p class="ekf-voltar">
          <a class="ekf-botao" href={entradaDoApp('writer')} data-teste="baixar-os-voltar">
            {t('writer.inicio.voltar')}
          </a>
        </p>
      </PaginaApp>
    </div>
  );
}
