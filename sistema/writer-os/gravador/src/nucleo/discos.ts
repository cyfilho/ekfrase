// SPDX-License-Identifier: MPL-2.0

/**
 * OS DISCOS: a lista do que está ligado e A REGRA DE QUAL PODE SER APAGADO (PLANO §6.1b e §8b). É a
 * parte mais perigosa do Gravador, então é simples, testada com saídas reais (tests/gravador.test.ts)
 * e roda DUAS vezes: na janela (para mostrar a lista) e de novo no processo que grava, logo antes de
 * apagar (o disco pode ter mudado entre um e outro).
 *
 * - Só entra na lista o que está ligado por USB (o barramento, nunca o rótulo "removível": SSD e HD
 *   externos se dizem "disco fixo"). O disco interno (SATA, NVMe, SD/MMC embutido, virtual…) nem aparece.
 * - Um disco USB aparece, mas TRAVADO, se: é o do sistema (tem o Windows, o "/", a troca, o boot), tem
 *   o próprio Gravador ou a pasta onde ele guarda a imagem, é só leitura, tem menos de 4 GB, tem setor
 *   que não é 512 nem 4096, ou (Linux) está em uso por LVM, criptografia ou RAID.
 */
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { promisify } from 'node:util';
import { NOME_BOOT, NOME_DADOS, TIPO } from './gpt.ts';

const rodar = promisify(execFile);

/** "4 GB" de pendrive têm uns 3,7 a 4,0 bilhões de bytes; abaixo disto, recusa (PLANO §8b). */
export const MINIMO_DISCO = 3_600_000_000;

export interface ParticaoVista {
  numero: number;
  /** Rótulo do sistema de arquivos (FAT/exFAT/NTFS/ext4). */
  rotulo: string | null;
  /** Nome da partição na GPT (Linux: PARTLABEL; o Windows não mostra). */
  nomeGpt: string | null;
  tipoGpt: string | null;
  sistema: string | null;
  inicio: number | null;
  tamanho: number;
  usado: number | null;
  montagens: string[];
}

export type Recusa = 'sistema' | 'gravador' | 'somente-leitura' | 'pequeno' | 'setor' | 'em-uso';

export interface Disco {
  /** Estável enquanto o disco está ligado: `win:2` (o número do disco) ou `/dev/sdb`. */
  id: string;
  /** O que se abre para gravar: `\\.\PhysicalDrive2` ou `/dev/sdb`. */
  caminho: string;
  nome: string;
  tamanho: number;
  setor: number;
  barramento: string;
  /** Pendrive (se diz removível) ou disco externo (SSD/HD: se diz fixo). */
  tipo: 'pendrive' | 'externo';
  serial: string | null;
  somenteLeitura: boolean;
  particoes: ParticaoVista[];
  /** O motivo de não poder gravar (null = pode). */
  recusa: Recusa | null;
  /** Parece um Writer OS (então o modo Atualizar vale). Quem grava confere pela GPT. */
  writerOS: boolean;
}

/** Os caminhos que o Gravador usa (o executável, a pasta da imagem, a pasta temporária): o disco deles nunca é apagado. */
export interface Contexto {
  caminhosProtegidos: string[];
}

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : 0);
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const lista = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const guid = (v: unknown): string | null => {
  const s = txt(v);
  return s ? s.replace(/[{}]/g, '').toUpperCase() : null;
};

function parecerWriterOS(ps: ParticaoVista[]): boolean {
  const [p1, ...resto] = [...ps].sort((a, b) => a.numero - b.numero);
  if (!p1 || p1.numero !== 1 || resto.length > 1) return false;
  const bootOk = p1.nomeGpt === NOME_BOOT || p1.rotulo === 'EKFR-BOOT' || (p1.tipoGpt === TIPO.esp && p1.inicio === 1024 * 1024);
  const dadosOk = !resto.length || (resto[0]!.numero === 2 && (resto[0]!.nomeGpt === NOME_DADOS || resto[0]!.rotulo === 'EKFR-DADOS'));
  return bootOk && dadosOk && (p1.nomeGpt === NOME_BOOT || p1.rotulo === 'EKFR-BOOT' || resto.length === 1);
}

function avaliar(d: Omit<Disco, 'recusa' | 'writerOS'>, sistema: boolean, gravador: boolean, emUso: boolean): Recusa | null {
  if (sistema) return 'sistema';
  if (gravador) return 'gravador';
  if (emUso) return 'em-uso';
  if (d.somenteLeitura) return 'somente-leitura';
  if (d.setor !== 512 && d.setor !== 4096) return 'setor';
  if (d.tamanho < MINIMO_DISCO) return 'pequeno';
  return null;
}

