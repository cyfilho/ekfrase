// SPDX-License-Identifier: MPL-2.0

/**
 * O PADRÃO DE ENDEREÇOS do Ekfrase (DEC-P070, 18/11/2026; explicado para pessoas em `docs/ENDERECOS.md`).
 * Todo link da família sai daqui: nenhum app monta endereço à mão.
 *
 * MODO NORMAL = caminho limpo, sem `#`:
 *   ekfrase.com/                       a página inicial
 *   ekfrase.com/<página>               página do site (apps, conta, equipe, sobre, contato, privacidade, termos,
 *                                      redefinir/<código> e cadastro/<código>: os links dos e-mails da conta…)
 *   ekfrase.com/<app>/                 a entrada do app (o "hall" do modo normal: as formas de usar)
 *   ekfrase.com/<app>/<página>         página pública do app, fora dele (computador, os, convite, redefinir…)
 *   ekfrase.com/<app>/app              o app aberto (a tela principal)
 *   ekfrase.com/<app>/app/<tela>/<id>  uma tela dentro do app
 *
 * MODO JOGO = o castelo, sempre na raiz e sempre depois do `#`:
 *   ekfrase.com/#/patio                o pátio, os terrenos do castelo (a página inicial do modo jogo)
 *   ekfrase.com/#/castelo              o Grande Hall do castelo central (DEC-P073)
 *   ekfrase.com/#/castelo/<área>       o corredor de uma área (ala) do castelo; `/#/castelo/retratos` a Sala dos Retratos
 *   ekfrase.com/#/<app>                o hall da torre do app
 *   ekfrase.com/#/<app>/app            a sala do app
 *
 * Regra de bolso: tem `#` = modo jogo; não tem = modo normal. Endereços antigos (`/<app>/#/x`, `/#/torre/x`,
 * `/#/conta`…) continuam valendo: viram os novos sozinhos, sem recarregar (`migrarHashAntigo`, castelo).
 */

/** As páginas do site na raiz (modo normal). Nenhum app pode ter um destes nomes como id. */
export const PAGINAS_DO_SITE = ['apps', 'conta', 'equipe', 'feedback', 'sobre', 'contato', 'privacidade', 'termos', 'redefinir', 'cadastro'] as const;

/** Páginas do site (modo normal). */
export const site = {
  inicio: '/',
  apps: '/apps',
  conta: '/conta',
  inventario: '/conta/inventario',
  equipe: '/equipe',
  pedidos: '/equipe/pedidos',
  escolas: '/equipe/escolas',
  pagina: (p: string): string => `/${p.replace(/^\/+/, '')}`,
};

/** O castelo (modo jogo). */
export const jogo = {
  patio: '/#/patio',
  /** O castelo central: sem nada, o Grande Hall; com uma área (`letras`, `mundos`…) ou `retratos`, a cena dela. */
  castelo: (lugar = ''): string => `/#/castelo${lugar ? `/${lugar}` : ''}`,
  hall: (app: string): string => `/#/${app}`,
  sala: (app: string): string => `/#/${app}/app`,
};

/** `ekfrase.com/<app>/`: a entrada do app. */
export const entradaDoApp = (app: string): string => `/${app}/`;
/** `ekfrase.com/<app>/<página>`: página pública do app, fora dele. */
export const paginaDoApp = (app: string, pagina: string): string => `/${app}/${pagina.replace(/^\/+/, '')}`;
/** `ekfrase.com/<app>/app[/<tela>]`: dentro do app. */
export const noApp = (app: string, tela = ''): string => {
  const t = tela.replace(/^\/+|\/+$/g, '');
  return `/${app}/app${t ? `/${t}` : ''}`;
};

/**
 * O que vem depois de `/<app>/` no endereço, em partes: `[]` = a entrada, `['computador']` = uma página pública,
 * `['app']` = o app, `['app', 'historia', '<id>']` = uma tela. `null` = o endereço não é deste app.
 */
export function partesDoEndereco(app: string, caminho: string = location.pathname): string[] | null {
  const base = `/${app}`;
  if (caminho !== base && !caminho.startsWith(`${base}/`)) return null;
  return caminho
    .slice(base.length)
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
}

/** As partes da tela dentro do app (depois de `/<app>/app/`), ou `null` se não está dentro do app. */
export function telaNoApp(app: string, caminho: string = location.pathname): string[] | null {
  const p = partesDoEndereco(app, caminho);
  return p && p[0] === 'app' ? p.slice(1) : null;
}

const EVENTO = 'ekfrase:endereco';

/**
 * Troca de tela sem recarregar a página (o botão Voltar do navegador continua funcionando). Endereço de fora da
 * página atual (outro app, outro site) abre de verdade.
 */
export function irPara(url: string, o: { substituir?: boolean; mesmaPagina?: (u: URL) => boolean } = {}): void {
  const u = new URL(url, location.href);
  if (u.origin !== location.origin || (o.mesmaPagina && !o.mesmaPagina(u))) return void location.assign(u.href);
  const novo = u.pathname + u.search + u.hash;
  if (novo === location.pathname + location.search + location.hash) return;
  if (o.substituir) history.replaceState(history.state, '', novo);
  else history.pushState(null, '', novo);
  avisarMudanca();
}

/** Avisa quem escuta o endereço (depois de um `history.replaceState` feito à mão). */
export function avisarMudanca(): void {
  dispatchEvent(new Event(EVENTO));
}

/** Chama `f` a cada troca de endereço (link, `irPara`, Voltar e Avançar do navegador, `#` do castelo). */
export function aoMudarEndereco(f: () => void): () => void {
  addEventListener(EVENTO, f);
  addEventListener('popstate', f);
  addEventListener('hashchange', f);
  return () => {
    removeEventListener(EVENTO, f);
    removeEventListener('popstate', f);
    removeEventListener('hashchange', f);
  };
}

/**
 * Os `<a href>` desta página trocam de tela sem recarregar. `daPagina(u)` diz quais endereços são desta página
 * (num app: tudo que começa com `/<app>/`). Clique com Ctrl, Shift, botão do meio, `target` ou `download` segue
 * o navegador (abre em outra aba, baixa).
 */
export function capturarLinks(daPagina: (u: URL) => boolean): () => void {
  const clique = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || !daPagina(u)) return;
    e.preventDefault();
    irPara(u.href);
  };
  document.addEventListener('click', clique);
  return () => document.removeEventListener('click', clique);
}

/** Um app: os links que começam com `/<app>/` são dele. */
export const linksDoApp = (app: string) => (u: URL): boolean => partesDoEndereco(app, u.pathname) !== null && !u.hash;

/**
 * Endereço antigo do app (`/<app>/#/x`, de antes de 18/11/2026: e-mails, favoritos, links salvos) vira o novo no
 * lugar, sem recarregar. `traduzir('x/y')` devolve o endereço novo; por padrão, `/<app>/app/x/y` (e `#/` = o app).
 */
export function migrarHashAntigo(app: string, traduzir: (resto: string) => string = (r) => noApp(app, r)): void {
  if (partesDoEndereco(app) === null || !location.hash.startsWith('#/')) return;
  const resto = location.hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  history.replaceState(history.state, '', traduzir(resto) + location.search);
}
