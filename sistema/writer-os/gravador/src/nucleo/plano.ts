// SPDX-License-Identifier: MPL-2.0

/**
 * O PLANO DA GRAVAÇÃO: onde cada byte vai no disco. Calculado ANTES de escrever qualquer coisa, a
 * partir da imagem (a GPT e o começo da FAT32) e do disco (tamanho, setor e, no Atualizar, a GPT dele).
 *
 * Criar (PLANO §8b): a GPT do disco é nova (do tamanho do disco e com o setor dele); a partição 1
 * (EKFRASE-BOOT) vem da imagem, em 1 MiB; a 2 (EKFRASE-DADOS) usa o resto (ou o limite pedido), se
 * houver pelo menos 512 MB e se der para formatar aqui (exFAT; ext4 a partir de 1 TB, como o
 * `ekfrase-dados.sh` do primeiro boot). Se não der, o primeiro boot a cria.
 *
 * Atualizar: só o conteúdo da partição 1 muda; a GPT e a EKFRASE-DADOS ficam como estão. O plano diz
 * a faixa de bytes que pode ser escrita, e quem grava recusa qualquer escrita fora dela.
 *
 * Ordem das escritas: a partição 1 primeiro, depois a GPT reserva (no fim do disco) e, por último, a
 * GPT do começo: assim o Windows só vê partições novas quando tudo já está lá.
 */
import { bytesAteDados, lerBpb, traduzir4k, type Traducao4k } from './fat4k.ts';
import { geometria, montarGpt, NOME_BOOT, NOME_DADOS, TIPO, type GptMontada, type Gpt } from './gpt.ts';
import { MIB, type CabecaImagem, type Fluxo } from './imagem.ts';

export type Modo = 'criar' | 'atualizar';
export type SistemaDados = 'exfat' | 'ext4';

/** Abaixo disto, a EKFRASE-DADOS não é criada (o mesmo mínimo do `ekfrase-dados.sh`). */
export const MINIMO_DADOS = 512 * MIB;
/** A partir disto, a EKFRASE-DADOS é ext4 (PLANO §6.1b, item 3). */
export const LIMIAR_EXT4 = 1_000_000_000_000;

export class ErroPlano extends Error {
  readonly codigo: 'setor' | 'pequeno' | 'nao-e-writer-os' | 'nao-cabe' | 'nao-fat32' | 'fat-incompativel';
  constructor(codigo: ErroPlano['codigo']) {
    super(codigo);
    this.codigo = codigo;
  }
}

export interface Plano {
  modo: Modo;
  setor: number;
  /** A partição 1 no disco: onde começa, o tamanho da partição e quanto dela é escrito. */
  boot: { inicio: number; tamanho: number; conteudo: number };
  /** Disco 4Kn: a FAT32 reescrita com setor de 4096. */
  traducao: Traducao4k | null;
  dados: { numero: 2; inicio: number; tamanho: number; sistema: SistemaDados } | null;
  /** A GPT nova (só no Criar). */
  gpt: GptMontada | null;
  /** A única faixa de bytes que pode ser escrita [início, fim). */
  permitido: [number, number];
  /** Quantos bytes serão escritos (para a barra de progresso). */
  total: number;
}

export interface Escrita {
  posicao: number;
  dados: Buffer;
}

const acima = (n: number, m: number) => Math.ceil(n / m) * m;
const abaixo = (n: number, m: number) => Math.floor(n / m) * m;

/**
 * Lê do fluxo o começo da FAT32 da imagem (o fluxo já está no começo da partição 1) e monta o plano.
 * Devolve também o que foi lido, que é escrito primeiro (`escritas`).
 */