// ---------------------------------------------------------------- Windows

/**
 * O que o PowerShell devolve (sem precisar de administrador): Get-Disk, Get-Partition, Get-Volume e,
 * do Win32_DiskDrive, o tipo de mídia (removível ou não, só para o ícone).
 */
export const SCRIPT_WINDOWS = String.raw`
$ErrorActionPreference = 'Stop'
$midia = @{}
try { Get-CimInstance Win32_DiskDrive | ForEach-Object { $midia[[int]$_.Index] = [string]$_.MediaType } } catch {}
$discos = @(Get-Disk | ForEach-Object {
  $d = $_
  $ps = @(Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue | ForEach-Object {
    $v = $null
    try { $v = $_ | Get-Volume -ErrorAction Stop } catch {}
    [pscustomobject]@{
      numero = $_.PartitionNumber; tipo = [string]$_.GptType; inicio = $_.Offset; tamanho = $_.Size
      letra = [string]$_.DriveLetter; caminhos = @($_.AccessPaths); ehSistema = [bool]$_.IsSystem; ehBoot = [bool]$_.IsBoot
      rotulo = $(if ($v) { [string]$v.FileSystemLabel } else { $null }); sistema = $(if ($v) { [string]$v.FileSystem } else { $null })
      tamanhoVolume = $(if ($v) { $v.Size } else { $null }); livre = $(if ($v) { $v.SizeRemaining } else { $null })
    }
  })
  [pscustomobject]@{
    numero = $d.Number; nome = [string]$d.FriendlyName; serial = [string]$d.SerialNumber; barramento = [string]$d.BusType
    tamanho = $d.Size; setor = $d.LogicalSectorSize; somenteLeitura = [bool]$d.IsReadOnly; sistema = [bool]$d.IsSystem
    boot = [bool]$d.IsBoot; midia = $midia[[int]$d.Number]; particoes = $ps
  }
})
$letra = $env:SystemDrive.Substring(0, 1)
$doWindows = $null
try { $doWindows = (Get-Partition -DriveLetter $letra -ErrorAction Stop).DiskNumber } catch {}
[pscustomobject]@{ discos = $discos; doWindows = $doWindows } | ConvertTo-Json -Depth 6 -Compress
`;

interface ParticaoWin {
  numero: unknown;
  tipo: unknown;
  inicio: unknown;
  tamanho: unknown;
  letra: unknown;
  caminhos?: unknown;
  ehSistema?: unknown;
  ehBoot?: unknown;
  rotulo?: unknown;
  sistema?: unknown;
  tamanhoVolume?: unknown;
  livre?: unknown;
}
interface DiscoWin {
  numero: unknown;
  nome: unknown;
  serial: unknown;
  barramento: unknown;
  tamanho: unknown;
  setor: unknown;
  somenteLeitura?: unknown;
  sistema?: unknown;
  boot?: unknown;
  midia?: unknown;
  particoes?: ParticaoWin | ParticaoWin[] | null;
}

/** MSFT_Disk.BusType: 7 = USB (o PowerShell às vezes devolve o número, às vezes o nome). */
const barramentoWin = (v: unknown): string => {
  const nomes: Record<number, string> = { 1: 'scsi', 2: 'atapi', 3: 'ata', 7: 'usb', 8: 'raid', 9: 'iscsi', 10: 'sas', 11: 'sata', 12: 'sd', 13: 'mmc', 14: 'virtual', 15: 'vhd', 16: 'spaces', 17: 'nvme' };
  if (typeof v === 'number') return nomes[v] ?? `bus-${v}`;
  const s = (txt(v) ?? '').toLowerCase();
  return /^\d+$/.test(s) ? (nomes[Number(s)] ?? `bus-${s}`) : s === 'file backed virtual' ? 'vhd' : s;
};

/** A letra de unidade de cada caminho protegido ("C:\Users\…" → "C"). */
const letras = (ctx: Contexto): Set<string> => new Set(ctx.caminhosProtegidos.map((c) => /^([a-zA-Z]):/.exec(win32.resolve(c))?.[1]?.toUpperCase()).filter((x): x is string => !!x));

