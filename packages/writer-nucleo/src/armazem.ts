// SPDX-License-Identifier: MPL-2.0

/**
 * O ARMAZÉM (docs/writer/PLANO.md §4.1): onde os registros moram no aparelho. O app nunca fala com
 * o IndexedDB nem com o SQLite: fala com esta interface (em geral por `Escrita`, de `dominio.ts`).
 *
 * UM ARMAZÉM = UM DONO. Dados de contas diferentes não se misturam: cada conta (e quem escreve sem
 * conta, o dono `local`) tem o seu banco. Quem escreve sem conta e depois entra leva os textos com
 * `adotar(origem, destino)`.
 *
 * Além dos registros, o armazém guarda por registro a BASE (a versão do servidor que este aparelho
 * conhece, e as versões de campo dela) e se há mudança PENDENTE de envio; guarda o cursor do
 * servidor; e as duas coleções que não saem do aparelho (`versoes_cena`, `escrita_dia`).
 *
 * `ArmazemComum` tem toda a regra (carimbar versões, fila de saída, aplicar o que vem do servidor)
 * em cima de uma `Transacao` mínima; cada adaptador (`ArmazemMemoria` aqui, `ArmazemIndexedDB` em
 * `armazem-idb.ts`, o SQLite da casca depois) só implementa a transação.
 */
import { lapide, mesclar } from './conflito.ts';
import { Relogio, ehHlc, novoAparelho } from './hlc.ts';
import { bemFormado, ehColecao, iguais, versoesDe, type Colecao, type Dados, type EscritaDia, type Registro, type RegistroEnvio, type VersaoCena, type VersoesDeCampo } from './modelo.ts';
import { ehUuidV7 } from './uuid.ts';

/** O dono de quem escreve sem conta. */
export const DONO_LOCAL = 'local';

export type LojaLocal = 'versoes_cena' | 'escrita_dia';

/** Um pedido de gravação: só os campos que mudam (os outros ficam como estão). */
export interface Gravacao {
  colecao: Colecao;
  id: string;
  /** Campos a gravar. Só os que MUDAM de valor ganham versão nova. */
  dados?: Dados;
  /** `true` = apagar (lápide); `false` = trazer de volta. */
  apagado?: boolean;
  /**
   * Só grava se estes campos AINDA tiverem estes valores no armazém (conferido dentro da mesma
   * transação). Outra aba no mesmo banco pode ter escrito no meio: aí nada é gravado e sai `MudouAntes`.
   */
  seAinda?: Dados;
}

/** A gravação pedia `seAinda` e o registro já tinha mudado (outra aba, outro processo). Nada foi gravado. */
export class MudouAntes extends Error {
  readonly codigo = 'mudou';
  readonly id: string;
  constructor(id: string) {
    super(`o registro ${id} mudou antes da gravação`);
    this.name = 'MudouAntes';
    this.id = id;
  }
}

/** O que mais entra na MESMA transação de uma gravação (o histórico e a meta do dia). */
export interface ExtrasDeGravacao {
  somarDia?: { data: string; palavras: number };
  versoes?: readonly VersaoCena[];
  apagarVersoes?: readonly string[];
}

export interface Filtro {
  historia?: string;
  /** `null` = só as cenas soltas. */
  capitulo?: string | null;
  /** `true` = inclui as lápides (o padrão é não incluir). */
  apagados?: boolean;
}

/** Um pedaço da fila de saída. */
export interface Fila {
  registros: RegistroEnvio[];
  /** O cursor local para pedir o pedaço seguinte. */
  cursor: number;
  mais: boolean;
}

export interface ResultadoAplicar {
  /** Os ids que mudaram neste aparelho. */
  mudaram: string[];
  /** As cópias de conflito criadas agora (cenas novas). */
  copias: Registro[];
}

/** Tudo o que um armazém tem, para levar a outro (`adotar`). */
export interface Despejo {
  registros: Registro[];
  versoes: VersaoCena[];
  dias: EscritaDia[];
  config: Record<string, unknown>;
}

