// SPDX-License-Identifier: MPL-2.0

/**
 * O SINCRONIZADOR (docs/writer/PLANO.md §4 e §5): roda por trás, sozinho. Cada ciclo PUXA o que
 * mudou no servidor (com cursor, página por página), ENVIA a fila de saída em lotes e, se o
 * servidor responder "conflito", mescla (`conflito.ts`) e reenvia na volta seguinte.
 *
 * Nunca perde o que está na fila: um registro só sai dela quando o servidor diz "aceito". Se a
 * rede cair, tenta de novo em 10 s, 30 s, 1 min, 2 min e 5 min (e fica nos 5 min), e na hora em que
 * a rede volta. O `estado` é o que o indicador do rodapé mostra (§4.4).
 */
import type { Armazem } from './armazem.ts';
import type { Registro, RegistroEnvio } from './modelo.ts';
import { MAX_POR_PEDIDO, type Envio, type Transporte } from './transporte.ts';

/** As esperas entre tentativas depois de uma falha (a última se repete). */
export const ESPERAS = [10_000, 30_000, 60_000, 120_000, 300_000] as const;
/** Quantas voltas de puxar + enviar um ciclo dá antes de deixar o resto para o ciclo seguinte. */
const MAX_VOLTAS = 8;
/** Erros do pedido inteiro que um registro do lote pode causar: o lote é dividido para achar qual. */
const ERROS_DO_LOTE = new Set(['grande', 'vazio', 'dados']);

/**
 * - `em-dia`: tudo na nuvem;
 * - `enviando`: sincronizando agora (ou há fila e o próximo ciclo já está marcado);
 * - `sem-rede`: o servidor não respondeu; salvo só no aparelho, tentando de novo;
 * - `sem-conta`: ninguém entrou (ou a sessão caiu); salvo só no aparelho;
 * - `erro`: o servidor respondeu com erro (`erro` diz qual), ou recusou algum registro.
 */
export type Situacao = 'em-dia' | 'enviando' | 'sem-rede' | 'sem-conta' | 'erro';

export interface EstadoSinc {
  situacao: Situacao;
  /** Registros na fila de saída. */
  pendentes: number;
  /** Registros que o servidor recusou (ficam guardados no aparelho). */
  recusados: number;
  /** O código do erro (`cota`, `servidor`, `recusado`…), ou `null`. */
  erro: string | null;
  /** Quando foi a última sincronização completa (ms), ou `null`. */
  ultimaVez: number | null;
  /** Quando será a próxima tentativa (ms), ou `null`. */
  proximaTentativa: number | null;
  /** Quantas cópias de conflito apareceram desde que o sincronizador foi criado. */
  copias: number;
}

export interface Agendador {
  /** Chama `f` daqui a `ms`; devolve como cancelar. */
  depois(ms: number, f: () => void): () => void;
}

export interface OpcoesSincronizador {
  armazem: Armazem;
  /** `null` = sem conta: nada sai do aparelho. */
  transporte: Transporte | null;
  agora?: () => number;
  agendador?: Agendador;
  /** Avisa quando a rede volta; devolve como parar de ouvir. (Padrão: o evento `online` do navegador.) */
  aoVoltarARede?: (f: () => void) => () => void;
  /** Registros por pedido de envio (1 a 500; padrão 200). */
  lote?: number;
  /** Tamanho aproximado (caracteres do JSON) de um pedido de envio (padrão 2 milhões). */
  tamanhoDoLote?: number;
  /** Quanto esperar depois de uma mudança local antes de sincronizar (padrão 2 s). */
  atraso?: number;
  /** De quanto em quanto tempo puxar novidades quando está tudo em dia (padrão 1 min; 0 = nunca). */
  intervalo?: number;
}

class Falha extends Error {
  readonly codigo: string;
  constructor(codigo: string) {
    super(codigo);
    this.codigo = codigo;
  }
}

const relogioDeParede: Agendador = {
  depois(ms, f) {
    const t = setTimeout(f, ms);
    return () => clearTimeout(t);
  },
};

