// SPDX-License-Identifier: MPL-2.0

/**
 * Baixa NUM PROCESSO À PARTE (U2, 19/11 noite, 4). O pai só espera mensagens e tem o relógio dele: `parado` ms sem
 * nenhuma notícia do filho, o filho é morto e outro recomeça de onde o `.parte` parou (a retomada por `Range`).
 * `script` é o `baixador.cjs` (o `baixador-filho.ts` empacotado); `execPath` é o Electron/Node que o roda.
 */
import { fork } from 'node:child_process';
import { ErroBaixar, type CodigoBaixar, type OpcoesBaixar, esperar } from './baixar.ts';

export type OpcoesProcesso = Pick<OpcoesBaixar, 'tamanho' | 'agente' | 'gravarACada' | 'aoBaixar' | 'aoTentarDeNovo' | 'aoPasso' | 'sinal'> & {
  /** Sem nenhuma mensagem do filho por tanto tempo, ele é morto (padrão 90 s). */
  mudo?: number;
  tentativas?: number;
};

export async function baixarArquivoEmProcesso(script: string, url: string, destino: string, o: OpcoesProcesso = {}): Promise<void> {
  const tentativas = o.tentativas ?? 5;
  for (let i = 0; ; i++) {
    if (o.sinal?.aborted) throw new ErroBaixar('cancelado');
    const motivo = await uma(script, url, destino, o);
    if (motivo === 'ok') return;
    if (motivo instanceof ErroBaixar) throw motivo;
    if (i + 1 >= tentativas) throw new ErroBaixar('sem-rede', motivo);
    o.aoTentarDeNovo?.(i + 2, 0, motivo);
    o.aoPasso?.('esperar');
    await esperar(Math.min(15_000, 1000 * 2 ** i), o.sinal);
  }
}

/** Um filho: 'ok', um `ErroBaixar` (definitivo) ou o texto de por que morreu (vale tentar de novo). */
function uma(script: string, url: string, destino: string, o: OpcoesProcesso): Promise<'ok' | ErroBaixar | string> {
  return new Promise((resolve) => {
    const filho = fork(script, [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, execPath: process.execPath, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let fim = false;
    const acabar = (r: 'ok' | ErroBaixar | string) => {
      if (fim) return;
      fim = true;
      clearTimeout(mudo);
      o.sinal?.removeEventListener('abort', cancelar);
      filho.kill('SIGKILL');
      resolve(r);
    };
    const cancelar = () => acabar(new ErroBaixar('cancelado'));
    o.sinal?.addEventListener('abort', cancelar);
    const prazo = o.mudo ?? 90_000;
    let mudo = setTimeout(() => acabar('filho-mudo'), prazo);
    const vivo = () => {
      clearTimeout(mudo);
      mudo = setTimeout(() => acabar('filho-mudo'), prazo);
    };
    filho.on('message', (m: { t: string; feito?: number; passo?: never; n?: number; motivo?: string; codigo?: string; detalhe?: string }) => {
      vivo();
      if (m.t === 'baixou') o.aoBaixar?.(m.feito ?? 0, o.tamanho ?? 0);
      else if (m.t === 'passo') o.aoPasso?.(m.passo as never);
      else if (m.t === 'de-novo') o.aoTentarDeNovo?.(m.n ?? 0, m.feito ?? 0, m.motivo ?? '');
      else if (m.t === 'fim') acabar('ok');
      else if (m.t === 'erro') {
        const c = m.codigo as CodigoBaixar | '';
        acabar(c ? new ErroBaixar(c, m.detalhe ?? '') : (m.detalhe ?? 'erro'));
      }
    });
    filho.on('error', (e) => acabar(`filho: ${e.message}`));
    filho.on('exit', (c) => acabar(`filho saiu ${c}`));
    filho.send({ url, destino, tamanho: o.tamanho, agente: o.agente, gravarACada: o.gravarACada });
  });
}