export interface Mudanca {
  /** `local` = gravado por este armazém; `servidor` = veio da nuvem; `fora` = outra aba gravou no mesmo banco. */
  origem: 'local' | 'servidor' | 'fora';
  ids: readonly string[];
}

export interface Recusa {
  id: string;
  versao: string;
  erro: string;
}

export interface Armazem {
  readonly dono: string;
  /** O id deste aparelho (8 hex): o fim de toda versão gerada aqui. */
  aparelho(): Promise<string>;

  ler(colecao: Colecao, id: string): Promise<Registro | null>;
  listar(colecao: Colecao, filtro?: Filtro): Promise<Registro[]>;
  /** Grava (atômico) e já carimba `versao` e `dados._v` dos campos que mudaram. */
  gravar(g: Gravacao): Promise<Registro>;
  /** Várias gravações numa transação só (tudo ou nada), com a MESMA versão. */
  gravarVarios(gs: readonly Gravacao[], extras?: ExtrasDeGravacao): Promise<Registro[]>;

  /** A fila de saída: o que mudou aqui e o servidor ainda não tem, em ordem (cursor local 0 = do começo). */
  mudancasDesde(cursorLocal?: number, limite?: number): Promise<Fila>;
  /** O servidor aceitou estes registros (como foram enviados). Saem da fila se não mudaram depois. */
  marcarEnviadas(aceitos: readonly Registro[]): Promise<void>;
  /** O servidor recusou: ficam guardados, fora da fila, até serem editados de novo. */
  marcarRecusadas(recusas: readonly Recusa[]): Promise<void>;
  pendentes(): Promise<{ fila: number; recusados: number }>;

  /** O que veio do servidor: guarda, e mescla com o que está pendente aqui (pode criar cópia de conflito). */
  aplicarDoServidor(registros: readonly Registro[]): Promise<ResultadoAplicar>;
  cursorDoServidor(): Promise<number>;
  guardarCursorDoServidor(cursor: number): Promise<void>;

  versoesDaCena(cena: string): Promise<VersaoCena[]>;
  lerVersao(id: string): Promise<VersaoCena | null>;
  dias(): Promise<EscritaDia[]>;
  lerDia(data: string): Promise<EscritaDia | null>;
  lerConfig(chave: string): Promise<unknown>;
  gravarConfig(chave: string, valor: unknown): Promise<void>;

  despejar(): Promise<Despejo>;
  /** Recebe o despejo de outro armazém: tudo entra como mudança pendente deste dono. */
  receber(d: Despejo): Promise<ResultadoAplicar>;
  limpar(): Promise<void>;
  /**
   * Tira deste armazém o que foi levado num despejo, mas só os registros que continuam IGUAIS (mesma
   * versão): o que mudou depois do despejo (outra aba escrevendo) fica, para ser levado de novo.
   */
  esquecer(d: Despejo): Promise<void>;

  aoMudar(f: (m: Mudanca) => void): () => void;
  /** Outra aba (ou processo) gravou estes registros no MESMO banco: avisa quem ouve aqui (origem `fora`). */
  avisarDeFora(ids: readonly string[]): void;
  fechar(): void;
}

// ---------- o que um adaptador implementa ----------

/** O registro como fica guardado: com a base do servidor e a marca de pendente. */
export interface Guardado extends Registro {
  /** A `versao` do servidor que este aparelho conhece (`null` = o servidor nunca viu). */
  base: string | null;
  /** O `dados._v` dessa versão do servidor. */
  baseV: VersoesDeCampo | null;
  /** 1 = tem mudança que o servidor ainda não tem. (Número, para servir de índice no IndexedDB.) */
  pendente: 0 | 1;
  /** A ordem na fila de saída. */
  seqLocal: number;
  /** O código do erro, se o servidor recusou esta versão. */
  recusado: string | null;
}

