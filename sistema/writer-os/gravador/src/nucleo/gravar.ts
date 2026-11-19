// SPDX-License-Identifier: MPL-2.0

/**
 * A GRAVAÇÃO (o que roda com permissão de administrador; `trabalhador.ts`). Em ordem:
 *
 * 1. a lista de discos de novo, DAQUI: o disco tem de ser o mesmo que a pessoa escolheu (caminho,
 *    tamanho, setor, série, nome) e continuar podendo ser apagado (discos.ts). Senão, para sem escrever;
 * 2. a imagem: o SHA-256 tem de ser o que a janela conferiu (o lacre é conferido lá, origem.ts: daqui
 *    em diante, o SHA-256 amarra o arquivo; se ele mudar no meio, `Fluxo.terminar` também percebe);
 * 3. o plano (plano.ts), inteiro, antes de escrever: no Atualizar, com a GPT lida do disco;
 * 4. preparar o disco (desmontar; no Windows, limpar ou tirar do ar) e gravar, só dentro da faixa
 *    permitida, em blocos de 4 MiB alinhados ao setor;
 * 5. sincronizar, esvaziar o cache e LER DE VOLTA tudo o que foi escrito (SHA-256 igual ou erro);
 * 6. no Criar, formatar a EKFRASE-DADOS (exFAT, ou ext4 a partir de 1 TB).
 */
import { createHash } from 'node:crypto';
import { mesmoDisco, type Disco } from './discos.ts';
import { lerGpt, ErroGpt } from './gpt.ts';
import { Fluxo, lerCabecaImagem, ErroImagem } from './imagem.ts';
import { sha256DoArquivo } from '@ekfrase/atualizacoes';
import { escritas, planejar, ErroPlano, type Modo, type Plano, type SistemaDados } from './plano.ts';

export interface Tarefa {
  modo: Modo;
  /** O disco como a janela o viu (quem grava confere se continua igual). */
  disco: Pick<Disco, 'id' | 'caminho' | 'tamanho' | 'setor' | 'serial' | 'nome'>;
  imagem: {
    arquivo: string;
    /** O SHA-256 que a janela conferiu (junto com o lacre, ou com a confirmação escrita de quem grava sem ele). */
    sha256: string;
  };
  /** Limite da EKFRASE-DADOS, em bytes (null = o resto do disco). */
  limiteDados: number | null;
}

export type Fase = 'conferir' | 'preparar' | 'gravar' | 'verificar' | 'dados' | 'pronto';

export interface Aviso {
  fase: Fase;
  feito?: number;
  total?: number;
}

export type CodigoErro =
  | 'disco-mudou'
  | 'disco-sumiu'
  | 'recusado'
  | 'imagem-mudou'
  | 'imagem-corrompida'
  | 'nao-e-writer-os'
  | 'setor'
  | 'pequeno'
  | 'nao-cabe'
  | 'nao-fat32'
  | 'fat-incompativel'
  | 'em-uso'
  | 'escrita'
  | 'verificacao'
  | 'formatar'
  | 'fora-da-faixa';

export class ErroGravar extends Error {
  readonly codigo: CodigoErro;
  readonly detalhe: string;
  constructor(codigo: CodigoErro, detalhe = '') {
    super(detalhe ? `${codigo}: ${detalhe}` : codigo);
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}

/** O disco aberto para gravar. Posições e tamanhos sempre múltiplos do setor. */
export interface Dispositivo {
  ler(posicao: number, tamanho: number): Promise<Buffer>;
  escrever(posicao: number, dados: Buffer): Promise<void>;
  sincronizar(): Promise<void>;
  fechar(): Promise<void>;
}

/** O que muda de um sistema para outro (ambientes.ts). */
export interface Ambiente {
  inventario(): Promise<Disco[]>;
  /** Desmonta o que for preciso. Criar: o disco inteiro; Atualizar: pode deixar a EKFRASE-DADOS. */
  preparar(d: Disco, modo: Modo): Promise<void>;
  /** `ler`: só leitura (a GPT no Atualizar, a conferência). `gravar`: exclusivo, depois do `preparar`. */
  abrir(d: Disco, uso: 'ler' | 'gravar'): Promise<Dispositivo>;
  /** Depois de gravar: o sistema esquece o que tinha em cache do disco (para a leitura de volta ser do disco). */
  esvaziarCache(d: Disco): Promise<void>;
  /** Depois de tudo: o sistema lê a tabela de partições de novo (e põe o disco no ar, se tirou). */
  releer(d: Disco, modo: Modo): Promise<void>;
  formatos(): Promise<ReadonlySet<SistemaDados>>;
  formatar(d: Disco, numero: number, sistema: SistemaDados): Promise<void>;
}

const BLOCO = 4 * 1024 * 1024;

/** Junta as escritas em blocos de até 4 MiB e escreve; anota as faixas e o SHA-256 do que foi escrito. */
class Gravador {
  private buf = Buffer.alloc(BLOCO);
  private usado = 0;
  private inicio = -1;
  readonly faixas: [number, number][] = [];
  readonly sha = createHash('sha256');
  escrito = 0;

  private readonly dev: Dispositivo;
  private readonly setor: number;
  private readonly permitido: [number, number];
  private readonly aoEscrever: (n: number) => void;

  constructor(dev: Dispositivo, setor: number, permitido: [number, number], aoEscrever: (n: number) => void) {
    this.dev = dev;
    this.setor = setor;
    this.permitido = permitido;
    this.aoEscrever = aoEscrever;
  }

