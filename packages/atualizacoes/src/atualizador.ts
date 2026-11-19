// SPDX-License-Identifier: MPL-2.0

/**
 * O ATUALIZADOR dos apps de computador que se atualizam trocando UM arquivo (DEC-P072, docs/ATUALIZACOES.md §5, U2): o
 * Writer no computador (o instalador NSIS no Windows, o AppImage no Linux) e o Gravador (o `.exe` portátil, o AppImage).
 * O Writer OS tem o dele (a cópia de reserva do sistema: `casca/src/writer/atualizacoes-os.ts`).
 *
 * O caminho: procura no Release do público pelo prefixo e pelo canal; o manifesto `<app>-<v>.atualizacao.json` + o
 * `.minisig` dele dizem o arquivo de cada sistema (o `papel`: `windows`, `linux`) com o tamanho e o SHA-256; baixa com
 * retomada para `<pasta>/<versão>/`, confere o lacre e o SHA-256 e passa o arquivo a `preparar` (cada app sabe o que
 * fazer com ele: trocar o AppImage já, ou guardar o instalador para rodar ao fechar). Feito isso, a situação é `pronta`.
 *
 * "Automáticas" (o padrão): procura logo depois de abrir e a cada 6 horas; achou, baixa, confere e deixa pronta, sem
 * perguntar e sem reiniciar. "Perguntar": achou = `disponivel`, e só baixa no "Instalar". Nunca para trás: só uma versão
 * MAIOR que a de agora. `podeAgora` (o Gravador no meio de uma gravação) adia a busca automática.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERVALO_MS, proximaBusca, type ModoAtualizacoes } from './ajuste.ts';
import { baixarArquivo, baixarTexto, ErroBaixar, type Buscar } from './baixar.ts';
import { CHAVE_EKFRASE } from './chave.ts';
import { conferirManifesto, ErroManifesto, nomeDoManifesto, type ArquivoDaAtualizacao } from './manifesto.ts';
import { sha256DoArquivo } from './minisign.ts';
import { API_GITHUB, arquivoDe, lancamentos, type Lancamento } from './releases.ts';
import { ehVersao, maisNova, type Canal } from './versoes.ts';

/** Onde a atualização está (o mesmo que a `SituacaoAtualizacao` do Writer). */
export type SituacaoDoAtualizador = 'parado' | 'procurando' | 'em-dia' | 'disponivel' | 'baixando' | 'aplicando' | 'pronta' | 'erro';
export type ErroDoAtualizador = 'sem-rede' | 'lacre' | 'sem-espaco' | 'sem-dados' | 'pendente' | 'falhou';

/** O estado que a tela mostra (o mesmo formato da `EstadoAtualizacoes` do Writer). */
export interface EstadoDoAtualizador {
  modo: ModoAtualizacoes;
  versao: string;
  canal: Canal;
  situacao: SituacaoDoAtualizador;
  nova: string | null;
  feito: number;
  total: number;
  erro: ErroDoAtualizador | null;
  ultimaBusca: number | null;
  /** Só o Writer OS (a cópia nova que não ligou): aqui, sempre `null`. */
  voltou: { de: string; para: string } | null;
}

export interface OpcoesAtualizador {
  /** O nome do app no manifesto (`ekfrase-writer`, `ekfrase-gravador`). */
  app: string;
  /** O nome no comentário do lacre (`Ekfrase Writer`, `Ekfrase Gravador`). */
  nome: string;
  /** O prefixo das tags (`writer-v`, `writer-os-v`). */
  prefixo: string;
  /** A versão que está rodando. */
  versao: string;
  canal: Canal;
  /** O arquivo deste sistema no manifesto: `windows` ou `linux`. */
  papel: string;
  /** Onde baixar (cada versão numa pasta dela). */
  pasta: string;
  modo: () => ModoAtualizacoes;
  gravarModo: (m: ModoAtualizacoes) => void;
  /** O arquivo chegou e está conferido: deixa-o pronto para valer. Um erro aqui = `falhou` (nada mudou). */
  preparar: (arquivo: string, versao: string, sha256: string) => Promise<void>;
  /** `false` = agora não (o Gravador gravando): a busca automática fica para daqui a pouco. */
  podeAgora?: () => boolean;
  buscar?: Buscar;
  api?: string;
  /** As chaves em que se confia (a da Ekfrase; nos testes, mais uma). */
  chaves?: readonly string[];
  /** A primeira busca depois de abrir (padrão 20 s). */
  atrasoInicial?: number;
  intervalo?: number;
  /** O `user-agent` dos pedidos. */
  agente?: string;
}

