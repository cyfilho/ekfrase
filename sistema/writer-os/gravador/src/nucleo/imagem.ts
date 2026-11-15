// SPDX-License-Identifier: MPL-2.0
/// <reference path="./xz-decompress.d.ts" />

/**
 * A IMAGEM do Writer OS, lida em sequência: o `.img.xz` (descomprimido aqui mesmo, pelo xz em
 * WebAssembly: nada nativo, nada de arquivo temporário de 1,4 GB) ou um `.img` cru.
 * Enquanto lê, calcula o SHA-256 do arquivo como ele está no disco: se mudar entre a conferência
 * e a gravação, o Gravador percebe (`Fluxo.terminar`).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import xz from 'xz-decompress';
import { ErroGpt, NOME_BOOT, TIPO, lerGpt, type Particao } from './gpt.ts';

export const MIB = 1024 * 1024;

export class ErroImagem extends Error {
  readonly codigo: 'nao-e-writer-os' | 'imagem-curta' | 'imagem-mudou' | 'imagem-corrompida';
  constructor(codigo: ErroImagem['codigo']) {
    super(codigo);
    this.codigo = codigo;
  }
}

export const ehXz = (arquivo: string): boolean => /\.xz$/i.test(arquivo);

/** Os pedaços (já descomprimidos) da imagem; `sha` recebe os bytes do ARQUIVO como estão no disco. */
async function* pedacos(arquivo: string, sha: ReturnType<typeof createHash>, aoLer?: (bytes: number) => void): AsyncGenerator<Buffer> {
  let lidos = 0;
  async function* doArquivo(): AsyncGenerator<Buffer> {
    for await (const p of createReadStream(arquivo, { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) {
      sha.update(p);
      lidos += p.length;
      aoLer?.(lidos);
      yield p;
    }
  }
  if (!ehXz(arquivo)) {
    yield* doArquivo();
    return;
  }
  const saida = new xz.XzReadableStream(Readable.toWeb(Readable.from(doArquivo())) as unknown as ReadableStream<Uint8Array>);
  try {
    for await (const u of saida as unknown as AsyncIterable<Uint8Array>) yield Buffer.from(u.buffer, u.byteOffset, u.byteLength);
  } catch (e) {
    if (e instanceof ErroImagem) throw e;
    throw new ErroImagem('imagem-corrompida');
  }
}

/** Leitura em sequência, com "leia exatamente N bytes" e "passe N bytes adiante". */
export class Fluxo {
  private resto: Buffer = Buffer.alloc(0);
  private readonly it: AsyncIterator<Buffer>;
  private readonly sha = createHash('sha256');
  /** Quantos bytes (descomprimidos) já saíram. */
  posicao = 0;

  constructor(arquivo: string, aoLerArquivo?: (bytes: number) => void) {
    this.it = pedacos(arquivo, this.sha, aoLerArquivo)[Symbol.asyncIterator]();
  }

  private async encher(): Promise<boolean> {
    const r = await this.it.next();
    if (r.done) return false;
    this.resto = this.resto.length ? Buffer.concat([this.resto, r.value]) : r.value;
    return true;
  }

  async ler(n: number): Promise<Buffer> {
    while (this.resto.length < n) if (!(await this.encher())) throw new ErroImagem('imagem-curta');
    const b = Buffer.from(this.resto.subarray(0, n));
    this.resto = this.resto.subarray(n);
    this.posicao += n;
    return b;
  }

  /** Os próximos `n` bytes, em pedaços (sem juntar tudo na memória). */
  async *passar(n: number): AsyncGenerator<Buffer> {
    let falta = n;
    while (falta > 0) {
      if (!this.resto.length && !(await this.encher())) throw new ErroImagem('imagem-curta');
      const p = this.resto.subarray(0, Math.min(falta, this.resto.length));
      this.resto = this.resto.subarray(p.length);
      falta -= p.length;
      this.posicao += p.length;
      yield p;
    }
  }

  async pular(n: number): Promise<void> {
    for await (const _ of this.passar(n));
  }

  /**
   * Solta a leitura sem ir até o fim. OBRIGATÓRIO para quem não termina: o xz em WebAssembly só
   * descomprime UM arquivo por vez no processo (uma trava global), e uma leitura largada no meio
   * travaria a próxima para sempre.
   */
  async fechar(): Promise<void> {
    await this.it.return?.(undefined)?.catch(() => undefined);
  }

  /** Lê o que sobrou (para o SHA-256 cobrir o arquivo inteiro) e confere com o esperado. */
  async terminar(sha256Esperado: string | null): Promise<string> {
    while (await this.encher()) this.resto = Buffer.alloc(0);
    const h = this.sha.digest('hex');
    if (sha256Esperado && h !== sha256Esperado.toLowerCase()) throw new ErroImagem('imagem-mudou');
    return h;
  }
}

export interface CabecaImagem {
  /** A partição 1 da imagem (em LBAs de 512). */
  boot: Particao;
  /** Onde ela começa e quanto tem, em bytes. */
  inicio: number;
  tamanho: number;
}

/**
 * Lê a GPT da imagem (do começo do fluxo até o começo da partição 1, que fica no fluxo logo depois).
 * Uma imagem do Writer OS tem UMA partição, EKFRASE-BOOT, do tipo ESP.
 */
export async function lerCabecaImagem(f: Fluxo): Promise<CabecaImagem> {
  if (f.posicao !== 0) throw new Error('o fluxo precisa estar no começo');
  const inicioGpt = await f.ler(34 * 512);
  let gpt;
  try {
    gpt = await lerGpt(async (pos, tam) => {
      if (pos + tam > inicioGpt.length) throw new ErroImagem('nao-e-writer-os');
      return inicioGpt.subarray(pos, pos + tam);
    }, 512);
  } catch (e) {
    if (e instanceof ErroGpt || e instanceof ErroImagem) throw new ErroImagem('nao-e-writer-os');
    throw e;
  }
  const [boot, ...outras] = gpt.particoes;
  if (!boot || outras.length || boot.nome !== NOME_BOOT || boot.tipo !== TIPO.esp || boot.numero !== 1) throw new ErroImagem('nao-e-writer-os');
  const inicio = boot.inicio * 512;
  const tamanho = (boot.fim - boot.inicio + 1) * 512;
  if (inicio < inicioGpt.length || inicio % MIB !== 0 || tamanho % MIB !== 0 || tamanho > 8 * 1024 * MIB) throw new ErroImagem('nao-e-writer-os');
  await f.pular(inicio - f.posicao);
  return { boot, inicio, tamanho };
}
