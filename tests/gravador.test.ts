// SPDX-License-Identifier: MPL-2.0
/**
 * O Gravador sem o Electron (sistema/writer-os/gravador/src/nucleo): a GPT, o lacre (contra uma
 * assinatura feita pelo minisign de verdade), a FAT32 reescrita para disco de 4096, a REGRA DE QUAL
 * DISCO PODE SER APAGADO (com saídas de verdade do PowerShell e do lsblk), o Criar e o Atualizar
 * inteiros contra discos simulados (arquivos), as recusas de quem grava e o download com retomada.
 * O mesmo contra discos virtuais de verdade (loop no Linux, VHD no Windows) e a imagem de verdade:
 * tests/gravador/disco-virtual.ts, no CI do Writer OS.
 */
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ambienteSimulado, MARCA_SIMULADA, particaoLinux } from '../sistema/writer-os/gravador/src/nucleo/ambientes.ts';
import { CHAVE_EKFRASE, ID_CHAVE_EKFRASE } from '@ekfrase/atualizacoes';
import { computadorSimulado, entradasDoWriter, executarComputador, GB, guardaDoSistema, lerInfo, recusaDoPreparar, scriptPreparar, SEM_COMPUTADOR, TAMANHOS_GB, tamanhosQueCabem } from '../sistema/writer-os/gravador/src/nucleo/computador.ts';
import { discosDoLinux, discosDoWindows, MINIMO_DISCO, type Disco } from '../sistema/writer-os/gravador/src/nucleo/discos.ts';
import { lerBpb, traduzir4k } from '../sistema/writer-os/gravador/src/nucleo/fat4k.ts';
import { bytesParaGuid, crc32, guidParaBytes, lerGpt, montarGpt, NOME_BOOT, NOME_DADOS, TIPO } from '../sistema/writer-os/gravador/src/nucleo/gpt.ts';
import { executar, type Ambiente, type Aviso, type Tarefa } from '../sistema/writer-os/gravador/src/nucleo/gravar.ts';
import { Fluxo } from '../sistema/writer-os/gravador/src/nucleo/imagem.ts';
import { conferirAssinatura, hashesDoArquivo, lerChavePublica } from '@ekfrase/atualizacoes';
import { baixarArquivo, imagemDoArquivo, ultimoLancamento, type Buscar } from '../sistema/writer-os/gravador/src/nucleo/origem.ts';
import { arquivosTeste, assinadorTeste, comprimirXz, fat32, imagemTeste, lerDaFat, MIB, sha256 } from './gravador/imagem-teste.ts';

const FIX = fileURLToPath(new URL('./gravador/fixtures/', import.meta.url));
const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const pasta = mkdtempSync(join(tmpdir(), 'gravador-teste-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('GPT', () => {
  it('CRC-32 e GUID como a especificação', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(guidParaBytes(TIPO.esp).toString('hex')).toBe('28732ac11ff8d211ba4b00a0c93ec93b');
    expect(bytesParaGuid(guidParaBytes(TIPO.dadosMicrosoft))).toBe(TIPO.dadosMicrosoft);
  });

  for (const setor of [512, 4096]) {
    it(`monta e lê de volta (setor ${setor}): MBR protetor, primária e reserva no último LBA`, async () => {
      const tamanho = 64 * MIB;
      const disco = Buffer.alloc(tamanho);
      const lbaMib = MIB / setor;
      const g = montarGpt({ tamanho, setor, particoes: [{ tipo: TIPO.esp, inicio: lbaMib, fim: 2 * lbaMib - 1, nome: NOME_BOOT }, { tipo: TIPO.dadosMicrosoft, inicio: 2 * lbaMib, fim: 10 * lbaMib - 1, nome: NOME_DADOS }] });
      g.inicio.copy(disco, 0);
      g.fim.dados.copy(disco, g.fim.posicao);
      expect(disco[450]).toBe(0xee);
      expect(disco.readUInt16LE(510)).toBe(0xaa55);
      const lida = await lerGpt(async (p, n) => disco.subarray(p, p + n), setor);
      expect(lida.reserva).toBe(tamanho / setor - 1);
      expect(lida.particoes.map((p) => [p.numero, p.nome, p.tipo, p.inicio, p.fim])).toEqual([
        [1, NOME_BOOT, TIPO.esp, lbaMib, 2 * lbaMib - 1],
        [2, NOME_DADOS, TIPO.dadosMicrosoft, 2 * lbaMib, 10 * lbaMib - 1],
      ]);
      // o cabeçalho reserva aponta para a primária
      expect(disco.subarray(tamanho - setor, tamanho - setor + 8).toString('latin1')).toBe('EFI PART');
      // GPT com um byte trocado = erro, nunca "adivinhar"
      disco[2 * setor + 60] = disco[2 * setor + 60]! ^ 1;
      await expect(lerGpt(async (p, n) => disco.subarray(p, p + n), setor)).rejects.toThrow('gpt-corrompida');
    });
  }

  it('recusa partição fora do espaço útil', () => {
    expect(() => montarGpt({ tamanho: 8 * MIB, setor: 512, particoes: [{ tipo: TIPO.esp, inicio: 2048, fim: 8 * 2048, nome: NOME_BOOT }] })).toThrow('não cabe');
  });
});

