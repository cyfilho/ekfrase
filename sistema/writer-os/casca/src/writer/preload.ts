// SPDX-License-Identifier: MPL-2.0

/**
 * O PRELOAD: a única coisa entre a página do Writer e o computador. Roda com `sandbox:true` e
 * `contextIsolation:true`: põe em `window.ekfraseCasca` (por `contextBridge`) só as funções da
 * `PonteCasca` (`packages/writer-nucleo/src/casca.ts`), e mais nada. A página não ganha Node,
 * nem `ipcRenderer`, nem `require`. A ponte é a de `ponte-comum.ts`, sobre o IPC.
 *
 * E segura o arrastar: um arquivo solto na janela (fora de um campo de arquivo) não abre nada.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { montarPonte, segurarArrastar, type Transporte } from './ponte-comum.ts';

const transporte: Transporte = {
  pedir: (canal, ...a) => ipcRenderer.invoke(canal, ...a),
  sincrono: (canal, ...a) => ipcRenderer.sendSync(canal, ...a),
  avisar: (canal, ...a) => ipcRenderer.send(canal, ...a),
  ouvir: (canal, f) => void ipcRenderer.on(canal, (_e, ...a: unknown[]) => f(...a)),
};

contextBridge.exposeInMainWorld(
  'ekfraseCasca',
  montarPonte(transporte, {
    versao: (process.argv.find((a) => a.startsWith('--ekfrase-versao=')) ?? '').slice('--ekfrase-versao='.length),
    plataforma: process.platform,
    // o Writer OS (o pendrive): só quando a casca abriu com `--modo-os` dentro da imagem (ou o simulado)
    os: process.argv.includes('--ekfrase-os=1'),
    // as atualizações (DEC-P072): no Writer OS desde a U1 e no computador desde a U2 (o Writer OS sem o Electron, parado,
    // não tem; nem o computador sem um jeito de aplicar: o `npm run casca` sem o simulado)
    atualizacoes: process.argv.includes('--ekfrase-atualizacoes=1'),
  }),
);

segurarArrastar();
