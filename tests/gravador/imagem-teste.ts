// SPDX-License-Identifier: MPL-2.0

/**
 * Imagens de teste do Gravador, feitas em JS (sem mkfs): uma FAT32 pequena com alguns arquivos, dentro
 * de uma GPT de 512 igual à da imagem do Writer OS (uma partição EKFRASE-BOOT, tipo ESP, em 1 MiB),
 * um leitor de FAT32 (para conferir a tradução para 4096) e um assinador minisign (chave só de teste).
 * O CI confere com a imagem DE VERDADE (mkfs.vfat + sgdisk) em tests/gravador/disco-virtual.ts.
 */
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { montarGpt, NOME_BOOT, TIPO } from '../../sistema/writer-os/gravador/src/nucleo/gpt.ts';

export const MIB = 1024 * 1024;

/** Uma FAT32 de `tamanho` bytes (512 por setor, cluster de 4 KiB), com os arquivos na raiz (nomes 8.3). */
export function fat32(tamanho: number, arquivos: Record<string, Buffer>, rotulo = 'EKFR-BOOT'): Buffer {
  const total = tamanho / 512;
  const spc = 8;
  const rsvd = 32;
  let fatSz = 1;
  for (let i = 0; i < 10; i++) {
    const n = Math.floor((total - rsvd - 2 * fatSz) / spc);
    fatSz = Math.ceil(((n + 2) * 4) / 512);
  }
  const p = Buffer.alloc(tamanho);
  const b = p.subarray(0, 512);
  b.set([0xeb, 0x58, 0x90]);
  b.write('MSWIN4.1', 3, 'latin1');
  b.writeUInt16LE(512, 11);
  b[13] = spc;
  b.writeUInt16LE(rsvd, 14);
  b[16] = 2;
  b[21] = 0xf8;
  b.writeUInt16LE(63, 24);
  b.writeUInt16LE(255, 26);
  b.writeUInt32LE(2048, 28);
  b.writeUInt32LE(total, 32);
  b.writeUInt32LE(fatSz, 36);
  b.writeUInt32LE(2, 44);
  b.writeUInt16LE(1, 48);
  b.writeUInt16LE(6, 50);
  b[64] = 0x80;
  b[66] = 0x29;
  b.writeUInt32LE(0x1234abcd, 67);
  b.write(rotulo.padEnd(11), 71, 'latin1');
  b.write('FAT32   ', 82, 'latin1');
  b[510] = 0x55;
  b[511] = 0xaa;
  const fsinfo = p.subarray(512, 1024);
  fsinfo.writeUInt32LE(0x41615252, 0);
  fsinfo.writeUInt32LE(0x61417272, 484);
  fsinfo.writeUInt32LE(0xffffffff, 488);
  fsinfo.writeUInt32LE(0xffffffff, 492);
  fsinfo.writeUInt32LE(0xaa550000, 508);
  p.copy(p, 6 * 512, 0, 1024);

  const inicioDados = (rsvd + 2 * fatSz) * 512;
  const fat = Buffer.alloc(fatSz * 512);
  fat.writeUInt32LE(0x0ffffff8, 0);
  fat.writeUInt32LE(0x0fffffff, 4);
  fat.writeUInt32LE(0x0fffffff, 8); // a raiz, no cluster 2
  const raiz = p.subarray(inicioDados, inicioDados + 4096);
  raiz.write(rotulo.padEnd(11), 0, 'latin1');
  raiz[11] = 0x08;
  let cluster = 3;
  Object.entries(arquivos).forEach(([nome, dados], i) => {
    const [base, ext = ''] = nome.toUpperCase().split('.');
    const e = raiz.subarray(32 * (i + 1), 32 * (i + 2));
    e.write(base!.padEnd(8) + ext.padEnd(3), 0, 'latin1');
    e[11] = 0x20;
    e.writeUInt16LE(cluster >> 16, 20);
    e.writeUInt16LE(cluster & 0xffff, 26);
    e.writeUInt32LE(dados.length, 28);
    const n = Math.max(1, Math.ceil(dados.length / 4096));
    for (let k = 0; k < n; k++) fat.writeUInt32LE(k === n - 1 ? 0x0fffffff : cluster + k + 1, (cluster + k) * 4);
    dados.copy(p, inicioDados + (cluster - 2) * 4096);
    cluster += n;
  });
  fat.copy(p, rsvd * 512);
  fat.copy(p, (rsvd + fatSz) * 512);
  return p;
}