export interface Transacao {
  obter(id: string): Promise<Guardado | undefined>;
  por(g: Guardado): Promise<void>;
  tirar(id: string): Promise<void>;
  daColecao(colecao: Colecao): Promise<Guardado[]>;
  pendentes(): Promise<Guardado[]>;
  todos(): Promise<Guardado[]>;
  lerMeta(chave: string): Promise<unknown>;
  porMeta(chave: string, valor: unknown): Promise<void>;
  lerLocal(loja: LojaLocal, chave: string): Promise<unknown>;
  /** `cena` só vale para `versoes_cena`. */
  listarLocal(loja: LojaLocal, cena?: string): Promise<unknown[]>;
  porLocal(loja: LojaLocal, valor: VersaoCena | EscritaDia): Promise<void>;
  tirarLocal(loja: LojaLocal, chave: string): Promise<void>;
  limpar(): Promise<void>;
}

export interface OpcoesArmazem {
  /** De quem são os dados (padrão: `local`). */
  dono?: string;
  /** O id deste aparelho; se faltar, o armazém cria um e guarda. */
  aparelho?: string;
  /** O relógio do aparelho em ms (padrão: `Date.now`). */
  agora?: () => number;
}

const copiar = <T>(v: T): T => structuredClone(v);

const limpo = (g: Registro): Registro => ({ id: g.id, colecao: g.colecao, versao: g.versao, apagado: g.apagado, dados: copiar(g.dados) });

const registroBemFormado = (r: Registro): boolean =>
  !!r && ehUuidV7(r.id) && ehColecao(r.colecao) && ehHlc(r.versao) && typeof r.apagado === 'boolean' && !!r.dados && typeof r.dados === 'object' && !Array.isArray(r.dados);

export abstract class ArmazemComum implements Armazem {
  readonly dono: string;
  private readonly opcoes: OpcoesArmazem;
  private relogio: Relogio | null = null;
  private pronto: Promise<Relogio> | null = null;
  private readonly ouvintes = new Set<(m: Mudanca) => void>();

  constructor(opcoes: OpcoesArmazem = {}) {
    this.opcoes = opcoes;
    this.dono = opcoes.dono ?? DONO_LOCAL;
  }

  /** Uma transação: tudo o que `f` fizer vale inteiro ou não vale nada. */
  protected abstract transacao<T>(escreve: boolean, f: (t: Transacao) => Promise<T>): Promise<T>;
  abstract fechar(): void;

  private preparar(): Promise<Relogio> {
    this.pronto ??= this.transacao(true, async (t) => {
      let aparelho = this.opcoes.aparelho ?? ((await t.lerMeta('aparelho')) as string | undefined);
      if (!aparelho) aparelho = novoAparelho();
      await t.porMeta('aparelho', aparelho);
      const ultimo = (await t.lerMeta('relogio')) as string | undefined;
      this.relogio = new Relogio({ aparelho, ...(this.opcoes.agora ? { agora: this.opcoes.agora } : {}), ultimo: ultimo ?? null });
      return this.relogio;
    });
    return this.pronto;
  }

  private async escrever<T>(origem: Mudanca['origem'], f: (t: Transacao, relogio: Relogio, mudou: (id: string) => void, seq: () => number) => Promise<T>): Promise<T> {
    const relogio = await this.preparar();
    const ids: string[] = [];
    const saida = await this.transacao(true, async (t) => {
      const antes = ((await t.lerMeta('seqLocal')) as number | undefined) ?? 0;
      let seq = antes;
      const r = await f(t, relogio, (id) => ids.push(id), () => ++seq);
      if (seq !== antes) await t.porMeta('seqLocal', seq);
      if (relogio.ultimo) await t.porMeta('relogio', relogio.ultimo);
      return r;
    });
    if (ids.length) this.avisar({ origem, ids });
    return saida;
  }

  private async lerSo<T>(f: (t: Transacao) => Promise<T>): Promise<T> {
    await this.preparar();
    return this.transacao(false, f);
  }