describe('o lacre (minisign)', () => {
  it('a chave embutida é a de sistema/writer-os/imagem/minisign.pub', () => {
    const arquivo = readFileSync(join(RAIZ, 'sistema/writer-os/imagem/minisign.pub'), 'utf8');
    expect(CHAVE_EKFRASE.replace(/\r/g, '').trim()).toBe(arquivo.replace(/\r/g, '').trim());
    expect(lerChavePublica(CHAVE_EKFRASE).id).toBe(ID_CHAVE_EKFRASE);
  });

  it('confere uma assinatura feita pelo minisign de verdade (e recusa o arquivo mudado e outra chave)', async () => {
    const chave = lerChavePublica(readFileSync(join(FIX, 'teste.pub'), 'utf8'));
    const sig = readFileSync(join(FIX, 'assinado.txt.minisig'), 'utf8');
    const h = await hashesDoArquivo(join(FIX, 'assinado.txt'));
    expect(conferirAssinatura(chave, sig, h.blake2b)).toEqual({ ok: true, comentario: 'teste do Gravador' });
    const outro = Buffer.from(h.blake2b);
    outro[0] = outro[0]! ^ 1;
    expect(conferirAssinatura(chave, sig, outro)).toEqual({ ok: false, motivo: 'assinatura' });
    expect(conferirAssinatura(lerChavePublica(CHAVE_EKFRASE), sig, h.blake2b)).toEqual({ ok: false, motivo: 'outra-chave' });
    // o comentário de confiança também é assinado
    expect(conferirAssinatura(chave, sig.replace('teste do Gravador', 'outro'), h.blake2b)).toEqual({ ok: false, motivo: 'assinatura' });
  });
});

describe('a imagem', () => {
  it('descomprime o .xz (o xz em WebAssembly) e lê em pedaços exatos', async () => {
    const f = new Fluxo(join(FIX, 'padrao.bin.xz'));
    const esperado = Buffer.alloc(3 * MIB);
    for (let i = 0; i < esperado.length; i++) esperado[i] = (i * 7 + (i >> 12)) % 251;
    const a = await f.ler(1000);
    const partes = [a];
    for await (const p of f.passar(3 * MIB - 1000)) partes.push(Buffer.from(p));
    expect(sha256(Buffer.concat(partes))).toBe(sha256(esperado));
    await expect(f.ler(1)).rejects.toThrow('imagem-curta');
  });
});

describe('disco de setor 4096: a FAT32 reescrita', () => {
  it('os mesmos arquivos, nos mesmos clusters; só o começo muda', () => {
    const arquivos = arquivosTeste();
    const p = fat32(16 * MIB, arquivos);
    const t = traduzir4k(p, 256);
    const nova = Buffer.alloc(t.tamanhoFs);
    t.cabeca.copy(nova, 0);
    p.copy(nova, t.dadosDestino, t.dadosOrigem, t.dadosOrigem + t.dadosTamanho);
    const b = lerBpb(nova);
    expect([b.bytesPorSetor, b.setoresPorCluster, b.ocultos, b.fsInfo, b.copiaBoot]).toEqual([4096, 1, 256, 1, 6]);
    expect(b.reservados).toBeGreaterThanOrEqual(8);
    expect(nova.readUInt16LE(6 * 4096 + 11)).toBe(4096); // a cópia do boot também
    for (const [nome, dados] of Object.entries(arquivos)) expect(lerDaFat(nova, nome)?.equals(dados), nome).toBe(true);
    expect(t.tamanhoFs % 4096).toBe(0);
  });

  it('recusa FAT com cluster menor que 4 KiB e o que não é FAT32', () => {
    const p = fat32(16 * MIB, {});
    p[13] = 1;
    expect(() => traduzir4k(p, 256)).toThrow('fat-incompativel');
    expect(() => lerBpb(Buffer.alloc(512))).toThrow('nao-fat32');
  });
});

// ---------------------------------------------------------------- a regra dos discos

const CTX = { caminhosProtegidos: ['E:\\Gravador-Writer-OS.exe', 'C:\\Users\\a\\AppData\\Local\\Ekfrase\\Gravador'] };

