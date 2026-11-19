// SPDX-License-Identifier: MPL-2.0
/**
 * O "PREPARAR" E O "REMOVER" DO GRAVADOR NUM DISCO DE VERDADE (PLANO §8c; só no Windows, como administrador: o CI do
 * público, job do Gravador no windows-latest). Um VHD de 48 GB faz o papel do disco do computador: GPT, uma ESP e um
 * "C:" NTFS com um arquivo conhecido. Pelo MESMO código do Gravador (`executarComputador`, sem exigir que seja o disco
 * do sistema):
 *
 *   1. preparar 16 GB: o "C:" diminui (`Resize-Partition`) e sobram ≥ 16 GB livres; o arquivo conhecido continua igual;
 *   2. "instalar" como o Writer OS faria: EKFRASE-BOOT (ESP, 1400 MiB) e EKFRASE-DADOS (Linux, exFAT com a pasta
 *      "Ekfrase Writer"), com os nomes GPT escritos aqui (o Windows não escreve nome de partição);
 *   3. remover com a cópia: os textos vão para a pasta pedida, as duas partições saem e o "C:" volta ao tamanho de antes.
 *
 *     node tests/gravador/computador-vhd.ts
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executarComputador, GB, type Removido } from '../../sistema/writer-os/gravador/src/nucleo/computador.ts';
import { lerGpt, montarGpt, NOME_BOOT, NOME_DADOS, TIPO } from '../../sistema/writer-os/gravador/src/nucleo/gpt.ts';

if (process.platform !== 'win32') {
  console.log('computador-vhd: só no Windows (pulado).');
  process.exit(0);
}

const falhas: string[] = [];
const ok = (c: unknown, msg: string) => {
  console.log(`${c ? 'ok  ' : 'XX  '}${msg}`);
  if (!c) falhas.push(msg);
};
const ps = (script: string): string => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `$ErrorActionPreference = 'Stop'\n${script}`], { encoding: 'utf8' }).trim();
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const trab = mkdtempSync(join(tmpdir(), 'ekfrase-pc-vhd-'));
const vhd = join(trab, 'computador.vhdx');
const dp = (linhas: string[]) => {
  const s = join(trab, 'dp.txt');
  writeFileSync(s, linhas.join('\r\n'));
  return execFileSync('diskpart', ['/s', s], { encoding: 'utf8' });
};

dp([`create vdisk file="${vhd}" maximum=49152 type=expandable`, `select vdisk file="${vhd}"`, 'attach vdisk']);
try {
  const n = Number(ps(`(Get-DiskImage -ImagePath '${vhd}' | Get-Disk).Number`));
  console.log(`-- o VHD é o disco ${n}`);
  // o "computador": GPT, a ESP do "Windows" e o C: (NTFS, o resto do disco)
  const letra = ps(
    [
      `Initialize-Disk -Number ${n} -PartitionStyle GPT`,
      `New-Partition -DiskNumber ${n} -Size 100MB -GptType '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}' | Out-Null`,
      `$p = New-Partition -DiskNumber ${n} -UseMaximumSize -AssignDriveLetter`,
      `Format-Volume -Partition $p -FileSystem NTFS -NewFileSystemLabel 'Windows' -Confirm:$false | Out-Null`,
      `[string](Get-Partition -DiskNumber ${n} -PartitionNumber $p.PartitionNumber).DriveLetter`,
    ].join('\n'),
  ).slice(-1);
  const conhecido = randomBytes(4 * 1024 * 1024);
  writeFileSync(`${letra}:\\conhecido.bin`, conhecido);
  const serial = ps(`([string](Get-Disk -Number ${n}).SerialNumber).Trim()`);
  const tamanhoAntes = Number(ps(`(Get-Partition -DriveLetter ${letra}).Size`));
  console.log(`-- o "C:" do teste é ${letra}: (${(tamanhoAntes / GB).toFixed(1)} GiB)`);

  // ---------- 1. preparar 16 GB ----------
  const r1 = (await executarComputador({ tipo: 'preparar', disco: n, serial, letra, bytes: 16 * GB }, { exigirSistema: false })) as { livre: number };
  ok(r1.livre >= 16 * GB - 2 * 1024 * 1024, `preparar: sobraram ${(r1.livre / GB).toFixed(2)} GiB livres (≥ 16)`);
  ok(Number(ps(`(Get-Partition -DriveLetter ${letra}).Size`)) <= tamanhoAntes - 16 * GB + 1024 * 1024, 'preparar: o "C:" diminuiu');
  ok(sha(readFileSync(`${letra}:\\conhecido.bin`)) === sha(conhecido), 'preparar: o arquivo conhecido do "C:" continua igual');
  // pedir de novo mais do que cabe nos 20 GB livres do Windows: recusa, sem mudar nada
  const antes2 = Number(ps(`(Get-Partition -DriveLetter ${letra}).Size`));
  const recusa = await executarComputador({ tipo: 'preparar', disco: n, serial, letra, bytes: 32 * GB }, { exigirSistema: false }).then(
    () => 'nenhuma',
    (e: { codigo?: string }) => e.codigo ?? 'outra',
  );
  ok(recusa === 'pouco-livre', `preparar 32 GB num "C:" de ${(antes2 / GB).toFixed(0)} GiB: recusa (pouco-livre; veio ${recusa})`);
  ok(Number(ps(`(Get-Partition -DriveLetter ${letra}).Size`)) === antes2, 'a recusa não mudou o "C:"');
  // a guarda: outro número de série = outro disco
  const outro = await executarComputador({ tipo: 'preparar', disco: n, serial: 'OUTRO', letra, bytes: 8 * GB }, { exigirSistema: false }).then(
    () => 'nenhuma',
    (e: { codigo?: string }) => e.codigo ?? 'outra',
  );
  ok(outro === 'disco-mudou', `a guarda recusa um disco com outro número de série (${outro})`);

  // ---------- 2. "instalar" como o Writer OS ----------
  const textos = ps(
    [
      `$b = New-Partition -DiskNumber ${n} -Size 1400MB -GptType '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}'`,
      `$d = New-Partition -DiskNumber ${n} -UseMaximumSize -AssignDriveLetter`,
      `Format-Volume -Partition $d -FileSystem exFAT -NewFileSystemLabel 'EKFR-DADOS' -Confirm:$false | Out-Null`,
      `$l = [string](Get-Partition -DiskNumber ${n} -PartitionNumber $d.PartitionNumber).DriveLetter`,
      `New-Item -ItemType Directory -Path "$($l):\\Ekfrase Writer\\dados" | Out-Null`,
      `Set-Content -Path "$($l):\\Ekfrase Writer\\dados\\texto.txt" -Value 'Escrito no Writer OS.' -NoNewline`,
      `Remove-PartitionAccessPath -DiskNumber ${n} -PartitionNumber $d.PartitionNumber -AccessPath "$($l):\\"`,
      `Set-Partition -DiskNumber ${n} -PartitionNumber $d.PartitionNumber -GptType '{0fc63daf-8483-4772-8e79-3d69d8477de4}'`,
      `"$($b.PartitionNumber) $($d.PartitionNumber)"`,
    ].join('\n'),
  );
  const [nBoot, nDados] = textos.split(/\s+/).slice(-2).map(Number);
  // os nomes GPT (o Windows não escreve): a mesma GPT, só com os dois nomes
  const setor = Number(ps(`(Get-Disk -Number ${n}).LogicalSectorSize`));
  const tamanhoDisco = Number(ps(`(Get-Disk -Number ${n}).Size`));
  const fh = await open(`\\\\.\\PhysicalDrive${n}`, 'r+');
  try {
    const ler = async (pos: number, t: number) => {
      const b = Buffer.alloc(t);
      await fh.read(b, 0, t, pos);
      return b;
    };
    const g = await lerGpt(ler, setor);
    const nova = montarGpt({
      tamanho: tamanhoDisco,
      setor,
      discoGuid: g.discoGuid,
      particoes: g.particoes.map((p) => ({ tipo: p.tipo, inicio: p.inicio, fim: p.fim, unico: p.unico, atributos: p.atributos, nome: p.numero === nBoot ? NOME_BOOT : p.numero === nDados ? NOME_DADOS : p.nome })),
    });
    await fh.write(nova.inicio, 0, nova.inicio.length, 0);
    await fh.write(nova.fim.dados, 0, nova.fim.dados.length, nova.fim.posicao);
    await fh.sync();
    const conferida = await lerGpt(ler, setor);
    ok(conferida.particoes.some((p) => p.nome === NOME_BOOT && p.tipo === TIPO.esp) && conferida.particoes.some((p) => p.nome === NOME_DADOS && p.tipo === TIPO.linux), 'instalar (simulado): as partições EKFRASE-BOOT e EKFRASE-DADOS estão na GPT');
  } finally {
    await fh.close();
  }
  ps(`Update-Disk -Number ${n}`);

  // ---------- 3. remover, com a cópia dos textos ----------
  const destino = join(trab, 'Documentos', 'Ekfrase Writer (Writer OS, teste)');
  const r3 = (await executarComputador({ tipo: 'remover', disco: n, serial, letra, copiarPara: destino }, { exigirSistema: false })) as Removido;
  ok(r3.copiado === destino && existsSync(join(destino, 'dados', 'texto.txt')) && readFileSync(join(destino, 'dados', 'texto.txt'), 'utf8') === 'Escrito no Writer OS.', 'remover: os textos foram copiados antes');
  const partes = ps(`@(Get-Partition -DiskNumber ${n}).Count`);
  ok(Number(partes) <= 3, `remover: as duas partições do Writer OS saíram (sobraram ${partes}: a reservada, a ESP e o "C:")`);
  ok(r3.espaco === 'devolvido', `remover: o espaço voltou ao "C:" (${r3.espaco})`);
  const tamanhoDepois = Number(ps(`(Get-Partition -DriveLetter ${letra}).Size`));
  ok(tamanhoDepois >= tamanhoAntes - 2 * 1024 * 1024, `remover: o "C:" voltou ao tamanho de antes (${(tamanhoDepois / GB).toFixed(2)} de ${(tamanhoAntes / GB).toFixed(2)} GiB)`);
  ok(sha(readFileSync(`${letra}:\\conhecido.bin`)) === sha(conhecido), 'remover: o arquivo conhecido do "C:" continua igual');
} catch (e) {
  falhas.push(String((e as Error)?.stack ?? e));
  console.error(e);
} finally {
  try {
    dp([`select vdisk file="${vhd}"`, 'detach vdisk']);
  } catch {
    // o runner some de qualquer jeito
  }
  try {
    // o Windows pode segurar o arquivo do VHD um pouco depois do detach: a pasta temporária fica para o runner
    rmSync(trab, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
  } catch {
    console.log(`(a pasta ${trab} ficou: o Windows ainda segura o VHD)`);
  }
}
console.log(falhas.length ? `\n${falhas.length} falha(s) no preparar/remover do Gravador.` : '\nGravador, preparar e remover num VHD: tudo certo.');
process.exit(falhas.length ? 1 : 0);
