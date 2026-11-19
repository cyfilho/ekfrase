// SPDX-License-Identifier: MPL-2.0

/**
 * O WRITER OS SE ATUALIZA (DEC-P072, docs/ATUALIZACOES.md §1 e §4, U1): a casca (usuário writer) procura no Release
 * `writer-os-v*` do público, baixa para a partição de dados (`/dados/Ekfrase Writer/.atualizacao/<versão>/`, com
 * retomada) e confere o lacre do manifesto e o SHA-256 de cada arquivo; depois pede ao `ekfrase-atualizar.service`
 * (root) que grave a versão na cópia de reserva do sistema. Ele confere tudo DE NOVO antes de gravar. A nova vale na
 * próxima vez que ligar; quando a janela abre por ela, a casca confirma (`confirmar`). Se a nova não ligar duas vezes,
 * o GRUB volta para a de antes e o estado diz `voltou`.
 *
 * "Automáticas" (o padrão): procura 20 s depois de abrir e a cada 6 horas (sem internet, tenta de novo mais cedo);
 * achou, baixa e deixa pronta, sem perguntar e sem reiniciar. "Perguntar": achou = `disponivel`, e só baixa no
 * "Instalar". Nunca para trás: só uma versão MAIOR que a de agora, e nunca de novo a que já não ligou.
 */
import {
  API_GITHUB,
  arquivoDe,
  baixarArquivo,
  baixarTexto,
  CHAVE_EKFRASE,
  conferirManifesto,
  ErroBaixar,
  ErroManifesto,
  ehVersao,
  INTERVALO_MS,
  lancamentos,
  maisNova,
  nomeDoManifesto,
  proximaBusca,
  sha256DoArquivo,
  type Buscar,
  type Lancamento,
  type Manifesto,
} from '@ekfrase/atualizacoes';
import type { ErroAtualizacao, EstadoAtualizacoes, ModoAtualizacoes } from '@ekfrase/writer-nucleo';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EstadoBoot, Sistema } from '../motor/sistema.ts';

export const PREFIXO_OS = 'writer-os-v';
export const APP_OS = 'ekfrase-writer-os';
export const NOME_OS = 'Ekfrase Writer OS';

export interface OpcoesAtualizacoesOS {
  sistema: Sistema;
  /** Onde baixar (`/dados/Ekfrase Writer/.atualizacao`); `null` = sem a partição de dados. */
  pasta: () => string | null;
  modo: () => ModoAtualizacoes;
  gravarModo: (m: ModoAtualizacoes) => void;
  buscar?: Buscar;
  api?: string;
  /** As chaves em que se confia (a da Ekfrase; nos testes, mais uma). */
  chaves?: readonly string[];
  /** A primeira busca depois de abrir (padrão 20 s: a rede tem tempo de conectar). */
  atrasoInicial?: number;
  intervalo?: number;
  /** Só o teste da volta (qemu.py teste_voltar): a casca não confirma a cópia nova. */
  naoConfirmar?: boolean;
}

/** A cada quantos bytes o download desce ao disco (`baixarArquivo`, `gravarACada`). */
export const GRAVAR_A_CADA = 16 << 20;

const vazio = (): EstadoAtualizacoes => ({ modo: 'automaticas', versao: '?', canal: 'estavel', situacao: 'parado', nova: null, feito: 0, total: 0, erro: null, ultimaBusca: null, voltou: null });

export class AtualizacoesOS {
  private readonly o: OpcoesAtualizacoesOS;
  private e: EstadoAtualizacoes = vazio();
  private boot: EstadoBoot | null = null;
  private achada: Lancamento | null = null;
  private emCurso: Promise<void> | null = null;
  private relogio: ReturnType<typeof setTimeout> | null = null;
  private falhas = 0;
  private readonly ouvintes = new Set<(e: EstadoAtualizacoes) => void>();
  /** Só o agente de teste: uma linha por mudança de situação (`atualizacao …`). */
  aoRelatar: ((linha: string) => void) | null = null;

  constructor(o: OpcoesAtualizacoesOS) {
    this.o = o;
    this.e.modo = o.modo();
    this.e.versao = o.sistema.versao();
    this.e.canal = o.sistema.canal();
  }

