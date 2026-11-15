// SPDX-License-Identifier: MPL-2.0

/**
 * O HALL do Writer no modo normal do site (o equivalente ao balcão da torre no modo jogo): para quem
 * já tem onde escrever (conta ou "sem conta"), os três caminhos — escrever na web, no computador, no
 * pendrive —, com as páginas do computador e do pendrive no mesmo visual. Para quem ainda não tem, o
 * hall é a tela inicial (`EntradaApp`, em `App.tsx`), com os mesmos cartões.
 */
import { EntradaApp } from '@ekfrase/interface';
import { naCasca, noOS } from './computador/casca.ts';
import { IconePena } from './icones.tsx';
import logo from './img/logo-writer.png';
import { ir } from './rotas.ts';
import { t, tr } from './textos.ts';
import { avisar } from './ui.tsx';

export function Hall() {
  return (
    <EntradaApp
      t={t}
      tr={tr}
      app="writer"
      semPasseio={noOS}
      {...(naCasca && !noOS ? { aoPasseio: () => avisar(t('writer.passeio.casca')) } : {})}
      logo={logo}
      nome={t('writer.nome')}
      descricao={t('writer.entrada.descricao')}
      podeCriar
      arquivos
      computador={naCasca ? null : { aoEscolher: () => ir({ tela: 'computador' }) }}
      pendrive={naCasca ? null : { aoEscolher: () => ir({ tela: 'os' }) }}
      aoEntrar={() => undefined}
      emCasa={{
        icone: <IconePena tamanho={36} />,
        titulo: t('writer.inicio.web.titulo'),
        texto: t('writer.inicio.web.texto'),
        botao: t('writer.inicio.web.botao'),
        aoEscolher: () => ir({ tela: 'estante' }),
      }}
    />
  );
}