export async function planejar(
  f: Fluxo,
  img: CabecaImagem,
  disco: { tamanho: number; setor: number },
  modo: Modo,
  o: { limiteDados?: number | null; formatos?: ReadonlySet<SistemaDados>; gptDisco?: Gpt | null } = {},
): Promise<{ plano: Plano; lido: Buffer }> {
  const s = disco.setor;
  if (s !== 512 && s !== 4096) throw new ErroPlano('setor');
  const primeiro = await f.ler(512);
  let bpb;
  try {
    bpb = lerBpb(primeiro);
  } catch {
    throw new ErroPlano('nao-fat32');
  }
  let lido = primeiro;
  if (s === 4096) lido = Buffer.concat([primeiro, await f.ler(bytesAteDados(bpb) - 512)]);

  let bootInicio: number;
  let bootTamanho: number;
  let permitido: [number, number];
  if (modo === 'atualizar') {
    const g = o.gptDisco;
    if (!g || g.setor !== s) throw new ErroPlano('nao-e-writer-os');
    const [p1, ...outras] = g.particoes;
    if (!p1 || p1.numero !== 1 || p1.nome !== NOME_BOOT || p1.tipo !== TIPO.esp) throw new ErroPlano('nao-e-writer-os');
    if (outras.some((p) => p.numero !== 2 || p.nome !== NOME_DADOS) || outras.length > 1) throw new ErroPlano('nao-e-writer-os');
    bootInicio = p1.inicio * s;
    bootTamanho = (p1.fim - p1.inicio + 1) * s;
    permitido = [bootInicio, bootInicio + bootTamanho];
  } else {
    bootInicio = MIB;
    bootTamanho = 0; // abaixo, depois da tradução
    permitido = [0, disco.tamanho];
  }

  let traducao: Traducao4k | null = null;
  let conteudo = img.tamanho;
  if (s === 4096) {
    try {
      traducao = traduzir4k(lido, bootInicio / s);
    } catch (e) {
      throw new ErroPlano((e as { codigo?: 'nao-fat32' | 'fat-incompativel' }).codigo ?? 'fat-incompativel');
    }
    conteudo = traducao.tamanhoFs;
  }
  if (modo === 'criar') bootTamanho = acima(conteudo, MIB);
  if (conteudo > bootTamanho) throw new ErroPlano('nao-cabe');

  let dados: Plano['dados'] = null;
  let gpt: GptMontada | null = null;
  if (modo === 'criar') {
    const geo = geometria(disco.tamanho, s);
    const fimBoot = bootInicio + bootTamanho;
    if (fimBoot / s - 1 > geo.ultimoUtil) throw new ErroPlano('pequeno');
    const inicioDados = fimBoot;
    const livre = abaixo((geo.ultimoUtil + 1) * s - inicioDados, MIB);
    const limite = o.limiteDados ? abaixo(o.limiteDados, MIB) : null;
    const tamanho = limite ? Math.min(limite, livre) : livre;
    const sistema: SistemaDados = tamanho >= LIMIAR_EXT4 ? 'ext4' : 'exfat';
    if (tamanho >= MINIMO_DADOS && (o.formatos ?? new Set(['exfat', 'ext4'])).has(sistema)) dados = { numero: 2, inicio: inicioDados, tamanho, sistema };
    gpt = montarGpt({
      tamanho: disco.tamanho,
      setor: s,
      particoes: [
        { tipo: TIPO.esp, inicio: bootInicio / s, fim: fimBoot / s - 1, nome: NOME_BOOT, atributos: img.boot.atributos },
        ...(dados ? [{ tipo: dados.sistema === 'ext4' ? TIPO.linux : TIPO.dadosMicrosoft, inicio: dados.inicio / s, fim: (dados.inicio + dados.tamanho) / s - 1, nome: NOME_DADOS }] : []),
      ],
    });
  }
  const total = conteudo + (gpt ? gpt.inicio.length + gpt.fim.dados.length : 0);
  return { plano: { modo, setor: s, boot: { inicio: bootInicio, tamanho: bootTamanho, conteudo }, traducao, dados, gpt, permitido, total }, lido };
}

/** As escritas do plano, em ordem, a partir do fluxo (que está logo depois do `lido`). */
export async function* escritas(f: Fluxo, img: CabecaImagem, plano: Plano, lido: Buffer): AsyncGenerator<Escrita> {
  const b = plano.boot.inicio;
  if (plano.traducao) {
    const t = plano.traducao;
    yield { posicao: b, dados: t.cabeca };
    let pos = b + t.dadosDestino;
    for await (const p of f.passar(t.dadosTamanho)) {
      yield { posicao: pos, dados: p };
      pos += p.length;
    }
  } else {
    yield { posicao: b, dados: lido };
    let pos = b + lido.length;
    for await (const p of f.passar(img.tamanho - lido.length)) {
      yield { posicao: pos, dados: p };
      pos += p.length;
    }
  }
  if (plano.gpt) {
    yield { posicao: plano.gpt.fim.posicao, dados: plano.gpt.fim.dados };
    yield { posicao: 0, dados: plano.gpt.inicio };
  }
}
