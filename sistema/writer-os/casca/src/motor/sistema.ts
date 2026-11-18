// SPDX-License-Identifier: MPL-2.0

/**
 * O SISTEMA do Writer OS (parte do Motor; PLANO §6.4 e §7): o que o painel do sistema e o primeiro uso
 * pedem ao Linux, sempre como o usuário `writer`, sem root, pelos programas do sistema que falam com o
 * D-Bus. O polkit da imagem (`sistema/writer-os/imagem/raiz/etc/polkit-1/rules.d/50-ekfrase.rules`)
 * libera só isto, e só na sessão ativa:
 *
 * - Wi-Fi: `nmcli` (NetworkManager: `network-control`, `wifi.scan`, `settings.modify.own`; as conexões
 *   são do `writer`, `connection.permissions user:writer`);
 * - discos: `lsblk` (ler) e `udisksctl` (montar, desmontar, desligar), **só no barramento USB**
 *   (§6.1b: pendrive, SSD portátil e HD externo; o disco interno nem aparece para o udisks2);
 * - brilho, desligar, reiniciar: `busctl` (logind); fuso: `timedatectl`; bateria: `/sys`.
 *
 * Duas versões: `SistemaLinux` (a de verdade) e `SistemaSimulado` (para os testes e os prints fora do
 * pendrive, no Windows também). Nenhum comando passa por shell: `execFile` com a lista de argumentos.
 */
import type { Bateria, DiscoUSB, RedeWifi, RespostaSistema } from '@ekfrase/writer-nucleo';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';

/** Os teclados do primeiro uso e do painel (o `ekfrase-sessao.sh` da imagem conhece os mesmos). */
export const TECLADOS = ['br', 'us', 'us-intl', 'gb', 'pt', 'es', 'de', 'fr'] as const;

/** Os fusos da lista (o primeiro é o padrão). Os do Brasil primeiro. */
export const FUSOS = [
  'America/Sao_Paulo',
  'America/Bahia',
  'America/Fortaleza',
  'America/Recife',
  'America/Belem',
  'America/Manaus',
  'America/Cuiaba',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'America/Noronha',
  'Europe/Lisbon',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Luanda',
  'Africa/Maputo',
  'Asia/Tokyo',
  'UTC',
] as const;

/** Onde as coisas do sistema ficam (na imagem, `/run/ekfrase` e `/dados`; simulado, numa pasta de testes). */
export interface Caminhos {
  /** `/run/ekfrase`: `dados.json` (o que o `ekfrase-dados.service` achou) e o `sistema.json` sem partição. */
  run: string;
  /** Onde a partição de dados está montada (`/dados`). */
  dados: string;
  /** A memória (`/run/ekfrase/ram`, tmpfs de 256 MB). */
  ram: string;
  /** Só na imagem de teste: onde o agente de teste escreve o relato. */
  teste: string | null;
}

export interface Sistema {
  readonly simulado: boolean;
  readonly caminhos: Caminhos;
  redes(): Promise<RedeWifi[]>;
  conectar(ssid: string, senha: string | null): Promise<RespostaSistema>;
  /** Uma rede guardada no cofre volta ao NetworkManager (as conexões dele vivem na memória). */
  lembrarRede(ssid: string, senha: string | null): Promise<void>;
  esquecer(ssid: string): Promise<void>;
  bateria(): Promise<Bateria | null>;
  brilho(passo?: number): Promise<number | null>;
  usarFuso(id: string): Promise<boolean>;
  discos(): Promise<DiscoUSB[]>;
  /** Monta pelo udisks2 e devolve onde (ou `null`). */
  montar(id: string): Promise<string | null>;
  ejetar(id: string): Promise<RespostaSistema>;
  /** Só o agente de teste: tenta montar o disco interno (tem de ser negado). */
  montarInterno(): Promise<'negado' | 'montou' | 'sem-disco'>;
  desligar(): Promise<void>;
  reiniciar(): Promise<void>;
  versao(): string;
  kernel(): string;
  secureBoot(): 'ligado' | 'desligado' | 'desconhecido';
}

