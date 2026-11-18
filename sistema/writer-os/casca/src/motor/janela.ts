// SPDX-License-Identifier: MPL-2.0

/**
 * A JANELA TRAVADA (parte do Motor; PLANO §7, linha "navegador", que vale também no computador):
 *
 * - `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`: a página não tem Node; só o
 *   que o preload põe nela com `contextBridge`;
 * - carrega SÓ `app://<host>/` (os arquivos empacotados do app; nunca uma página da internet). O que não é arquivo
 *   e não tem extensão (as telas do app: `/writer/app/ideias`) recebe o `index.html`, como o site;
 * - `will-navigate`, `will-redirect` e `setWindowOpenHandler` bloqueiam tudo (nenhum link sai,
 *   nenhuma janela nova abre, nem `window.open`, nem link externo);
 * - DevTools desligado no build (`devTools:false`); no desenvolvimento, só com EKFRASE_CASCA_DEVTOOLS=1;
 * - sem menu (sem Ctrl+R, F5, F12, Ctrl+Shift+I…) e as teclas do Chromium que sobram são
 *   engolidas antes de chegar a ele (`before-input-event`);
 * - arrastar um arquivo para a janela não navega (`navigateOnDragDrop:false`, o preload segura o
 *   `drop` fora dos campos que aceitam arquivo, e `will-navigate` bloqueia o `file://`);
 * - nenhuma permissão (câmera, microfone, localização, notificações…), menos as da área de transferência
 *   e da tela cheia; nenhum `<webview>`.
 *
 * Tudo o que for bloqueado fica anotado em `travas.bloqueado` (os testes leem pelo processo principal).
 */
import { BrowserWindow, Menu, app, protocol, type Session, type WebContents } from 'electron';
import { anotar, arquivoDoApp, CSP } from './servir.ts';
import { teclaProibida } from './teclas.ts';

export { teclaProibida } from './teclas.ts';

export { anotar, CSP, travas, type Bloqueio } from './servir.ts';

