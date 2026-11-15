// SPDX-License-Identifier: MPL-2.0

/**
 * A REDE da casca (parte do Motor). A página NUNCA sai para a internet: ela pede `/api/...` na
 * própria origem (`app://writer/api/...`, como no site pede `ekfrase.com/api/...`), e o processo
 * principal leva o pedido ao servidor escolhido, por uma sessão só dele. Por isso não há CORS (o
 * pedido não sai da página) e o "Servidor: Outro…" funciona no computador.
 *
 * Duas travas (PLANO §7): a sessão da página só deixa passar os esquemas internos (`app:`, `data:`,
 * `blob:`); a sessão da rede só deixa sair para a ORIGEM do servidor escolhido (e, enquanto a
 * pessoa confere um endereço novo, para ele). Todo o resto é cancelado.
 */
import type { Session } from 'electron';
import { destinoDaApi } from './destino.ts';

/** Os cabeçalhos que vão da página ao servidor (o resto fica). */
const VAI = ['accept', 'content-type', 'x-csrf-token', 'accept-language'];
/** Os que voltam (o `Set-Cookie` fica na sessão da rede: a página nunca vê o cookie). */
const VOLTA = ['content-type', 'cache-control', 'content-disposition', 'content-length'];

/** Os esquemas que a página pode pedir. */
export const ESQUEMAS_DA_PAGINA = ['app:', 'data:', 'blob:'];

export const origemDe = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
};

export interface OpcoesRede {
  /** A sessão SÓ da rede (não é a da página). */
  sessao: Session;
  /** A base da API (`https://ekfrase.com/api/v1/`). */
  base: string;
  /** Avisa as tentativas bloqueadas (os testes conferem). */
  aoBloquear?: (url: string, onde: 'pagina' | 'rede') => void;
}

export class Rede {
  private base: string;
  private readonly sessao: Session;
  private readonly conferindo = new Set<string>();
  private readonly aoBloquear: (url: string, onde: 'pagina' | 'rede') => void;

  constructor(o: OpcoesRede) {
    this.base = o.base;
    this.sessao = o.sessao;
    this.aoBloquear = o.aoBloquear ?? (() => undefined);
    // a sessão da rede: só a origem do servidor escolhido (e a que está sendo conferida)
    this.sessao.webRequest.onBeforeRequest((d, responder) => {
      const origem = origemDe(d.url);
      const pode = origem !== null && (origem === origemDe(this.base) || this.conferindo.has(origem));
      if (!pode) this.aoBloquear(d.url, 'rede');
      responder({ cancel: !pode });
    });
    this.sessao.setPermissionRequestHandler((_w, _p, responder) => responder(false));
  }

  /** A base da API em uso. */
  get servidor(): string {
    return this.base;
  }

  usar(base: string): void {
    this.base = base;
  }

  /** A sessão da PÁGINA: nada sai para a internet; só os esquemas internos. */
  travarPagina(sessao: Session): void {
    sessao.webRequest.onBeforeRequest((d, responder) => {
      const pode = ESQUEMAS_DA_PAGINA.some((e) => d.url.startsWith(e)) || d.url.startsWith('devtools:');
      if (!pode) this.aoBloquear(d.url, 'pagina');
      responder({ cancel: !pode });
    });
  }

  /**
   * Leva um pedido da página (`app://writer/api/v1/...`) ao servidor escolhido. Sem rede (ou com o
   * servidor fora), o pedido FALHA como falha uma rede de verdade: o `ponte.ts` da página entende `rede`.
   */
  async levar(pedido: Request, caminhoDaApi: string): Promise<Response> {
    const destino = destinoDaApi(caminhoDaApi, this.base);
    if (origemDe(destino) !== origemDe(this.base)) return Response.error();
    const cabecalhos = new Headers();
    for (const [k, v] of pedido.headers) if (VAI.includes(k.toLowerCase())) cabecalhos.set(k, v);
    const temCorpo = pedido.method !== 'GET' && pedido.method !== 'HEAD';
    try {
      const r = await this.sessao.fetch(destino, {
        method: pedido.method,
        headers: cabecalhos,
        credentials: 'include',
        redirect: 'error',
        ...(temCorpo ? { body: await pedido.arrayBuffer() } : {}),
      });
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
      return await conferir((entrada, init) => this.sessao.fetch(entrada as string, { ...(init ?? {}), credentials: 'omit', redirect: 'error' }));
    } finally {
      if (origem) this.conferindo.delete(origem);
    }
  }
}
