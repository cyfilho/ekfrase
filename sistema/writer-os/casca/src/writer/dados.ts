// SPDX-License-Identifier: MPL-2.0

/**
 * OS DADOS DO WRITER no processo principal: a pasta escolhida, o cofre (a senha), um armazém
 * SQLite cifrado por dono e o espelho `.md`. Não depende do Electron (os testes usam direto); o
 * `main.ts` liga isto às mensagens da página.
 *
 * Fluxo: pasta (a sugerida ou outra) → senha (criar, numa pasta nova; abrir, numa com textos) →
 * pergunta do espelho (a cada pasta aberta, menos quando a resposta foi "sempre neste") → o app.
 */
import { Escrita, servirArmazem, type DestinoOS, type EscolhaEspelho, type EstadoCasca, type MetodoArmazem, type Mudanca, type RespostaArmazem, type RespostaCasca, type SituacaoEspelho, SENHA_MINIMA, DONO_LOCAL } from '@ekfrase/writer-nucleo';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ErroDoBanco } from '../motor/banco.ts';
import { Cofre } from '../motor/cofre.ts';
import { EspelhoDePasta } from '../motor/espelho.ts';
import { ehPasta, FORMATO, gravarLembrado, gravarMarcador, lerLembrado, lerMarcador, pastaDoApp, pastaGravavel, type Lembrado } from '../motor/pastas.ts';
import { ArmazemSQLite } from './armazem-sqlite.ts';
import { arquivosDoEspelho } from './espelho-md.ts';

export const NOME_DA_PASTA = 'Ekfrase Writer';
export const APP = 'writer';

export interface OpcoesDados {
  /** O arquivo do que este computador lembra (`userData/casca.json`). */
  lembrado: string;
  /** A pasta sugerida (Documentos). A pasta do app fica dentro dela. */
  sugerida: string;
  nativo?: string;
  /** O servidor em uso: para separar, no disco, as contas de servidores diferentes. */
  servidor: () => { base: string; padrao: boolean };
  /** Uma mudança num armazém aberto (a casca manda para a página). */
  aoMudar?: (alca: string, m: Mudanca) => void;
  /** Quanto o espelho espera depois de uma gravação (ms; PLANO §4.5: 5 s). */
  atrasoDoEspelho?: number;
  /** No Writer OS: o modo e onde os textos estão (no computador, nada). */
  os?: () => { destino: DestinoOS | null };
}

interface Aberto {
  armazem: ArmazemSQLite;
  alcas: Set<string>;
  parar: () => void;
}

/** A pasta do espelho de cada dono, dentro da pasta do app. */
export const pastaDoEspelho = (dono: string): string => (dono === DONO_LOCAL ? 'espelho' : `espelho-conta-${dono.replace(/[^A-Za-z0-9_-]/g, '_')}`);

export class DadosDoWriter {
  private readonly o: OpcoesDados;
  private pasta: string | null = null;
  private sumiu: string | null = null;
  private cofre: Cofre | null = null;
  private espelho: SituacaoEspelho = 'perguntar';
  private readonly abertos = new Map<string, Aberto>();
  private readonly alcas = new Map<string, string>();
  private seq = 0;
  private readonly agendados = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly escrevendo = new Map<string, Promise<void>>();
  private espelhoEmDia = true;

  constructor(o: OpcoesDados) {
    this.o = o;
    const l = lerLembrado(o.lembrado);
    if (l.pasta && ehPasta(l.pasta) && lerMarcador(l.pasta)) this.pasta = l.pasta;
    else if (l.pasta) this.sumiu = l.pasta;
  }

  private lembrado(): Lembrado {
    return lerLembrado(this.o.lembrado);
  }

  get pastaDoApp(): string | null {
    return this.pasta;
  }

  get aberta(): boolean {
    return !!this.cofre?.aberto;
  }

  estado(): EstadoCasca {
    const s = this.o.servidor();
    const ligado = this.espelho === 'sim' || this.espelho === 'sempre';
    return {
      pasta: this.pasta,
      sugerida: pastaDoApp(this.o.sugerida, NOME_DA_PASTA),
      temSenha: !!this.pasta && existsSync(join(this.pasta, 'dados', 'cofre.db')),
      sumiu: this.sumiu,
      aberta: this.aberta,
      espelho: this.espelho,
      pastaEspelho: this.pasta && ligado ? this.pasta : null,
      espelhoEmDia: !ligado || (this.espelhoEmDia && this.agendados.size === 0 && this.escrevendo.size === 0),
      servidor: s.base,
      servidorPadrao: s.padrao,
      modo: this.o.os ? 'os' : 'computador',
      destino: this.o.os ? this.o.os().destino : null,
    };
  }