function redeDoNavegador(f: () => void): () => void {
  const g = globalThis as { addEventListener?: (tipo: string, f: () => void) => void; removeEventListener?: (tipo: string, f: () => void) => void };
  if (typeof g.addEventListener !== 'function') return () => undefined;
  g.addEventListener('online', f);
  return () => g.removeEventListener?.('online', f);
}

const semBase = (r: RegistroEnvio): Registro => ({ id: r.id, colecao: r.colecao, versao: r.versao, apagado: r.apagado, dados: r.dados });

export class Sincronizador {
  private readonly armazem: Armazem;
  private transporte: Transporte | null;
  private readonly agora: () => number;
  private readonly agendador: Agendador;
  private readonly ouvirRede: (f: () => void) => () => void;
  private readonly lote: number;
  private readonly tamanhoDoLote: number;
  private readonly atraso: number;
  private readonly intervalo: number;

  private atual: EstadoSinc = { situacao: 'sem-conta', pendentes: 0, recusados: 0, erro: null, ultimaVez: null, proximaTentativa: null, copias: 0 };
  private readonly ouvintes = new Set<(e: EstadoSinc) => void>();
  private rodando: Promise<EstadoSinc> | null = null;
  private deNovo = false;
  private falhas = 0;
  private cancelarEspera: (() => void) | null = null;
  private desligarTudo: (() => void)[] = [];
  private ligado = false;

  constructor(o: OpcoesSincronizador) {
    this.armazem = o.armazem;
    this.transporte = o.transporte;
    this.agora = o.agora ?? Date.now;
    this.agendador = o.agendador ?? relogioDeParede;
    this.ouvirRede = o.aoVoltarARede ?? redeDoNavegador;
    this.lote = Math.min(MAX_POR_PEDIDO, Math.max(1, o.lote ?? 200));
    this.tamanhoDoLote = o.tamanhoDoLote ?? 2_000_000;
    this.atraso = o.atraso ?? 2000;
    this.intervalo = o.intervalo ?? 60_000;
    this.atual = { ...this.atual, situacao: this.transporte ? 'enviando' : 'sem-conta' };
  }

  /** O estado para o indicador. */
  get estado(): EstadoSinc {
    return this.atual;
  }

  aoMudar(f: (e: EstadoSinc) => void): () => void {
    this.ouvintes.add(f);
    return () => this.ouvintes.delete(f);
  }

  private mudar(parte: Partial<EstadoSinc>): void {
    this.atual = { ...this.atual, ...parte };
    for (const f of [...this.ouvintes]) {
      try {
        f(this.atual);
      } catch {
        // um ouvinte com defeito não para a sincronização
      }
    }
  }

  /** Começa a trabalhar sozinho: sincroniza agora, a cada mudança local e quando a rede volta. */
  ligar(): void {
    if (this.ligado) return;
    this.ligado = true;
    this.desligarTudo = [
      this.armazem.aoMudar((m) => {
        if (m.origem === 'local') this.marcar(this.atraso);
      }),
      this.ouvirRede(() => this.redeVoltou()),
    ];
    void this.sincronizar();
  }

  desligar(): void {
    this.ligado = false;
    for (const f of this.desligarTudo) f();
    this.desligarTudo = [];
    this.cancelar();
  }

  /** Entrou na conta (um transporte) ou saiu (`null`). */
  trocarTransporte(transporte: Transporte | null): void {
    this.transporte = transporte;
    this.falhas = 0;
    this.cancelar();
    if (this.ligado || !transporte) void this.sincronizar();
  }

  /** A rede voltou: tenta agora, sem esperar o resto da espera. */
  redeVoltou(): void {
    if (!this.transporte) return;
    this.falhas = 0;
    this.cancelar();
    void this.sincronizar();
  }

  private cancelar(): void {
    this.cancelarEspera?.();
    this.cancelarEspera = null;
    if (this.atual.proximaTentativa !== null) this.mudar({ proximaTentativa: null });
  }