  private avisar(m: Mudanca): void {
    for (const f of [...this.ouvintes]) {
      try {
        f(m);
      } catch {
        // um ouvinte com defeito não derruba a gravação
      }
    }
  }

  aoMudar(f: (m: Mudanca) => void): () => void {
    this.ouvintes.add(f);
    return () => this.ouvintes.delete(f);
  }

  avisarDeFora(ids: readonly string[]): void {
    if (ids.length) this.avisar({ origem: 'fora', ids: [...ids] });
  }

  async aparelho(): Promise<string> {
    return (await this.preparar()).aparelho;
  }

  ler(colecao: Colecao, id: string): Promise<Registro | null> {
    return this.lerSo(async (t) => {
      const g = await t.obter(id);
      return g && g.colecao === colecao ? limpo(g) : null;
    });
  }

  listar(colecao: Colecao, filtro: Filtro = {}): Promise<Registro[]> {
    return this.lerSo(async (t) => {
      const todos = await t.daColecao(colecao);
      return todos
        .filter((g) => filtro.apagados || !g.apagado)
        .filter((g) => filtro.historia === undefined || g.dados['historia'] === filtro.historia)
        .filter((g) => filtro.capitulo === undefined || (g.dados['capitulo'] ?? null) === filtro.capitulo)
        .map(limpo);
    });
  }

  async gravar(g: Gravacao): Promise<Registro> {
    return (await this.gravarVarios([g]))[0]!;
  }

  gravarVarios(gs: readonly Gravacao[], extras: ExtrasDeGravacao = {}): Promise<Registro[]> {
    return this.escrever('local', async (t, relogio, mudou, seq) => {
      let versao: string | null = null;
      const saida: Registro[] = [];
      for (const g of gs) {
        if (!ehUuidV7(g.id) || !ehColecao(g.colecao)) throw new Error(`gravação malformada: ${g.colecao}/${g.id}`);
        const atual = await t.obter(g.id);
        if (atual && atual.colecao !== g.colecao) throw new Error(`o registro ${g.id} é de ${atual.colecao}, não de ${g.colecao}`);
        if (g.seAinda && (!atual || Object.entries(g.seAinda).some(([campo, valor]) => !iguais(atual.dados[campo], valor)))) throw new MudouAntes(g.id);
        const dados: Dados = atual ? copiar(atual.dados) : {};
        const v: VersoesDeCampo = { ...versoesDe(dados) };
        const mudados: string[] = [];
        for (const [campo, bruto] of Object.entries(g.dados ?? {})) {
          if (campo === '_v' || bruto === undefined) continue;
          // meio emoji solto não entra: o servidor recusaria o pedido inteiro
          const valor = bemFormado(bruto);
          if (!atual || !iguais(dados[campo], valor)) {
            dados[campo] = copiar(valor);
            mudados.push(campo);
          }
        }
        let apagado = atual?.apagado ?? false;
        if (g.apagado !== undefined && g.apagado !== apagado) {
          apagado = g.apagado;
          mudados.push('apagado');
        }
        if (atual && mudados.length === 0) {
          saida.push(limpo(atual));
          continue;
        }
        versao ??= relogio.agora();
        for (const campo of mudados) v[campo] = versao;
        dados['_v'] = v;
        const novo: Guardado = {
          id: g.id,
          colecao: g.colecao,
          versao,
          apagado: lapide(apagado, v),
          dados,
          base: atual?.base ?? null,
          baseV: atual?.baseV ?? null,
          pendente: 1,
          seqLocal: seq(),
          recusado: null,
        };
        await t.por(novo);
        mudou(novo.id);
        saida.push(limpo(novo));
      }
      if (extras.somarDia && extras.somarDia.palavras !== 0) {
        const dia = (await t.lerLocal('escrita_dia', extras.somarDia.data)) as EscritaDia | undefined;
        await t.porLocal('escrita_dia', { data: extras.somarDia.data, palavras: (dia?.palavras ?? 0) + extras.somarDia.palavras });
      }
      for (const versaoCena of extras.versoes ?? []) await t.porLocal('versoes_cena', copiar(versaoCena));
      for (const id of extras.apagarVersoes ?? []) await t.tirarLocal('versoes_cena', id);
      return saida;
    });
  }

