// SPDX-License-Identifier: MPL-2.0

/**
 * A moldura das páginas de um app que ficam fora do app em si (o hall, o download do app do
 * computador, o Writer OS…): o topo do Ekfrase, o app em poucas palavras e o rodapé, igual à tela
 * inicial (`EntradaApp`). O conteúdo da página vai em `children`; use `.ekf-pagina` para texto corrido
 * e `.ekf-formas`/`.ekf-forma` para cartões.
 */
import type { Tradutor } from '@ekfrase/nucleo';
import type { ComponentChildren } from 'preact';
import { jogo } from './enderecos.ts';
import { RodapeEkfrase } from './Rodape.tsx';
import { TopoEkfrase } from './Topo.tsx';
import type { T } from './tipos.ts';

export interface PaginaAppProps {
  t: T;
  tr: Tradutor;
  app: string;
  logo: string;
  /** O título da página (o `h1`). */
  titulo: string;
  descricao?: string;
  aoTrocarIdioma?: (codigo: string) => void;
  /** Para o teste achar a página. */
  dataTeste?: string;
  children: ComponentChildren;
}

export function PaginaApp(p: PaginaAppProps) {
  return (
    <div class="ekf-entrada-app" data-teste={p.dataTeste}>
      <TopoEkfrase t={p.t} tr={p.tr} app={p.app} passeio={jogo.hall(p.app)} {...(p.aoTrocarIdioma ? { aoTrocarIdioma: p.aoTrocarIdioma } : {})} />
      <main class="ekf-entrada-miolo">
        <section class="ekf-heroi">
          <img class="ekf-heroi-logo" src={p.logo} width={96} height={96} alt="" />
          <div>
            <h1 tabIndex={-1} data-foco-inicial>
              {p.titulo}
            </h1>
            {p.descricao && <p>{p.descricao}</p>}
          </div>
        </section>
        {p.children}
      </main>
      <RodapeEkfrase t={p.t} completo />
    </div>
  );
}