/** O Writer tem uma pasta com textos neste disco montado? */
export const temWriter = (montado: string | null): boolean => !!montado && existsSync(join(montado, 'Ekfrase Writer', 'dados', 'cofre.db'));

// ======================================================================================
// o Linux de verdade
// ======================================================================================

interface Saida {
  ok: boolean;
  out: string;
  err: string;
}

function rodar(programa: string, args: string[], tempo = 20000): Promise<Saida> {
  return new Promise((ok) => {
    execFile(programa, args, { timeout: tempo, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (erro, out, err) => {
      ok({ ok: !erro, out: String(out ?? ''), err: String(err ?? '') });
    });
  });
}

/** Uma linha do `nmcli -t` (os `:` dentro dos campos vêm como `\:`). */
export function camposNmcli(linha: string): string[] {
  const saida: string[] = [];
  let atual = '';
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '\\' && i + 1 < linha.length) {
      atual += linha[++i];
    } else if (c === ':') {
      saida.push(atual);
      atual = '';
    } else atual += c;
  }
  saida.push(atual);
  return saida;
}

interface NoLsblk {
  name: string;
  path: string;
  type: string;
  tran?: string | null;
  size: number | string;
  label?: string | null;
  partlabel?: string | null;
  fstype?: string | null;
  mountpoint?: string | null;
  model?: string | null;
  vendor?: string | null;
  children?: NoLsblk[];
}

const SISTEMAS_DE_ARQUIVOS = new Set(['vfat', 'exfat', 'ntfs', 'ext4', 'ext3', 'ext2']);

/** As partições (ou o disco inteiro, sem tabela) de um nó do `lsblk` que dá para montar. */
function montaveis(disco: NoLsblk): NoLsblk[] {
  const filhos = disco.children ?? [];
  if (!filhos.length) return disco.fstype && SISTEMAS_DE_ARQUIVOS.has(disco.fstype) ? [disco] : [];
  return filhos.filter((p) => p.fstype && SISTEMAS_DE_ARQUIVOS.has(p.fstype));
}

const ehBoot = (disco: NoLsblk): boolean => [disco, ...(disco.children ?? [])].some((p) => p.partlabel === 'EKFRASE-BOOT' || p.mountpoint === '/run/live/medium');

export class SistemaLinux implements Sistema {
  readonly simulado = false;
  readonly caminhos: Caminhos;

  constructor(teste: boolean) {
    this.caminhos = { run: '/run/ekfrase', dados: '/dados', ram: '/run/ekfrase/ram', teste: teste ? '/run/ekfrase/teste' : null };
  }

