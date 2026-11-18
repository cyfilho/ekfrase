// SPDX-License-Identifier: MPL-2.0

/**
 * A REDE do Writer OS sem o Electron (parte do Motor): a mesma regra da `rede.ts`, com o `fetch` do Node.
 * A página pede `/api/...` na própria origem (`http://127.0.0.1:<porta>/api/...`) e o serviço leva o pedido ao
 * servidor escolhido. Só sai para a ORIGEM desse servidor (e, enquanto a pessoa confere um endereço novo, para ele);
 * os cookies da conta ficam AQUI, na memória do serviço (a página nunca vê o `Set-Cookie`), como na sessão só da
 * rede do Electron, que também não ia para o disco.
 */
import { destinoDaApi } from './destino.ts';

const VAI = ['accept', 'content-type', 'x-csrf-token', 'accept-language'];
const VOLTA = ['content-type', 'cache-control', 'content-disposition', 'content-length'];

export const origemDe = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
};

/** Os cookies de uma origem (nome → valor). Sem `Domain` nem `Path`: o serviço só fala com um servidor por vez. */
export class Biscoitos {
  private readonly porOrigem = new Map<string, Map<string, string>>();

  guardar(origem: string, setCookie: string[]): void {
    const lista = this.porOrigem.get(origem) ?? new Map<string, string>();
    for (const linha of setCookie) {
      const [par = '', ...atributos] = linha.split(';');
      const i = par.indexOf('=');
      if (i <= 0) continue;
      const nome = par.slice(0, i).trim();
      const valor = par.slice(i + 1).trim();
      const expira = atributos.some((a) => {
        const [k = '', v = ''] = a.split('=').map((x) => x.trim());
        if (k.toLowerCase() === 'max-age') return Number(v) <= 0;
        if (k.toLowerCase() === 'expires') return Date.parse(v) <= Date.now();
        return false;
      });
      if (expira || valor === '' || valor === 'deleted') lista.delete(nome);
      else lista.set(nome, valor);
    }
    this.porOrigem.set(origem, lista);
  }

  cabecalho(origem: string): string {
    return [...(this.porOrigem.get(origem) ?? new Map<string, string>())].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  esquecer(): void {
    this.porOrigem.clear();
  }
}

export interface OpcoesRedeNode {
  base: string;
  aoBloquear?: (url: string) => void;
  /** Para os testes: outro `fetch`. */
  buscar?: typeof fetch;
}

export class RedeNode {
  private base: string;
  private readonly conferindo = new Set<string>();
  private readonly aoBloquear: (url: string) => void;
  private readonly buscar: typeof fetch;
  readonly biscoitos = new Biscoitos();

  constructor(o: OpcoesRedeNode) {
    this.base = o.base;
    this.aoBloquear = o.aoBloquear ?? (() => undefined);
    this.buscar = o.buscar ?? fetch;
  }

  get servidor(): string {
    return this.base;
  }

  usar(base: string): void {
    this.base = base;
  }

  /** Só a origem do servidor escolhido (e a que está sendo conferida). */
  private pode(url: string): boolean {
    const origem = origemDe(url);
    const ok = origem !== null && (origem === origemDe(this.base) || this.conferindo.has(origem));
    if (!ok) this.aoBloquear(url);
    return ok;
  }

  /** Leva um pedido da página ao servidor escolhido; sem rede, FALHA como uma rede de verdade (`Response.error()`). */
  async levar(pedido: Request, caminhoDaApi: string): Promise<Response> {
    const destino = destinoDaApi(caminhoDaApi, this.base);
    const origem = origemDe(destino);
    if (!origem || origem !== origemDe(this.base) || !this.pode(destino)) return Response.error();
    const cabecalhos = new Headers();
    for (const [k, v] of pedido.headers) if (VAI.includes(k.toLowerCase())) cabecalhos.set(k, v);
    const biscoito = this.biscoitos.cabecalho(origem);
    if (biscoito) cabecalhos.set('cookie', biscoito);
    const temCorpo = pedido.method !== 'GET' && pedido.method !== 'HEAD';
    try {
      const r = await this.buscar(destino, {
        method: pedido.method,
        headers: cabecalhos,
        redirect: 'error',
        ...(temCorpo ? { body: await pedido.arrayBuffer() } : {}),
      });
      this.biscoitos.guardar(origem, r.headers.getSetCookie());
      const volta = new Headers();
      for (const [k, v] of r.headers) if (VOLTA.includes(k.toLowerCase())) volta.set(k, v);
      return new Response(await r.arrayBuffer(), { status: r.status, statusText: r.statusText, headers: volta });
    } catch {
      return Response.error();
    }
  }

  /** Confere um endereço novo com a função do app (abre a trava só para ele, só durante a conferência). */
  async conferir<T>(origem: string | null, conferir: (buscar: typeof fetch) => Promise<T>): Promise<T> {
    if (origem) this.conferindo.add(origem);
    try {
      return await conferir((entrada, init) => {
        const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
        if (!this.pode(url)) return Promise.reject(new TypeError('rede'));
        return this.buscar(url, { ...(init ?? {}), credentials: 'omit', redirect: 'error' });
      });
    } finally {
      if (origem) this.conferindo.delete(origem);
    }
  }
}
