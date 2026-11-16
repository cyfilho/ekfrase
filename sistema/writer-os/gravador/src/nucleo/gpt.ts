// SPDX-License-Identifier: MPL-2.0

/**
 * A TABELA DE PARTIÇÕES GPT (UEFI 2.10, §5.2–5.3), lida e montada à mão: o Gravador escreve a tabela
 * do disco ele mesmo (a do tamanho certo do disco, com a cópia no fim, e com o setor do disco: 512 ou
 * 4096), em vez de copiar a da imagem (que é de 512 e do tamanho da imagem).
 *
 * Disco: LBA 0 = MBR protetor; LBA 1 = cabeçalho; LBA 2… = as 128 entradas de 128 bytes (16 KiB);
 * no fim, as entradas de novo e, no último LBA, o cabeçalho reserva.
 */
import { randomBytes } from 'node:crypto';

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (o mesmo do zlib e da GPT). */
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABELA_CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Os tipos de partição que o Writer OS usa. */
export const TIPO = {
  esp: 'C12A7328-F81F-11D2-BA4B-00A0C93EC93B',
  /** "Microsoft basic data" (sgdisk 0700): a EKFRASE-DADOS em exFAT. */
  dadosMicrosoft: 'EBD0A0A2-B9E5-4433-87C0-68B6B72699C7',
  /** "Linux filesystem" (sgdisk 8300): a EKFRASE-DADOS em ext4 (1 TB ou mais). */
  linux: '0FC63DAF-8483-4772-8E79-3D69D8477DE4',
} as const;

export const NOME_BOOT = 'EKFRASE-BOOT';
export const NOME_DADOS = 'EKFRASE-DADOS';

const N_ENTRADAS = 128;
const TAM_ENTRADA = 128;
const BYTES_ENTRADAS = N_ENTRADAS * TAM_ENTRADA;

/** GUID em texto ("C12A7328-F81F-…") → os 16 bytes da GPT (os três primeiros campos ao contrário). */
export function guidParaBytes(g: string): Buffer {
  const h = g.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(h)) throw new Error(`GUID inválido: ${g}`);
  const b = Buffer.from(h, 'hex');
  const s = Buffer.alloc(16);
  s.writeUInt32LE(b.readUInt32BE(0), 0);
  s.writeUInt16LE(b.readUInt16BE(4), 4);
  s.writeUInt16LE(b.readUInt16BE(6), 6);
  b.copy(s, 8, 8, 16);
  return s;
}

export function bytesParaGuid(b: Uint8Array): string {
  const x = Buffer.from(b.buffer, b.byteOffset, 16);
  const h = (n: number, d: number) => n.toString(16).padStart(d, '0');
  const fim = x.subarray(10, 16).toString('hex');
  return `${h(x.readUInt32LE(0), 8)}-${h(x.readUInt16LE(4), 4)}-${h(x.readUInt16LE(6), 4)}-${x.subarray(8, 10).toString('hex')}-${fim}`.toUpperCase();
}