  mudancasDesde(cursorLocal = 0, limite = 500): Promise<Fila> {
    return this.lerSo(async (t) => {
      const fila = (await t.pendentes()).filter((g) => !g.recusado && g.seqLocal > cursorLocal).sort((a, b) => a.seqLocal - b.seqLocal);
      const pedaco = fila.slice(0, Math.max(1, limite));
      return {
        // o que foi gravado antes da regra do `bemFormado` também sai bem formado
        registros: pedaco.map((g) => ({ ...limpo(g), dados: bemFormado(g.dados), base: g.base })),
        cursor: pedaco.at(-1)?.seqLocal ?? cursorLocal,
        mais: fila.length > pedaco.length,
      };
    });
  }

  marcarEnviadas(aceitos: readonly Registro[]): Promise<void> {
    return this.escrever('servidor', async (t) => {
      for (const a of aceitos) {
        const g = await t.obter(a.id);
        if (!g) continue;
        const igual = g.versao === a.versao;
        await t.por({ ...g, base: a.versao, baseV: { ...versoesDe(a.dados) }, pendente: igual ? 0 : 1, recusado: igual ? null : g.recusado });
      }
    });
  }

  marcarRecusadas(recusas: readonly Recusa[]): Promise<void> {
    return this.escrever('servidor', async (t) => {
      for (const r of recusas) {
        const g = await t.obter(r.id);
        if (g && g.versao === r.versao) await t.por({ ...g, recusado: r.erro });
      }
    });
  }

  pendentes(): Promise<{ fila: number; recusados: number }> {
    return this.lerSo(async (t) => {
      const p = await t.pendentes();
      const recusados = p.filter((g) => g.recusado).length;
      return { fila: p.length - recusados, recusados };
    });
  }

  aplicarDoServidor(registros: readonly Registro[]): Promise<ResultadoAplicar> {
    return this.escrever('servidor', async (t, relogio, mudou, seq) => {
      const copias: Registro[] = [];
      const mudaram: string[] = [];
      const marcar = (id: string): void => {
        mudaram.push(id);
        mudou(id);
      };
      for (const bruto of registros) {
        if (!registroBemFormado(bruto)) continue;
        const r = limpo(bruto);
        relogio.absorver(r.versao);
        const rv = { ...versoesDe(r.dados) };
        const doServidor = (seqLocal: number): Guardado => ({ ...r, base: r.versao, baseV: rv, pendente: 0, seqLocal, recusado: null });
        const local = await t.obter(r.id);
        if (!local) {
          await t.por(doServidor(0));
          marcar(r.id);
          continue;
        }
        if (local.colecao !== r.colecao) continue;
        if (!local.pendente || local.versao === r.versao) {
          // nada pendente aqui (ou o servidor já tem esta mesma versão): vale o do servidor
          const igual = local.versao === r.versao && local.apagado === r.apagado && iguais(local.dados, r.dados);
          await t.por(doServidor(local.seqLocal));
          if (!igual) marcar(r.id);
          continue;
        }
        if (local.base === r.versao) {
          // o servidor não tem novidade; o pendente segue na fila. Se a versão daqui ficou para trás
          // (relógio estragado), ganha uma nova: senão o servidor responderia "conflito" para sempre
          if (local.versao <= r.versao) await t.por({ ...local, versao: relogio.agora(), seqLocal: seq() });
          continue;
        }
        const m = mesclar({ local, servidor: r, baseV: local.baseV });
        if (m.igualAoServidor) {
          await t.por(doServidor(local.seqLocal));
        } else {
          await t.por({ id: r.id, colecao: r.colecao, versao: relogio.agora(), apagado: m.apagado, dados: m.dados, base: r.versao, baseV: rv, pendente: 1, seqLocal: seq(), recusado: null });
        }
        marcar(r.id);
        if (m.copia && !(await t.obter(m.copia.id))) {
          await t.por({ ...m.copia, base: null, baseV: null, pendente: 1, seqLocal: seq(), recusado: null });
          copias.push(limpo(m.copia));
          marcar(m.copia.id);
        }
      }
      await reviverDonas(t, relogio, seq, [...mudaram], marcar);
      return { mudaram, copias };
    });
  }

