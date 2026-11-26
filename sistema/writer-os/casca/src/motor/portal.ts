// SPDX-License-Identifier: MPL-2.0

/**
 * A JANELA DO PORTAL CATIVO (parte do Motor; PLANO §7, "Portal cativo", W4). O Wi-Fi do hotel ou do café pede login
 * numa página: é a ÚNICA vez em que o Writer OS abre uma página da internet, e assim:
 *
 * - uma sessão só dela, em memória (`session.fromPartition` sem `persist:`: some quando o programa fecha), sem preload,
 *   `sandbox`, `contextIsolation`, sem DevTools, sem caixas de diálogo, nenhuma permissão, nenhum download;
 * - abre o endereço do teste de conectividade (`Sistema.enderecoDoTeste()`); os sites da PRIMEIRA cadeia de
 *   redirecionamentos (até a 1ª página carregar) viram os sites do portal, e depois a página principal e os quadros só
 *   navegam dentro deles (`webRequest.onBeforeRequest` + a exceção da `janela.ts`, `permitirNavegacao`, pela sessão);
 *   janela nova de um site do portal abre na mesma janela, as outras não abrem; as regras são as de `portal-regras.ts`;
 * - as outras travas do `travarApp` valem igual (teclas do Chromium, DevTools, `<webview>`); certificado inválido
 *   continua recusado (nenhum `certificate-error` aceita);
 * - fecha sozinha quando a conectividade vira `internet` (confere a cada 3 s), com Esc, ou em 10 min.
 */
import { BrowserWindow, session, type Session } from 'electron';
import { anotar, permitirNavegacao } from './janela.ts';
import { abrirNaMesma, deixarPassar, PORTAL_CONFERIR_MS, PORTAL_MAXIMO_MS, type Conectividade, type TipoPedido } from './portal-regras.ts';

/** A sessão da janela do portal (em memória: sem `persist:`). */
export const PARTICAO_DO_PORTAL = 'ekfrase-portal';

export interface OpcoesPortal {
  /** O endereço `http` do teste de conectividade. */
  endereco: string;
  /** O que o sistema diz agora (`Sistema.conectividade`). */
  conectividade: () => Promise<Conectividade>;
  /** A janela do app (o foco volta para ela ao fechar). */
  pai?: BrowserWindow | null;
  /** No Writer OS de verdade: em tela cheia (o Cage). */
  telaCheia?: boolean;
}

/** O que a janela aberta aprendeu: os sites do portal e se a primeira cadeia ainda não terminou. */
interface Aberta {
  janela: BrowserWindow;
  sites: Set<string>;
  aprendendo: boolean;
  fim: Promise<Conectividade>;
}

let aberta: Aberta | null = null;
let sessaoPronta: Session | null = null;

const tipoDoPedido = (t: string): TipoPedido => (t === 'mainFrame' ? 'principal' : t === 'subFrame' ? 'quadro' : 'outro');

/** A sessão do portal, travada uma vez só (as regras leem a janela aberta; sem janela, nada sai). */
function sessaoDoPortal(): Session {
  if (sessaoPronta) return sessaoPronta;
  const s = session.fromPartition(PARTICAO_DO_PORTAL);
  s.webRequest.onBeforeRequest((d, responder) => {
    const ok = !!aberta && deixarPassar(d.url, tipoDoPedido(d.resourceType), aberta.sites, aberta.aprendendo);
    if (!ok) anotar({ tipo: 'portal', alvo: d.url });
    responder({ cancel: !ok });
  });
  permitirNavegacao(s, {
    navegar: (url, principal) => !!aberta && deixarPassar(url, principal ? 'principal' : 'quadro', aberta.sites, aberta.aprendendo),
    janelaNova: (url) => {
      if (aberta && abrirNaMesma(url, aberta.sites)) void aberta.janela.webContents.loadURL(url).catch(() => undefined);
    },
  });
  s.setPermissionRequestHandler((_wc, permissao, responder) => {
    anotar({ tipo: 'permissao', alvo: permissao });
    responder(false);
  });
  s.setPermissionCheckHandler(() => false);
  s.on('will-download', (e) => e.preventDefault());
  s.setSpellCheckerEnabled(false);
  sessaoPronta = s;
  return s;
}

