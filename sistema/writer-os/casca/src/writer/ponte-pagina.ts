// SPDX-License-Identifier: MPL-2.0

/**
 * A PONTE DA PÁGINA no Writer OS sem o Electron (o "preload" do Cog). O Cog do Writer OS (com o remendo
 * `sistema/writer-os/imagem/cog/ekfrase.patch`) injeta este arquivo na página ANTES de tudo, só na origem do app;
 * o serviço (`servico-os.ts`) escreve antes, no começo, a configuração em `globalThis.__EKFRASE_PONTE__`
 * (a ficha desta sessão, a versão). Põe em `window.ekfraseCasca` a MESMA `PonteCasca` do computador
 * (`ponte-comum.ts`), com o transporte por pedidos ao serviço local:
 *
 * - pedidos: `POST /casca/pedir` · síncronos (o rascunho de emergência): `XMLHttpRequest` síncrono em `/casca/sinc`
 *   · avisos: `POST /casca/aviso` (keepalive) · recados do serviço: `EventSource` em `/casca/eventos`;
 * - todo pedido à própria origem (os de cima e o `/api/...` da conta) leva o cabeçalho `x-ekfrase-ficha`: sem
 *   ele o serviço não atende (outro programa do computador não fala com o serviço no lugar da página);
 * - as teclas de brilho do notebook vão ao serviço (no Electron era o `before-input-event`).
 */
import { NA_PAGINA } from './pagina.ts';
import { deJson, paraJson } from './json-bytes.ts';
import { montarPonte, segurarArrastar, type Transporte } from './ponte-comum.ts';

interface Configuracao {
  ficha: string;
  versao: string;
}

const g = globalThis as { __EKFRASE_PONTE__?: Configuracao };
const config = g.__EKFRASE_PONTE__;
delete g.__EKFRASE_PONTE__;

if (config && typeof config.ficha === 'string') {
  const FICHA = 'x-ekfrase-ficha';
  const ficha = config.ficha;
  const buscar = window.fetch.bind(window);

  // o `/api/...` da conta (packages/interface) e tudo o mais da própria origem levam a ficha
  window.fetch = (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const pedido = new Request(entrada, init);
    if (new URL(pedido.url).origin !== location.origin) return buscar(pedido);
    const cabecalhos = new Headers(pedido.headers);
    cabecalhos.set(FICHA, ficha);
    return buscar(new Request(pedido, { headers: cabecalhos }));
  };

  const corpo = (canal: string, a: unknown[]) => paraJson({ canal, a });
  const resposta = (t: string): unknown => {
    const r = deJson<{ ok: boolean; valor?: unknown; erro?: string }>(t);
    if (!r.ok) throw new Error(r.erro ?? 'recusado');
    return r.valor;
  };

  const ouvintes = new Map<string, Set<(...a: unknown[]) => void>>();
  const transporte: Transporte = {
    pedir: async (canal, ...a) => {
      const r = await buscar('/casca/pedir', { method: 'POST', headers: { [FICHA]: ficha, 'content-type': 'application/json' }, body: corpo(canal, a) });
      return resposta(await r.text());
    },
    sincrono: (canal, ...a) => {
      try {
        const x = new XMLHttpRequest();
        x.open('POST', '/casca/sinc', false);
        x.setRequestHeader(FICHA, ficha);
        x.setRequestHeader('content-type', 'application/json');
        x.send(corpo(canal, a));
        return resposta(x.responseText);
      } catch {
        return canal === 'rascunho:todos' ? {} : false;
      }
    },
    avisar: (canal, ...a) => {
      void buscar('/casca/aviso', { method: 'POST', keepalive: true, headers: { [FICHA]: ficha, 'content-type': 'application/json' }, body: corpo(canal, a) }).catch(() => undefined);
    },
    ouvir: (canal, f) => {
      const lista = ouvintes.get(canal) ?? new Set();
      lista.add(f);
      ouvintes.set(canal, lista);
    },
  };

  // os recados do serviço: os canais (`armazem:mudou`…) e os pedidos à página (o que o Electron fazia por executeJavaScript)
  const responder = (id: number, valor: unknown, erro?: string) =>
    void buscar('/casca/resposta', { method: 'POST', headers: { [FICHA]: ficha, 'content-type': 'application/json' }, body: paraJson({ id, valor, erro }) }).catch(() => undefined);
  const eventos = new EventSource(`/casca/eventos?ficha=${encodeURIComponent(ficha)}`);
  eventos.onmessage = (e: MessageEvent<string>) => {
    let m: { canal?: string; a?: unknown[]; id?: number; pedido?: string; arg?: string };
    try {
      m = deJson(e.data);
    } catch {
      return;
    }
    if (m.canal) {
      for (const f of [...(ouvintes.get(m.canal) ?? [])]) {
        try {
          f(...(m.a ?? []));
        } catch {
          // um ouvinte com defeito não derruba os outros
        }
      }
      return;
    }
    if (m.pedido === 'recarregar') return location.reload();
    if (typeof m.id !== 'number') return;
    try {
      if (m.pedido === 'copiar-guardado') responder(m.id, NA_PAGINA.copiarGuardado());
      else if (m.pedido === 'por-guardado') responder(m.id, NA_PAGINA.porGuardado(String(m.arg ?? '{}')));
      else if (m.pedido === 'qual-tela') responder(m.id, NA_PAGINA.qualTela());
      else responder(m.id, null, 'pedido');
    } catch (erro) {
      responder(m.id, null, String(erro));
    }
  };

  Object.defineProperty(window, 'ekfraseCasca', {
    value: Object.freeze(montarPonte(transporte, { versao: String(config.versao ?? ''), plataforma: 'linux', os: true })),
    writable: false,
    configurable: false,
    enumerable: false,
  });

  // as teclas de brilho do notebook (o XKB: XF86MonBrightnessUp/Down; o WebKit: "BrightnessUp"/"BrightnessDown")
  addEventListener(
    'keydown',
    (e) => {
      const passo = e.key === 'BrightnessUp' || e.code === 'BrightnessUp' ? 10 : e.key === 'BrightnessDown' || e.code === 'BrightnessDown' ? -10 : 0;
      if (passo) transporte.avisar('os:tecla-brilho', passo);
    },
    true,
  );

  segurarArrastar();
}
