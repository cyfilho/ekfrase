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
import { capturarLinks, chegouAgora, entradaDoApp, entradaPedida, linksDoApp, migrarHashAntigo, noApp, paginaDoApp, partesDoEndereco } from '@ekfrase/interface';
import { render } from 'preact';
import { App } from './App.tsx';
import { naCasca } from './computador/casca.ts';
import { tr } from './textos.ts';

// marca a visita já ao abrir (ir do castelo para cá não conta como chegar por link direto)
chegouAgora();
// o sinal `?inicio` (o botão do modo jogo) é lido e apagado do endereço
if (!naCasca) entradaPedida();
// dentro da casca a janela abre em app://writer/writer/ (o mesmo caminho do site), mas o app abre direto na estante
if (naCasca && !location.hash && (partesDoEndereco('writer') ?? []).length === 0) history.replaceState(null, '', noApp('writer') + location.search);
// os endereços de antes de 18/11/2026 (`/writer/#/ideias`) viram os novos, sem recarregar
migrarHashAntigo('writer', (resto) => {
  const [tela = ''] = resto.split('/');
  if (tela === 'inicio') return entradaDoApp('writer');
  if (tela === 'computador' || tela === 'os') return paginaDoApp('writer', tela);
  return noApp('writer', resto);
});
// os <a href="/writer/..."> trocam de tela sem recarregar
capturarLinks(linksDoApp('writer'));
iniciarIdioma(tr);
aplicarTema(temaAtual());
render(<App />, document.getElementById('app')!);

// o manifest no idioma da pessoa (o build grava um por idioma; ver pwa/plugin.ts): instalar em
// inglês instala com o nome e a descrição em inglês
const manifestNoIdioma = () => {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link) link.href = `${import.meta.env.BASE_URL}manifest.${tr.idioma()}.webmanifest`;
};
if (import.meta.env.PROD) {
  manifestNoIdioma();
  tr.aoTrocar(manifestNoIdioma);
}

// sem internet depois da primeira visita (pwa/sw.js); só na versão publicada
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).catch(() => undefined);
}