/** A janela do portal está aberta? (o agente de teste e os testes). */
export const portalAberto = (): boolean => !!aberta;

/**
 * Abre a janela do portal (uma só: pedida de novo, ela vem para a frente) e devolve a conectividade quando ela fecha.
 */
export function abrirPortal(o: OpcoesPortal): Promise<Conectividade> {
  if (aberta) {
    aberta.janela.focus();
    return aberta.fim;
  }
  const sessao = sessaoDoPortal();
  const janela = new BrowserWindow({
    title: '',
    width: 1000,
    height: 760,
    minWidth: 360,
    minHeight: 480,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    ...(o.telaCheia ? { fullscreen: true } : {}),
    webPreferences: {
      session: sessao,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: false,
      spellcheck: false,
      enableWebSQL: false,
      safeDialogs: true,
      // alert/confirm abririam uma caixa do sistema: no Writer OS, nada do sistema aparece
      disableDialogs: true,
    },
  });
  janela.setMenu(null);
  janela.removeMenu();

  let terminar: (c: Conectividade) => void = () => undefined;
  const fim = new Promise<Conectividade>((ok) => (terminar = ok));
  const esta: Aberta = { janela, sites: new Set(), aprendendo: true, fim };
  aberta = esta;

  let fechando = false;
  const fechar = async (c: Conectividade | null) => {
    if (fechando) return;
    fechando = true;
    clearInterval(conferir);
    clearTimeout(prazo);
    if (aberta === esta) aberta = null;
    if (!janela.isDestroyed()) janela.destroy();
    if (o.pai && !o.pai.isDestroyed()) {
      o.pai.focus();
      o.pai.webContents.focus();
    }
    // fechou com Esc ou no prazo: pergunta de novo (a pessoa pode ter entrado agora mesmo)
    terminar(c ?? (await o.conectividade().catch((): Conectividade => 'desconhecida')));
  };

  // a primeira cadeia termina quando a 1ª página carrega (ou falha de vez): dali em diante, só os sites dela
  const aprendeu = () => {
    esta.aprendendo = false;
  };
  janela.webContents.on('did-finish-load', aprendeu);
  janela.webContents.on('did-fail-load', (_e, codigo, _d, _u, principal) => {
    // -3 = abortada (outra navegação tomou o lugar, como um redirecionamento por script): a cadeia continua
    if (principal && codigo !== -3) aprendeu();
  });
  // Esc fecha antes (a página não fica com a tecla)
  janela.webContents.on('before-input-event', (e, i) => {
    if (i.type === 'keyDown' && i.key === 'Escape' && !i.control && !i.alt && !i.shift && !i.meta) {
      e.preventDefault();
      void fechar(null);
    }
  });
  janela.on('closed', () => void fechar(null));

  let conferindo = false;
  const conferir = setInterval(() => {
    if (conferindo || fechando) return;
    conferindo = true;
    void o
      .conectividade()
      .then((c) => {
        if (c === 'internet') void fechar(c);
      })
      .catch(() => undefined)
      .finally(() => (conferindo = false));
  }, PORTAL_CONFERIR_MS);
  const prazo = setTimeout(() => void fechar(null), PORTAL_MAXIMO_MS);

  const mostrar = () => {
    if (janela.isDestroyed() || janela.isVisible()) return;
    janela.show();
    janela.focus();
  };
  janela.once('ready-to-show', mostrar);
  // a rede não respondeu nada: a janela aparece assim mesmo (com a página de erro), e Esc fecha
  setTimeout(mostrar, 3000);
  void janela.loadURL(o.endereco).catch(() => undefined);
  return fim;
}
