// SPDX-License-Identifier: MPL-2.0

import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/cormorant-garamond/latin-600-italic.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/atkinson-hyperlegible-next/latin-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-400-italic.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700-italic.css';
import '@ekfrase/nucleo/estilo/tokens.css';
import '@ekfrase/nucleo/estilo/base.css';
import './tema.css';
import './writer.css';
import { aplicarTema, iniciarIdioma, temaAtual } from '@ekfrase/nucleo';
import { chegouAgora } from '@ekfrase/interface';
import { render } from 'preact';
import { App } from './App.tsx';
import { tr } from './textos.ts';

// marca a visita já ao abrir (ir do castelo para cá não conta como chegar por link direto)
chegouAgora();
iniciarIdioma(tr);
aplicarTema(temaAtual());
render(<App />, document.getElementById('app')!);

// o manifest no idioma da pessoa (o build grava um por idioma; ver pwa/plugin.ts): instalar em
// inglês instala com o nome e a descrição em inglês
const manifestNoIdioma = () => {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link) link.href = `./manifest.${tr.idioma()}.webmanifest`;
};
if (import.meta.env.PROD) {
  manifestNoIdioma();
  tr.aoTrocar(manifestNoIdioma);
}

// sem internet depois da primeira visita (pwa/sw.js); só na versão publicada
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).catch(() => undefined);
}