export function discosDoWindows(json: string, ctx: Contexto): Disco[] {
  const r = JSON.parse(json) as { discos?: DiscoWin | DiscoWin[]; doWindows?: unknown };
  const doWindows = r.doWindows == null ? null : num(r.doWindows);
  const protegidas = letras(ctx);
  const protegidos = ctx.caminhosProtegidos.map((c) => `${win32.resolve(c).toLowerCase().replace(/\\?$/, '\\')}`);
  const saida: Disco[] = [];
  for (const d of lista(r.discos)) {
    const barramento = barramentoWin(d.barramento);
    if (barramento !== 'usb') continue; // o disco do computador nunca aparece
    const numero = num(d.numero);
    const ps = lista(d.particoes);
    const particoes: ParticaoVista[] = ps.map((p) => {
      const tv = num(p.tamanhoVolume);
      const livre = p.livre == null ? null : num(p.livre);
      return {
        numero: num(p.numero),
        rotulo: txt(p.rotulo),
        nomeGpt: null,
        tipoGpt: guid(p.tipo),
        sistema: txt(p.sistema),
        inicio: num(p.inicio),
        tamanho: num(p.tamanho),
        usado: tv && livre != null ? tv - livre : null,
        montagens: [txt(p.letra) ? `${txt(p.letra)}:` : null, ...lista(p.caminhos as string[]).filter((c) => typeof c === 'string' && !c.startsWith('\\\\?\\'))].filter((x): x is string => !!x),
      };
    });
    const sistema = d.sistema === true || d.boot === true || numero === doWindows || ps.some((p) => p.ehSistema === true || p.ehBoot === true);
    const gravador = ps.some((p) => {
      const l = txt(p.letra);
      if (l && protegidas.has(l.toUpperCase())) return true;
      // um volume montado numa pasta ("C:\pendrive\") que contém um dos caminhos
      return lista(p.caminhos as string[]).some((ap) => typeof ap === 'string' && !ap.startsWith('\\\\?\\') && protegidos.some((c) => c.startsWith(ap.toLowerCase().replace(/\\?$/, '\\'))));
    });
    const base = {
      id: `win:${numero}`,
      caminho: `\\\\.\\PhysicalDrive${numero}`,
      nome: txt(d.nome) ?? `Disco ${numero}`,
      tamanho: num(d.tamanho),
      setor: num(d.setor) || 512,
      barramento,
      tipo: /removable/i.test(String(d.midia ?? '')) ? ('pendrive' as const) : ('externo' as const),
      serial: txt(d.serial),
      somenteLeitura: d.somenteLeitura === true,
      particoes,
    };
    saida.push({ ...base, recusa: avaliar(base, sistema, gravador, false), writerOS: parecerWriterOS(particoes) });
  }
  return saida;
}

// ---------------------------------------------------------------- Linux

interface NoLsblk {
  name?: string;
  path?: string;
  type?: string;
  size?: unknown;
  tran?: string | null;
  subsystems?: string | null;
  rm?: unknown;
  ro?: unknown;
  hotplug?: unknown;
  'log-sec'?: unknown;
  model?: string | null;
  vendor?: string | null;
  serial?: string | null;
  label?: string | null;
  partlabel?: string | null;
  parttype?: string | null;
  partn?: unknown;
  start?: unknown;
  fstype?: string | null;
  fsused?: unknown;
  mountpoint?: string | null;
  mountpoints?: (string | null)[] | null;
  children?: NoLsblk[];
}

/** O `lsblk` que o Gravador roda (as colunas que existem desde o util-linux 2.33). */
export const COLUNAS_LSBLK = 'NAME,PATH,TYPE,SIZE,TRAN,RM,RO,LOG-SEC,MODEL,VENDOR,SERIAL,LABEL,PARTLABEL,PARTTYPE,FSTYPE,FSUSED,MOUNTPOINT';

/** Montagens que dizem "este é o disco do sistema". */
const DO_SISTEMA = new Set(['/', '/boot', '/boot/efi', '/efi', '/usr', '/var', '/home', '/opt', '/srv', '/nix', '[SWAP]']);

const verdade = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

function montagensDe(n: NoLsblk): string[] {
  return [...lista(n.mountpoints), n.mountpoint].filter((m): m is string => typeof m === 'string' && !!m);
}

function descendentes(n: NoLsblk): NoLsblk[] {
  return lista(n.children).flatMap((c) => [c, ...descendentes(c)]);
}

/** O caminho de verdade (sem atalhos); se não existir mais, o próprio. */
const real = (c: string) => {
  if (process.platform === 'linux') {
    try {
      return realpathSync(c);
    } catch {
      // não existe mais: o próprio caminho
    }
  }
  return posix.resolve(c);
};