  async escrever(posicao: number, dados: Buffer): Promise<void> {
    if (this.usado && posicao !== this.inicio + this.usado) await this.descarregar();
    let p = posicao;
    let d = dados;
    while (d.length) {
      if (!this.usado) this.inicio = p;
      const n = Math.min(d.length, BLOCO - this.usado);
      d.copy(this.buf, this.usado, 0, n);
      this.usado += n;
      p += n;
      d = d.subarray(n);
      if (this.usado === BLOCO) await this.descarregar();
    }
  }

  async descarregar(): Promise<void> {
    if (!this.usado) return;
    const pos = this.inicio;
    const n = this.usado;
    if (pos % this.setor || n % this.setor) throw new ErroGravar('escrita', `desalinhado: ${pos}+${n}`);
    if (pos < this.permitido[0] || pos + n > this.permitido[1]) throw new ErroGravar('fora-da-faixa', `${pos}+${n}`);
    const bloco = this.buf.subarray(0, n);
    try {
      await this.dev.escrever(pos, bloco);
    } catch (e) {
      throw new ErroGravar('escrita', (e as Error).message);
    }
    this.sha.update(bloco);
    const ultima = this.faixas.at(-1);
    if (ultima && ultima[0] + ultima[1] === pos) ultima[1] += n;
    else this.faixas.push([pos, n]);
    this.escrito += n;
    this.usado = 0;
    this.aoEscrever(this.escrito);
  }
}

export function normalizarErro(e: unknown): ErroGravar {
  if (e instanceof ErroGravar) return e;
  if (e instanceof ErroPlano) return new ErroGravar(e.codigo);
  if (e instanceof ErroImagem) return new ErroGravar(e.codigo === 'imagem-curta' ? 'imagem-corrompida' : e.codigo);
  if (e instanceof ErroGpt) return new ErroGravar('nao-e-writer-os', e.codigo);
  const c = (e as NodeJS.ErrnoException)?.code;
  if (c === 'EBUSY') return new ErroGravar('em-uso');
  return new ErroGravar('escrita', (e as Error)?.message ?? String(e));
}

export async function executar(t: Tarefa, amb: Ambiente, avisar: (a: Aviso) => void): Promise<{ plano: Plano; sha256Escrito: string }> {
  // 1. o disco, de novo, daqui
  avisar({ fase: 'conferir' });
  const disco = (await amb.inventario()).find((d) => d.id === t.disco.id);
  if (!disco) throw new ErroGravar('disco-sumiu');
  if (!mesmoDisco(disco, t.disco)) throw new ErroGravar('disco-mudou');
  if (disco.recusa) throw new ErroGravar('recusado', disco.recusa);

  // 2. a imagem, de novo
  if ((await sha256DoArquivo(t.imagem.arquivo)) !== t.imagem.sha256.toLowerCase()) throw new ErroGravar('imagem-mudou');

  // 3. o plano, inteiro, ANTES de mexer no disco (no Atualizar, com a GPT lida do próprio disco)
  const f = new Fluxo(t.imagem.arquivo);
  let plano: Plano;
  let gravador: Gravador;
  try {
    const img = await lerCabecaImagem(f);
    const formatos = t.modo === 'criar' ? await amb.formatos() : new Set<SistemaDados>();
    let gptDisco = null;
    if (t.modo === 'atualizar') {
      const leitor = await amb.abrir(disco, 'ler');
      try {
        gptDisco = await lerGpt((p, n) => leitor.ler(p, n), disco.setor);
      } catch (e) {
        if (e instanceof ErroGpt) throw new ErroGravar('nao-e-writer-os', e.codigo);
        throw e;
      } finally {
        await leitor.fechar().catch(() => undefined);
      }
    }
    const r = await planejar(f, img, disco, t.modo, { limiteDados: t.limiteDados, formatos, gptDisco });
    plano = r.plano;

    // 4. preparar, abrir e gravar
    avisar({ fase: 'preparar' });
    await amb.preparar(disco, t.modo);
    const dev = await amb.abrir(disco, 'gravar');
    try {
      const total = plano.total;
      gravador = new Gravador(dev, disco.setor, plano.permitido, (n) => avisar({ fase: 'gravar', feito: n, total }));
      avisar({ fase: 'gravar', feito: 0, total });
      for await (const e of escritas(f, img, plano, r.lido)) await gravador.escrever(e.posicao, e.dados);
      await gravador.descarregar();
      await f.terminar(t.imagem.sha256);
      await dev.sincronizar();
    } finally {
      await dev.fechar().catch(() => undefined);
    }
  } finally {
    // o xz só descomprime um arquivo por vez: a leitura nunca fica largada (imagem.ts)
    await f.fechar();
  }
  const sha256Escrito = gravador.sha.digest('hex');

  // 5. ler de volta
  await amb.esvaziarCache(disco);
  const conferir = await amb.abrir(disco, 'ler');
  try {
    const sha = createHash('sha256');
    let feito = 0;
    for (const [pos, n] of gravador.faixas) {
      for (let o = 0; o < n; o += BLOCO) {
        sha.update(await conferir.ler(pos + o, Math.min(BLOCO, n - o)));
        feito += Math.min(BLOCO, n - o);
        avisar({ fase: 'verificar', feito, total: gravador.escrito });
      }
    }
    if (sha.digest('hex') !== sha256Escrito) throw new ErroGravar('verificacao');
  } finally {
    await conferir.fechar().catch(() => undefined);
  }

  // 6. a tabela de novo e a EKFRASE-DADOS
  await amb.releer(disco, t.modo);
  if (plano.dados) {
    avisar({ fase: 'dados' });
    try {
      await amb.formatar(disco, plano.dados.numero, plano.dados.sistema);
    } catch (e) {
      throw new ErroGravar('formatar', (e as Error).message);
    }
  }
  avisar({ fase: 'pronto' });
  return { plano, sha256Escrito };
}