describe('quais discos podem ser apagados (Windows)', () => {
  const json = JSON.stringify({
    doWindows: 0,
    discos: [
      { numero: 0, nome: 'SAMSUNG MZAL4256HBJD', serial: 'S1', barramento: 'NVMe', tamanho: 256e9, setor: 512, sistema: true, boot: true, midia: 'Fixed hard disk media', particoes: [{ numero: 3, tipo: '{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}', inicio: 1e6, tamanho: 255e9, letra: 'C', ehBoot: true }] },
      { numero: 1, nome: 'Msft Virtual Disk', serial: '', barramento: 'File Backed Virtual', tamanho: 1e12, setor: 512, particoes: null },
      { numero: 2, nome: 'Kingston DataTraveler 3.0', serial: 'K123  ', barramento: 'USB', tamanho: 15_500_000_000, setor: 512, midia: 'Removable Media', particoes: { numero: 1, tipo: '{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}', inicio: 1048576, tamanho: 15e9, letra: 'F', rotulo: 'FOTOS', sistema: 'exFAT', tamanhoVolume: 15e9, livre: 5e9 } },
      { numero: 3, nome: 'WD Elements', serial: 'W9', barramento: 7, tamanho: 2e12, setor: 4096, midia: 'External hard disk media', particoes: [{ numero: 1, tipo: '{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}', inicio: 1048576, tamanho: 2e12, letra: 'E', rotulo: 'BACKUP', sistema: 'NTFS' }] },
      { numero: 4, nome: 'Pendrive velho', serial: 'P', barramento: 'USB', tamanho: 2e9, setor: 512, particoes: [] },
      { numero: 5, nome: 'Windows To Go', serial: 'T', barramento: 'USB', tamanho: 64e9, setor: 512, sistema: true, particoes: [] },
      { numero: 6, nome: 'SanDisk Writer', serial: 'S', barramento: 'USB', tamanho: 32e9, setor: 512, particoes: [{ numero: 1, tipo: '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}', inicio: 1048576, tamanho: 1468006400 }, { numero: 2, tipo: '{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}', inicio: 1469054976, tamanho: 30e9, letra: 'G', rotulo: 'EKFR-DADOS', sistema: 'exFAT' }] },
      { numero: 7, nome: 'Leitor SD', serial: '', barramento: 'SD', tamanho: 64e9, setor: 512, particoes: [] },
    ],
  });
  const d = discosDoWindows(json, CTX);
  const por = (n: number) => d.find((x) => x.id === `win:${n}`);

  it('o disco interno, o virtual e o leitor SD nem aparecem', () => {
    expect(d.map((x) => x.id)).toEqual(['win:2', 'win:3', 'win:4', 'win:5', 'win:6']);
  });
  it('o pendrive pode; o HD que tem o Gravador, o pequeno e o do sistema, não', () => {
    expect(por(2)).toMatchObject({ recusa: null, tipo: 'pendrive', caminho: '\\\\.\\PhysicalDrive2', serial: 'K123', writerOS: false });
    expect(por(2)!.particoes[0]).toMatchObject({ rotulo: 'FOTOS', usado: 10e9, montagens: ['F:'] });
    expect(por(3)).toMatchObject({ recusa: 'gravador', tipo: 'externo', setor: 4096 });
    expect(por(4)!.recusa).toBe('pequeno');
    expect(por(5)!.recusa).toBe('sistema');
  });
  it('reconhece um Writer OS (modo Atualizar)', () => {
    expect(por(6)).toMatchObject({ recusa: null, writerOS: true });
  });
});