export function discosDoLinux(json: string, ctx: Contexto): Disco[] {
  const r = JSON.parse(json) as { blockdevices?: NoLsblk[] };
  const protegidos = ctx.caminhosProtegidos.map(real);
  const saida: Disco[] = [];
  for (const d of lista(r.blockdevices)) {
    if (d.type !== 'disk') continue;
    const usb = (d.tran ?? '').toLowerCase() === 'usb';
    if (!usb) continue; // o disco do computador nunca aparece
    const filhos = descendentes(d);
    const todas = [...montagensDe(d), ...filhos.flatMap(montagensDe)];
    const sistema = todas.some((m) => DO_SISTEMA.has(m));
    // o disco que tem o Gravador, a imagem ou a pasta temporária: a montagem mais longa que contém o caminho
    const gravador = protegidos.some((c) => todas.some((m) => m !== '[SWAP]' && (c === m || c.startsWith(m.endsWith('/') ? m : `${m}/`))));
    const emUso = filhos.some((c) => c.type && c.type !== 'part');
    const particoes: ParticaoVista[] = lista(d.children)
      .filter((c) => c.type === 'part')
      .map((c, i) => ({
        numero: num(c.partn) || Number(/(\d+)$/.exec(c.name ?? '')?.[1] ?? i + 1),
        rotulo: txt(c.label),
        nomeGpt: txt(c.partlabel),
        tipoGpt: guid(c.parttype),
        sistema: txt(c.fstype),
        inicio: c.start == null ? null : num(c.start) * 512,
        tamanho: num(c.size),
        usado: c.fsused == null ? null : num(c.fsused),
        montagens: [...montagensDe(c), ...descendentes(c).flatMap(montagensDe)],
      }));
    const nome = [txt(d.vendor), txt(d.model)].filter(Boolean).join(' ') || d.name || 'USB';
    const base = {
      id: d.path ?? `/dev/${d.name}`,
      caminho: d.path ?? `/dev/${d.name}`,
      nome: nome.replace(/\s+/g, ' '),
      tamanho: num(d.size),
      setor: num(d['log-sec']) || 512,
      barramento: 'usb',
      tipo: verdade(d.rm) ? ('pendrive' as const) : ('externo' as const),
      serial: txt(d.serial),
      somenteLeitura: verdade(d.ro),
      particoes,
    };
    saida.push({ ...base, recusa: avaliar(base, sistema, gravador, emUso), writerOS: parecerWriterOS(particoes) });
  }
  return saida;
}

// ---------------------------------------------------------------- ler do sistema

export async function listarDiscos(ctx: Contexto, plataforma: NodeJS.Platform = process.platform): Promise<Disco[]> {
  if (plataforma === 'win32') {
    const { stdout } = await rodar('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT_WINDOWS], { windowsHide: true, maxBuffer: 16 << 20, timeout: 60_000 });
    return discosDoWindows(stdout.trim() || '{}', ctx);
  }
  if (plataforma === 'linux') {
    const { stdout } = await rodar('lsblk', ['-J', '-b', '-o', COLUNAS_LSBLK], { maxBuffer: 16 << 20, timeout: 30_000 });
    return discosDoLinux(stdout, ctx);
  }
  return [];
}

/** O texto do conteúdo, para mostrar antes de apagar: as partições com rótulo e o espaço usado. */
export function resumoDoConteudo(d: Disco): { particoes: number; usado: number | null; rotulos: string[] } {
  const usados = d.particoes.map((p) => p.usado).filter((u): u is number => u != null);
  return { particoes: d.particoes.length, usado: usados.length ? usados.reduce((a, b) => a + b, 0) : null, rotulos: d.particoes.map((p) => p.rotulo ?? p.nomeGpt).filter((x): x is string => !!x) };
}

/** É o MESMO disco que a pessoa escolheu? (quem grava confere de novo, logo antes de apagar) */
export function mesmoDisco(a: Pick<Disco, 'id' | 'caminho' | 'tamanho' | 'setor' | 'serial' | 'nome'>, b: Pick<Disco, 'id' | 'caminho' | 'tamanho' | 'setor' | 'serial' | 'nome'>): boolean {
  return a.id === b.id && a.caminho === b.caminho && a.tamanho === b.tamanho && a.setor === b.setor && (a.serial ?? '') === (b.serial ?? '') && a.nome === b.nome;
}
