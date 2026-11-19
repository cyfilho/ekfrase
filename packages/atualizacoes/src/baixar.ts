// SPDX-License-Identifier: MPL-2.0

/**
 * BAIXAR com retomada (saiu do Gravador em 19/11, U1): a internet caiu, continua de onde parou. O que já veio fica em
 * `<destino>.parte`; a cada queda pede o resto (`Range`). Se o servidor não aceita o pedaço, começa de novo. Só vira
 * `<destino>` quando completo.
 */
import { existsSync, rmSync, statSync } from 'node:fs';
import { open, rename } from 'node:fs/promises';

export type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

export type CodigoBaixar = 'sem-rede' | 'cancelado' | 'sem-espaco';

export class ErroBaixar extends Error {
  readonly codigo: CodigoBaixar;
  readonly detalhe: string;
  constructor(codigo: CodigoBaixar, detalhe = '') {
    super(detalhe ? `${codigo}: ${detalhe}` : codigo);
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}

/** O nome que os apps mandam ao GitHub (ele pede um `user-agent`). */
export const AGENTE = 'Ekfrase';

export const esperar = (ms: number, sinal?: AbortSignal) =>
  new Promise<void>((ok, nao) => {
    if (sinal?.aborted) return nao(new ErroBaixar('cancelado'));
    const t = setTimeout(ok, ms);
    sinal?.addEventListener('abort', () => {
      clearTimeout(t);
      nao(new ErroBaixar('cancelado'));
    });
  });

/** Um arquivo pequeno (o `.sha256`, o `.minisig`, o manifesto), com 4 tentativas. */
export async function baixarTexto(buscar: Buscar, url: string, o: { agente?: string; maximo?: number } = {}): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      // um pedido pequeno que não responde em 30 s é falta de rede (sem isto, uma conexão parada travava a busca)
      const r = await buscar(url, { headers: { 'user-agent': o.agente ?? AGENTE }, signal: AbortSignal.timeout(30_000) });
      if (r.ok) {
        const t = await r.text();
        if (o.maximo && t.length > o.maximo) throw new ErroBaixar('sem-rede', 'grande demais');
        return t;
      }
      if (r.status < 500 && r.status !== 429) throw new ErroBaixar('sem-rede', `HTTP ${r.status}`);
    } catch (e) {
      if (e instanceof ErroBaixar && e.detalhe !== '') throw e;
      if (i >= 3) throw e instanceof ErroBaixar ? e : new ErroBaixar('sem-rede', (e as Error).message);
    }
    if (i >= 3) throw new ErroBaixar('sem-rede');
    await esperar(1000 * (i + 1));
  }
}

export interface OpcoesBaixar {
  tamanho?: number | undefined;
  aoBaixar?: ((feito: number, total: number) => void) | undefined;
  sinal?: AbortSignal | undefined;
  tentativas?: number;
  agente?: string;
  /** Quanto tempo sem receber nada até a conexão cair e ser retomada (padrão 60 s). */
  parado?: number;
}

export async function baixarArquivo(buscar: Buscar, url: string, destino: string, o: OpcoesBaixar = {}): Promise<void> {
  const parte = `${destino}.parte`;
  const tentativas = o.tentativas ?? 8;
  let total = o.tamanho ?? 0;
  for (let i = 0; ; i++) {
    if (o.sinal?.aborted) throw new ErroBaixar('cancelado');
    let inicio = existsSync(parte) ? statSync(parte).size : 0;
    if (total && inicio > total) {
      rmSync(parte, { force: true });
      inicio = 0;
    }
    if (total && inicio === total) break;
    // SILÊNCIO (U1, 19/11): a conexão que fica aberta sem mandar nada por `parado` ms cai e é retomada de onde parou
    // (sem isto, um download parado no meio travava a atualização para sempre)
    const parar = new AbortController();
    const repassar = () => parar.abort();
    o.sinal?.addEventListener('abort', repassar);
    let silencio = setTimeout(() => parar.abort(), o.parado ?? 60_000);
    const vivo = () => {
      clearTimeout(silencio);
      silencio = setTimeout(() => parar.abort(), o.parado ?? 60_000);
    };
    try {
      const r = await buscar(url, { headers: { 'user-agent': o.agente ?? AGENTE, ...(inicio ? { range: `bytes=${inicio}-` } : {}) }, signal: parar.signal });
      vivo();
      if (r.status === 416 && total && inicio === total) break;
      if (r.status !== 200 && r.status !== 206) {
        if (r.status < 500 && r.status !== 429 && r.status !== 416) throw new ErroBaixar('sem-rede', `HTTP ${r.status}`);
        throw new Error(`HTTP ${r.status}`);
      }
      if (r.status === 200) inicio = 0; // o servidor mandou o arquivo inteiro
      const comprimento = Number(r.headers.get('content-length') ?? 0);
      if (!total && comprimento) total = inicio + comprimento;
      const fh = await open(parte, inicio ? 'r+' : 'w');
      try {
        if (!inicio) await fh.truncate(0);
        let pos = inicio;
        if (!r.body) throw new Error('sem corpo');
        for await (const pedaco of r.body as unknown as AsyncIterable<Uint8Array>) {
          vivo();
          await fh.write(pedaco, 0, pedaco.length, pos);
          pos += pedaco.length;
          o.aoBaixar?.(pos, total);
        }
        await fh.sync();
      } finally {
        await fh.close();
      }
      const agora = statSync(parte).size;
      if (!total || agora === total) break;
      throw new Error(`veio ${agora} de ${total}`);
    } catch (e) {
      if (e instanceof ErroBaixar) throw e;
      if (o.sinal?.aborted) throw new ErroBaixar('cancelado');
      if ((e as NodeJS.ErrnoException).code === 'ENOSPC') throw new ErroBaixar('sem-espaco');
      if (i + 1 >= tentativas) throw new ErroBaixar('sem-rede', (e as Error).message);
      await esperar(Math.min(15_000, 1000 * 2 ** i), o.sinal);
    } finally {
      clearTimeout(silencio);
      o.sinal?.removeEventListener('abort', repassar);
    }
  }
  await rename(parte, destino);
}