  cursorDoServidor(): Promise<number> {
    return this.lerSo(async (t) => ((await t.lerMeta('cursorServidor')) as number | undefined) ?? 0);
  }

  guardarCursorDoServidor(cursor: number): Promise<void> {
    return this.escrever('servidor', (t) => t.porMeta('cursorServidor', cursor));
  }

  versoesDaCena(cena: string): Promise<VersaoCena[]> {
    return this.lerSo(async (t) => {
      const vs = (await t.listarLocal('versoes_cena', cena)) as VersaoCena[];
      return copiar(vs).sort((a, b) => b.criado_em - a.criado_em || (a.id < b.id ? 1 : -1));
    });
  }

  lerVersao(id: string): Promise<VersaoCena | null> {
    return this.lerSo(async (t) => copiar(((await t.lerLocal('versoes_cena', id)) as VersaoCena | undefined) ?? null));
  }

  dias(): Promise<EscritaDia[]> {
    return this.lerSo(async (t) => copiar((await t.listarLocal('escrita_dia')) as EscritaDia[]).sort((a, b) => (a.data < b.data ? -1 : 1)));
  }

  lerDia(data: string): Promise<EscritaDia | null> {
    return this.lerSo(async (t) => copiar(((await t.lerLocal('escrita_dia', data)) as EscritaDia | undefined) ?? null));
  }

  lerConfig(chave: string): Promise<unknown> {
    return this.lerSo(async (t) => copiar((((await t.lerMeta('config')) as Record<string, unknown> | undefined) ?? {})[chave]));
  }

  gravarConfig(chave: string, valor: unknown): Promise<void> {
    return this.escrever('local', async (t) => {
      const config = ((await t.lerMeta('config')) as Record<string, unknown> | undefined) ?? {};
      await t.porMeta('config', { ...config, [chave]: copiar(valor) });
    });
  }

  despejar(): Promise<Despejo> {
    return this.lerSo(async (t) => ({
      registros: (await t.todos()).map(limpo),
      versoes: copiar((await t.listarLocal('versoes_cena')) as VersaoCena[]),
      dias: copiar((await t.listarLocal('escrita_dia')) as EscritaDia[]),
      config: copiar(((await t.lerMeta('config')) as Record<string, unknown> | undefined) ?? {}),
    }));
  }

  receber(d: Despejo): Promise<ResultadoAplicar> {
    return this.escrever('local', async (t, relogio, mudou, seq) => {
      const copias: Registro[] = [];
      const mudaram: string[] = [];
      const entrar = async (r: Registro): Promise<void> => {
        await t.por({ ...r, base: null, baseV: null, pendente: 1, seqLocal: seq(), recusado: null });
        mudaram.push(r.id);
        mudou(r.id);
      };
      for (const bruto of d.registros) {
        if (!registroBemFormado(bruto)) continue;
        const r = limpo(bruto);
        relogio.absorver(r.versao);
        const aqui = await t.obter(r.id);
        if (!aqui) {
          await entrar(r);
          continue;
        }
        if (aqui.colecao !== r.colecao || aqui.versao === r.versao) continue;
        // o mesmo registro já existe neste dono: mescla como se o daqui fosse o do servidor
        const m = mesclar({ local: r, servidor: aqui, baseV: null });
        if (!m.igualAoServidor) {
          await t.por({ ...aqui, versao: relogio.agora(), apagado: m.apagado, dados: m.dados, pendente: 1, seqLocal: seq(), recusado: null });
          mudaram.push(r.id);
          mudou(r.id);
        }
        if (m.copia && !(await t.obter(m.copia.id))) {
          await entrar(m.copia);
          copias.push(limpo(m.copia));
        }
      }
      await reviverDonas(t, relogio, seq, [...mudaram], (id) => {
        mudaram.push(id);
        mudou(id);
      });
      for (const v of d.versoes) if (!(await t.lerLocal('versoes_cena', v.id))) await t.porLocal('versoes_cena', copiar(v));
      for (const dia of d.dias) {
        const aqui = (await t.lerLocal('escrita_dia', dia.data)) as EscritaDia | undefined;
        await t.porLocal('escrita_dia', { data: dia.data, palavras: (aqui?.palavras ?? 0) + dia.palavras });
      }
      const config = ((await t.lerMeta('config')) as Record<string, unknown> | undefined) ?? {};
      await t.porMeta('config', { ...d.config, ...config });
      return { mudaram, copias };
    });
  }