/** Lê um arquivo da raiz de uma FAT32 (qualquer tamanho de setor): para conferir a tradução. */
export function lerDaFat(p: Buffer, nome: string): Buffer | null {
  const bps = p.readUInt16LE(11);
  const spc = p[13]!;
  const rsvd = p.readUInt16LE(14);
  const nf = p[16]!;
  const fatSz = p.readUInt32LE(36);
  const cl = bps * spc;
  const dados = (rsvd + nf * fatSz) * bps;
  const fat = (n: number) => p.readUInt32LE(rsvd * bps + n * 4) & 0x0fffffff;
  const raiz = p.subarray(dados + (p.readUInt32LE(44) - 2) * cl, dados + (p.readUInt32LE(44) - 1) * cl);
  const [base, ext = ''] = nome.toUpperCase().split('.');
  const alvo = base!.padEnd(8) + ext.padEnd(3);
  for (let o = 0; o < raiz.length; o += 32) {
    if (raiz.subarray(o, o + 11).toString('latin1') !== alvo) continue;
    let c = (raiz.readUInt16LE(o + 20) << 16) | raiz.readUInt16LE(o + 26);
    const tam = raiz.readUInt32LE(o + 28);
    const partes: Buffer[] = [];
    while (c >= 2 && c < 0x0ffffff8) {
      partes.push(p.subarray(dados + (c - 2) * cl, dados + (c - 1) * cl));
      c = fat(c);
    }
    return Buffer.concat(partes).subarray(0, tam);
  }
  return null;
}

/** Uma imagem como a do Writer OS: 1 MiB + a partição 1 + 1 MiB, GPT de 512. */
export function imagemTeste(p1: Buffer): Buffer {
  const total = MIB + p1.length + MIB;
  const g = montarGpt({ tamanho: total, setor: 512, particoes: [{ tipo: TIPO.esp, inicio: 2048, fim: 2048 + p1.length / 512 - 1, nome: NOME_BOOT }] });
  const img = Buffer.alloc(total);
  g.inicio.copy(img, 0);
  p1.copy(img, MIB);
  g.fim.dados.copy(img, g.fim.posicao);
  return img;
}

/** Arquivos de teste com conteúdo sorteado (um maior que um cluster, para ter cadeia na FAT). */
export function arquivosTeste(semente = 'a'): Record<string, Buffer> {
  return { 'VMLINUZ': randomBytes(10_000), 'GRUB.CFG': Buffer.from(`set timeout=0 # ${semente}\n`), 'DADOS.BIN': randomBytes(70_000) };
}

/** Um assinador minisign (pré-hash, `ED`) com uma chave sorteada: só para os testes. */
export function assinadorTeste() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const id = randomBytes(8);
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
  const chave = `untrusted comment: minisign public key teste\n${Buffer.concat([Buffer.from('Ed', 'latin1'), id, pub]).toString('base64')}\n`;
  const assinar = (dados: Buffer, comentario = 'teste') => {
    const h = createHash('blake2b512').update(dados).digest();
    const sig = sign(null, h, privateKey);
    const global = sign(null, Buffer.concat([sig, Buffer.from(comentario)]), privateKey);
    return `untrusted comment: assinatura de teste\n${Buffer.concat([Buffer.from('ED', 'latin1'), id, sig]).toString('base64')}\ntrusted comment: ${comentario}\n${global.toString('base64')}\n`;
  };
  return { chave, assinar };
}

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** Comprime com o `xz` do sistema (no Windows, o que vem com o Git): `arquivo` → `arquivo.xz` (o original fica). */
export function comprimirXz(arquivo: string): string {
  const opcoes = [process.env['XZ'], 'xz', 'C:\\Program Files\\Git\\usr\\bin\\xz.exe', 'C:\\Program Files\\Git\\ucrt64\\bin\\xz.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\xz.exe'].filter((x): x is string => !!x);
  for (const x of opcoes) if (spawnSync(x, ['-T0', '-3', '-f', '-k', arquivo]).status === 0) return `${arquivo}.xz`;
  throw new Error('sem o xz (no Windows, o do Git for Windows)');
}