  /** Marca um ciclo para daqui a `ms` (se já houver um marcado para antes, fica o que vem antes). */
  private marcar(ms: number): void {
    const quando = this.agora() + ms;
    if (this.cancelarEspera && this.atual.proximaTentativa !== null && this.atual.proximaTentativa <= quando) return;
    this.cancelarEspera?.();
    this.cancelarEspera = this.agendador.depois(ms, () => {
      this.cancelarEspera = null;
      this.atual = { ...this.atual, proximaTentativa: null };
      void this.sincronizar();
    });
    this.mudar({ proximaTentativa: quando });
  }

  /**
   * Sincroniza agora. Chamadas ao mesmo tempo viram uma só (e, se algo mudou no meio, roda mais
   * um ciclo no fim). Nunca lança: a falha vai para o `estado`.
   */
  sincronizar(): Promise<EstadoSinc> {
    if (this.rodando) {
      this.deNovo = true;
      return this.rodando;
    }
    this.rodando = (async () => {
      try {
        do {
          this.deNovo = false;
          await this.ciclo();
        } while (this.deNovo && this.atual.situacao !== 'sem-rede' && this.atual.situacao !== 'sem-conta');
      } catch {
        // o armazém foi fechado no meio (a pessoa saiu da conta, a sessão acabou): não há o que fazer
      } finally {
        this.rodando = null;
      }
      return this.atual;
    })();
    return this.rodando;
  }

  private async ciclo(): Promise<void> {
    const transporte = this.transporte;
    if (!transporte) {
      this.mudar({ situacao: 'sem-conta', erro: null, ...(await this.armazem.pendentes().then((p) => ({ pendentes: p.fila, recusados: p.recusados }))) });
      return;
    }
    this.cancelar();
    this.mudar({ situacao: 'enviando', erro: null });
    try {
      for (let volta = 0; volta < MAX_VOLTAS; volta++) {
        await this.puxar(transporte);
        await this.enviar(transporte);
        if ((await this.armazem.pendentes()).fila === 0) break;
      }
    } catch (e) {
      const codigo = e instanceof Falha ? e.codigo : 'rede';
      const p = await this.armazem.pendentes();
      const contas = { pendentes: p.fila, recusados: p.recusados };
      if (codigo === 'login') {
        // a sessão caiu: fica só no aparelho até a pessoa entrar de novo
        this.mudar({ situacao: 'sem-conta', erro: null, ...contas });
        return;
      }
      this.mudar({ situacao: codigo === 'rede' ? 'sem-rede' : 'erro', erro: codigo === 'rede' ? null : codigo, ...contas });
      this.marcar(ESPERAS[Math.min(this.falhas, ESPERAS.length - 1)]!);
      this.falhas += 1;
      return;
    }
    this.falhas = 0;
    const p = await this.armazem.pendentes();
    const contas = { pendentes: p.fila, recusados: p.recusados, ultimaVez: this.agora() };
    if (p.fila > 0) {
      // sobrou fila (mudou algo durante o ciclo, ou muitos conflitos seguidos): segue no próximo
      this.mudar({ situacao: 'enviando', erro: null, ...contas });
      this.marcar(this.atraso);
    } else if (p.recusados > 0) {
      this.mudar({ situacao: 'erro', erro: 'recusado', ...contas });
    } else {
      this.mudar({ situacao: 'em-dia', erro: null, ...contas });
    }
    if (p.fila === 0 && this.intervalo > 0 && this.ligado) this.marcar(this.intervalo);
  }

  private async puxar(transporte: Transporte): Promise<void> {
    let cursor = await this.armazem.cursorDoServidor();
    for (;;) {
      const r = await transporte.mudancas(cursor, MAX_POR_PEDIDO);
      if (!r.ok) throw new Falha(r.erro);
      if (r.registros.length) {
        const feito = await this.armazem.aplicarDoServidor(r.registros);
        if (feito.copias.length) this.mudar({ copias: this.atual.copias + feito.copias.length });
      }
      const parado = r.cursor <= cursor;
      if (r.cursor > cursor) {
        cursor = r.cursor;
        await this.armazem.guardarCursorDoServidor(cursor);
      }
      // `mais` sem o cursor andar seria um laço sem fim: para e tenta no próximo ciclo
      if (!r.mais || parado) return;
    }
  }

