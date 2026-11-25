// SPDX-License-Identifier: MPL-2.0

import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/atkinson-hyperlegible-next/latin-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700.css';
import '@ekfrase/nucleo/estilo/tokens.css';
import '@ekfrase/nucleo/estilo/base.css';
import '../../../../apps/writer/src/tema.css';
import './gravador.css';
import { aplicarTema, definirTemaPadrao, iniciarIdioma, temaAtual } from '@ekfrase/nucleo';
import { render } from 'preact';
import { App } from './App.tsx';
import { tr } from './textos.ts';

iniciarIdioma(tr);
definirTemaPadrao('escuro'); // pedido do Alcy (20/11/2026): sempre começa no noturno
aplicarTema(temaAtual());
document.title = tr.t('gravador.titulo');
render(<App />, document.getElementById('app')!);
