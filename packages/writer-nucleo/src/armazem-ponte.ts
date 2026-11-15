// SPDX-License-Identifier: MPL-2.0

/**
 * O armazém do OUTRO LADO de uma ponte (PLANO §4.1: "ponte IPC no OS/desktop"). Na casca do
 * computador (`sistema/writer-os/casca`), o banco (SQLite cifrado) mora no processo principal e a
 * página não tem Node: ela recebe pelo preload só um `chamar(metodo, args)` e um `aoMudar`, e este
 * adaptador transforma isso de volta na interface `Armazem`. As telas não sabem a diferença.
 *
 * Do outro lado, `servirArmazem` recebe o pedido, confere se o método é do `Armazem` (lista
 * fechada: `METODOS_ARMAZEM`) e devolve a resposta num envelope que atravessa a ponte (os erros
 * voltam com o código, e `MudouAntes` volta a ser `MudouAntes`).
 */
import { MudouAntes, type Armazem, type Despejo, type ExtrasDeGravacao, type Filtro, type Fila, type Gravacao, type Mudanca, type Recusa, type ResultadoAplicar } from './armazem.ts';
import type { Colecao, EscritaDia, Registro, VersaoCena } from './modelo.ts';

/** Os métodos que atravessam a ponte (nada além disto chega ao banco). */
export const METODOS_ARMAZEM = [
  'aparelho',
  'ler',
  'listar',
  'gravar',
  'gravarVarios',
  'mudancasDesde',
  'marcarEnviadas',
  'marcarRecusadas',
  'pendentes',
  'aplicarDoServidor',
  'cursorDoServidor',
  'guardarCursorDoServidor',
  'versoesDaCena',
  'lerVersao',
  'dias',
  'lerDia',
  'lerConfig',
  'gravarConfig',
  'despejar',
  'receber',
  'limpar',
  'esquecer',
] as const;

export type MetodoArmazem = (typeof METODOS_ARMAZEM)[number];

export const ehMetodoArmazem = (m: unknown): m is MetodoArmazem => typeof m === 'string' && (METODOS_ARMAZEM as readonly string[]).includes(m);

/** O que volta pela ponte. */
export type RespostaArmazem = { ok: true; valor: unknown } | { ok: false; nome: string; codigo: string | null; id: string | null; mensagem: string };

/** Do lado do banco: executa um pedido que veio pela ponte. Nunca lança (o erro vai no envelope). */
export async function servirArmazem(armazem: Armazem, metodo: unknown, args: unknown): Promise<RespostaArmazem> {
  try {
    if (!ehMetodoArmazem(metodo)) throw Object.assign(new Error(`método desconhecido: ${String(metodo)}`), { codigo: 'metodo' });
    const lista = Array.isArray(args) ? args : [];
    const f = armazem[metodo] as (...a: unknown[]) => Promise<unknown>;
    return { ok: true, valor: (await f.apply(armazem, lista)) ?? null };
  } catch (e) {
    const x = e as { name?: unknown; codigo?: unknown; id?: unknown; message?: unknown };
    return {
      ok: false,
      nome: typeof x?.name === 'string' ? x.name : 'Error',
      codigo: typeof x?.codigo === 'string' ? x.codigo : null,
      id: typeof x?.id === 'string' ? x.id : null,
      mensagem: typeof x?.message === 'string' ? x.message : String(e),
    };
  }
}

/** O lado da página: como falar com o banco. */
export interface CanalArmazem {
  chamar(metodo: MetodoArmazem, args: unknown[]): Promise<RespostaArmazem>;
  /** As mudanças gravadas do outro lado (por esta página ou pela sincronização). Devolve como parar. */
  aoMudar(f: (m: Mudanca) => void): () => void;
  /** Fecha o armazém do outro lado (depois dos pedidos que já foram). */
  fechar(): void;
}

function erroDe(r: Extract<RespostaArmazem, { ok: false }>): Error {
  if (r.nome === 'MudouAntes' || r.codigo === 'mudou') return new MudouAntes(r.id ?? '');
  const e = new Error(r.mensagem) as Error & { codigo?: string };
  e.name = r.nome;
  if (r.codigo) e.codigo = r.codigo;
  return e;
}