  /** Lê as duas cópias e marca a primeira busca. */
  async iniciar(): Promise<void> {
    await this.lerBoot();
    this.relatar(`atualizacao boot ${this.boot ? `${this.boot.lado} ${this.boot.versao} atual=${this.boot.atual} novo=${this.boot.novo?.lado ?? '-'} falhou=${this.boot.falhou?.lado ?? '-'}` : 'sem-servico'}`);
    if (this.e.voltou) this.relatar(`atualizacao voltou ${this.e.voltou.de} ${this.e.voltou.para}`);
    this.marcar(this.o.atrasoInicial ?? 20_000);
  }

  parar(): void {
    if (this.relogio) clearTimeout(this.relogio);
    this.relogio = null;
  }

  estado(): EstadoAtualizacoes {
    return structuredClone(this.e);
  }

  aoMudar(f: (e: EstadoAtualizacoes) => void): () => void {
    this.ouvintes.add(f);
    return () => void this.ouvintes.delete(f);
  }

  /** "Procurar agora": com o modo automáticas, achou = já baixa e deixa pronta. */
  async procurar(): Promise<EstadoAtualizacoes> {
    await this.vez(() => this.buscar(this.o.modo() === 'automaticas'));
    return this.estado();
  }

  /** "Instalar" (o modo perguntar): baixa e aplica a que foi achada. */
  async instalar(): Promise<EstadoAtualizacoes> {
    await this.vez(async () => {
      if (!this.achada || this.e.situacao !== 'disponivel') await this.buscar(false);
      if (this.achada && this.e.situacao === 'disponivel') await this.baixarEAplicar(this.achada);
    });
    return this.estado();
  }

  usarModo(m: ModoAtualizacoes): EstadoAtualizacoes {
    if (m !== 'automaticas' && m !== 'perguntar') return this.estado();
    this.o.gravarModo(m);
    this.mudar({ modo: m });
    // passou para automáticas com uma esperando: instala já
    if (m === 'automaticas' && this.e.situacao === 'disponivel' && this.achada) {
      const l = this.achada;
      void this.vez(() => this.baixarEAplicar(l));
    }
    return this.estado();
  }

  /**
   * A janela do Writer abriu (a sessão está pronta): se ligou por uma cópia nova, ela passa a valer. Sem isto, o GRUB
   * volta para a de antes depois de duas tentativas.
   */
  async confirmar(): Promise<void> {
    if (!this.boot) await this.lerBoot();
    const b = this.boot;
    if (!b) return;
    const precisa = b.novo?.lado === b.lado || b.atual !== b.lado;
    if (!precisa) return;
    if (this.o.naoConfirmar) {
      this.relatar(`atualizacao sem-confirmar ${b.lado}`);
      return;
    }
    const ok = await this.o.sistema.confirmarBoot();
    this.relatar(`atualizacao ${ok ? 'confirmada' : 'nao-confirmou'} ${b.lado} ${b.versao}`);
    await this.lerBoot();
  }

  // ---------- por dentro ----------

  private relatar(l: string): void {
    this.aoRelatar?.(l);
  }

  private mudar(m: Partial<EstadoAtualizacoes>): void {
    const antes = this.e.situacao;
    this.e = { ...this.e, ...m };
    if (this.e.situacao !== antes || m.erro !== undefined) this.relatar(`atualizacao ${this.e.situacao} ${this.e.nova ?? '-'} ${this.e.erro ?? '-'}`);
    const copia = this.estado();
    for (const f of [...this.ouvintes]) {
      try {
        f(copia);
      } catch {
        // um ouvinte com defeito não derruba os outros
      }
    }
  }

  /** Uma coisa por vez (a busca automática e o botão não se atropelam). */
  private async vez(f: () => Promise<void>): Promise<void> {
    while (this.emCurso) await this.emCurso.catch(() => undefined);
    const p = f().finally(() => {
      if (this.emCurso === p) this.emCurso = null;
    });
    this.emCurso = p;
    await p.catch(() => undefined);
  }