  /** O cofre aberto (o Writer OS guarda nele as redes Wi-Fi e o que a página lembra). */
  get cofreAberto(): Cofre | null {
    return this.cofre?.aberto ? this.cofre : null;
  }

  /** O armazém aberto de um dono (o agente de teste do Writer OS confere a integridade). */
  armazemAberto(dono: string): ArmazemSQLite | null {
    return this.abertos.get(this.donoNoDisco(dono))?.armazem ?? null;
  }

  /** Usa esta pasta (a escolhida; a pasta do app fica dentro dela, se ela já não for a do app). */
  async usarPasta(escolhida: string): Promise<RespostaCasca> {
    if (!escolhida) return { ok: false, erro: 'pasta' };
    const pasta = pastaDoApp(escolhida, NOME_DA_PASTA);
    if (!pastaGravavel(pasta)) return { ok: false, erro: 'pasta' };
    await this.trancar();
    this.pasta = pasta;
    this.sumiu = null;
    this.espelho = 'perguntar';
    gravarLembrado(this.o.lembrado, { ...this.lembrado(), pasta });
    return { ok: true, estado: this.estado() };
  }

  private depoisDeAbrir(): void {
    const m = this.pasta ? lerMarcador(this.pasta) : null;
    this.espelho = m?.espelho === 'sempre' ? 'sempre' : 'perguntar';
  }

  /** Pasta nova: cria a senha (DEC-P063: obrigatória) e abre. */
  async criarSenha(senha: string): Promise<RespostaCasca> {
    if (!this.pasta) return { ok: false, erro: 'pasta' };
    if (typeof senha !== 'string' || senha.length < SENHA_MINIMA) return { ok: false, erro: 'senha-curta' };
    const cofre = new Cofre(this.pasta, this.o.nativo);
    if (cofre.temSenha) return { ok: false, erro: 'nao-abre' };
    try {
      cofre.criar(senha);
      gravarMarcador(this.pasta, { formato: FORMATO, app: APP, espelho: null });
    } catch {
      cofre.fechar();
      return { ok: false, erro: 'pasta' };
    }
    this.cofre = cofre;
    this.depoisDeAbrir();
    return { ok: true, estado: this.estado() };
  }

  /** Pasta com textos: abre com a senha. */
  async abrir(senha: string): Promise<RespostaCasca> {
    if (!this.pasta) return { ok: false, erro: 'pasta' };
    const cofre = new Cofre(this.pasta, this.o.nativo);
    try {
      cofre.abrir(typeof senha === 'string' ? senha : '');
    } catch (e) {
      cofre.fechar();
      return { ok: false, erro: e instanceof ErroDoBanco && (e.codigo === 'senha' || e.codigo === 'sem-senha') ? 'senha' : 'nao-abre' };
    }
    this.cofre = cofre;
    this.depoisDeAbrir();
    return { ok: true, estado: this.estado() };
  }

  /** Fecha os textos: o espelho termina, os bancos fecham, a senha sai da memória. */
  async trancar(): Promise<EstadoCasca> {
    await this.descarregar();
    for (const [dono, a] of this.abertos) {
      a.parar();
      a.armazem.fechar();
      await a.armazem.terminar();
      this.abertos.delete(dono);
    }
    this.alcas.clear();
    this.cofre?.fechar();
    this.cofre = null;
    this.espelho = 'perguntar';
    return this.estado();
  }

  async responderEspelho(escolha: EscolhaEspelho): Promise<EstadoCasca> {
    if (escolha !== 'sim' && escolha !== 'sempre' && escolha !== 'nao') return this.estado();
    this.espelho = escolha;
    if (this.pasta) {
      const m = lerMarcador(this.pasta) ?? { formato: FORMATO, app: APP, espelho: null };
      const sempre = escolha === 'sempre' ? 'sempre' : null;
      if (m.espelho !== sempre) gravarMarcador(this.pasta, { ...m, espelho: sempre });
    }
    if (escolha !== 'nao') for (const dono of this.abertos.keys()) this.agendar(dono, 0);
    return this.estado();
  }

  // ---------- os armazéns ----------

