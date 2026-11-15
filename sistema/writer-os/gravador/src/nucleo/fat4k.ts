// SPDX-License-Identifier: MPL-2.0

/**
 * O DISCO DE SETOR 4096 (4Kn; PLANO §6.1b, item 2). A imagem é uma GPT de 512 com uma FAT32 de 512
 * bytes por setor, e o Linux não monta uma FAT cujo setor seja menor que o do disco (nem o live-boot
 * acharia o sistema). Então, num disco 4Kn, o Gravador "monta a partição ali mesmo": a GPT é feita
 * com LBAs de 4096 (gpt.ts) e a FAT32 é REESCRITA com setor de 4096, sem mexer em nenhum arquivo:
 *
 * - o cluster continua com o mesmo tamanho em bytes (4 KiB ou múltiplo: a imagem é feita com
 *   `mkfs.vfat -s 8`), e o número de clusters é o mesmo;
 * - então a FAT (que conta clusters) e a área de dados (os diretórios e os arquivos) vão byte a byte;
 * - muda só o começo: o setor de boot (bytes por setor, setores por cluster, reservados, tamanho
 *   da FAT, total, ocultos), o FSInfo e as cópias, e cada FAT fica com o tamanho arredondado para
 *   setores de 4096 (o que sobra é zero).
 *
 * Fica igual a uma FAT32 feita do zero com `mkfs.vfat -S 4096`, com os mesmos arquivos nos mesmos
 * clusters. O CI confere montando as duas e comparando os arquivos (tests/gravador/disco-virtual.ts).
 */

export interface Bpb {
  bytesPorSetor: number;
  setoresPorCluster: number;
  reservados: number;
  fats: number;
  setoresPorFat: number;
  totalSetores: number;
  ocultos: number;
  clusterRaiz: number;
  fsInfo: number;
  copiaBoot: number;
}

export class ErroFat extends Error {
  readonly codigo: 'nao-fat32' | 'fat-incompativel';
  constructor(codigo: 'nao-fat32' | 'fat-incompativel') {
    super(codigo);
    this.codigo = codigo;
  }
}

/** Lê o BPB de uma FAT32 (o primeiro setor da partição). Não é FAT32 = erro. */
export function lerBpb(s: Buffer): Bpb {
  if (s.length < 512 || s[510] !== 0x55 || s[511] !== 0xaa) throw new ErroFat('nao-fat32');
  const b: Bpb = {
    bytesPorSetor: s.readUInt16LE(11),
    setoresPorCluster: s[13]!,
    reservados: s.readUInt16LE(14),
    fats: s[16]!,
    setoresPorFat: s.readUInt32LE(36),
    totalSetores: s.readUInt32LE(32),
    ocultos: s.readUInt32LE(28),
    clusterRaiz: s.readUInt32LE(44),
    fsInfo: s.readUInt16LE(48),
    copiaBoot: s.readUInt16LE(50),
  };
  const fat32 = s.subarray(82, 90).toString('latin1') === 'FAT32   ';
  const raizFat16 = s.readUInt16LE(17);
  if (!fat32 || raizFat16 !== 0 || s.readUInt16LE(22) !== 0 || !b.setoresPorFat || !b.totalSetores) throw new ErroFat('nao-fat32');
  if (![512, 1024, 2048, 4096].includes(b.bytesPorSetor) || !b.setoresPorCluster || b.setoresPorCluster & (b.setoresPorCluster - 1)) throw new ErroFat('nao-fat32');
  if (b.fats < 1 || b.fats > 2 || b.reservados < 2) throw new ErroFat('nao-fat32');
  return b;
}

/** Quantos bytes do começo da partição vão até o início dos dados (reservados + FATs). */
export const bytesAteDados = (b: Bpb): number => (b.reservados + b.fats * b.setoresPorFat) * b.bytesPorSetor;

export const clusters = (b: Bpb): number => Math.floor((b.totalSetores - b.reservados - b.fats * b.setoresPorFat) / b.setoresPorCluster);

export interface Traducao4k {
  /** O começo novo da partição (setor de boot, FSInfo, cópias, FATs): vai no início dela. */
  cabeca: Buffer;
  /** De onde vem a área de dados na partição de origem e quanto ela tem (só os clusters). */
  dadosOrigem: number;
  dadosTamanho: number;
  /** Onde a área de dados fica na partição nova (= `cabeca.length`). */
  dadosDestino: number;
  /** O tamanho do sistema de arquivos novo, em bytes (múltiplo de 4096). */
  tamanhoFs: number;
}

const S = 4096;

/**
 * Reescreve o começo de uma FAT32 de 512 para setor de 4096. `origem` tem pelo menos
 * `bytesAteDados(bpb)` bytes do começo da partição. `lbaParticao` = o LBA (de 4096) onde a
 * partição começa no disco novo (vai no campo "setores ocultos").
 */
export function traduzir4k(origem: Buffer, lbaParticao: number): Traducao4k {
  const b = lerBpb(origem);
  if (b.bytesPorSetor !== 512) throw new ErroFat('fat-incompativel');
  const bytesCluster = b.setoresPorCluster * 512;
  if (bytesCluster % S !== 0) throw new ErroFat('fat-incompativel');
  const ateDados = bytesAteDados(b);
  if (origem.length < ateDados) throw new Error('começo da FAT incompleto');
  const n = clusters(b);
  const bytesFat = b.setoresPorFat * 512;
  if (bytesFat < (n + 2) * 4) throw new ErroFat('nao-fat32');

  const reservados = Math.max(8, Math.ceil((b.reservados * 512) / S));
  const setoresPorFat = Math.ceil(bytesFat / S);
  const setoresPorCluster = bytesCluster / S;
  const inicioDados = reservados + b.fats * setoresPorFat;
  const total = inicioDados + n * setoresPorCluster;
  if (total > 0xffffffff) throw new ErroFat('fat-incompativel');

  const cabeca = Buffer.alloc(inicioDados * S);
  // os setores reservados da origem (boot, FSInfo, o 3º setor do boot e as cópias), cada um no começo do setor novo
  for (let i = 0; i < Math.min(b.reservados, reservados); i++) origem.copy(cabeca, i * S, i * 512, (i + 1) * 512);
  const boot = (pos: number) => {
    const s = cabeca.subarray(pos, pos + 512);
    s.writeUInt16LE(S, 11);
    s[13] = setoresPorCluster;
    s.writeUInt16LE(reservados, 14);
    s.writeUInt32LE(lbaParticao, 28);
    s.writeUInt32LE(total, 32);
    s.writeUInt32LE(setoresPorFat, 36);
  };
  boot(0);
  if (b.copiaBoot > 0 && b.copiaBoot < reservados) {
    origem.copy(cabeca, b.copiaBoot * S, 0, 512);
    if (b.fsInfo > 0 && b.copiaBoot + b.fsInfo < reservados) origem.copy(cabeca, (b.copiaBoot + b.fsInfo) * S, b.fsInfo * 512, (b.fsInfo + 1) * 512);
    boot(b.copiaBoot * S);
  }
  for (let f = 0; f < b.fats; f++) {
    const de = (b.reservados + f * b.setoresPorFat) * 512;
    origem.copy(cabeca, (reservados + f * setoresPorFat) * S, de, de + bytesFat);
  }
  return { cabeca, dadosOrigem: ateDados, dadosTamanho: n * bytesCluster, dadosDestino: cabeca.length, tamanhoFs: total * S };
}
