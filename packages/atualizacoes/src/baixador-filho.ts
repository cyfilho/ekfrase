// SPDX-License-Identifier: MPL-2.0

/**
 * O PROCESSO FILHO que baixa (U2, 19/11 noite, 4): roda com `ELECTRON_RUN_AS_NODE=1`, recebe UM pedido e conta o que
 * houve por mensagens. Existe porque, no Writer OS no QEMU, o download dentro do processo principal da casca parava
 * (o laço de eventos inteiro, intermitente); aqui quem trava é só este processo, e o pai o mata e recomeça.
 */
import { ErroBaixar, baixarArquivo } from './baixar.ts';

type Pedido = { url: string; destino: string; tamanho?: number; agente?: string; gravarACada?: number; parado?: number };

const enviar = (m: unknown) => process.send?.(m);

process.once('message', async (p: Pedido) => {
  try {
    await baixarArquivo(fetch, p.url, p.destino, {
      ...(p.tamanho ? { tamanho: p.tamanho } : {}),
      ...(p.agente ? { agente: p.agente } : {}),
      ...(p.gravarACada ? { gravarACada: p.gravarACada } : {}),
      ...(p.parado ? { parado: p.parado } : {}),
      aoBaixar: (feito) => enviar({ t: 'baixou', feito }),
      aoPasso: (passo) => enviar({ t: 'passo', passo }),
      aoTentarDeNovo: (n, feito, motivo) => enviar({ t: 'de-novo', n, feito, motivo }),
    });
    enviar({ t: 'fim' });
    process.exit(0);
  } catch (e) {
    enviar({ t: 'erro', codigo: e instanceof ErroBaixar ? e.codigo : '', detalhe: (e as Error).message });
    process.exit(1);
  }
});