  /** O dono como fica no disco: a conta de outro servidor não se mistura com a do ekfrase.com. */
  private donoNoDisco(dono: string): string {
    const s = this.o.servidor();
    if (dono === DONO_LOCAL || s.padrao) return dono;
    let host = 'outro';
    try {
      host = new URL(s.base).host;
    } catch {
      // fica "outro"
    }
    return `${host}-${dono}`;
  }

  async abrirArmazem(dono: string): Promise<string> {
    if (!this.cofre?.aberto || !this.pasta) throw new ErroDoBanco('sem-senha');
    if (typeof dono !== 'string' || !dono) throw new Error('dono');
    const disco = this.donoNoDisco(dono);
    let a = this.abertos.get(disco);
    if (!a) {
      const armazem = await ArmazemSQLite.abrir({ pasta: this.cofre.pastaDosBancos, senha: this.cofre.senha, dono: disco, ...(this.o.nativo ? { nativo: this.o.nativo } : {}) });
      const aberto: Aberto = { armazem, alcas: new Set(), parar: () => undefined };
      aberto.parar = armazem.aoMudar((m) => {
        for (const alca of aberto.alcas) this.o.aoMudar?.(alca, m);
        this.agendar(disco);
      });
      a = aberto;
      this.abertos.set(disco, a);
      this.agendar(disco);
    }
    const alca = `${disco}#${++this.seq}`;
    a.alcas.add(alca);
    this.alcas.set(alca, disco);
    return alca;
  }

  async chamar(alca: string, metodo: MetodoArmazem, args: unknown[]): Promise<RespostaArmazem> {
    const disco = this.alcas.get(alca);
    const a = disco ? this.abertos.get(disco) : undefined;
    if (!a) return { ok: false, nome: 'Error', codigo: 'fechado', id: null, mensagem: 'armazém fechado' };
    return servirArmazem(a.armazem, metodo, args);
  }

  fecharAlca(alca: string): void {
    const disco = this.alcas.get(alca);
    this.alcas.delete(alca);
    const a = disco ? this.abertos.get(disco) : undefined;
    if (!a || !disco) return;
    a.alcas.delete(alca);
    // o banco fica aberto até trancar: abrir de novo (trocar de conta e voltar) é imediato
  }

  // ---------- o rascunho de emergência ----------

  porRascunho(chave: string, valor: string): boolean {
    return typeof chave === 'string' && typeof valor === 'string' && !!this.cofre?.porRascunho(chave, valor);
  }
  tirarRascunho(chave: string): void {
    if (typeof chave === 'string') this.cofre?.tirarRascunho(chave);
  }
  rascunhos(): Record<string, string> {
    return this.cofre?.rascunhos() ?? {};
  }

  // ---------- o espelho ----------

  private get espelhoLigado(): boolean {
    return this.espelho === 'sim' || this.espelho === 'sempre';
  }

  private agendar(disco: string, atraso = this.o.atrasoDoEspelho ?? 5000): void {
    if (!this.espelhoLigado) return;
    const antes = this.agendados.get(disco);
    if (antes) clearTimeout(antes);
    this.agendados.set(
      disco,
      setTimeout(() => {
        this.agendados.delete(disco);
        void this.escreverEspelho(disco);
      }, atraso),
    );
  }

  private escreverEspelho(disco: string): Promise<void> {
    const anterior = this.escrevendo.get(disco) ?? Promise.resolve();
    const agora = anterior.then(async () => {
      const a = this.abertos.get(disco);
      if (!a || !this.pasta || !this.espelhoLigado) return;
      try {
        const arquivos = await arquivosDoEspelho(new Escrita(a.armazem));
        new EspelhoDePasta(join(this.pasta, pastaDoEspelho(disco))).sincronizar(arquivos);
        this.espelhoEmDia = true;
      } catch {
        // pendrive saiu, disco cheio…: fica marcado e tenta de novo na próxima gravação
        this.espelhoEmDia = false;
      }
    });
    const fim = agora.finally(() => {
      if (this.escrevendo.get(disco) === fim) this.escrevendo.delete(disco);
    });
    this.escrevendo.set(disco, fim);
    return fim;
  }

  /** Escreve AGORA o espelho que estava esperando (antes de fechar, de trancar, e nos testes). */
  async descarregar(): Promise<void> {
    const esperando = [...this.agendados.keys()];
    for (const d of esperando) {
      clearTimeout(this.agendados.get(d));
      this.agendados.delete(d);
      void this.escreverEspelho(d);
    }
    await Promise.allSettled([...this.escrevendo.values()]);
  }
}