  private lotes(registros: readonly RegistroEnvio[]): RegistroEnvio[][] {
    const saida: RegistroEnvio[][] = [];
    let lote: RegistroEnvio[] = [];
    let tamanho = 0;
    for (const r of registros) {
      const t = JSON.stringify(r).length;
      if (lote.length && (lote.length >= this.lote || tamanho + t > this.tamanhoDoLote)) {
        saida.push(lote);
        lote = [];
        tamanho = 0;
      }
      lote.push(r);
      tamanho += t;
    }
    if (lote.length) saida.push(lote);
    return saida;
  }

  private async enviar(transporte: Transporte): Promise<void> {
    let cursorLocal = 0;
    for (;;) {
      const fila = await this.armazem.mudancasDesde(cursorLocal, this.lote);
      if (!fila.registros.length) return;
      this.mudar({ pendentes: (await this.armazem.pendentes()).fila });
      for (const lote of this.lotes(fila.registros)) await this.mandar(transporte, lote);
      if (!fila.mais) return;
      cursorLocal = fila.cursor;
    }
  }

  /** Manda um lote e guarda o que o servidor respondeu para cada registro. */
  private async mandar(transporte: Transporte, lote: readonly RegistroEnvio[]): Promise<void> {
    const ilegiveis: { r: RegistroEnvio; erro: string }[] = [];
    const algumPassou = await this.mandarDividindo(transporte, lote, ilegiveis);
    if (!ilegiveis.length) return;
    // nenhum pedido passou: o problema é do servidor (ou do caminho até ele), não de um registro
    if (!algumPassou) throw new Falha(ilegiveis[0]!.erro);
    await this.armazem.marcarRecusadas(ilegiveis.map((x) => ({ id: x.r.id, versao: x.r.versao, erro: 'invalido' })));
  }

  /**
   * Manda o lote. `grande` (o pedido não coube) ou `vazio`/`dados` (o servidor não conseguiu ler o
   * pedido: um registro estragado derruba o pedido inteiro): divide o lote até achar o culpado. Um
   * registro sozinho grande demais fica recusado; um sozinho ilegível vai para `ilegiveis`. Devolve
   * se algum pedido passou.
   */
  private async mandarDividindo(transporte: Transporte, lote: readonly RegistroEnvio[], ilegiveis: { r: RegistroEnvio; erro: string }[]): Promise<boolean> {
    const r = await transporte.enviar(lote);
    if (!r.ok) {
      if (!ERROS_DO_LOTE.has(r.erro)) throw new Falha(r.erro);
      if (lote.length === 1) {
        if (r.erro === 'grande') await this.armazem.marcarRecusadas([{ id: lote[0]!.id, versao: lote[0]!.versao, erro: 'grande_demais' }]);
        else ilegiveis.push({ r: lote[0]!, erro: r.erro });
        return false;
      }
      const meio = Math.ceil(lote.length / 2);
      const a = await this.mandarDividindo(transporte, lote.slice(0, meio), ilegiveis);
      const b = await this.mandarDividindo(transporte, lote.slice(meio), ilegiveis);
      return a || b;
    }
    await this.guardarResposta(lote, r);
    return true;
  }

  /** Guarda o que o servidor respondeu para cada registro do lote. */
  private async guardarResposta(lote: readonly RegistroEnvio[], r: Envio): Promise<void> {
    const porId = new Map(r.resultados.map((x) => [x.id, x]));
    const aceitos: Registro[] = [];
    for (const [i, enviado] of lote.entries()) {
      const naOrdem = r.resultados[i];
      const res = naOrdem?.id === enviado.id ? naOrdem : porId.get(enviado.id);
      if (!res) continue; // sem resposta para este: continua na fila
      if (res.estado === 'aceito') aceitos.push(semBase(enviado));
      else if (res.estado === 'conflito') {
        const feito = await this.armazem.aplicarDoServidor([res.servidor]);
        if (feito.copias.length) this.mudar({ copias: this.atual.copias + feito.copias.length });
      } else await this.armazem.marcarRecusadas([{ id: enviado.id, versao: enviado.versao, erro: res.erro }]);
    }
    if (aceitos.length) await this.armazem.marcarEnviadas(aceitos);
  }
}
