// SPDX-License-Identifier: MPL-2.0

/**
 * O QUE MUDA DE UM SISTEMA PARA OUTRO na gravação (a interface `Ambiente` de gravar.ts). Roda com
 * permissão de administrador. Todo comando destrutivo do Windows confere ANTES, no mesmo script, que o
 * disco N ainda é o USB com aquele tamanho e aquele número de série (os números de disco do Windows
 * mudam quando se liga ou tira outro disco).
 *
 * - Windows: Criar = `Clear-Disk` (sem partições, nada montado: o Windows deixa escrever no disco
 *   inteiro) e, no fim, `Update-Disk` + `Format-Volume` exFAT. Atualizar = o disco fora do ar
 *   (`Set-Disk -IsOffline`) durante a gravação da partição 1, e de volta no ar no fim.
 * - Linux: desmonta tudo o que é do disco, abre com O_EXCL (o kernel recusa se ainda houver algo em
 *   uso), `blockdev --flushbufs` antes de ler de volta, `blockdev --rereadpt`, `mkfs.exfat`/`mkfs.ext4`.
 * - Simulado (só para os testes e o desenvolvimento): o "disco" é um arquivo.
 */
import { execFile } from 'node:child_process';
import { constants, existsSync, readFileSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { promisify } from 'node:util';
import { listarDiscos, type Contexto, type Disco } from './discos.ts';
import { ErroGravar, type Ambiente, type Dispositivo } from './gravar.ts';
import type { Modo, SistemaDados } from './plano.ts';

const rodar = promisify(execFile);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Um arquivo (ou disco) aberto, com leitura e escrita inteiras (o Node pode ler/escrever menos que o pedido). */
export function dispositivo(fh: FileHandle, setor: number): Dispositivo {
  const alinhado = (p: number, n: number) => {
    if (p % setor || n % setor) throw new ErroGravar('escrita', `desalinhado: ${p}+${n}`);
  };
  return {
    async ler(posicao, tamanho) {
      alinhado(posicao, tamanho);
      const b = Buffer.alloc(tamanho);
      let feito = 0;
      while (feito < tamanho) {
        const { bytesRead } = await fh.read(b, feito, tamanho - feito, posicao + feito);
        if (!bytesRead) throw new ErroGravar('verificacao', `fim do disco em ${posicao + feito}`);
        feito += bytesRead;
      }
      return b;
    },
    async escrever(posicao, dados) {
      alinhado(posicao, dados.length);
      let feito = 0;
      while (feito < dados.length) {
        const { bytesWritten } = await fh.write(dados, feito, dados.length - feito, posicao + feito);
        if (!bytesWritten) throw new ErroGravar('escrita', `nada escrito em ${posicao + feito}`);
        feito += bytesWritten;
      }
    },
    sincronizar: () => fh.sync(),
    fechar: () => fh.close(),
  };
}

// ---------------------------------------------------------------- Windows

const ps = (script: string) => rodar('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 180_000, maxBuffer: 8 << 20 });
const aspas = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** O começo de todo script destrutivo: o disco N ainda é ESTE disco USB. */
function guarda(d: Disco, barramentos: readonly string[]): string {
  const n = Number(d.id.slice(4));
  if (!Number.isInteger(n) || n < 0 || d.caminho !== `\\\\.\\PhysicalDrive${n}`) throw new ErroGravar('disco-mudou');
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$d = Get-Disk -Number ${n}`,
    `if ([string]$d.BusType -notin @(${barramentos.map(aspas).join(', ')})) { throw 'ekfrase:disco-mudou' }`,
    `if ([int64]$d.Size -ne ${d.tamanho}) { throw 'ekfrase:disco-mudou' }`,
    `if (([string]$d.SerialNumber).Trim() -ne ${aspas(d.serial ?? '')}) { throw 'ekfrase:disco-mudou' }`,
    `if ($d.IsSystem -or $d.IsBoot) { throw 'ekfrase:disco-mudou' }`,
  ].join('\n');
}

async function psGuardado(d: Disco, corpo: string, barramentos: readonly string[]): Promise<string> {
  try {
    const { stdout } = await ps(`${guarda(d, barramentos)}\n${corpo}`);
    return stdout;
  } catch (e) {
    const t = `${(e as { stderr?: string }).stderr ?? ''} ${(e as Error).message}`;
    if (t.includes('ekfrase:disco-mudou')) throw new ErroGravar('disco-mudou');
    throw new ErroGravar('em-uso', t.slice(0, 400));
  }
}

/**
 * opcoes.barramentos: SÓ para o teste do CI (um VHD é "File Backed Virtual"); o Gravador usa o padrão, USB.
 */
export function ambienteWindows(ctx: Contexto, inventario?: () => Promise<Disco[]>, opcoes: { barramentos?: readonly string[] } = {}): Ambiente {
  const n = (d: Disco) => Number(d.id.slice(4));
  const barramentos = opcoes.barramentos ?? ['USB', '7'];
  const psGuardadoAqui = (d: Disco, corpo: string) => psGuardado(d, corpo, barramentos);
  return {
    inventario: inventario ?? (() => listarDiscos(ctx, 'win32')),
    async preparar(d, modo) {
      if (modo === 'criar') {
        await psGuardadoAqui(d, `if ($d.IsReadOnly) { Set-Disk -Number ${n(d)} -IsReadOnly $false }\nif ($d.IsOffline) { Set-Disk -Number ${n(d)} -IsOffline $false }\nif ([string]$d.PartitionStyle -notin @('RAW', '0')) { Clear-Disk -Number ${n(d)} -RemoveData -RemoveOEM -Confirm:$false }`);
      } else {
        await psGuardadoAqui(d, `if ($d.IsReadOnly) { Set-Disk -Number ${n(d)} -IsReadOnly $false }\nSet-Disk -Number ${n(d)} -IsOffline $true`);
      }
    },
    async abrir(d, uso) {
      return dispositivo(await open(d.caminho, uso === 'gravar' ? 'r+' : 'r'), d.setor);
    },
    async esvaziarCache() {
      // o Windows não guarda em cache o que se lê do disco físico (\\.\PhysicalDriveN)
    },
    async releer(d, modo: Modo) {
      await psGuardadoAqui(d, `${modo === 'atualizar' ? `Set-Disk -Number ${n(d)} -IsOffline $false\n` : ''}Update-Disk -Number ${n(d)}`);
    },
    async formatos() {
      return new Set<SistemaDados>(['exfat']);
    },
    async formatar(d, numero, sistema) {
      if (sistema !== 'exfat') throw new ErroGravar('formatar', 'o Windows só formata exFAT');
      await psGuardadoAqui(
        d,
        [
          `$p = $null`,
          `for ($i = 0; $i -lt 20 -and -not $p; $i++) { Update-Disk -Number ${n(d)}; $p = Get-Partition -DiskNumber ${n(d)} -PartitionNumber ${numero} -ErrorAction SilentlyContinue; if (-not $p) { Start-Sleep -Milliseconds 500 } }`,
          `if (-not $p) { throw 'sem a partição ${numero}' }`,
          `Format-Volume -Partition $p -FileSystem exFAT -NewFileSystemLabel 'EKFR-DADOS' -Confirm:$false -Force | Out-Null`,
        ].join('\n'),
      );
    },
  };
}

// ---------------------------------------------------------------- Linux

/** `/dev/sdb` → `/dev/sdb2`; `/dev/nvme0n1`, `/dev/loop3`, `/dev/mmcblk0` → `…p2`. */
export const particaoLinux = (disco: string, n: number): string => (/\d$/.test(disco) ? `${disco}p${n}` : `${disco}${n}`);

async function tem(programa: string, arg = '-V'): Promise<boolean> {
  try {
    await rodar(programa, [arg], { timeout: 10_000 });
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ENOENT' && typeof (e as { code?: unknown }).code === 'number';
  }
}

export function ambienteLinux(ctx: Contexto, inventario?: () => Promise<Disco[]>): Ambiente {
  return {
    inventario: inventario ?? (() => listarDiscos(ctx, 'linux')),
    async preparar(d) {
      // tudo o que é do disco sai do ar (inclusive a EKFRASE-DADOS no Atualizar: o O_EXCL pede o disco livre)
      const { stdout } = await rodar('lsblk', ['-J', '-o', 'PATH,MOUNTPOINT', d.caminho]);
      const nos: { path?: string; mountpoint?: string | null; children?: unknown[] }[] = [];
      const juntar = (l: unknown[] | undefined) =>
        (l ?? []).forEach((x) => {
          const n = x as { path?: string; mountpoint?: string | null; children?: unknown[] };
          nos.push(n);
          juntar(n.children);
        });
      juntar((JSON.parse(stdout) as { blockdevices?: unknown[] }).blockdevices);
      for (const no of nos.reverse()) {
        if (!no.mountpoint) continue;
        try {
          await rodar('umount', [no.path ?? no.mountpoint], { timeout: 60_000 });
        } catch (e) {
          throw new ErroGravar('em-uso', `${no.mountpoint}: ${(e as { stderr?: string }).stderr ?? ''}`.trim());
        }
      }
    },
    async abrir(d, uso) {
      const flags = uso === 'gravar' ? constants.O_RDWR | constants.O_EXCL : constants.O_RDONLY;
      return dispositivo(await open(d.caminho, flags), d.setor);
    },
    async esvaziarCache(d) {
      await rodar('blockdev', ['--flushbufs', d.caminho]);
    },
    async releer(d) {
      await rodar('blockdev', ['--rereadpt', d.caminho]).catch(() => rodar('partx', ['-u', d.caminho]).catch(() => undefined));
      await rodar('udevadm', ['settle', '--timeout=20']).catch(() => undefined);
    },
    async formatos() {
      const f = new Set<SistemaDados>();
      if (await tem('mkfs.exfat')) f.add('exfat');
      if (await tem('mkfs.ext4')) f.add('ext4');
      return f;
    },
    async formatar(d, numero, sistema) {
      const p = particaoLinux(d.caminho, numero);
      for (let i = 0; i < 40 && !existsSync(p); i++) await esperar(250);
      if (!existsSync(p)) throw new ErroGravar('formatar', `${p} não apareceu`);
      await rodar('wipefs', ['-a', '-q', p]).catch(() => undefined);
      if (sistema === 'ext4') await rodar('mkfs.ext4', ['-q', '-F', '-L', 'EKFR-DADOS', '-E', 'root_owner=1000:1000', p], { timeout: 600_000 });
      else await rodar('mkfs.exfat', ['-L', 'EKFR-DADOS', p], { timeout: 600_000 });
      await rodar('udevadm', ['settle', '--timeout=20']).catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------- simulado

/** A marca que o "formatar" simulado deixa no começo da partição de dados. */
export const MARCA_SIMULADA = 'EKFRASE-DADOS-SIMULADA';

/**
 * Só para os testes e o desenvolvimento (a janela só usa fora do pacote): os discos vêm de um JSON
 * (`Disco[]`, com `caminho` = um arquivo) e "formatar" escreve uma marca.
 */
export function ambienteSimulado(arquivoDiscos: string): Ambiente {
  return {
    inventario: async () => JSON.parse(readFileSync(arquivoDiscos, 'utf8')) as Disco[],
    async preparar() {},
    async abrir(d, uso) {
      return dispositivo(await open(d.caminho, uso === 'gravar' ? 'r+' : 'r'), d.setor);
    },
    async esvaziarCache() {},
    async releer() {},
    async formatos() {
      return new Set<SistemaDados>(['exfat', 'ext4']);
    },
    async formatar(d, numero) {
      const { lerGpt } = await import('./gpt.ts');
      const fh = await open(d.caminho, 'r+');
      try {
        const dev = dispositivo(fh, d.setor);
        const g = await lerGpt((p, n) => dev.ler(p, n), d.setor);
        const p = g.particoes.find((x) => x.numero === numero);
        if (!p) throw new Error(`sem a partição ${numero}`);
        const marca = Buffer.alloc(d.setor);
        marca.write(MARCA_SIMULADA, 0, 'latin1');
        await dev.escrever(p.inicio * d.setor, marca);
      } finally {
        await fh.close();
      }
    },
  };
}