  private marcar(ms: number): void {
    if (this.relogio) clearTimeout(this.relogio);
    this.relogio = setTimeout(() => {
      this.relogio = null;
      void this.vez(() => this.buscar(this.o.modo() === 'automaticas')).finally(() => {
        if (!this.relogio) this.marcar(proximaBusca(this.falhas, this.o.intervalo ?? INTERVALO_MS));
      });
    }, ms);
    (this.relogio as { unref?: () => void }).unref?.();
  }

  private async lerBoot(): Promise<void> {
    const b = await this.o.sistema.estadoBoot();
    this.boot = b;
    // a versão de agora: a da cópia que ligou (o arquivo versao dela), senão a do sistema
    const versao = b && ehVersao(b.versao) ? b.versao : this.o.sistema.versao();
    const voltou = b?.falhou && b.falhou.lado !== b.lado ? { de: b.falhou.versao, para: versao } : null;
    this.mudar({ versao, voltou });
  }

  /** O Release mais novo que vale instalar (ou `null`: em dia). */
  private escolher(lista: Lancamento[]): Lancamento | null {
    const falhou = this.e.voltou?.de;
    for (const l of lista) {
      if (!maisNova(l.versao, this.e.versao)) return null;
      // a que não ligou não volta (só uma maior que ela)
      if (falhou && !maisNova(l.versao, falhou)) return null;
      if (arquivoDe(l, nomeDoManifesto(APP_OS, l.versao)) && arquivoDe(l, `${nomeDoManifesto(APP_OS, l.versao)}.minisig`)) return l;
    }
    return null;
  }

  private async buscar(instalar: boolean): Promise<void> {
    if (this.e.situacao === 'baixando' || this.e.situacao === 'aplicando') return;
    this.mudar({ situacao: 'procurando', erro: null });
    let lista: Lancamento[];
    try {
      lista = await lancamentos(this.o.buscar ?? fetch, { prefixo: PREFIXO_OS, canal: this.e.canal, api: this.o.api ?? API_GITHUB, agente: 'Ekfrase-Writer-OS' });
    } catch (e) {
      this.falhas++;
      this.mudar({ situacao: 'erro', erro: e instanceof ErroBaixar && e.codigo === 'sem-espaco' ? 'sem-espaco' : 'sem-rede', ultimaBusca: Date.now() });
      return;
    }
    this.falhas = 0;
    const l = this.escolher(lista);
    const pronta = this.boot?.novo && this.boot.novo.lado !== this.boot.lado ? this.boot.novo.versao : null;
    if (!l || l.versao === pronta) {
      this.achada = null;
      this.mudar(pronta ? { situacao: 'pronta', nova: pronta, ultimaBusca: Date.now() } : { situacao: 'em-dia', nova: null, ultimaBusca: Date.now() });
      return;
    }
    this.achada = l;
    this.mudar({ situacao: 'disponivel', nova: l.versao, ultimaBusca: Date.now() });
    if (instalar) await this.baixarEAplicar(l);
  }

  private falhar(erro: ErroAtualizacao): void {
    this.mudar({ situacao: 'erro', erro, feito: 0, total: 0 });
  }