export class ArmazemPonte implements Armazem {
  readonly dono: string;
  private readonly canal: CanalArmazem;
  private readonly ouvintes = new Set<(m: Mudanca) => void>();
  private readonly parar: () => void;

  constructor(dono: string, canal: CanalArmazem) {
    this.dono = dono;
    this.canal = canal;
    this.parar = canal.aoMudar((m) => this.avisar(m));
  }

  private async pedir<T>(metodo: MetodoArmazem, ...args: unknown[]): Promise<T> {
    const r = await this.canal.chamar(metodo, args);
    if (!r.ok) throw erroDe(r);
    return r.valor as T;
  }

  private avisar(m: Mudanca): void {
    for (const f of [...this.ouvintes]) {
      try {
        f(m);
      } catch {
        // um ouvinte com defeito não derruba os outros
      }
    }
  }

  aparelho(): Promise<string> {
    return this.pedir('aparelho');
  }
  ler(colecao: Colecao, id: string): Promise<Registro | null> {
    return this.pedir('ler', colecao, id);
  }
  listar(colecao: Colecao, filtro?: Filtro): Promise<Registro[]> {
    return filtro === undefined ? this.pedir('listar', colecao) : this.pedir('listar', colecao, filtro);
  }
  gravar(g: Gravacao): Promise<Registro> {
    return this.pedir('gravar', g);
  }
  gravarVarios(gs: readonly Gravacao[], extras?: ExtrasDeGravacao): Promise<Registro[]> {
    return extras === undefined ? this.pedir('gravarVarios', gs) : this.pedir('gravarVarios', gs, extras);
  }
  mudancasDesde(cursorLocal?: number, limite?: number): Promise<Fila> {
    return this.pedir('mudancasDesde', ...(cursorLocal === undefined ? [] : [cursorLocal]), ...(limite === undefined ? [] : [limite]));
  }
  marcarEnviadas(aceitos: readonly Registro[]): Promise<void> {
    return this.pedir('marcarEnviadas', aceitos);
  }
  marcarRecusadas(recusas: readonly Recusa[]): Promise<void> {
    return this.pedir('marcarRecusadas', recusas);
  }
  pendentes(): Promise<{ fila: number; recusados: number }> {
    return this.pedir('pendentes');
  }
  aplicarDoServidor(registros: readonly Registro[]): Promise<ResultadoAplicar> {
    return this.pedir('aplicarDoServidor', registros);
  }
  cursorDoServidor(): Promise<number> {
    return this.pedir('cursorDoServidor');
  }
  guardarCursorDoServidor(cursor: number): Promise<void> {
    return this.pedir('guardarCursorDoServidor', cursor);
  }
  versoesDaCena(cena: string): Promise<VersaoCena[]> {
    return this.pedir('versoesDaCena', cena);
  }
  lerVersao(id: string): Promise<VersaoCena | null> {
    return this.pedir('lerVersao', id);
  }
  dias(): Promise<EscritaDia[]> {
    return this.pedir('dias');
  }
  lerDia(data: string): Promise<EscritaDia | null> {
    return this.pedir('lerDia', data);
  }
  async lerConfig(chave: string): Promise<unknown> {
    // `undefined` não atravessa todas as pontes: do outro lado, "não tem" volta como `null`
    const v = await this.pedir<unknown>('lerConfig', chave);
    return v === null ? undefined : v;
  }
  gravarConfig(chave: string, valor: unknown): Promise<void> {
    return this.pedir('gravarConfig', chave, valor);
  }
  despejar(): Promise<Despejo> {
    return this.pedir('despejar');
  }
  receber(d: Despejo): Promise<ResultadoAplicar> {
    return this.pedir('receber', d);
  }
  limpar(): Promise<void> {
    return this.pedir('limpar');
  }
  esquecer(d: Despejo): Promise<void> {
    return this.pedir('esquecer', d);
  }

  aoMudar(f: (m: Mudanca) => void): () => void {
    this.ouvintes.add(f);
    return () => this.ouvintes.delete(f);
  }

  avisarDeFora(ids: readonly string[]): void {
    if (ids.length) this.avisar({ origem: 'fora', ids: [...ids] });
  }

  fechar(): void {
    this.parar();
    this.canal.fechar();
  }
}
