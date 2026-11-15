// SPDX-License-Identifier: MPL-2.0
// A ponte da página do Gravador (`window.gravador`): só estas chamadas; a página não tem Node.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { PonteGravador, Progresso } from './ponte.ts';

const ponte: PonteGravador = {
  estado: () => ipcRenderer.invoke('gravador:estado'),
  discos: () => ipcRenderer.invoke('gravador:discos'),
  lancamento: () => ipcRenderer.invoke('gravador:lancamento'),
  escolherImagem: () => ipcRenderer.invoke('gravador:escolher-imagem'),
  gravar: (p) => ipcRenderer.invoke('gravador:gravar', p),
  cancelar: () => ipcRenderer.invoke('gravador:cancelar'),
  ejetar: (id) => ipcRenderer.invoke('gravador:ejetar', id),
  aoProgresso(f) {
    const h = (_e: IpcRendererEvent, p: Progresso) => f(p);
    ipcRenderer.on('gravador:progresso', h);
    return () => ipcRenderer.removeListener('gravador:progresso', h);
  },
  aoTentarFechar(f) {
    const h = () => f();
    ipcRenderer.on('gravador:tentou-fechar', h);
    return () => ipcRenderer.removeListener('gravador:tentou-fechar', h);
  },
};

contextBridge.exposeInMainWorld('gravador', ponte);

// arrastar um arquivo para a janela não navega
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
