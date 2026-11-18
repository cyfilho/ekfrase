// SPDX-License-Identifier: MPL-2.0

/**
 * O PRELOAD: a única coisa entre a página do Writer e o computador. Roda com `sandbox:true` e
 * `contextIsolation:true`: põe em `window.ekfraseCasca` (por `contextBridge`) só as funções da
 * `PonteCasca` (`packages/writer-nucleo/src/casca.ts`), e mais nada. A página não ganha Node,
 * nem `ipcRenderer`, nem `require`.
 *
 * E segura o arrastar: um arquivo solto na janela (fora de um campo de arquivo) não abre nada.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type {
  Bateria,
  DiscoUSB,
  ErroSistema,
  EscolhaEspelho,
  EstadoCasca,
  EstadoOS,
  ListaDePasta,
  MetodoArmazem,
  Mudanca,
  PonteCasca,
  PonteSistema,
  RedeWifi,
  RespostaArmazem,
  RespostaCasca,
  RespostaSistema,
  ServidorConferido,
  SobreOS,
} from '@ekfrase/writer-nucleo';

const ouvintes = new Map<string, Set<(m: Mudanca) => void>>();
ipcRenderer.on('armazem:mudou', (_e, alca: string, m: Mudanca) => {
  for (const f of [...(ouvintes.get(alca) ?? [])]) {
    try {
      f(m);
    } catch {
      // um ouvinte com defeito não derruba os outros
    }
  }
});

let aoFechar: (() => Promise<void>) | null = null;
ipcRenderer.on('casca:fechar', () => {
  const pronto = () => ipcRenderer.send('casca:pode-fechar');
  if (!aoFechar) return pronto();
  Promise.resolve()
    .then(() => aoFechar?.())
    .then(pronto, pronto);
});

const pedir = <T>(canal: string, ...a: unknown[]): Promise<T> => ipcRenderer.invoke(canal, ...a) as Promise<T>;

// as teclas de brilho do notebook (Writer OS): o processo principal conta o brilho novo
const ouvintesDoBrilho = new Set<(n: number) => void>();
ipcRenderer.on('os:brilho-mudou', (_e, n: unknown) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return;
  for (const f of [...ouvintesDoBrilho]) {
    try {
      f(n);
    } catch {
      // um ouvinte com defeito não derruba os outros
    }
  }
});

/** O Writer OS (o pendrive): só quando a casca abriu com `--modo-os` dentro da imagem. */
const os: PonteSistema | undefined = process.argv.includes('--ekfrase-os=1')
  ? {
      estado: () => pedir<EstadoOS>('os:estado'),
      usarIdioma: (c: string) => pedir<EstadoOS>('os:idioma', String(c)),
      teclados: () => pedir<string[]>('os:teclados'),
      usarTeclado: (id: string) => pedir<{ estado: EstadoOS; reabrindo: boolean }>('os:teclado', String(id)),
      fusos: () => pedir<string[]>('os:fusos'),
      usarFuso: (id: string) => pedir<EstadoOS>('os:fuso', String(id)),
      passarWifi: () => pedir<EstadoOS>('os:passar-wifi'),
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

const ponte: PonteCasca = {
  versao: (process.argv.find((a) => a.startsWith('--ekfrase-versao=')) ?? '').slice('--ekfrase-versao='.length),
  plataforma: process.platform,
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
      ipcRenderer.send('armazem:fechar', String(alca));
    },
  },
  rascunhos: {
    por: (chave: string, valor: string) => ipcRenderer.sendSync('rascunho:por', String(chave), String(valor)) === true,
    tirar: (chave: string) => void ipcRenderer.sendSync('rascunho:tirar', String(chave)),
    todos: () => (ipcRenderer.sendSync('rascunho:todos') ?? {}) as Record<string, string>,
  },
  conferirServidor: (endereco: string) => pedir<ServidorConferido>('servidor:conferir', String(endereco)),
  usarServidor: (base: string | null) => pedir<void>('servidor:usar', base === null ? null : String(base)),
  aoFechar: (f: () => Promise<void>) => {
    aoFechar = typeof f === 'function' ? f : null;
  },
  ...(os ? { os } : {}),
};

contextBridge.exposeInMainWorld('ekfraseCasca', ponte);

// arrastar um arquivo para a janela não abre o arquivo (só um campo de arquivo aceita)
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
