// SPDX-License-Identifier: MPL-2.0

/**
 * O GRAVADOR E O DISCO DESTE COMPUTADOR (PLANO §8c, fase 3d; só no Windows). Duas coisas, e nenhuma apaga o Windows:
 *
 * - **preparar:** diminui o C: (`Resize-Partition`) para sobrar um espaço livre de 8, 16 ou 32 GB no disco do
 *   sistema. Quem instala depois é o próprio Writer OS, pelo pendrive ("Instalar neste computador"). De fora do
 *   Windows ninguém diminui uma partição com BitLocker; o Windows consegue (resposta do Alcy de 15/11).
 * - **remover:** acha pela GPT as partições EKFRASE-BOOT e EKFRASE-DADOS que o Writer OS criou (o Windows não mostra
 *   os nomes GPT: lemos o `\\.\PhysicalDriveN`), copia os textos para os Documentos (antes, a EKFRASE-DADOS vira
 *   "dados básicos" e ganha uma letra), tira a entrada "Ekfrase Writer OS" do firmware (`bcdedit`), apaga as duas e
 *   devolve o espaço ao C: (se o espaço ficou logo depois dele).
 *
 * A janela só LÊ (`infoDoComputador`, sem administrador); o que muda o disco roda no processo elevado
 * (`trabalhador.ts` → `executarComputador`), e todo script começa pela guarda "o disco N ainda é o do sistema, com
 * este número de série, e a letra é dele".
 */
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { promisify } from 'node:util';
import { GB, LIVRE_MINIMO_WINDOWS, LIVRE_PARA_INSTALAR, type InfoComputador } from './computador-regras.ts';
import { lerGpt, NOME_BOOT, NOME_DADOS, TIPO } from './gpt.ts';

export * from './computador-regras.ts';

const rodar = promisify(execFile);

/** A EKFRASE-BOOT tem sempre 1400 MiB (a mesma da imagem). */
const TAMANHO_BOOT = 1400 * 1024 * 1024;

export type TarefaComputador =
  | { tipo: 'preparar'; disco: number; serial: string; letra: string; bytes: number }
  | { tipo: 'remover'; disco: number; serial: string; letra: string; copiarPara: string | null };

export type CodigoComputador = 'disco-mudou' | 'nao-gpt' | 'nao-encolhe' | 'pouco-livre' | 'sem-writer' | 'copia' | 'entrada' | 'remover' | 'falhou';

export class ErroComputador extends Error {
  readonly codigo: CodigoComputador;
  readonly detalhe: string;
  constructor(codigo: CodigoComputador, detalhe = '') {
    super(detalhe ? `${codigo}: ${detalhe}` : codigo);
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}

/** O que o "remover" fez: onde os textos foram parar e se o espaço voltou ao Windows. */
export interface Removido {
  copiado: string | null;
  espaco: 'devolvido' | 'solto';
}

// ---------------------------------------------------------------- ler (sem administrador)

/** O disco do sistema (o do C:), o C: e as partições (para achar um Writer OS instalado). */
export const SCRIPT_INFO = String.raw`
$ErrorActionPreference = 'Stop'
$letra = $env:SystemDrive.Substring(0, 1)
$p = Get-Partition -DriveLetter $letra
$d = $p | Get-Disk
$v = Get-Volume -DriveLetter $letra
$ps = @(Get-Partition -DiskNumber $d.Number | ForEach-Object { [pscustomobject]@{ tipo = [string]$_.GptType; tamanho = $_.Size } })
[pscustomobject]@{
  numero = $d.Number; serial = ([string]$d.SerialNumber).Trim(); nome = [string]$d.FriendlyName; tamanho = $d.Size
  setor = $d.LogicalSectorSize; estilo = [string]$d.PartitionStyle; livreMaior = $d.LargestFreeExtent
  letra = $letra; tamanhoC = $p.Size; livreC = $v.SizeRemaining; particoes = $ps
} | ConvertTo-Json -Depth 4 -Compress
`;

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : 0);
const guidLimpo = (v: unknown): string => String(v ?? '').replace(/[{}]/g, '').toUpperCase();