/** Precisa vir ANTES de `app.whenReady()`: o `app://` é um esquema "de verdade" (origem, fetch, cookies). */
export function registrarEsquema(esquema = 'app'): void {
  protocol.registerSchemesAsPrivileged([{ scheme: esquema, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);
}

export interface OpcoesServir {
  sessao: Session;
  esquema?: string;
  /** `writer` → `app://writer/`. */
  host: string;
  /** A pasta com os arquivos do app (o build do Vite). */
  pasta: string;
  /** Prefixo da `base` do build (`/writer/`): `app://writer/writer/x.js` → `<pasta>/x.js`. */
  base?: string;
  /** Pedidos `app://<host>/api/...`: quem leva ao servidor (ver `rede.ts`). */
  api?: (pedido: Request, caminho: string) => Promise<Response>;
}

export interface OpcoesJanela {
  sessao: Session;
  esquema?: string;
  host: string;
  /** O caminho em que a janela abre (padrão `/`; o Writer abre em `/writer/`, o mesmo endereço do site). */
  inicio?: string;
  preload: string;
  titulo: string;
  icone?: string;
  /** DevTools (só no desenvolvimento, e só se pedido). */
  devTools?: boolean;
  largura?: number;
  altura?: number;
  /** Vão para o `process.argv` do preload (a versão da casca). */
  argumentos?: string[];
  /** O Writer OS: sem moldura e em tela cheia (o Cage só mostra esta janela). */
  telaCheia?: boolean;
}

/** Serve os arquivos do app pelo `app://` (nunca fora da pasta; o que não existe = 404). */
export function servirApp(o: OpcoesServir): void {
  const esquema = o.esquema ?? 'app';
  o.sessao.protocol.handle(esquema, async (pedido) => {
    const u = new URL(pedido.url);
    if (u.host !== o.host) return new Response('', { status: 404 });
    const caminho = decodeURIComponent(u.pathname);
    if (o.api && caminho.startsWith('/api/')) return o.api(pedido, caminho.slice('/api/'.length));
    const a = await arquivoDoApp(o.pasta, o.base ?? '/', caminho);
    if (!a) return new Response('', { status: 404 });
    return new Response(new Uint8Array(a.corpo), { status: 200, headers: { 'content-type': a.tipo, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' } });
  });
}

/** A URL inicial da janela (`inicio` = o caminho dentro do host: o do Writer é `/writer/`, igual ao do site). */
export const urlDoApp = (host: string, esquema = 'app', inicio = '/'): string => `${esquema}://${host}${inicio.startsWith('/') ? inicio : `/${inicio}`}`;

/** O endereço é do próprio app (mesma origem `app://host`)? */
export function ehDoApp(url: string, host: string, esquema = 'app'): boolean {
  try {
    const u = new URL(url);
    return u.protocol === `${esquema}:` && u.host === host;
  } catch {
    return false;
  }
}

/** Trava um `webContents` (a janela, e qualquer outro que apareça). */
export function travarConteudo(wc: WebContents, devTools = false): void {
  // navegar: NUNCA (as telas do app trocam de endereço por `history.pushState`, que não navega; recarregar é só pelo processo principal)
  const naoNavegar = (e: { preventDefault(): void }, url: string) => {
    e.preventDefault();
    anotar({ tipo: 'navegar', alvo: url });
  };
  wc.on('will-navigate', naoNavegar);
  wc.on('will-redirect', naoNavegar);
  wc.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame) {
      e.preventDefault();
      anotar({ tipo: 'navegar', alvo: e.url });
    }
  });
  // nenhuma janela nova (window.open, target=_blank, Shift+clique…): e nada abre "lá fora"
  wc.setWindowOpenHandler(({ url }) => {
    anotar({ tipo: 'janela', alvo: url });
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (e) => {
    e.preventDefault();
    anotar({ tipo: 'webview', alvo: '' });
  });
  // as teclas do Chromium
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown' && i.type !== 'rawKeyDown') return;
    if (teclaProibida(i)) {
      e.preventDefault();
      anotar({ tipo: 'tecla', alvo: `${i.control ? 'Ctrl+' : ''}${i.shift ? 'Shift+' : ''}${i.alt ? 'Alt+' : ''}${i.key}` });
    }
  });
  if (!devTools) {
    wc.on('devtools-opened', () => {
      anotar({ tipo: 'devtools', alvo: '' });
      wc.closeDevTools();
    });
  }
}

/** As permissões da sessão da página: quase nada. */
export function travarPermissoes(sessao: Session): void {
  const pode = new Set(['clipboard-sanitized-write', 'fullscreen']);
  sessao.setPermissionRequestHandler((_wc, permissao, responder) => {
    const ok = pode.has(permissao);
    if (!ok) anotar({ tipo: 'permissao', alvo: permissao });
    responder(ok);
  });
  sessao.setPermissionCheckHandler((_wc, permissao) => pode.has(permissao));
  // o corretor do Chromium baixaria dicionários da internet (no Linux): sem isso
  sessao.setSpellCheckerDictionaryDownloadURL('https://0.0.0.0/');
}

/** Liga as travas que valem para o app inteiro (qualquer `webContents` que apareça). */
export function travarApp(devTools = false): void {
  Menu.setApplicationMenu(null);
  app.on('web-contents-created', (_e, wc) => travarConteudo(wc, devTools));
}

/** Cria a janela travada do app. */
export function criarJanela(o: OpcoesJanela): BrowserWindow {
  const esquema = o.esquema ?? 'app';
  const win = new BrowserWindow({
    title: o.titulo,
    width: o.largura ?? 1280,
    height: o.altura ?? 840,
    minWidth: 360,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1d2433',
    ...(o.icone ? { icon: o.icone } : {}),
    ...(o.telaCheia ? { frame: false, fullscreen: true } : {}),
    webPreferences: {
      preload: o.preload,
      session: o.sessao,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: !!o.devTools,
      additionalArguments: o.argumentos ?? [],
      spellcheck: true,
      enableWebSQL: false,
      safeDialogs: true,
      disableDialogs: false,
    },
  });
  win.setMenu(null);
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  void win.loadURL(urlDoApp(o.host, esquema, o.inicio));
  return win;
}