  async limpar(): Promise<void> {
    const relogio = await this.preparar();
    const ids = await this.transacao(true, async (t) => {
      const todos = (await t.todos()).map((g) => g.id);
      await t.limpar();
      // o aparelho e o relógio continuam: uma versão nova nunca repete uma antiga
      await t.porMeta('aparelho', relogio.aparelho);
      if (relogio.ultimo) await t.porMeta('relogio', relogio.ultimo);
      return todos;
    });
    if (ids.length) this.avisar({ origem: 'local', ids });
  }

  esquecer(d: Despejo): Promise<void> {
    return this.escrever('local', async (t, _relogio, mudou) => {
      for (const r of d.registros) {
        const g = await t.obter(r.id);
        if (g && g.versao === r.versao) {
          await t.tirar(r.id);
          mudou(r.id);
        }
      }
      for (const v of d.versoes) await t.tirarLocal('versoes_cena', v.id);
      for (const dia of d.dias) {
        const aqui = (await t.lerLocal('escrita_dia', dia.data)) as EscritaDia | undefined;
        const resto = (aqui?.palavras ?? 0) - dia.palavras;
        if (resto === 0) await t.tirarLocal('escrita_dia', dia.data);
        else await t.porLocal('escrita_dia', { data: dia.data, palavras: resto });
      }
    });
  }
}

/** As coleções que pertencem a uma história (apagar a história leva estas junto). */
const DA_HISTORIA = ['capitulos', 'cenas', 'personagens'] as const;

/**
 * Um capítulo, uma cena ou um personagem VIVO numa história APAGADA (um aparelho apagou a história,
 * outro continuou escrevendo numa cena dela, e a edição mais nova trouxe a cena de volta) ficaria
 * sem caminho na tela. Então a história volta também, com tudo o que foi apagado junto com ela (a
 * mesma regra de `Escrita.restaurar`). Vira mudança deste aparelho e sobe para os outros.
 */
async function reviverDonas(t: Transacao, relogio: Relogio, seq: () => number, ids: readonly string[], marcar: (id: string) => void): Promise<void> {
  const mortas = new Set<string>();
  for (const id of new Set(ids)) {
    const g = await t.obter(id);
    if (!g || g.apagado || !(DA_HISTORIA as readonly string[]).includes(g.colecao)) continue;
    const h = g.dados['historia'];
    if (typeof h !== 'string') continue;
    const dona = await t.obter(h);
    if (dona && dona.colecao === 'historias' && dona.apagado) mortas.add(h);
  }
  for (const h of mortas) {
    const dona = (await t.obter(h))!;
    const quando = versoesDe(dona.dados)['apagado'];
    const versao = relogio.agora();
    const reviver = async (g: Guardado): Promise<void> => {
      const dados: Dados = { ...g.dados, _v: { ...versoesDe(g.dados), apagado: versao } };
      await t.por({ ...g, versao, apagado: false, dados, pendente: 1, seqLocal: seq(), recusado: null });
      marcar(g.id);
    };
    await reviver(dona);
    if (quando === undefined) continue;
    for (const c of DA_HISTORIA) {
      for (const filho of await t.daColecao(c)) {
        if (filho.dados['historia'] === h && filho.apagado && versoesDe(filho.dados)['apagado'] === quando) await reviver(filho);
      }
    }
  }
}

