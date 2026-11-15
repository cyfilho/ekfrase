// SPDX-License-Identifier: MPL-2.0
/**
 * O GRAVADOR CONTRA UM DISCO VIRTUAL DE VERDADE E A IMAGEM DE VERDADE (PLANO §8b, "Testes"). Roda no CI
 * do Writer OS, como root (Linux) ou administrador (Windows), com o Node 24 direto:
 *
 *   sudo node tests/gravador/disco-virtual.ts --imagem <.img ou .img.xz> [--setor 4096] [--saida disco.img]
 *   node tests/gravador/disco-virtual.ts --windows --imagem <.img.xz>
 *
 * Linux: um arquivo de 8 GB vira disco por `losetup` (com o setor pedido). Windows: um VHD de 8 GB
 * (diskpart). O Gravador grava pelo MESMO caminho do programa (gravar.ts + ambientes.ts); a única
 * diferença é a lista de discos, que aqui diz que o disco virtual é "USB" (ele é um loop ou um VHD).
 * Confere: a partição 1 idêntica à da imagem (512) ou os mesmos arquivos, com fsck limpo (4096); a
 * EKFRASE-DADOS em exFAT, montada, com um arquivo de teste; o Atualizar devolve a partição 1 (que foi
 * estragada de propósito, no Linux) e o arquivo de teste continua lá. Com `--saida`, o disco fica para o
 * QEMU ligar (tests/writer-os/qemu.py --disco-4k).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, truncateSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ambienteLinux, ambienteWindows, particaoLinux } from '../../sistema/writer-os/gravador/src/nucleo/ambientes.ts';
import { listarDiscos, type Disco } from '../../sistema/writer-os/gravador/src/nucleo/discos.ts';
import { lerGpt, NOME_BOOT, NOME_DADOS } from '../../sistema/writer-os/gravador/src/nucleo/gpt.ts';
import { executar, type Ambiente } from '../../sistema/writer-os/gravador/src/nucleo/gravar.ts';
import { Fluxo, lerCabecaImagem, MIB } from '../../sistema/writer-os/gravador/src/nucleo/imagem.ts';
import { imagemDoArquivo } from '../../sistema/writer-os/gravador/src/nucleo/origem.ts';
import { sha256DoArquivo } from '../../sistema/writer-os/gravador/src/nucleo/minisign.ts';

const args = process.argv.slice(2);
const arg = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const imagem = arg('--imagem');
if (!imagem) throw new Error('falta --imagem');
const setor = Number(arg('--setor') ?? 512);
const saida = arg('--saida');
const windows = args.includes('--windows');
const falhas: string[] = [];
const ok = (c: unknown, m: string) => {
  console.log(`${c ? 'ok  ' : 'XX  '}${m}`);
  if (!c) falhas.push(m);
};
const sh = (cmd: string, a: string[]) => execFileSync(cmd, a, { encoding: 'utf8' }).trim();
const trab = mkdtempSync(join(tmpdir(), 'gravador-disco-'));

/** O SHA-256 da partição 1 da imagem (descomprimida) e quanto ela tem. */
async function boot512(): Promise<{ sha: string; tamanho: number }> {
  const f = new Fluxo(imagem!);
  try {
    const c = await lerCabecaImagem(f);
    const h = createHash('sha256');
    for await (const p of f.passar(c.tamanho)) h.update(p);
    return { sha: h.digest('hex'), tamanho: c.tamanho };
  } finally {
    // o xz em WebAssembly só descomprime um arquivo por vez: largar esta leitura aberta travava o `executar`
    // (o passo com a imagem .img.xz de entrega ficava num await que nunca voltava; 14/11/2026)
    await f.fechar();
  }
}

