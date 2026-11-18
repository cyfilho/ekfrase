// SPDX-License-Identifier: MPL-2.0

/**
 * O que o lado de cá (o processo principal do Electron ou o serviço do Writer OS) pede à PÁGINA do Writer.
 * Sem importar o `electron`: o `os.ts`, o agente de teste e os testes usam só esta interface.
 */
export interface Pagina {
  /** A página está aberta (a janela existe; no Cog, a página está ligada ao serviço). */
  aberta(): boolean;
  /** Um recado à página (`armazem:mudou`, `casca:fechar`, `os:brilho-mudou`). */
  enviar(canal: string, ...a: unknown[]): void;
  /** As chaves `ekfrase*` do `localStorage`, em JSON (escrever sem conta, idioma, tema). */
  copiarGuardado(): Promise<string>;
  /** Põe de volta o que `copiarGuardado` deu; `true` = mudou alguma coisa. */
  porGuardado(json: string): Promise<boolean>;
  /** O `data-teste` da tela aberta (o agente de teste conta as telas). */
  qualTela(): Promise<string>;
  recarregar(): void;
}

/** O código que roda na página para cada pedido (o Electron usa `executeJavaScript`; a ponte do Cog, o mesmo). */
export const NA_PAGINA = {
  copiarGuardado: () => JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('ekfrase')).map((k) => [k, localStorage.getItem(k)]))),
  porGuardado: (json: string): boolean => {
    const o = JSON.parse(json) as Record<string, unknown>;
    let mudou = false;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && k.startsWith('ekfrase') && localStorage.getItem(k) !== v) {
        localStorage.setItem(k, v);
        mudou = true;
      }
    }
    return mudou;
  },
  qualTela: (): string => {
    const m = document.querySelector('main[data-teste]') || document.querySelector('[data-teste^="tela-"]');
    return m ? (m.getAttribute('data-teste') ?? '') : '';
  },
};

/** A página de uma janela do Electron (só o pedaço do `webContents` que se usa). */
export function paginaDoElectron(janela: () => { isDestroyed(): boolean; webContents: { send(c: string, ...a: unknown[]): void; executeJavaScript(c: string): Promise<unknown>; reload(): void } } | null): Pagina {
  const wc = () => {
    const j = janela();
    return j && !j.isDestroyed() ? j.webContents : null;
  };
  const rodar = async <T>(codigo: string): Promise<T> => {
    const w = wc();
    if (!w) throw new Error('sem janela');
    return (await w.executeJavaScript(codigo)) as T;
  };
  return {
    aberta: () => !!wc(),
    enviar: (canal, ...a) => wc()?.send(canal, ...a),
    copiarGuardado: () => rodar<string>(`(${NA_PAGINA.copiarGuardado.toString()})()`),
    porGuardado: (json) => rodar<boolean>(`(${NA_PAGINA.porGuardado.toString()})(${JSON.stringify(json)})`),
    qualTela: () => rodar<string>(`(${NA_PAGINA.qualTela.toString()})()`),
    recarregar: () => wc()?.reload(),
  };
}