/** Lê o JSON do `SCRIPT_INFO` (e o `%firmware_type%` do cmd: `UEFI` ou `Legacy`). */
export function lerInfo(json: string, firmware: string): InfoComputador {
  const j = JSON.parse(json) as Record<string, unknown>;
  const partes = (Array.isArray(j['particoes']) ? j['particoes'] : j['particoes'] ? [j['particoes']] : []) as { tipo?: unknown; tamanho?: unknown }[];
  const estilo = String(j['estilo'] ?? '').toUpperCase();
  const letra = String(j['letra'] ?? 'C').toUpperCase();
  return {
    disponivel: true,
    uefi: firmware.trim().toUpperCase() === 'UEFI',
    disco: {
      numero: num(j['numero']),
      serial: String(j['serial'] ?? ''),
      nome: String(j['nome'] ?? ''),
      tamanho: num(j['tamanho']),
      setor: num(j['setor']) || 512,
      // MSFT_Disk.PartitionStyle: 1 = MBR, 2 = GPT (às vezes vem o número)
      gpt: estilo === 'GPT' || estilo === '2',
      livreMaior: num(j['livreMaior']),
    },
    windows: /^[A-Z]$/.test(letra) ? { letra, tamanho: num(j['tamanhoC']), livre: num(j['livreC']) } : null,
    writer: partes.some((p) => guidLimpo(p.tipo) === TIPO.esp && num(p.tamanho) === TAMANHO_BOOT) && partes.some((p) => guidLimpo(p.tipo) === TIPO.linux),
  };
}

export const SEM_COMPUTADOR: InfoComputador = { disponivel: false, uefi: false, disco: null, windows: null, writer: false };