function shaDoDisco(caminho: string, pos: number, n: number): string {
  const fd = openSync(caminho, 'r');
  const h = createHash('sha256');
  const b = Buffer.alloc(4 * MIB);
  try {
    for (let o = 0; o < n; o += b.length) {
      const k = Math.min(b.length, n - o);
      readSync(fd, b, 0, k, pos + o);
      h.update(b.subarray(0, k));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

const lerDe = (caminho: string) => async (pos: number, n: number) => {
  const fd = openSync(caminho, 'r');
  try {
    const b = Buffer.alloc(n);
    readSync(fd, b, 0, n, pos);
    return b;
  } finally {
    closeSync(fd);
  }
};

const tarefa = async (d: Disco, modo: 'criar' | 'atualizar') => ({ modo, disco: d, imagem: { arquivo: imagem!, sha256: await sha256DoArquivo(imagem!) }, limiteDados: null });
const avisar = (() => {
  let ultima = '';
  return (a: { fase: string }) => {
    if (a.fase !== ultima) console.log(`   … ${a.fase}`);
    ultima = a.fase;
  };
})();

// o lacre do CI confere com o verificador do Gravador (o .minisig ao lado da imagem, se houver)
if (existsSync(`${imagem}.minisig`)) {
  const r = await imagemDoArquivo(imagem).catch((e: Error) => e);
  ok(!(r instanceof Error) && r.lacre === 'ekfrase', `o lacre que o CI fez confere no Gravador (${r instanceof Error ? r.message : r.comentario})`);
}
const esperado = await boot512();

if (!windows) {
  // ---------------------------------------------------------------- Linux (loop)
  const arquivo = saida ?? join(trab, 'disco.img');
  writeFileSync(arquivo, '');
  truncateSync(arquivo, 8 * 1024 * MIB);
  const loop = sh('losetup', ['-f', '--show', '-P', '--sector-size', String(setor), arquivo]);
  const montar = (dev: string, ponto: string, opcoes: string[] = []) => {
    mkdirSync(ponto, { recursive: true });
    sh('mount', [...opcoes, dev, ponto]);
  };
  try {
    const disco = (): Disco => ({ id: loop, caminho: loop, nome: 'Disco virtual', tamanho: Number(sh('blockdev', ['--getsize64', loop])), setor: Number(sh('blockdev', ['--getss', loop])), barramento: 'usb', tipo: 'pendrive', serial: null, somenteLeitura: false, particoes: [], recusa: null, writerOS: false });
    ok(disco().setor === setor, `o loop tem setor de ${setor}`);
    const reais = await listarDiscos({ caminhosProtegidos: [process.cwd()] }, 'linux');
    ok(!reais.some((d) => d.caminho === loop) && !reais.some((d) => d.barramento !== 'usb'), 'a lista de verdade (lsblk) não mostra o loop nem disco que não é USB');
    const amb: Ambiente = ambienteLinux({ caminhosProtegidos: [] }, async () => [disco()]);

    const r = await executar(await tarefa(disco(), 'criar'), amb, avisar);
    ok(r.plano.dados?.sistema === 'exfat', 'Criar: gravou, conferiu e planejou a EKFRASE-DADOS em exFAT');
    const g = await lerGpt(lerDe(loop), setor);
    ok(g.particoes.map((p) => p.nome).join() === `${NOME_BOOT},${NOME_DADOS}`, 'a GPT do disco tem as duas partições');
    ok(g.reserva === disco().tamanho / setor - 1, 'a GPT reserva está no fim do disco');
    const p1 = particaoLinux(loop, 1);
    const p2 = particaoLinux(loop, 2);
    if (setor === 512) {
      ok(shaDoDisco(loop, MIB, esperado.tamanho) === esperado.sha, 'a partição 1 é IDÊNTICA à da imagem');
    } else {
      // os mesmos arquivos da imagem, num FAT32 de setor 4096 que o Linux monta e o fsck aprova
      const img = imagem.endsWith('.xz') ? null : imagem;
      sh('fsck.vfat', ['-n', p1]);
      ok(true, 'fsck.vfat -n na partição 1 de 4096: limpo');
      montar(p1, join(trab, 'a'), ['-o', 'ro']);
      if (img) {
        const loopImg = sh('losetup', ['-f', '--show', '-P', '-r', img]);
        try {
          montar(particaoLinux(loopImg, 1), join(trab, 'b'), ['-o', 'ro']);
          const d = execFileSync('diff', ['-r', join(trab, 'a'), join(trab, 'b')], { encoding: 'utf8' });
          ok(d === '', 'os arquivos da partição 1 são os mesmos da imagem (diff -r)');
          sh('umount', [join(trab, 'b')]);
        } finally {
          sh('losetup', ['-d', loopImg]);
        }
      }
      ok(existsSync(join(trab, 'a', 'live', 'filesystem.squashfs')) && existsSync(join(trab, 'a', 'EFI', 'BOOT', 'BOOTX64.EFI')), 'o sistema e o shim estão lá');
      sh('umount', [join(trab, 'a')]);
    }
    const blkid = sh('blkid', ['-o', 'export', p2]);
    ok(/TYPE=exfat/.test(blkid) && /LABEL=EKFR-DADOS/.test(blkid), `a EKFRASE-DADOS é exFAT com o rótulo certo (${blkid.replace(/\n/g, ' ')})`);
    montar(p2, join(trab, 'dados'));
    writeFileSync(join(trab, 'dados', 'teste.txt'), 'os textos ficam');
    sh('umount', [join(trab, 'dados')]);

    // estraga um pedaço da partição 1 (como um sistema velho) e atualiza
    const fd = openSync(loop, 'r+');
    writeSync(fd, Buffer.alloc(4 * MIB, 0xee), 0, 4 * MIB, 200 * MIB);
    closeSync(fd);
    sh('blockdev', ['--flushbufs', loop]);
    await executar(await tarefa({ ...disco(), writerOS: true }, 'atualizar'), amb, avisar);
    if (setor === 512) ok(shaDoDisco(loop, MIB, esperado.tamanho) === esperado.sha, 'Atualizar: a partição 1 voltou a ser idêntica à da imagem');
    else {
      sh('fsck.vfat', ['-n', p1]);
      ok(true, 'Atualizar: o fsck da partição 1 continua limpo');
    }
    montar(p2, join(trab, 'dados'));
    ok(readFileSync(join(trab, 'dados', 'teste.txt'), 'utf8') === 'os textos ficam', 'Atualizar: o arquivo de teste da EKFRASE-DADOS continua lá');
    sh('umount', [join(trab, 'dados')]);
  } finally {
    try {
      sh('losetup', ['-d', loop]);
    } catch {
      // já saiu
    }
  }
} else {
  // ---------------------------------------------------------------- Windows (VHD)
  const vhd = join(trab, 'disco.vhdx');
  const dp = (linhas: string[]) => {
    const s = join(trab, 'dp.txt');
    writeFileSync(s, linhas.join('\r\n'));
    return execFileSync('diskpart', ['/s', s], { encoding: 'utf8' });
  };
  dp([`create vdisk file="${vhd}" maximum=8192 type=expandable`, `select vdisk file="${vhd}"`, 'attach vdisk']);
  try {
    const ps = (c: string) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', c], { encoding: 'utf8' }).trim();
    const numero = Number(ps(`(Get-DiskImage -ImagePath '${vhd}' | Get-Disk).Number`));
    ok(Number.isInteger(numero) && numero > 0, `o VHD é o disco ${numero}`);
    const disco = (): Disco => {
      const j = JSON.parse(ps(`Get-Disk -Number ${numero} | Select-Object FriendlyName,SerialNumber,Size,LogicalSectorSize | ConvertTo-Json -Compress`)) as { FriendlyName: string; SerialNumber: string | null; Size: number; LogicalSectorSize: number };
      return { id: `win:${numero}`, caminho: `\\\\.\\PhysicalDrive${numero}`, nome: j.FriendlyName, tamanho: j.Size, setor: j.LogicalSectorSize, barramento: 'usb', tipo: 'pendrive', serial: (j.SerialNumber ?? '').trim() || null, somenteLeitura: false, particoes: [], recusa: null, writerOS: false };
    };
    const reais = await listarDiscos({ caminhosProtegidos: [process.cwd()] }, 'win32');
    ok(!reais.some((d) => d.id === `win:${numero}`) && !reais.some((d) => d.barramento !== 'usb'), 'a lista de verdade (PowerShell) não mostra o VHD nem o disco do sistema');
    const amb = ambienteWindows({ caminhosProtegidos: [] }, async () => [disco()], { barramentos: ['USB', '7', 'File Backed Virtual', '15'] });
    const r = await executar(await tarefa(disco(), 'criar'), amb, avisar);
    ok(r.plano.dados?.sistema === 'exfat', 'Criar (Windows): gravou, conferiu e formatou a EKFRASE-DADOS');
    ok(shaDoDisco(disco().caminho, MIB, esperado.tamanho) === esperado.sha, 'a partição 1 é IDÊNTICA à da imagem');
    const vol = JSON.parse(ps(`Get-Partition -DiskNumber ${numero} -PartitionNumber 2 | Get-Volume | Select-Object FileSystem,FileSystemLabel,DriveLetter | ConvertTo-Json -Compress`)) as { FileSystem: string; FileSystemLabel: string; DriveLetter: string | null };
    ok(vol.FileSystem === 'exFAT' && vol.FileSystemLabel === 'EKFR-DADOS', `a EKFRASE-DADOS é exFAT (${vol.FileSystem}, ${vol.FileSystemLabel})`);
    let letra = vol.DriveLetter;
    if (!letra) {
      ps(`Get-Partition -DiskNumber ${numero} -PartitionNumber 2 | Add-PartitionAccessPath -AssignDriveLetter`);
      letra = ps(`(Get-Partition -DiskNumber ${numero} -PartitionNumber 2).DriveLetter`);
    }
    writeFileSync(`${letra}:\\teste.txt`, 'os textos ficam');
    ps(`Write-VolumeCache -DriveLetter ${letra}`);
    await executar(await tarefa({ ...disco(), writerOS: true }, 'atualizar'), amb, avisar);
    ok(shaDoDisco(disco().caminho, MIB, esperado.tamanho) === esperado.sha, 'Atualizar (Windows): a partição 1 é a da imagem');
    const l2 = ps(`(Get-Partition -DiskNumber ${numero} -PartitionNumber 2).DriveLetter`);
    ok(!!l2 && readFileSync(`${l2}:\\teste.txt`, 'utf8') === 'os textos ficam', 'Atualizar (Windows): o arquivo de teste da EKFRASE-DADOS continua lá');
  } finally {
    // o Atualizar tira o disco do ar e o Windows pode já ter solto o VHD ("The virtual disk is already detached"):
    // a limpeza não pode derrubar um teste que passou (nem esconder o erro de um que falhou)
    try {
      dp([`select vdisk file="${vhd}"`, 'detach vdisk']);
    } catch {
      /* já solto */
    }
  }
}

if (!saida) {
  try {
    rmSync(trab, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    /* no Windows o VHD ainda pode segurar a pasta (EPERM); é só lixo da pasta temporária */
  }
}
console.log(falhas.length ? `\n${falhas.length} falha(s).` : `\nGravador no disco virtual (${windows ? 'Windows, VHD' : `Linux, setor ${setor}`}): tudo certo.`);
process.exit(falhas.length ? 1 : 0);
