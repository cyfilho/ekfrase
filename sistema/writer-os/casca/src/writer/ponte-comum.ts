// SPDX-License-Identifier: MPL-2.0

/**
 * A `PonteCasca` (`packages/writer-nucleo/src/casca.ts`) montada sobre um TRANSPORTE: o objeto
 * `window.ekfraseCasca` que o preload do Electron põe na página (o transporte é o `ipcRenderer`).
 * Os canais são os de `canais.ts`.
 */
import type {
  Bateria,
  DiscoUSB,
  ErroSistema,
  EscolhaEspelho,
  EstadoAtualizacoes,
  EstadoCasca,
  EstadoOS,
  InfoInstalacao,
  ListaDePasta,
  MetodoArmazem,
  ModoAtualizacoes,
  Mudanca,
  PassoInstalar,
  PonteAtualizacoes,
  PonteCasca,
  PonteSistema,
  RedeWifi,
  RespostaArmazem,
  RespostaCasca,
  RespostaInstalar,
  RespostaSistema,
  ServidorConferido,
  SobreOS,
} from '@ekfrase/writer-nucleo';

export interface Transporte {
  /** Um pedido com resposta (o `ipcRenderer.invoke`). */
  pedir(canal: string, ...a: unknown[]): Promise<unknown>;
  /** Um pedido SÍNCRONO (o rascunho de emergência: a página pode estar fechando). */
  sincrono(canal: string, ...a: unknown[]): unknown;
  /** Um aviso sem resposta. */
  avisar(canal: string, ...a: unknown[]): void;
  /** O que o outro lado manda (`armazem:mudou`, `casca:fechar`, `os:brilho-mudou`, `os:instalar-passo`). */
  ouvir(canal: string, f: (...a: unknown[]) => void): void;
}

const cada = <F extends (...a: never[]) => void>(lista: Iterable<F>, ...a: Parameters<F>): void => {
  for (const f of [...lista]) {
    try {
      f(...a);
    } catch {
      // um ouvinte com defeito não derruba os outros
    }
  }
};