describe('quais discos podem ser apagados (Linux)', () => {
  const json = JSON.stringify({
    blockdevices: [
      { name: 'nvme0n1', path: '/dev/nvme0n1', type: 'disk', size: 512e9, tran: 'nvme', rm: false, ro: false, 'log-sec': 512, model: 'SAMSUNG', children: [{ name: 'nvme0n1p2', path: '/dev/nvme0n1p2', type: 'part', size: 511e9, mountpoint: '/' }] },
      { name: 'sda', path: '/dev/sda', type: 'disk', size: '16008609792', tran: 'usb', rm: true, ro: false, 'log-sec': '512', vendor: 'Kingston', model: 'DataTraveler 3.0 ', serial: 'K1', children: [{ name: 'sda1', path: '/dev/sda1', type: 'part', size: 16e9, label: 'FOTOS', fstype: 'vfat', fsused: '4000000000', mountpoint: '/media/ana/FOTOS' }] },
      { name: 'sdb', path: '/dev/sdb', type: 'disk', size: 64e9, tran: 'usb', rm: false, 'log-sec': 512, model: 'Ext', children: [{ name: 'sdb1', path: '/dev/sdb1', type: 'part', size: 63e9, mountpoint: '/home' }] },
      { name: 'sdc', path: '/dev/sdc', type: 'disk', size: 500e9, tran: 'usb', rm: false, 'log-sec': 4096, model: 'Crypt', children: [{ name: 'sdc1', path: '/dev/sdc1', type: 'part', size: 499e9, children: [{ name: 'luks', path: '/dev/mapper/luks', type: 'crypt', mountpoint: null }] }] },
      { name: 'sdd', path: '/dev/sdd', type: 'disk', size: 2e9, tran: 'usb', rm: true, 'log-sec': 512, model: 'Velho' },
      { name: 'sde', path: '/dev/sde', type: 'disk', size: 32e9, tran: 'usb', rm: true, 'log-sec': 512, model: 'Writer', children: [{ name: 'sde1', path: '/dev/sde1', type: 'part', size: 1468006400, partlabel: 'EKFRASE-BOOT', label: 'EKFR-BOOT' }, { name: 'sde2', path: '/dev/sde2', type: 'part', size: 30e9, partlabel: 'EKFRASE-DADOS', label: 'EKFR-DADOS', mountpoint: '/media/ana/EKFR-DADOS' }] },
      { name: 'sdf', path: '/dev/sdf', type: 'disk', size: 32e9, tran: 'usb', rm: true, 'log-sec': 512, model: 'ComGravador', children: [{ name: 'sdf1', path: '/dev/sdf1', type: 'part', size: 32e9, mountpoint: '/media/ana/PEN' }] },
      { name: 'mmcblk0', path: '/dev/mmcblk0', type: 'disk', size: 64e9, tran: null, rm: false, 'log-sec': 512 },
      { name: 'loop0', path: '/dev/loop0', type: 'loop', size: 8e9 },
    ],
  });
  const d = discosDoLinux(json, { caminhosProtegidos: ['/media/ana/PEN/Gravador-Writer-OS.AppImage'] });
  const por = (n: string) => d.find((x) => x.id === `/dev/${n}`);

  it('só USB: o NVMe, o cartão SD embutido e o loop nem aparecem', () => {
    expect(d.map((x) => x.id)).toEqual(['/dev/sda', '/dev/sdb', '/dev/sdc', '/dev/sdd', '/dev/sde', '/dev/sdf']);
  });
  it('as recusas', () => {
    expect(por('sda')).toMatchObject({ recusa: null, nome: 'Kingston DataTraveler 3.0', tamanho: 16008609792, tipo: 'pendrive' });
    expect(por('sda')!.particoes[0]).toMatchObject({ rotulo: 'FOTOS', usado: 4e9 });
    expect(por('sdb')!.recusa).toBe('sistema');
    expect(por('sdc')).toMatchObject({ recusa: 'em-uso', setor: 4096 });
    expect(por('sdd')!.recusa).toBe('pequeno');
    expect(por('sdf')!.recusa).toBe('gravador');
    expect(por('sde')).toMatchObject({ recusa: null, writerOS: true });
    expect(MINIMO_DISCO).toBeLessThan(3.8e9);
  });
  it('o nome da partição no Linux', () => {
    expect([particaoLinux('/dev/sdb', 2), particaoLinux('/dev/loop3', 2), particaoLinux('/dev/nvme0n1', 1)]).toEqual(['/dev/sdb2', '/dev/loop3p2', '/dev/nvme0n1p1']);
  });
});

// ---------------------------------------------------------------- gravar de ponta a ponta (discos simulados)

interface Cenario {
  arquivoImagem: string;
  imagem: Buffer;
  p1: Buffer;
  arquivos: Record<string, Buffer>;
}

function cenario(nome: string, semente: string): Cenario {
  const arquivos = arquivosTeste(semente);
  const p1 = fat32(24 * MIB, arquivos);
  const imagem = imagemTeste(p1);
  const arquivoImagem = join(pasta, `${nome}.img`);
  writeFileSync(arquivoImagem, imagem);
  return { arquivoImagem, imagem, p1, arquivos };
}

function disco(nome: string, tamanho: number, setor: number, extra: Partial<Disco> = {}): { d: Disco; amb: Ambiente } {
  const caminho = join(pasta, `${nome}.disco`);
  // um arquivo (esparso) do tamanho do disco
  writeFileSync(caminho, '');
  truncateSync(caminho, tamanho);
  const d: Disco = { id: `sim:${nome}`, caminho, nome: `Disco ${nome}`, tamanho, setor, barramento: 'usb', tipo: 'pendrive', serial: nome, somenteLeitura: false, particoes: [], recusa: null, writerOS: false, ...extra };
  const lista = join(pasta, `${nome}.json`);
  writeFileSync(lista, JSON.stringify([d]));
  return { d, amb: ambienteSimulado(lista) };
}

function tarefa(c: Cenario, d: Disco, modo: Tarefa['modo'], limiteDados: number | null = null): Tarefa {
  return { modo, disco: d, imagem: { arquivo: c.arquivoImagem, sha256: sha256(readFileSync(c.arquivoImagem)) }, limiteDados };
}

const lerDisco = (d: Disco, pos: number, n: number) => {
  const fd = openSync(d.caminho, 'r');
  try {
    const b = Buffer.alloc(n);
    readSync(fd, b, 0, n, pos);
    return b;
  } finally {
    closeSync(fd);
  }
};