/** O que o app deixou pronto para valer (o instalador baixado e conferido). */
export interface Pronta {
  versao: string;
  arquivo: string;
  sha256: string;
  tamanho: number;
}

export class Atualizador {
  private readonly o: OpcoesAtualizador;
  private e: EstadoDoAtualizador;
  private achada: Lancamento | null = null;
  private feita: Pronta | null = null;
  private emCurso: Promise<void> | null = null;
  private relogio: ReturnType<typeof setTimeout> | null = null;
  private falhas = 0;
  private readonly ouvintes = new Set<(e: EstadoDoAtualizador) => void>();

  constructor(o: OpcoesAtualizador) {
    this.o = o;
    this.e = { modo: o.modo(), versao: o.versao, canal: o.canal, situacao: 'parado', nova: null, feito: 0, total: 0, erro: null, ultimaBusca: null, voltou: null };
  }

  /** Tira o que ficou de outras vezes (versões que já não são maiores que a de agora) e marca a primeira busca. */
  iniciar(): void {
    try {
      if (existsSync(this.o.pasta)) for (const p of readdirSync(this.o.pasta)) if (!ehVersao(p) || !maisNova(p, this.o.versao)) rmSync(join(this.o.pasta, p), { recursive: true, force: true });
    } catch {
      // a pasta das atualizações é só um cache
    }
    this.marcar(this.o.atrasoInicial ?? 20_000);
  }

  parar(): void {
    if (this.relogio) clearTimeout(this.relogio);
    this.relogio = null;
  }

  estado(): EstadoDoAtualizador {
    return structuredClone(this.e);
  }

  /** A versão baixada, conferida e preparada (para o app aplicar ao fechar), ou `null`. */
  pronta(): Pronta | null {
    return this.feita ? { ...this.feita } : null;
  }

  aoMudar(f: (e: EstadoDoAtualizador) => void): () => void {
    this.ouvintes.add(f);
    return () => void this.ouvintes.delete(f);
  }

  /** "Procurar agora": no modo automáticas, achou = já baixa e deixa pronta. */
  async procurar(): Promise<EstadoDoAtualizador> {
    await this.vez(() => this.buscar(this.o.modo() === 'automaticas'));
    return this.estado();
  }

  /** "Instalar" (o modo perguntar): baixa e prepara a que foi achada. */
  async instalar(): Promise<EstadoDoAtualizador> {
    await this.vez(async () => {
      if (!this.achada || this.e.situacao !== 'disponivel') await this.buscar(false);
      if (this.achada && this.e.situacao === 'disponivel') await this.baixarEPreparar(this.achada);
    });
    return this.estado();
  }

  usarModo(m: ModoAtualizacoes): EstadoDoAtualizador {
    if (m !== 'automaticas' && m !== 'perguntar') return this.estado();
    this.o.gravarModo(m);
    this.mudar({ modo: m });
    // passou para automáticas com uma esperando: instala já
    if (m === 'automaticas' && this.e.situacao === 'disponivel' && this.achada) {
      const l = this.achada;
      void this.vez(() => this.baixarEPreparar(l));
    }
    return this.estado();
  }

  // ---------- por dentro ----------