  private async conexoesWifi(): Promise<string[]> {
    const r = await rodar('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show']);
    return r.out
      .split('\n')
      .map(camposNmcli)
      .filter((c) => c[1] === '802-11-wireless')
      .map((c) => c[0] ?? '');
  }

  async redes(): Promise<RedeWifi[]> {
    const [lista, conhecidas] = await Promise.all([rodar('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'auto']), this.conexoesWifi()]);
    const porNome = new Map<string, RedeWifi>();
    for (const linha of lista.out.split('\n')) {
      const [uso, ssid, sinal, seg] = camposNmcli(linha);
      if (!ssid) continue;
      const rede: RedeWifi = { ssid, sinal: Number(sinal) || 0, segura: !!seg && seg !== '--', conhecida: conhecidas.includes(ssid), conectada: uso === '*' };
      const antes = porNome.get(ssid);
      if (!antes || rede.conectada || (!antes.conectada && rede.sinal > antes.sinal)) porNome.set(ssid, rede);
    }
    return [...porNome.values()].sort((a, b) => Number(b.conectada) - Number(a.conectada) || b.sinal - a.sinal);
  }

  private async adicionar(ssid: string, senha: string | null): Promise<boolean> {
    const args = ['connection', 'add', 'type', 'wifi', 'con-name', ssid, 'ssid', ssid, 'connection.permissions', 'user:writer', 'connection.autoconnect', 'yes'];
    if (senha) args.push('wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', senha);
    return (await rodar('nmcli', args)).ok;
  }

  async conectar(ssid: string, senha: string | null): Promise<RespostaSistema> {
    const conhecidas = await this.conexoesWifi();
    if (senha !== null || !conhecidas.includes(ssid)) {
      if (conhecidas.includes(ssid)) await rodar('nmcli', ['connection', 'delete', 'id', ssid]);
      if (!(await this.adicionar(ssid, senha))) return { ok: false, erro: 'negado' };
    }
    const r = await rodar('nmcli', ['--wait', '40', 'connection', 'up', 'id', ssid], 50000);
    if (r.ok) return { ok: true };
    if (senha !== null) await rodar('nmcli', ['connection', 'delete', 'id', ssid]);
    return { ok: false, erro: /secret|password|802-1x|psk/i.test(r.err) ? 'senha' : 'falhou' };
  }

  async lembrarRede(ssid: string, senha: string | null): Promise<void> {
    if (!(await this.conexoesWifi()).includes(ssid)) await this.adicionar(ssid, senha);
  }

  async esquecer(ssid: string): Promise<void> {
    await rodar('nmcli', ['connection', 'delete', 'id', ssid]);
  }

  async bateria(): Promise<Bateria | null> {
    const base = '/sys/class/power_supply';
    try {
      for (const n of readdirSync(base)) {
        const ler = (f: string) => readFileSync(join(base, n, f), 'utf8').trim();
        if (ler('type') !== 'Battery') continue;
        return { nivel: Math.max(0, Math.min(100, Number(ler('capacity')) || 0)), carregando: ler('status') === 'Charging' };
      }
    } catch {
      // sem bateria (computador de mesa, máquina virtual)
    }
    return null;
  }

  async brilho(passo?: number): Promise<number | null> {
    const base = '/sys/class/backlight';
    let dispositivo: string | undefined;
    try {
      dispositivo = escolherLuz(
        readdirSync(base).map((nome) => {
          let tipo = '';
          try {
            tipo = readFileSync(join(base, nome, 'type'), 'utf8').trim();
          } catch {
            // sem o tipo: fica por último
          }
          return { nome, tipo };
        }),
      );
    } catch {
      return null;
    }
    if (!dispositivo) return null;
    const ler = (f: string) => Number(readFileSync(join(base, dispositivo, f), 'utf8').trim());
    const max = ler('max_brightness');
    if (!max) return null;
    let atual = ler('brightness');
    if (passo) {
      // nunca apaga a tela de vez (5% no mínimo)
      const novo = Math.round(Math.max(max * 0.05, Math.min(max, atual + (passo / 100) * max)));
      const r = await rodar('busctl', ['call', 'org.freedesktop.login1', '/org/freedesktop/login1/session/auto', 'org.freedesktop.login1.Session', 'SetBrightness', 'ssu', 'backlight', dispositivo, String(novo)]);
      if (r.ok) atual = novo;
    }
    return Math.round((atual / max) * 100);
  }

  async usarFuso(id: string): Promise<boolean> {
    return (await rodar('timedatectl', ['set-timezone', id])).ok;
  }

  private async arvore(): Promise<NoLsblk[]> {
    const r = await rodar('lsblk', ['-J', '-b', '-o', 'NAME,PATH,TYPE,TRAN,SIZE,LABEL,PARTLABEL,FSTYPE,MOUNTPOINT,MODEL,VENDOR']);
    try {
      return ((JSON.parse(r.out) as { blockdevices?: NoLsblk[] }).blockdevices ?? []).filter((d) => d.type === 'disk');
    } catch {
      return [];
    }
  }

  async discos(): Promise<DiscoUSB[]> {
    const saida: DiscoUSB[] = [];
    for (const d of await this.arvore()) {
      // §6.1b: pelo barramento, não por "removível"; o disco de boot fica de fora (a partição de dados é dele)
      if (d.tran !== 'usb' || ehBoot(d)) continue;
      const nome = [d.vendor, d.model].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
      for (const p of montaveis(d)) {
        saida.push({ id: p.path, nome, rotulo: (p.label ?? '').trim(), tamanho: Number(p.size) || 0, montado: p.mountpoint ?? null, temWriter: temWriter(p.mountpoint ?? null) });
      }
    }
    return saida;
  }

  async montar(id: string): Promise<string | null> {
    const d = (await this.discos()).find((x) => x.id === id);
    if (!d) return null;
    if (d.montado) return d.montado;
    await rodar('udisksctl', ['mount', '-b', id, '--no-user-interaction']);
    return (await this.discos()).find((x) => x.id === id)?.montado ?? null;
  }

  async ejetar(id: string): Promise<RespostaSistema> {
    const arv = await this.arvore();
    const disco = arv.find((d) => d.tran === 'usb' && !ehBoot(d) && montaveis(d).some((p) => p.path === id));
    if (!disco) return { ok: false, erro: 'negado' };
    await rodar('sync', []);
    for (const p of montaveis(disco)) {
      if (p.mountpoint && !(await rodar('udisksctl', ['unmount', '-b', p.path, '--no-user-interaction'])).ok) return { ok: false, erro: 'falhou' };
    }
    // desligar o disco (o HD para de girar); se não der, já está desmontado e pode tirar
    await rodar('udisksctl', ['power-off', '-b', disco.path, '--no-user-interaction']);
    return { ok: true };
  }

  async montarInterno(): Promise<'negado' | 'montou' | 'sem-disco'> {
    const internos = (await this.arvore()).filter((d) => d.tran !== 'usb' && !ehBoot(d)).flatMap(montaveis);
    if (!internos.length) return 'sem-disco';
    for (const p of internos) {
      if ((await rodar('udisksctl', ['mount', '-b', p.path, '--no-user-interaction'])).ok) {
        await rodar('udisksctl', ['unmount', '-b', p.path, '--no-user-interaction']);
        return 'montou';
      }
    }
    return 'negado';
  }

  private async logind(metodo: 'PowerOff' | 'Reboot'): Promise<void> {
    await rodar('sync', []);
    await rodar('busctl', ['call', 'org.freedesktop.login1', '/org/freedesktop/login1', 'org.freedesktop.login1.Manager', metodo, 'b', 'false']);
  }

  desligar(): Promise<void> {
    return this.logind('PowerOff');
  }

  reiniciar(): Promise<void> {
    return this.logind('Reboot');
  }

  versao(): string {
    try {
      return readFileSync('/etc/ekfrase/versao', 'utf8').trim();
    } catch {
      return '?';
    }
  }

  kernel(): string {
    return release();
  }

  secureBoot(): 'ligado' | 'desligado' | 'desconhecido' {
    try {
      const b = readFileSync('/sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c');
      return b[4] === 1 ? 'ligado' : 'desligado';
    } catch {
      return 'desconhecido';
    }
  }
}

// ======================================================================================
/**
 * Qual luz de tela usar quando o notebook tem mais de uma em /sys/class/backlight (a do ACPI e a da placa de
 * vídeo, p. ex.): a do firmware, depois a da plataforma, por último a "raw" do driver (a ordem que o kernel
 * recomenda; é a mesma do GNOME e do systemd).
 */
export function escolherLuz(lista: readonly { nome: string; tipo: string }[]): string | undefined {
  const peso = (tipo: string) => {
    const i = ['firmware', 'platform', 'raw'].indexOf(tipo);
    return i < 0 ? 3 : i;
  };
  return [...lista].sort((a, b) => peso(a.tipo) - peso(b.tipo) || a.nome.localeCompare(b.nome))[0]?.nome;
}

// o simulado (testes e prints)
// ======================================================================================

/**
 * Tudo numa pasta (`EKFRASE_CASCA_OS_RAIZ`): `run/`, `dados/` (a partição de dados, se o teste quer
 * uma: `EKFRASE_CASCA_OS_DADOS=pendrive`), `ram/` e `media/OUTRO` (o 2º pendrive). Duas redes
 * (`Casa`, com a senha `senha123`, e `Biblioteca`, aberta), bateria, brilho.
 */
export class SistemaSimulado implements Sistema {
  readonly simulado = true;
  readonly caminhos: Caminhos;
  private readonly raiz: string;
  private conhecidas = new Map<string, string | null>();
  private conectada: string | null = null;
  // como a imagem: a tela começa sempre em 50% (ekfrase-brilho.sh)
  private luz = 50;
  private outroMontado = false;
  saiu: 'desligar' | 'reiniciar' | null = null;

  constructor(raiz: string, teste: boolean) {
    this.raiz = raiz;
    this.caminhos = { run: join(raiz, 'run'), dados: join(raiz, 'dados'), ram: join(raiz, 'ram'), teste: teste ? join(raiz, 'run', 'teste') : null };
    for (const c of [this.caminhos.run, this.caminhos.ram]) mkdirSync(c, { recursive: true });
  }

  async redes(): Promise<RedeWifi[]> {
    return [
      { ssid: 'Casa', sinal: 82, segura: true, conhecida: this.conhecidas.has('Casa'), conectada: this.conectada === 'Casa' },
      { ssid: 'Biblioteca', sinal: 54, segura: false, conhecida: this.conhecidas.has('Biblioteca'), conectada: this.conectada === 'Biblioteca' },
    ];
  }

  async conectar(ssid: string, senha: string | null): Promise<RespostaSistema> {
    if (ssid === 'Casa' && (senha ?? this.conhecidas.get('Casa')) !== 'senha123') return { ok: false, erro: 'senha' };
    if (ssid !== 'Casa' && ssid !== 'Biblioteca') return { ok: false, erro: 'falhou' };
    this.conhecidas.set(ssid, senha ?? this.conhecidas.get(ssid) ?? null);
    this.conectada = ssid;
    return { ok: true };
  }

  async lembrarRede(ssid: string, senha: string | null): Promise<void> {
    this.conhecidas.set(ssid, senha);
  }

  async esquecer(ssid: string): Promise<void> {
    this.conhecidas.delete(ssid);
    if (this.conectada === ssid) this.conectada = null;
  }

  async bateria(): Promise<Bateria | null> {
    return { nivel: 72, carregando: false };
  }

  async brilho(passo?: number): Promise<number | null> {
    if (passo) this.luz = Math.max(5, Math.min(100, this.luz + passo));
    return this.luz;
  }

  async usarFuso(): Promise<boolean> {
    return true;
  }

  private get pastaOutro(): string {
    return join(this.raiz, 'media', 'OUTRO');
  }

  async discos(): Promise<DiscoUSB[]> {
    const montado = this.outroMontado ? this.pastaOutro : null;
    return [{ id: '/dev/sdb1', nome: 'Pendrive USB', rotulo: 'OUTRO', tamanho: 16 * 1024 ** 3, montado, temWriter: temWriter(montado) }];
  }

  async montar(id: string): Promise<string | null> {
    if (id !== '/dev/sdb1') return null;
    mkdirSync(this.pastaOutro, { recursive: true });
    this.outroMontado = true;
    return this.pastaOutro;
  }

  async ejetar(id: string): Promise<RespostaSistema> {
    if (id !== '/dev/sdb1') return { ok: false, erro: 'negado' };
    this.outroMontado = false;
    return { ok: true };
  }

  async montarInterno(): Promise<'negado'> {
    return 'negado';
  }

  async desligar(): Promise<void> {
    this.saiu = 'desligar';
  }

  async reiniciar(): Promise<void> {
    this.saiu = 'reiniciar';
  }

  versao(): string {
    return '0.1.0-simulado';
  }

  kernel(): string {
    return 'simulado';
  }

  secureBoot(): 'desconhecido' {
    return 'desconhecido';
  }

  /** Para os testes: começar de novo (outro boot). */
  limpar(): void {
    rmSync(this.caminhos.ram, { recursive: true, force: true });
    mkdirSync(this.caminhos.ram, { recursive: true });
  }
}