describe('Criar e Atualizar (discos simulados)', () => {
  const a = cenario('versao-a', 'a');
  const b = cenario('versao-b', 'b');

  for (const setor of [512, 4096]) {
    it(`setor ${setor}: Criar grava a partição 1, a GPT do disco e a EKFRASE-DADOS; Atualizar troca só a 1`, async () => {
      const { d, amb } = disco(`s${setor}`, 640 * MIB, setor);
      const avisos: Aviso[] = [];
      const r = await executar(tarefa(a, d, 'criar'), amb, (x) => avisos.push(x));
      expect(avisos.map((x) => x.fase).filter((f, i, l) => l.indexOf(f) === i)).toEqual(['conferir', 'preparar', 'gravar', 'verificar', 'dados', 'pronto']);
      const g = await lerGpt(async (p, n) => lerDisco(d, p, n), setor);
      expect(g.reserva).toBe((640 * MIB) / setor - 1);
      expect(g.particoes.map((p) => p.nome)).toEqual([NOME_BOOT, NOME_DADOS]);
      const [p1, p2] = g.particoes;
      expect(p1!.inicio * setor).toBe(MIB);
      const bootNoDisco = lerDisco(d, MIB, (p1!.fim - p1!.inicio + 1) * setor);
      if (setor === 512) expect(sha256(bootNoDisco.subarray(0, a.p1.length))).toBe(sha256(a.p1)); // idêntica à imagem
      else for (const [nome, dados] of Object.entries(a.arquivos)) expect(lerDaFat(bootNoDisco, nome)?.equals(dados), nome).toBe(true);
      expect(p2!.tipo).toBe(TIPO.dadosMicrosoft);
      expect(lerDisco(d, p2!.inicio * setor, MARCA_SIMULADA.length).toString('latin1')).toBe(MARCA_SIMULADA);
      expect(r.plano.dados?.sistema).toBe('exfat');

      // um "arquivo de teste" dentro da EKFRASE-DADOS
      const fh = (await import('node:fs/promises')).open;
      const h = await fh(d.caminho, 'r+');
      const texto = Buffer.alloc(setor, 0x41);
      await h.write(texto, 0, setor, p2!.inicio * setor + 8 * setor);
      await h.close();
      const dadosAntes = sha256(lerDisco(d, p2!.inicio * setor, (p2!.fim - p2!.inicio + 1) * setor));
      const gptAntes = sha256(lerDisco(d, 0, 64 * 1024));

      await executar(tarefa(b, d, 'atualizar'), amb, () => undefined);
      const boot2 = lerDisco(d, MIB, (p1!.fim - p1!.inicio + 1) * setor);
      if (setor === 512) expect(sha256(boot2.subarray(0, b.p1.length))).toBe(sha256(b.p1));
      else for (const [nome, dados] of Object.entries(b.arquivos)) expect(lerDaFat(boot2, nome)?.equals(dados), nome).toBe(true);
      expect(sha256(lerDisco(d, p2!.inicio * setor, (p2!.fim - p2!.inicio + 1) * setor))).toBe(dadosAntes);
      expect(sha256(lerDisco(d, 0, 64 * 1024))).toBe(gptAntes);
    }, 120_000);
  }

  it('limitar a EKFRASE-DADOS e não criar abaixo de 512 MB', async () => {
    const { d, amb } = disco('limite', 2048 * MIB, 512);
    const r = await executar(tarefa(a, d, 'criar', 600 * MIB), amb, () => undefined);
    expect(r.plano.dados?.tamanho).toBe(600 * MIB);
    const r2 = await executar(tarefa(a, d, 'criar', 100 * MIB), amb, () => undefined);
    expect(r2.plano.dados).toBeNull();
    const g = await lerGpt(async (p, n) => lerDisco(d, p, n), 512);
    expect(g.particoes.map((p) => p.nome)).toEqual([NOME_BOOT]);
  }, 60_000);

  it('quem grava recusa: o disco mudou, o disco virou do sistema, a imagem mudou, Atualizar num disco que não é Writer OS', async () => {
    const { d, amb } = disco('recusas', 128 * MIB, 512);
    await expect(executar(tarefa(a, { ...d, tamanho: d.tamanho + 512 }, 'criar'), amb, () => undefined)).rejects.toThrow('disco-mudou');
    await expect(executar(tarefa(a, { ...d, id: 'sim:outro' }, 'criar'), amb, () => undefined)).rejects.toThrow('disco-sumiu');
    const lista = join(pasta, 'recusas.json');
    writeFileSync(lista, JSON.stringify([{ ...d, recusa: 'sistema' }]));
    await expect(executar(tarefa(a, d, 'criar'), ambienteSimulado(lista), () => undefined)).rejects.toThrow('recusado');
    writeFileSync(lista, JSON.stringify([d]));
    await expect(executar({ ...tarefa(a, d, 'criar'), imagem: { arquivo: a.arquivoImagem, sha256: '0'.repeat(64) } }, amb, () => undefined)).rejects.toThrow('imagem-mudou');
    await expect(executar(tarefa(a, d, 'atualizar'), amb, () => undefined)).rejects.toThrow('nao-e-writer-os');
    // nada foi escrito: o disco continua zerado
    expect(lerDisco(d, 0, 2 * MIB).every((x) => x === 0)).toBe(true);
  }, 60_000);

  it('Criar a partir do .img.xz (o que o Release traz)', async () => {
    const { d, amb } = disco('xz', 640 * MIB, 512);
    const xz = comprimirXz(a.arquivoImagem);
    await executar({ modo: 'criar', disco: d, imagem: { arquivo: xz, sha256: sha256(readFileSync(xz)) }, limiteDados: null }, amb, () => undefined);
    expect(sha256(lerDisco(d, MIB, a.p1.length))).toBe(sha256(a.p1));
  }, 60_000);

  it('disco pequeno demais para a partição 1', async () => {
    const { d, amb } = disco('minusculo', 16 * MIB, 512);
    await expect(executar(tarefa(a, d, 'criar'), amb, () => undefined)).rejects.toThrow('pequeno');
  });
});

