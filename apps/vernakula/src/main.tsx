// SPDX-License-Identifier: MPL-2.0

import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/cormorant-garamond/latin-600-italic.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/atkinson-hyperlegible-next/latin-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700.css';
import '@ekfrase/nucleo/estilo/tokens.css';
import '@ekfrase/nucleo/estilo/base.css';
import './tema.css';
import './telas/telas.css';
import { render } from 'preact';
import { App } from './App.tsx';
import { aplicarTema, iniciarIdioma, temaAtual } from '@ekfrase/nucleo';
import { capturarLinks, chegouAgora, linksDoApp, migrarHashAntigo } from '@ekfrase/interface';
import { traduzirHashAntigo } from './rotas.ts';
import { tr } from './textos.ts';

// endereço antigo (`/vernakula/#/x`) vira o novo; os links do app trocam de tela sem recarregar
migrarHashAntigo('vernakula', traduzirHashAntigo);
capturarLinks(linksDoApp('vernakula'));
// marca a visita já ao abrir (ir do castelo para cá não conta como chegar por link direto)
chegouAgora();
iniciarIdioma(tr);
aplicarTema(temaAtual());
render(<App />, document.getElementById('app')!);

// O "service worker" guarda a casca do app para abrir sem internet (PWA).
// No servidor de desenvolvimento ele atrapalharia a atualização das telas.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}