  private async baixarEAplicar(l: Lancamento): Promise<void> {
    const raiz = this.o.pasta();
    if (!raiz) return this.falhar('sem-dados');
    const buscar = this.o.buscar ?? fetch;
    const pasta = join(raiz, l.versao);
    this.mudar({ situacao: 'baixando', nova: l.versao, feito: 0, total: 0, erro: null });
    let m: Manifesto;
    try {
      mkdirSync(pasta, { recursive: true });
      // as versões que ficaram de outras vezes saem (cada uma tem ~560 MB)
      for (const p of readdirSync(raiz)) if (p !== l.versao) rmSync(join(raiz, p), { recursive: true, force: true });
      const nome = nomeDoManifesto(APP_OS, l.versao);
      const texto = await baixarTexto(buscar, arquivoDe(l, nome)!.url, { maximo: 65536 });
      const sig = await baixarTexto(buscar, arquivoDe(l, `${nome}.minisig`)!.url, { maximo: 4096 });
      m = conferirManifesto(texto, sig, { chaves: this.o.chaves ?? [CHAVE_EKFRASE], app: APP_OS, nome: NOME_OS, versao: l.versao });
      writeFileSync(join(pasta, nome), texto);
      writeFileSync(join(pasta, `${nome}.minisig`), sig);
      const total = m.arquivos.reduce((s, a) => s + a.tamanho, 0);
      let antes = 0;
      this.mudar({ total });
      for (const a of m.arquivos) {
        const destino = join(pasta, a.nome);
        const url = arquivoDe(l, a.nome)?.url;
        if (!url) throw new ErroManifesto('formato', `falta ${a.nome} no Release`);
        // já baixado de outra vez (a casca fechou no meio): só confere
        const pronto = existsSync(destino) && statSync(destino).size === a.tamanho && (await sha256DoArquivo(destino)) === a.sha256;
        if (!pronto) {
          rmSync(destino, { force: true });
          let ultimo = 0;
          const inicio = Date.now();
          this.relatar(`baixar inicio ${a.nome} ${a.tamanho}`);
          await baixarArquivo(buscar, url, destino, {
            tamanho: a.tamanho,
            agente: 'Ekfrase-Writer-OS',
            // o que veio desce ao disco a cada 16 MB: os ~560 MB não ficam na memória para descer de uma vez no fim,
            // com o banco dos textos (no mesmo disco) esperando junto (a trava da writer-os-v0.2.0-teste.7)
            gravarACada: GRAVAR_A_CADA,
            aoTentarDeNovo: (n, feito, motivo) => this.relatar(`baixar de-novo ${a.nome} ${n} ${feito} ${motivo.replace(/\s+/g, '_').slice(0, 80)}`),
            aoBaixar: (feito) => {
              // o andamento vai à página a cada 4 MB (não a cada pedaço)
              if (feito - ultimo >= 4 << 20 || feito === a.tamanho) {
                ultimo = feito;
                this.mudar({ feito: antes + feito });
              }
            },
          });
          this.relatar(`baixar fim ${a.nome} ${statSync(destino).size} ${Date.now() - inicio}ms`);
          if ((await sha256DoArquivo(destino)) !== a.sha256) {
            rmSync(destino, { force: true });
            throw new ErroManifesto('lacre', a.nome);
          }
          this.relatar(`baixar conferido ${a.nome}`);
        } else this.relatar(`baixar ja-estava ${a.nome}`);
        antes += a.tamanho;
        this.mudar({ feito: antes });
      }
    } catch (e) {
      this.relatar(`baixar erro ${e instanceof ErroBaixar ? e.codigo : e instanceof ErroManifesto ? e.motivo :((e as NodeJS.ErrnoException).code ?? '-')} ${String((e as Error).message ?? e).replace(/\s+/g, '_').slice(0, 120)}`);
      if (e instanceof ErroManifesto) {
        rmSync(pasta, { recursive: true, force: true });
        return this.falhar('lacre');
      }
      if (e instanceof ErroBaixar) return this.falhar(e.codigo === 'sem-espaco' ? 'sem-espaco' : 'sem-rede');
      if ((e as NodeJS.ErrnoException).code === 'ENOSPC') return this.falhar('sem-espaco');
      return this.falhar('falhou');
    }

    // a cópia de reserva (o serviço root confere tudo de novo antes de gravar)
    this.mudar({ situacao: 'aplicando', feito: 0, total: 0 });
    const r = await this.o.sistema.aplicarAtualizacao(m.versao, (passo, feito, total) => {
      if (passo === 'copiar') this.mudar({ feito, total });
    });
    if (!r.ok) {
      this.relatar(`atualizacao aplicar-erro ${r.erro}`);
      if (r.erro === 'lacre' || r.erro === 'conferir' || r.erro === 'arquivos') rmSync(pasta, { recursive: true, force: true });
      return this.falhar(r.erro === 'pendente' ? 'pendente' : r.erro === 'sem-espaco' ? 'sem-espaco' : r.erro === 'lacre' || r.erro === 'conferir' ? 'lacre' : 'falhou');
    }
    // já está na partição de boot: o que foi baixado sai da partição de dados
    rmSync(pasta, { recursive: true, force: true });
    this.achada = null;
    await this.lerBoot();
    this.mudar({ situacao: 'pronta', nova: m.versao, feito: 0, total: 0, erro: null });
  }
}