export function montarPonte(t: Transporte, info: { versao: string; plataforma: string; os: boolean; atualizacoes?: boolean }): PonteCasca {
  const pedir = <T>(canal: string, ...a: unknown[]): Promise<T> => t.pedir(canal, ...a) as Promise<T>;

  const ouvintes = new Map<string, Set<(m: Mudanca) => void>>();
  t.ouvir('armazem:mudou', (alca, m) => cada(ouvintes.get(String(alca)) ?? [], m as Mudanca));

  let aoFechar: (() => Promise<void>) | null = null;
  t.ouvir('casca:fechar', () => {
    const pronto = () => t.avisar('casca:pode-fechar');
    if (!aoFechar) return pronto();
    Promise.resolve()
      .then(() => aoFechar?.())
      .then(pronto, pronto);
  });

  // as teclas de brilho do notebook (Writer OS): o outro lado conta o brilho novo
  const ouvintesDoBrilho = new Set<(n: number) => void>();
  t.ouvir('os:brilho-mudou', (n) => {
    if (typeof n === 'number' && Number.isFinite(n)) cada(ouvintesDoBrilho, n);
  });
  // o progresso da instalação no computador (PLANO §8c)
  const ouvintesDoInstalar = new Set<(passo: PassoInstalar, feito: number, total: number) => void>();
  t.ouvir('os:instalar-passo', (passo, feito, total) => {
    if (typeof passo === 'string') cada(ouvintesDoInstalar, passo as PassoInstalar, Number(feito) || 0, Number(total) || 0);
  });

  // as atualizações (DEC-P072): o andamento, pronta, erro
  const ouvintesDaAtualizacao = new Set<(e: EstadoAtualizacoes) => void>();
  t.ouvir('at:mudou', (e) => {
    if (e && typeof e === 'object') cada(ouvintesDaAtualizacao, e as EstadoAtualizacoes);
  });
  const atualizacoes: PonteAtualizacoes | undefined = info.atualizacoes
    ? {
        estado: () => pedir<EstadoAtualizacoes>('at:estado'),
        procurar: () => pedir<EstadoAtualizacoes>('at:procurar'),
        instalar: () => pedir<EstadoAtualizacoes>('at:instalar'),
        usarModo: (m: ModoAtualizacoes) => pedir<EstadoAtualizacoes>('at:modo', m === 'perguntar' ? 'perguntar' : 'automaticas'),
        // "Reiniciar agora": só no computador (no Writer OS, a nova vale ao ligar de novo; o menu tem o Reiniciar)
        ...(info.os ? {} : { reiniciar: () => pedir<void>('at:reiniciar') }),
        aoMudar: (f: (e: EstadoAtualizacoes) => void) => {
          ouvintesDaAtualizacao.add(f);
          return () => void ouvintesDaAtualizacao.delete(f);
        },
      }
    : undefined;

  const os: PonteSistema | undefined = info.os
    ? {
        estado: () => pedir<EstadoOS>('os:estado'),
        usarIdioma: (c: string) => pedir<EstadoOS>('os:idioma', String(c)),
        teclados: () => pedir<string[]>('os:teclados'),
        usarTeclado: (id: string) => pedir<{ estado: EstadoOS; reabrindo: boolean }>('os:teclado', String(id)),
        fusos: () => pedir<string[]>('os:fusos'),
        usarFuso: (id: string) => pedir<EstadoOS>('os:fuso', String(id)),
        passarWifi: () => pedir<EstadoOS>('os:passar-wifi'),
        passarUso: () => pedir<EstadoOS>('os:passar-uso'),
        instalacao: () => pedir<InfoInstalacao>('os:instalacao'),
        instalar: (disco: string, levar: boolean, apagar?: string) => pedir<RespostaInstalar>('os:instalar', String(disco), levar === true, typeof apagar === 'string' ? apagar : null),
        aoPassoDaInstalacao: (f: (passo: PassoInstalar, feito: number, total: number) => void) => {
          ouvintesDoInstalar.add(f);
          return () => void ouvintesDoInstalar.delete(f);
        },
        redes: () => pedir<RedeWifi[]>('os:redes'),
        conectar: (ssid: string, senha: string | null) => pedir<RespostaSistema>('os:conectar', String(ssid), senha === null ? null : String(senha)),
        esquecer: (ssid: string) => pedir<void>('os:esquecer', String(ssid)),
        bateria: () => pedir<Bateria | null>('os:bateria'),
        brilho: (passo?: number) => pedir<number | null>('os:brilho', typeof passo === 'number' ? passo : undefined),
        aoMudarBrilho: (f: (n: number) => void) => {
          ouvintesDoBrilho.add(f);
          return () => void ouvintesDoBrilho.delete(f);
        },
        discos: () => pedir<DiscoUSB[]>('os:discos'),
        guardarEm: (id: string) => pedir<RespostaCasca>('os:guardar-em', String(id)),
        guardarNaMemoria: () => pedir<RespostaCasca>('os:guardar-na-memoria'),
        ejetar: (id: string) => pedir<RespostaSistema>('os:ejetar', String(id)),
        abrirDisco: (id: string) => pedir<{ ok: true; raiz: string } | { ok: false; erro: ErroSistema }>('os:abrir-disco', String(id)),
        listar: (caminho: string) => pedir<ListaDePasta>('os:listar', String(caminho)),
        lerArquivo: (caminho: string) => pedir<{ ok: true; bytes: Uint8Array } | { ok: false; erro: ErroSistema }>('os:ler-arquivo', String(caminho)),
        gravarArquivo: (pasta: string, nome: string, bytes: Uint8Array) =>
          pedir<{ ok: true; nome: string } | { ok: false; erro: ErroSistema }>('os:gravar-arquivo', String(pasta), String(nome), bytes),
        desligar: () => pedir<void>('os:desligar'),
        reiniciar: () => pedir<void>('os:reiniciar'),
        sobre: () => pedir<SobreOS>('os:sobre'),
      }
    : undefined;

  return {
    versao: info.versao,
    plataforma: info.plataforma,
    estado: () => pedir<EstadoCasca>('casca:estado'),
    escolherPasta: () => pedir<string | null>('casca:escolher-pasta'),
    usarPasta: (c: string) => pedir<RespostaCasca>('casca:usar-pasta', String(c)),
    criarSenha: (s: string) => pedir<RespostaCasca>('casca:criar-senha', String(s)),
    abrir: (s: string) => pedir<RespostaCasca>('casca:abrir', String(s)),
    trancar: () => pedir<EstadoCasca>('casca:trancar'),
    responderEspelho: (r: EscolhaEspelho) => pedir<EstadoCasca>('casca:espelho', String(r)),
    armazem: {
      abrir: (dono: string) => pedir<string>('armazem:abrir', String(dono)),
      chamar: (alca: string, metodo: MetodoArmazem, args: unknown[]) => pedir<RespostaArmazem>('armazem:chamar', String(alca), String(metodo), args),
      aoMudar: (alca: string, f: (m: Mudanca) => void) => {
        const lista = ouvintes.get(alca) ?? new Set();
        lista.add(f);
        ouvintes.set(alca, lista);
        return () => {
          lista.delete(f);
          if (!lista.size) ouvintes.delete(alca);
        };
      },
      fechar: (alca: string) => {
        ouvintes.delete(alca);
        t.avisar('armazem:fechar', String(alca));
      },
    },
    rascunhos: {
      por: (chave: string, valor: string) => t.sincrono('rascunho:por', String(chave), String(valor)) === true,
      tirar: (chave: string) => void t.sincrono('rascunho:tirar', String(chave)),
      todos: () => (t.sincrono('rascunho:todos') ?? {}) as Record<string, string>,
    },
    conferirServidor: (endereco: string) => pedir<ServidorConferido>('servidor:conferir', String(endereco)),
    usarServidor: (base: string | null) => pedir<void>('servidor:usar', base === null ? null : String(base)),
    aoFechar: (f: () => Promise<void>) => {
      aoFechar = typeof f === 'function' ? f : null;
    },
    ...(os ? { os } : {}),
    ...(atualizacoes ? { atualizacoes } : {}),
  };
}

/** Arrastar um arquivo para a janela não abre o arquivo (só um campo de arquivo aceita). */
export function segurarArrastar(): void {
  const aceitaArquivo = (alvo: EventTarget | null): boolean => alvo instanceof HTMLInputElement && alvo.type === 'file';
  addEventListener(
    'dragover',
    (e) => {
      if (aceitaArquivo(e.target)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    },
    true,
  );
  addEventListener(
    'drop',
    (e) => {
      if (!aceitaArquivo(e.target)) e.preventDefault();
    },
    true,
  );
}