/**
 * Quem escreveu sem conta e depois entrou: leva tudo do armazém `origem` (o `local`) para o da
 * conta e tira da origem o que foi levado. Os registros entram como mudanças pendentes e sobem na
 * sincronização. O que outra aba gravou na origem DURANTE a mudança não sai de lá: fica para ser
 * levado da próxima vez (nada se perde).
 */
export async function adotar(origem: Armazem, destino: Armazem): Promise<ResultadoAplicar> {
  const despejo = await origem.despejar();
  const r = await destino.receber(despejo);
  await origem.esquecer(despejo);
  return r;
}

// ---------- o adaptador de memória ----------

interface Estado {
  registros: Map<string, Guardado>;
  meta: Map<string, unknown>;
  versoes_cena: Map<string, VersaoCena>;
  escrita_dia: Map<string, EscritaDia>;
}

const chaveLocal = (loja: LojaLocal, valor: VersaoCena | EscritaDia): string => (loja === 'versoes_cena' ? (valor as VersaoCena).id : (valor as EscritaDia).data);

/**
 * Armazém em memória: para os testes e como ÚLTIMO recurso (IndexedDB bloqueado; no Writer OS,
 * quando não há onde gravar). Some ao fechar: o app mostra o aviso do §4.4.
 */
export class ArmazemMemoria extends ArmazemComum {
  private estado: Estado = { registros: new Map(), meta: new Map(), versoes_cena: new Map(), escrita_dia: new Map() };
  private vez: Promise<unknown> = Promise.resolve();

  protected transacao<T>(escreve: boolean, f: (t: Transacao) => Promise<T>): Promise<T> {
    const rodar = async (): Promise<T> => {
      const e: Estado = escreve
        ? { registros: new Map(this.estado.registros), meta: new Map(this.estado.meta), versoes_cena: new Map(this.estado.versoes_cena), escrita_dia: new Map(this.estado.escrita_dia) }
        : this.estado;
      const t: Transacao = {
        obter: async (id) => copiar(e.registros.get(id)),
        por: async (g) => void e.registros.set(g.id, copiar(g)),
        tirar: async (id) => void e.registros.delete(id),
        daColecao: async (colecao) => copiar([...e.registros.values()].filter((g) => g.colecao === colecao)),
        pendentes: async () => copiar([...e.registros.values()].filter((g) => g.pendente === 1)),
        todos: async () => copiar([...e.registros.values()]),
        lerMeta: async (chave) => copiar(e.meta.get(chave)),
        porMeta: async (chave, valor) => void e.meta.set(chave, copiar(valor)),
        lerLocal: async (loja, chave) => copiar(e[loja].get(chave)),
        listarLocal: async (loja, cena) => copiar([...e[loja].values()].filter((v) => cena === undefined || (v as VersaoCena).cena === cena)),
        porLocal: async (loja, valor) => void (e[loja] as Map<string, VersaoCena | EscritaDia>).set(chaveLocal(loja, valor), copiar(valor)),
        tirarLocal: async (loja, chave) => void e[loja].delete(chave),
        limpar: async () => {
          e.registros.clear();
          e.meta.clear();
          e.versoes_cena.clear();
          e.escrita_dia.clear();
        },
      };
      const saida = await f(t);
      if (escreve) this.estado = e; // só vale se `f` chegou ao fim
      return saida;
    };
    const p = this.vez.then(rodar, rodar);
    this.vez = p.catch(() => undefined);
    return p;
  }

  fechar(): void {
    // nada a fechar
  }
}