/** O que o Gravador mostra do disco deste computador. Fora do Windows (ou se o PowerShell falhar), nada. */
export async function infoDoComputador(): Promise<InfoComputador> {
  if (process.platform !== 'win32') return SEM_COMPUTADOR;
  try {
    const [{ stdout }, fw] = await Promise.all([
      rodar('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT_INFO], { windowsHide: true, timeout: 60_000 }),
      // no PowerShell o $env:firmware_type vem vazio: é uma variável dinâmica só do cmd
      rodar('cmd.exe', ['/d', '/c', 'echo %firmware_type%'], { windowsHide: true, timeout: 10_000 }),
    ]);
    return lerInfo(stdout, fw.stdout);
  } catch {
    return SEM_COMPUTADOR;
  }
}

/**
 * O computador simulado (`EKFRASE_GRAVADOR_COMPUTADOR`, só fora do pacote: o roteiro): `livre` (dá para preparar),
 * `writer` (um Writer OS instalado), `pouco` (pouco espaço livre no C:) ou `legado` (sem UEFI).
 */
export function computadorSimulado(tipo: string | undefined): InfoComputador {
  if (!tipo) return SEM_COMPUTADOR;
  return {
    disponivel: true,
    uefi: tipo !== 'legado',
    disco: { numero: 0, serial: 'SIMULADO', nome: 'SSD NVMe simulado', tamanho: 256 * GB, setor: 512, gpt: true, livreMaior: tipo === 'writer' ? 0 : 1024 * 1024 },
    windows: { letra: 'C', tamanho: 237 * GB, livre: tipo === 'pouco' ? 30 * GB : 120 * GB },
    writer: tipo === 'writer',
  };
}

// ---------------------------------------------------------------- mudar (no processo elevado)

const aspas = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** O começo de todo script que muda o disco: o disco N ainda é o do sistema, com este número de série, e a letra é dele. */
export function guardaDoSistema(t: Pick<TarefaComputador, 'disco' | 'serial' | 'letra'>, exigirSistema = true): string {
  if (!Number.isInteger(t.disco) || t.disco < 0 || !/^[A-Z]$/.test(t.letra)) throw new ErroComputador('disco-mudou');
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$d = Get-Disk -Number ${t.disco}`,
    `if (([string]$d.SerialNumber).Trim() -ne ${aspas(t.serial)}) { throw 'ekfrase:disco-mudou' }`,
    `$c = Get-Partition -DriveLetter ${t.letra}`,
    `if ($c.DiskNumber -ne ${t.disco}) { throw 'ekfrase:disco-mudou' }`,
    `if ([string]$d.PartitionStyle -notin @('GPT', '2')) { throw 'ekfrase:nao-gpt' }`,
    ...(exigirSistema ? [`if (-not ($d.IsSystem -or $d.IsBoot)) { throw 'ekfrase:disco-mudou' }`] : []),
  ].join('\n');
}

/**
 * Diminui o C: em `bytes`. Recusa (sem mudar nada) se o C: não encolhe tanto (arquivos que não se movem: o
 * `nao-encolhe` leva o máximo possível, em bytes) ou se o Windows ficaria com menos de 20 GB livres.
 */
export function scriptPreparar(t: Extract<TarefaComputador, { tipo: 'preparar' }>, exigirSistema = true): string {
  if (!Number.isSafeInteger(t.bytes) || t.bytes < LIVRE_PARA_INSTALAR || t.bytes > 64 * GB) throw new ErroComputador('falhou', 'tamanho');
  return [
    guardaDoSistema(t, exigirSistema),
    `$v = Get-Volume -DriveLetter ${t.letra}`,
    `if (([int64]$v.SizeRemaining - ${t.bytes}) -lt ${LIVRE_MINIMO_WINDOWS}) { throw 'ekfrase:pouco-livre' }`,
    `$s = Get-PartitionSupportedSize -DriveLetter ${t.letra}`,
    `$novo = [int64]$c.Size - ${t.bytes}`,
    // o Resize-Partition alinha a 1 MiB: o tamanho novo também
    `$novo = [int64]([math]::Floor($novo / 1048576) * 1048576)`,
    `if ($novo -lt [int64]$s.SizeMin) { throw ('ekfrase:nao-encolhe:' + ([int64]$c.Size - [int64]$s.SizeMin)) }`,
    `Resize-Partition -DriveLetter ${t.letra} -Size $novo`,
    `Update-Disk -Number ${t.disco}`,
    `[int64](Get-Disk -Number ${t.disco}).LargestFreeExtent`,
  ].join('\n');
}

/** Os `{guid}` das entradas "Ekfrase Writer OS" na saída do `bcdedit /enum firmware` (os rótulos vêm traduzidos). */
export function entradasDoWriter(saida: string): string[] {
  const achadas: string[] = [];
  for (const bloco of saida.replace(/\r/g, '').split(/\n\s*\n/)) {
    const linhas = bloco.split('\n');
    if (!linhas.some((l) => /^\S+(\s\S+)*\s{2,}Ekfrase Writer OS\s*$/.test(l))) continue;
    const g = /\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}/.exec(bloco);
    if (g) achadas.push(g[0].toLowerCase());
  }
  return achadas;
}

async function ps(script: string): Promise<string> {
  try {
    const { stdout } = await rodar('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 600_000, maxBuffer: 8 << 20 });
    return stdout;
  } catch (e) {
    const texto = `${(e as { stderr?: string }).stderr ?? ''} ${(e as Error).message}`;
    const m = /ekfrase:([a-z-]+)(?::(\d+))?/.exec(texto);
    if (m?.[1] === 'disco-mudou' || m?.[1] === 'nao-gpt' || m?.[1] === 'pouco-livre' || m?.[1] === 'copia') throw new ErroComputador(m[1], texto.slice(0, 300));
    if (m?.[1] === 'nao-encolhe') throw new ErroComputador('nao-encolhe', m[2] ?? '0');
    throw new ErroComputador('falhou', texto.slice(0, 400));
  }
}

export interface OpcoesComputador {
  /** Só no teste do CI (um VHD, que não é o disco do sistema): não exige que o disco seja o do sistema. */
  exigirSistema?: boolean;
  /** Só no simulado: nada roda, a resposta é a de sempre. */
  simulado?: boolean;
  avisar?: (fase: 'preparar' | 'copiar' | 'entrada' | 'remover' | 'devolver') => void;
}

/** O que o processo elevado faz com a tarefa do computador. `preparar` devolve o espaço livre que ficou. */
export async function executarComputador(t: TarefaComputador, o: OpcoesComputador = {}): Promise<{ livre: number } | Removido> {
  const exigir = o.exigirSistema !== false;
  if (t.tipo === 'preparar') {
    o.avisar?.('preparar');
    if (o.simulado) return { livre: t.bytes };
    const livre = Number((await ps(scriptPreparar(t, exigir))).trim().split(/\s+/).pop() ?? 0);
    return { livre };
  }
  return remover(t, o, exigir);
}

async function remover(t: Extract<TarefaComputador, { tipo: 'remover' }>, o: OpcoesComputador, exigir: boolean): Promise<Removido> {
  if (o.simulado) {
    for (const f of ['copiar', 'entrada', 'remover', 'devolver'] as const) o.avisar?.(f);
    return { copiado: t.copiarPara, espaco: 'devolvido' };
  }
  const guarda = guardaDoSistema(t, exigir);
  // 1. as partições do Windows (número e onde começam) e o setor
  const lista = JSON.parse(await ps(`${guarda}\n@(Get-Partition -DiskNumber ${t.disco} | ForEach-Object { [pscustomobject]@{ n = $_.PartitionNumber; inicio = $_.Offset } }) + @([pscustomobject]@{ n = -1; inicio = [int64]$d.LogicalSectorSize }) | ConvertTo-Json -Compress`)) as { n: number; inicio: number }[] | { n: number; inicio: number };
  const partes = Array.isArray(lista) ? lista : [lista];
  const setor = partes.find((p) => p.n === -1)?.inicio ?? 512;
  // 2. a GPT de verdade (os nomes EKFRASE-BOOT e EKFRASE-DADOS só estão nela)
  const fh = await open(`\\\\.\\PhysicalDrive${t.disco}`, 'r');
  let gpt;
  try {
    gpt = await lerGpt(async (posicao, tamanho) => {
      const b = Buffer.alloc(tamanho);
      let feito = 0;
      while (feito < tamanho) {
        const { bytesRead } = await fh.read(b, feito, tamanho - feito, posicao + feito);
        if (!bytesRead) break;
        feito += bytesRead;
      }
      return b;
    }, setor);
  } finally {
    await fh.close();
  }
  const numeroDe = (nome: string): number | null => {
    const g = gpt.particoes.filter((p) => p.nome === nome);
    if (g.length !== 1) return null;
    return partes.find((p) => p.n > 0 && p.inicio === g[0]!.inicio * setor)?.n ?? null;
  };
  const nBoot = numeroDe(NOME_BOOT);
  const nDados = numeroDe(NOME_DADOS);
  if (nBoot === null && nDados === null) throw new ErroComputador('sem-writer');

  // 3. os textos vão para os Documentos (a EKFRASE-DADOS é do tipo Linux: o Windows só a lê como "dados básicos")
  let copiado: string | null = null;
  if (t.copiarPara && nDados !== null) {
    o.avisar?.('copiar');
    const letra = (
      await ps(
        [
          guarda,
          `$p = Get-Partition -DiskNumber ${t.disco} -PartitionNumber ${nDados}`,
          `Set-Partition -DiskNumber ${t.disco} -PartitionNumber ${nDados} -GptType '{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}'`,
          `if (-not $p.DriveLetter -or [string]$p.DriveLetter -eq [string][char]0) { Add-PartitionAccessPath -DiskNumber ${t.disco} -PartitionNumber ${nDados} -AssignDriveLetter }`,
          `$l = $null`,
          `for ($i = 0; $i -lt 20 -and -not $l; $i++) { $l = [string](Get-Partition -DiskNumber ${t.disco} -PartitionNumber ${nDados}).DriveLetter; if (-not $l -or $l -eq [string][char]0) { $l = $null; Start-Sleep -Milliseconds 500 } }`,
          `if (-not $l) { throw 'ekfrase:copia' }`,
          `$l`,
        ].join('\n'),
      )
    )
      .trim()
      .slice(-1);
    try {
      const origem = `${letra}:\\Ekfrase Writer`;
      if (existsSync(origem) && statSync(origem).isDirectory()) {
        mkdirSync(t.copiarPara, { recursive: true });
        cpSync(origem, t.copiarPara, { recursive: true, errorOnExist: false, force: false });
        copiado = t.copiarPara;
      }
    } catch (e) {
      throw new ErroComputador('copia', String((e as Error)?.message ?? e).slice(0, 300));
    } finally {
      await ps(`${guarda}\nRemove-PartitionAccessPath -DiskNumber ${t.disco} -PartitionNumber ${nDados} -AccessPath '${letra}:\\'`).catch(() => undefined);
    }
  }

  // 4. a entrada "Ekfrase Writer OS" do menu de ligar
  o.avisar?.('entrada');
  let firmware: string | null = null;
  try {
    firmware = (await rodar('bcdedit.exe', ['/enum', 'firmware'], { windowsHide: true, timeout: 60_000 })).stdout;
  } catch (e) {
    // o teste do CI (um VHD numa máquina virtual que pode não ser UEFI) segue sem o menu de ligar
    if (exigir) throw new ErroComputador('entrada', String((e as Error)?.message ?? e).slice(0, 300));
  }
  try {
    for (const g of entradasDoWriter(firmware ?? '')) await rodar('bcdedit.exe', ['/delete', g], { windowsHide: true, timeout: 60_000 });
  } catch (e) {
    throw new ErroComputador('entrada', String((e as Error)?.message ?? e).slice(0, 300));
  }

  // 5. as duas partições saem; 6. o espaço volta ao C: (só se ficou logo depois dele)
  o.avisar?.('remover');
  const apagar = [nBoot, nDados].filter((n): n is number => n !== null).sort((a, b) => b - a);
  await ps([guarda, ...apagar.map((n) => `Remove-Partition -DiskNumber ${t.disco} -PartitionNumber ${n} -Confirm:$false`), `Update-Disk -Number ${t.disco}`].join('\n')).catch((e: unknown) => {
    throw new ErroComputador('remover', String((e as Error)?.message ?? e).slice(0, 300));
  });
  o.avisar?.('devolver');
  const r = await ps(
    [
      guarda,
      `$s = Get-PartitionSupportedSize -DriveLetter ${t.letra}`,
      `if ([int64]$s.SizeMax -gt ([int64]$c.Size + 1048576)) { Resize-Partition -DriveLetter ${t.letra} -Size $s.SizeMax; 'devolvido' } else { 'solto' }`,
    ].join('\n'),
  );
  return { copiado, espaco: r.trim().endsWith('devolvido') ? 'devolvido' : 'solto' };
}