/** Um GUID novo (versão 4). */
export function guidAleatorio(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface Particao {
  /** 1, 2…: a posição na tabela. */
  numero: number;
  tipo: string;
  unico: string;
  /** Em LBAs do disco (primeiro e último, inclusive). */
  inicio: number;
  fim: number;
  atributos: bigint;
  nome: string;
}

export interface Gpt {
  setor: number;
  discoGuid: string;
  primeiroUtil: number;
  ultimoUtil: number;
  /** O LBA do cabeçalho reserva (o último do disco, numa GPT certa). */
  reserva: number;
  particoes: Particao[];
}

export class ErroGpt extends Error {
  readonly codigo: 'sem-gpt' | 'gpt-corrompida';
  constructor(codigo: 'sem-gpt' | 'gpt-corrompida') {
    super(codigo);
    this.codigo = codigo;
  }
}

const u64 = (b: Buffer, o: number): number => {
  const v = b.readBigUInt64LE(o);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ErroGpt('gpt-corrompida');
  return Number(v);
};

/**
 * Lê a GPT primária. `ler(posição, tamanho)` lê bytes do disco (ou da imagem). Confere a assinatura, o
 * CRC do cabeçalho e o das entradas: GPT com defeito = erro (o Gravador nunca "adivinha" partições).
 */
export async function lerGpt(ler: (posicao: number, tamanho: number) => Promise<Buffer>, setor: number): Promise<Gpt> {
  const cab = await ler(setor, setor);
  if (cab.subarray(0, 8).toString('latin1') !== 'EFI PART') throw new ErroGpt('sem-gpt');
  const tamCab = cab.readUInt32LE(12);
  if (tamCab < 92 || tamCab > setor) throw new ErroGpt('gpt-corrompida');
  const copia = Buffer.from(cab.subarray(0, tamCab));
  const crcCab = copia.readUInt32LE(16);
  copia.writeUInt32LE(0, 16);
  if (crc32(copia) !== crcCab) throw new ErroGpt('gpt-corrompida');
  if (u64(cab, 24) !== 1) throw new ErroGpt('gpt-corrompida');
  const lbaEntradas = u64(cab, 72);
  const n = cab.readUInt32LE(80);
  const tam = cab.readUInt32LE(84);
  if (tam < 128 || tam % 8 !== 0 || n < 1 || n * tam > 4 * 1024 * 1024) throw new ErroGpt('gpt-corrompida');
  const bruto = await ler(lbaEntradas * setor, Math.ceil((n * tam) / setor) * setor);
  const entradas = bruto.subarray(0, n * tam);
  if (crc32(entradas) !== cab.readUInt32LE(88)) throw new ErroGpt('gpt-corrompida');
  const particoes: Particao[] = [];
  for (let i = 0; i < n; i++) {
    const e = entradas.subarray(i * tam, i * tam + 128);
    if (e.subarray(0, 16).every((x) => x === 0)) continue;
    const nome = e.subarray(56, 128).toString('utf16le').replace(/\0.*$/s, '');
    particoes.push({ numero: i + 1, tipo: bytesParaGuid(e.subarray(0, 16)), unico: bytesParaGuid(e.subarray(16, 32)), inicio: u64(e, 32), fim: u64(e, 40), atributos: e.readBigUInt64LE(48), nome });
  }
  return { setor, discoGuid: bytesParaGuid(cab.subarray(56, 72)), primeiroUtil: u64(cab, 40), ultimoUtil: u64(cab, 48), reserva: u64(cab, 32), particoes };
}

/** A geometria de uma GPT nova num disco de `tamanho` bytes com setor `setor`. */
export function geometria(tamanho: number, setor: number): { ultimoLba: number; setoresEntradas: number; primeiroUtil: number; ultimoUtil: number } {
  const ultimoLba = Math.floor(tamanho / setor) - 1;
  const setoresEntradas = Math.ceil(BYTES_ENTRADAS / setor);
  return { ultimoLba, setoresEntradas, primeiroUtil: 2 + setoresEntradas, ultimoUtil: ultimoLba - setoresEntradas - 1 };
}

export interface NovaParticao {
  tipo: string;
  inicio: number;
  fim: number;
  nome: string;
  unico?: string;
  atributos?: bigint;
}

export interface GptMontada {
  /** LBA 0 até o fim das entradas primárias: vai na posição 0. */
  inicio: Buffer;
  /** As entradas reserva + o cabeçalho reserva: vai em `fim.posicao` (o fim do disco). */
  fim: { posicao: number; dados: Buffer };
  particoes: Particao[];
}

/** Monta a GPT inteira de um disco (MBR protetor, primária e reserva). As partições ficam na ordem dada. */
export function montarGpt(o: { tamanho: number; setor: number; particoes: NovaParticao[]; discoGuid?: string }): GptMontada {
  const { setor } = o;
  if (setor !== 512 && setor !== 4096) throw new Error(`setor de ${setor} bytes`);
  const g = geometria(o.tamanho, setor);
  let anterior = g.primeiroUtil - 1;
  const particoes: Particao[] = o.particoes.map((p, i) => {
    if (p.inicio <= anterior || p.fim < p.inicio || p.fim > g.ultimoUtil) throw new Error(`a partição ${i + 1} não cabe (${p.inicio}–${p.fim}; útil ${g.primeiroUtil}–${g.ultimoUtil})`);
    anterior = p.fim;
    return { numero: i + 1, tipo: p.tipo, unico: p.unico ?? guidAleatorio(), inicio: p.inicio, fim: p.fim, atributos: p.atributos ?? 0n, nome: p.nome };
  });
  if (particoes.length > N_ENTRADAS) throw new Error('partições demais');

  const entradas = Buffer.alloc(g.setoresEntradas * setor);
  particoes.forEach((p, i) => {
    const e = entradas.subarray(i * TAM_ENTRADA, (i + 1) * TAM_ENTRADA);
    guidParaBytes(p.tipo).copy(e, 0);
    guidParaBytes(p.unico).copy(e, 16);
    e.writeBigUInt64LE(BigInt(p.inicio), 32);
    e.writeBigUInt64LE(BigInt(p.fim), 40);
    e.writeBigUInt64LE(p.atributos, 48);
    const nome = Buffer.from(p.nome, 'utf16le');
    if (nome.length > 72) throw new Error('nome de partição longo demais');
    nome.copy(e, 56);
  });
  const crcEntradas = crc32(entradas.subarray(0, BYTES_ENTRADAS));
  const discoGuid = o.discoGuid ?? guidAleatorio();

  const cabecalho = (meu: number, outro: number, lbaEntradas: number): Buffer => {
    const c = Buffer.alloc(setor);
    c.write('EFI PART', 0, 'latin1');
    c.writeUInt32LE(0x00010000, 8);
    c.writeUInt32LE(92, 12);
    c.writeBigUInt64LE(BigInt(meu), 24);
    c.writeBigUInt64LE(BigInt(outro), 32);
    c.writeBigUInt64LE(BigInt(g.primeiroUtil), 40);
    c.writeBigUInt64LE(BigInt(g.ultimoUtil), 48);
    guidParaBytes(discoGuid).copy(c, 56);
    c.writeBigUInt64LE(BigInt(lbaEntradas), 72);
    c.writeUInt32LE(N_ENTRADAS, 80);
    c.writeUInt32LE(TAM_ENTRADA, 84);
    c.writeUInt32LE(crcEntradas, 88);
    c.writeUInt32LE(crc32(c.subarray(0, 92)), 16);
    return c;
  };

  // o MBR protetor: uma partição 0xEE cobrindo o disco (ou o máximo que 32 bits contam)
  const mbr = Buffer.alloc(setor);
  mbr[446 + 1] = 0x00;
  mbr[446 + 2] = 0x02;
  mbr[446 + 3] = 0x00;
  mbr[446 + 4] = 0xee;
  mbr[446 + 5] = 0xff;
  mbr[446 + 6] = 0xff;
  mbr[446 + 7] = 0xff;
  mbr.writeUInt32LE(1, 446 + 8);
  mbr.writeUInt32LE(Math.min(g.ultimoLba, 0xffffffff), 446 + 12);
  mbr[510] = 0x55;
  mbr[511] = 0xaa;

  const lbaEntradasReserva = g.ultimoLba - g.setoresEntradas;
  return {
    inicio: Buffer.concat([mbr, cabecalho(1, g.ultimoLba, 2), entradas]),
    fim: { posicao: lbaEntradasReserva * setor, dados: Buffer.concat([entradas, cabecalho(g.ultimoLba, 1, lbaEntradasReserva)]) },
    particoes,
  };
}
