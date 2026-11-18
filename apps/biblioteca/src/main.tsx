// SPDX-License-Identifier: MPL-2.0

import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/cormorant-garamond/latin-600-italic.css';
import '@fontsource/cinzel/latin-700.css';
// o grego (a Poética): a Cormorant não tem; o navegador só baixa quando aparece grego na página
import '@fontsource/gfs-didot/greek-400.css';
import '@fontsource/gfs-didot/greek-ext-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700.css';
import '@ekfrase/nucleo/estilo/tokens.css';
import '@ekfrase/nucleo/estilo/base.css';
import './tema.css';
import './biblioteca.css';
import { aplicarTema, iniciarIdioma, temaAtual } from '@ekfrase/nucleo';
import { capturarLinks, chegouAgora, linksDoApp, migrarHashAntigo } from '@ekfrase/interface';
import { render } from 'preact';
import { App } from './App.tsx';
import { tr } from './textos.ts';

// marca a visita já ao abrir (ir do castelo para cá não conta como chegar por link direto)
migrarHashAntigo('biblioteca');
capturarLinks(linksDoApp('biblioteca'));
chegouAgora();
iniciarIdioma(tr);
aplicarTema(temaAtual());
render(<App />, document.getElementById('app')!);