  private mudar(m: Partial<EstadoDoAtualizador>): void {
    this.e = { ...this.e, ...m };
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
      if (this.o.podeAgora && !this.o.podeAgora()) return this.marcar(60_000);
      void this.vez(() => this.buscar(this.o.modo() === 'automaticas')).finally(() => {
        if (!this.relogio) this.marcar(proximaBusca(this.falhas, this.o.intervalo ?? INTERVALO_MS));
      });
    }, ms);
    (this.relogio as { unref?: () => void }).unref?.();
  }

  /** O manifesto e o lacre dele estão no Release? */
  private temManifesto(l: Lancamento): boolean {
    const n = nomeDoManifesto(this.o.app, l.versao);
    return !!arquivoDe(l, n) && !!arquivoDe(l, `${n}.minisig`);
  }

  private async buscar(instalar: boolean): Promise<void> {
    if (this.e.situacao === 'baixando' || this.e.situacao === 'aplicando') return;
    this.mudar({ situacao: 'procurando', erro: null });
    let lista: Lancamento[];
    try {
      lista = await lancamentos(this.o.buscar ?? fetch, { prefixo: this.o.prefixo, canal: this.o.canal, api: this.o.api ?? API_GITHUB, agente: this.o.agente ?? 'Ekfrase' });
    } catch {
      this.falhas++;
      this.mudar({ situacao: 'erro', erro: 'sem-rede', ultimaBusca: Date.now() });
      return;
    }
    this.falhas = 0;
    // o mais novo que tem o manifesto (um Release sem ele, de antes da U2, não serve) e é maior que o de agora
    const l = lista.find((x) => this.temManifesto(x)) ?? null;
    const pronta = this.feita?.versao ?? null;
    if (!l || !maisNova(l.versao, this.o.versao) || (pronta && !maisNova(l.versao, pronta))) {
      this.achada = null;
      this.mudar(pronta ? { situacao: 'pronta', nova: pronta, ultimaBusca: Date.now() } : { situacao: 'em-dia', nova: null, ultimaBusca: Date.now() });
      return;
    }
    this.achada = l;
    this.mudar({ situacao: 'disponivel', nova: l.versao, ultimaBusca: Date.now() });
    if (instalar) await this.baixarEPreparar(l);
  }

  private falhar(erro: ErroDoAtualizador): void {
    // uma que já estava pronta continua pronta (só a nova falhou): o aviso diz o erro, e a de antes vale ao fechar
    this.mudar({ situacao: 'erro', erro, feito: 0, total: 0 });
  }

  private async baixarEPreparar(l: Lancamento): Promise<void> {
    const buscar = this.o.buscar ?? fetch;
    const pasta = join(this.o.pasta, l.versao);
    const agente = this.o.agente ?? 'Ekfrase';
    this.mudar({ situacao: 'baixando', nova: l.versao, feito: 0, total: 0, erro: null });
    let a: ArquivoDaAtualizacao;
    let destino: string;
    try {
      mkdirSync(pasta, { recursive: true });
      // as outras versões baixadas saem (menos a que já está pronta: ela vale até a nova ficar pronta)
      for (const p of readdirSync(this.o.pasta)) if (p !== l.versao && p !== this.feita?.versao) rmSync(join(this.o.pasta, p), { recursive: true, force: true });
      const nome = nomeDoManifesto(this.o.app, l.versao);
      const texto = await baixarTexto(buscar, arquivoDe(l, nome)!.url, { maximo: 65536, agente });
      const sig = await baixarTexto(buscar, arquivoDe(l, `${nome}.minisig`)!.url, { maximo: 4096, agente });
      const m = conferirManifesto(texto, sig, { chaves: this.o.chaves ?? [CHAVE_EKFRASE], app: this.o.app, nome: this.o.nome, versao: l.versao });
      const deste = m.arquivos.find((x) => x.papel === this.o.papel);
      if (!deste) throw new ErroManifesto('formato', `sem o arquivo de ${this.o.papel}`);
      a = deste;
      writeFileSync(join(pasta, nome), texto);
      destino = join(pasta, a.nome);
      const url = arquivoDe(l, a.nome)?.url;
      if (!url) throw new ErroManifesto('formato', `falta ${a.nome} no Release`);
      this.mudar({ total: a.tamanho });
      // já baixado de outra vez (o app fechou no meio): só confere
      const pronto = existsSync(destino) && statSync(destino).size === a.tamanho && (await sha256DoArquivo(destino)) === a.sha256;
      if (!pronto) {
        rmSync(destino, { force: true });
        let ultimo = 0;
        await baixarArquivo(buscar, url, destino, {
          tamanho: a.tamanho,
          agente,
          aoBaixar: (feito) => {
            // o andamento vai à tela a cada 2 MB (não a cada pedaço)
            if (feito - ultimo >= 2 << 20 || feito === a.tamanho) {
              ultimo = feito;
              this.mudar({ feito });
            }
          },
        });
        if ((await sha256DoArquivo(destino)) !== a.sha256) {
          rmSync(destino, { force: true });
          throw new ErroManifesto('lacre', a.nome);
        }
      }
    } catch (e) {
      if (e instanceof ErroManifesto) {
        rmSync(pasta, { recursive: true, force: true });
        return this.falhar('lacre');
      }
      if (e instanceof ErroBaixar) return this.falhar(e.codigo === 'sem-espaco' ? 'sem-espaco' : 'sem-rede');
      if ((e as NodeJS.ErrnoException).code === 'ENOSPC') return this.falhar('sem-espaco');
      return this.falhar('falhou');
    }

    this.mudar({ situacao: 'aplicando', feito: 0, total: 0 });
    try {
      await this.o.preparar(destino, l.versao, a.sha256);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOSPC') return this.falhar('sem-espaco');
      return this.falhar('falhou');
    }
    // a anterior que estava pronta sai (a nova a substitui)
    if (this.feita && this.feita.versao !== l.versao) rmSync(join(this.o.pasta, this.feita.versao), { recursive: true, force: true });
    this.feita = { versao: l.versao, arquivo: destino, sha256: a.sha256, tamanho: a.tamanho };
    this.achada = null;
    this.mudar({ situacao: 'pronta', nova: l.versao, feito: 0, total: 0, erro: null });
  }
}