// ---------------------------------------------------------------- de onde vem a imagem

describe('o Release e o download com retomada', () => {
  let servidor: Server;
  let base = '';
  const conteudo = Buffer.alloc(3 * MIB + 123);
  for (let i = 0; i < conteudo.length; i++) conteudo[i] = (i * 31) & 0xff;
  let cortes = 2;
  beforeAll(async () => {
    servidor = createServer((q, r) => {
      if (q.url === '/repos/cyfilho/ekfrase/releases?per_page=50') {
        r.setHeader('content-type', 'application/json');
        const ativo = (tag: string, n: string) => ({ name: n, browser_download_url: `${base}/d/${tag}/${n}`, size: conteudo.length });
        r.end(
          JSON.stringify([
            { tag_name: 'writer-v0.9.0', assets: [ativo('writer-v0.9.0', 'Ekfrase-Writer-Setup.exe')] },
            { tag_name: 'writer-os-v0.2.0', draft: true, assets: [] },
            { tag_name: 'writer-os-v0.1.10', assets: ['ekfrase-writer-os-0.1.10.img.xz', 'ekfrase-writer-os-0.1.10.img.xz.sha256', 'ekfrase-writer-os-0.1.10.img.xz.minisig'].map((n) => ativo('writer-os-v0.1.10', n)) },
            { tag_name: 'writer-os-v0.1.9', assets: ['ekfrase-writer-os-0.1.9.img.xz', 'ekfrase-writer-os-0.1.9.img.xz.sha256', 'ekfrase-writer-os-0.1.9.img.xz.minisig'].map((n) => ativo('writer-os-v0.1.9', n)) },
            { tag_name: 'writer-os-v0.3.0', assets: [ativo('writer-os-v0.3.0', 'ekfrase-writer-os-0.3.0.img.xz')] },
            ...[2, 10].map((n) => ({ tag_name: `writer-os-v0.1.10-teste.${n}`, prerelease: true, assets: ['ekfrase-writer-os-0.1.10.img.xz', 'ekfrase-writer-os-0.1.10.img.xz.sha256', 'ekfrase-writer-os-0.1.10.img.xz.minisig'].map((a) => ativo(`writer-os-v0.1.10-teste.${n}`, a)) })),
            { tag_name: 'writer-os-v0.1.11-teste.1', prerelease: true, assets: ['ekfrase-writer-os-0.1.11.img.xz', 'ekfrase-writer-os-0.1.11.img.xz.sha256', 'ekfrase-writer-os-0.1.11.img.xz.minisig'].map((a) => ativo('writer-os-v0.1.11-teste.1', a)) },
            { tag_name: 'writer-os-v0.1.12', prerelease: true, assets: ['ekfrase-writer-os-0.1.12.img.xz', 'ekfrase-writer-os-0.1.12.img.xz.sha256', 'ekfrase-writer-os-0.1.12.img.xz.minisig'].map((a) => ativo('writer-os-v0.1.12', a)) },
          ]),
        );
        return;
      }
      if (q.url === '/arquivo') {
        const m = /bytes=(\d+)-/.exec(q.headers.range ?? '');
        const inicio = m ? Number(m[1]) : 0;
        r.writeHead(m ? 206 : 200, { 'content-length': conteudo.length - inicio, ...(m ? { 'content-range': `bytes ${inicio}-${conteudo.length - 1}/${conteudo.length}` } : {}) });
        if (cortes-- > 0) {
          // manda um pedaço e derruba a conexão (a internet caiu)
          r.write(conteudo.subarray(inicio, inicio + MIB));
          setTimeout(() => r.socket?.destroy(), 20);
          return;
        }
        r.end(conteudo.subarray(inicio));
        return;
      }
      r.statusCode = 404;
      r.end();
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    const ad = servidor.address();
    base = `http://127.0.0.1:${typeof ad === 'object' && ad ? ad.port : 0}`;
  });
  afterAll(() => servidor.close());
  const buscar: Buscar = (u, i) => fetch(u, i);

  it('o mais novo do Writer OS com os três arquivos (nem rascunho, nem incompleto, nem o Writer do computador)', async () => {
    const l = await ultimoLancamento(buscar, base);
    expect(l).toMatchObject({ tag: 'writer-os-v0.1.10', versao: '0.1.10', imagem: { nome: 'ekfrase-writer-os-0.1.10.img.xz' } });
  });

  it('o canal de teste vê a pré-release de teste mais nova; o público nunca (nem uma pré-release com número de estável)', async () => {
    expect((await ultimoLancamento(buscar, base, 'estavel'))?.tag).toBe('writer-os-v0.1.10');
    const t = await ultimoLancamento(buscar, base, 'teste');
    expect(t).toMatchObject({ tag: 'writer-os-v0.1.11-teste.1', versao: '0.1.11-teste.1', imagem: { nome: 'ekfrase-writer-os-0.1.11.img.xz' } });
  });

  it('a internet cai duas vezes no meio e o download continua de onde parou', async () => {
    const destino = join(pasta, 'baixado.bin');
    const progresso: number[] = [];
    await baixarArquivo(buscar, `${base}/arquivo`, destino, { tamanho: conteudo.length, aoBaixar: (f) => progresso.push(f) });
    expect(sha256(readFileSync(destino))).toBe(sha256(conteudo));
    expect(existsSync(`${destino}.parte`)).toBe(false);
    expect(Math.min(...progresso.filter((p, i) => i > 0 && p < progresso[i - 1]!))).toBe(Infinity); // nunca voltou para trás
  });

  it('"Já tenho a imagem": com lacre certo, sem lacre, com lacre errado, com o .sha256 diferente', async () => {
    const c = cenario('local', 'l');
    const ass = assinadorTeste();
    expect(await imagemDoArquivo(c.arquivoImagem, { chave: ass.chave })).toMatchObject({ lacre: 'ausente', minisig: null });
    writeFileSync(`${c.arquivoImagem}.minisig`, ass.assinar(c.imagem, 'Ekfrase Writer OS 9.9.9'));
    expect(await imagemDoArquivo(c.arquivoImagem, { chave: ass.chave })).toMatchObject({ lacre: 'ekfrase', comentario: 'Ekfrase Writer OS 9.9.9' });
    await expect(imagemDoArquivo(c.arquivoImagem)).rejects.toThrow('lacre-invalido');
    writeFileSync(`${c.arquivoImagem}.sha256`, `${'0'.repeat(64)}  local.img\n`);
    await expect(imagemDoArquivo(c.arquivoImagem, { chave: ass.chave })).rejects.toThrow('sha-diferente');
    const outro = join(pasta, 'nao-e.img');
    writeFileSync(outro, Buffer.alloc(2 * MIB));
    await expect(imagemDoArquivo(outro)).rejects.toThrow('nao-e-writer-os');
    expect(statSync(c.arquivoImagem).size).toBe(c.imagem.length);
  });
});

describe('este computador: preparar e remover o Writer OS (computador.ts, PLANO §8c)', () => {
  const json = (o: Record<string, unknown>) =>
    JSON.stringify({ numero: 0, serial: ' S123 ', nome: 'SAMSUNG MZ', tamanho: 256 * GB, setor: 512, estilo: 'GPT', livreMaior: 1048576, letra: 'C', tamanhoC: 237 * GB, livreC: 120 * GB, particoes: [{ tipo: '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}', tamanho: 100 * 1024 * 1024 }, { tipo: '{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}', tamanho: 237 * GB }], ...o });

  it('lê o disco do sistema e o C: do PowerShell (o estilo vem em texto ou número; o firmware do cmd)', () => {
    const i = lerInfo(json({}), 'UEFI\r\n');
    expect(i).toMatchObject({ disponivel: true, uefi: true, writer: false, windows: { letra: 'C', livre: 120 * GB } });
    expect(i.disco).toMatchObject({ numero: 0, gpt: true, livreMaior: 1048576 });
    expect(lerInfo(json({ estilo: 2 }), 'UEFI').disco?.gpt).toBe(true);
    expect(lerInfo(json({ estilo: 'MBR' }), 'Legacy')).toMatchObject({ uefi: false, disco: { gpt: false } });
    // a ESP de 1400 MiB e uma partição Linux: o Writer OS está instalado
    const comWriter = json({ particoes: [{ tipo: '{C12A7328-F81F-11D2-BA4B-00A0C93EC93B}', tamanho: 1400 * 1024 * 1024 }, { tipo: '{0fc63daf-8483-4772-8e79-3d69d8477de4}', tamanho: 16 * GB }] });
    expect(lerInfo(comWriter, 'UEFI').writer).toBe(true);
  });

  it('as recusas do preparar (PLANO §8c) e os tamanhos que cabem', () => {
    const i = lerInfo(json({}), 'UEFI');
    expect(recusaDoPreparar(i, 16)).toBeNull();
    expect(recusaDoPreparar({ ...i, uefi: false }, 16)).toBe('nao-uefi');
    expect(recusaDoPreparar({ ...i, disco: { ...i.disco!, gpt: false } }, 16)).toBe('nao-gpt');
    expect(recusaDoPreparar({ ...i, writer: true }, 16)).toBe('ja-instalado');
    expect(recusaDoPreparar({ ...i, disco: { ...i.disco!, livreMaior: 9 * GB } }, 16)).toBe('ja-tem-espaco');
    const apertado = { ...i, windows: { ...i.windows!, livre: 40 * GB } };
    expect(recusaDoPreparar(apertado, 16)).toBeNull();
    expect(recusaDoPreparar(apertado, 32)).toBe('pouco-livre');
    expect(tamanhosQueCabem(apertado)).toEqual([8, 16]);
    expect(recusaDoPreparar(SEM_COMPUTADOR, 8)).toBe('nao-windows');
    expect(TAMANHOS_GB).toEqual([8, 16, 32]);
  });

  it('os scripts começam pela guarda (o disco do sistema, o número de série, a letra) e recusam o que não é deles', () => {
    const s = scriptPreparar({ tipo: 'preparar', disco: 0, serial: "S'1", letra: 'C', bytes: 16 * GB });
    expect(s).toContain("-ne 'S''1'");
    expect(s).toContain('$c.DiskNumber -ne 0');
    expect(s).toContain('IsSystem');
    expect(s.indexOf('pouco-livre')).toBeLessThan(s.indexOf('Resize-Partition'));
    expect(s.indexOf('nao-encolhe')).toBeLessThan(s.indexOf('Resize-Partition'));
    expect(guardaDoSistema({ disco: 2, serial: 'x', letra: 'D' }, false)).not.toContain('IsSystem');
    expect(() => guardaDoSistema({ disco: 0, serial: 'x', letra: 'C:; rm' })).toThrow();
    expect(() => scriptPreparar({ tipo: 'preparar', disco: 0, serial: 'x', letra: 'C', bytes: 1024 })).toThrow();
  });

  it('acha no bcdedit só as entradas "Ekfrase Writer OS" (os rótulos vêm traduzidos)', () => {
    const saida = [
      'Gerenciador de Inicialização de Firmware',
      '----------------------------------------',
      'identificador           {fwbootmgr}',
      'displayorder            {bootmgr}',
      '                        {0b1c2d3e-0000-1111-2222-333344445555}',
      '',
      'Aplicativo de Firmware (101fffff)',
      '-------------------------------',
      'identificador           {0b1c2d3e-0000-1111-2222-333344445555}',
      'descrição               Ekfrase Writer OS',
      '',
      'Aplicativo de Firmware (101fffff)',
      '-------------------------------',
      'identificador           {9999aaaa-0000-1111-2222-333344445555}',
      'descrição               Windows Boot Manager',
      '',
      'Firmware Application (101fffff)',
      'identifier              {ABCDEF01-0000-1111-2222-333344445555}',
      'description             Ekfrase Writer OS',
    ].join('\r\n');
    expect(entradasDoWriter(saida)).toEqual(['{0b1c2d3e-0000-1111-2222-333344445555}', '{abcdef01-0000-1111-2222-333344445555}']);
    expect(entradasDoWriter('')).toEqual([]);
  });

  it('o simulado: preparar devolve o espaço pedido; remover conta as etapas e copia para onde foi pedido', async () => {
    expect(await executarComputador({ tipo: 'preparar', disco: 0, serial: 'S', letra: 'C', bytes: 16 * GB }, { simulado: true })).toEqual({ livre: 16 * GB });
    const etapas: string[] = [];
    expect(await executarComputador({ tipo: 'remover', disco: 0, serial: 'S', letra: 'C', copiarPara: 'X:\\copia' }, { simulado: true, avisar: (e) => etapas.push(e) })).toEqual({ copiado: 'X:\\copia', espaco: 'devolvido' });
    expect(etapas).toEqual(['copiar', 'entrada', 'remover', 'devolver']);
    expect(computadorSimulado('writer').writer).toBe(true);
    expect(computadorSimulado(undefined).disponivel).toBe(false);
  });
});
