// SPDX-License-Identifier: MPL-2.0

/**
 * O AGENTE DE TESTE do Writer OS (PLANO §8). SÓ existe na imagem de teste: liga quando há
 * `/etc/ekfrase/teste` (a imagem de entrega não tem esse arquivo) ou, fora do pendrive, com
 * `EKFRASE_CASCA_OS_TESTE=1`. Ele não mexe na tela: só conta o que acontece, uma linha por evento, em
 * `/run/ekfrase/teste/relato`, que um serviço root da imagem de teste repassa para a serial
 * (`tests/writer-os/qemu.py` lê de lá):
 *
 *   tela <data-teste>       a tela que está aberta (a cada troca)
 *   texto ok | texto falta  depois da senha: a cena de teste tem o texto da última vez?
 *   ultimo <N>              o último número que ficou gravado
 *   integridade <r>         `PRAGMA integrity_check` do banco (`ok`)
 *   usb ok | usb negado     o 2º pendrive (rótulo OUTRO) monta e aceita um arquivo?
 *   interno negado          o disco interno NÃO monta (§7)
 *   gravado <N>             o laço de gravação (cada linha depois do COMMIT): é o teste de arrancar
 *   lugar <usb|computador>  de onde o sistema ligou (o `lugar` do dados.json; instalar no computador, PLANO §8c)
 *   bootorder <lista>       o BootOrder do firmware (ao ligar e depois de instalar), como o efibootmgr mostra
 *   entrada-writer <n>      a entrada "Ekfrase Writer OS" que existe no firmware (Boot<n>)
 *   instalar ok | <erro>    o fim de uma instalação no computador
 *   vpn empresa …           a VPN de empresa contra o ocserv do CI (W5a; só com /run/ekfrase/teste/vpn-empresa):
 *                           `adicionar ok`, `ligar certificado <pin>`, `senha-errada senha`, `confiar ok`, `ok`,
 *                           `ip <endereço do túnel>`, `desligar ok`, `2fa-sem-codigo segundo-fator`, `2fa ok`, `fim`;
 *                           `saida <rótulo> <linha>` = o que o openconnect e o nmcli disseram quando falhou
 *   atualizacao …           as atualizações (atualizacoes-os.ts): `boot <lado> <versão> atual=… novo=… falhou=…`,
 *                           cada situação (`procurando`, `baixando <v>`, `pronta <v>`, `erro - <código>`…),
 *                           `confirmada <lado> <v>`, `sem-confirmar <lado>`, `voltou <de> <para>`
 */
import { DONO_LOCAL, Escrita } from '@ekfrase/writer-nucleo';
import { createHmac } from 'node:crypto';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import type { Sistema } from '../motor/sistema.ts';
import type { AtualizacoesOS } from './atualizacoes-os.ts';
import type { DadosDoWriter } from './dados.ts';
import type { WriterOS } from './os.ts';
import type { Pagina } from './pagina.ts';

const EFIVARS = '/sys/firmware/efi/efivars';
const GUID_GLOBAL = '8be4df61-93ca-11d2-aa0d-00e098032b8c';

/**
 * O BootOrder e as entradas "Ekfrase Writer OS" lidos das variáveis do firmware (o efivarfs deixa qualquer um ler).
 * Cada arquivo começa com 4 bytes de atributos; o BootOrder é uma lista de UINT16; o Boot#### é um EFI_LOAD_OPTION
 * (UINT32 atributos, UINT16 tamanho dos caminhos e a descrição em UTF-16, terminada em zero).
 */
export function lerEfi(pasta = EFIVARS): { ordem: string | null; writer: string[] } {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
  let ordem: string | null = null;
  const writer: string[] = [];
  try {
    const b = readFileSync(join(pasta, `BootOrder-${GUID_GLOBAL}`));
    const l: string[] = [];
    for (let i = 4; i + 1 < b.length; i += 2) l.push(hex(b.readUInt16LE(i)));
    ordem = l.join(',');
  } catch {
    // sem UEFI (ou sem o efivarfs)
  }
  let nomes: string[] = [];
  try {
    nomes = readdirSync(pasta);
  } catch {
    // idem
  }
  for (const f of nomes) {
    const m = new RegExp(`^Boot([0-9A-Fa-f]{4})-${GUID_GLOBAL}$`).exec(f);
    if (!m?.[1]) continue;
    let b: Buffer;
    try {
      b = readFileSync(join(pasta, f));
    } catch {
      // uma entrada que o writer não pode ler (o efivarfs pode deixar só o root): as outras seguem
      continue;
    }
    let nome = '';
    for (let i = 10; i + 1 < b.length; i += 2) {
      const c = b.readUInt16LE(i);
      if (!c) break;
      nome += String.fromCharCode(c);
    }
    if (nome === 'Ekfrase Writer OS') writer.push(m[1].toUpperCase());
  }
  return { ordem, writer: writer.sort() };
}

export const HISTORIA_DE_TESTE = 'Teste do Writer OS';
const MARCA = 'Escrito no Writer OS.';
/** Quantas gravações o laço faz (uma a cada 250 ms: ~75 s). */
const VOLTAS = 300;

export function ligarAgente(o: { relato: string; pagina: Pagina; dados: DadosDoWriter; sistema: Sistema; os?: WriterOS; atualizacoes?: AtualizacoesOS }): (linha: string) => void {
  mkdirSync(dirname(o.relato), { recursive: true });
  const dizer = (linha: string) => {
    try {
      appendFileSync(o.relato, `${linha}\n`);
    } catch {
      // o relato é só para o teste
    }
  };
  dizer('agente ligado');
  if (o.atualizacoes) o.atualizacoes.aoRelatar = dizer;
  const contarEfi = () => {
    const e = lerEfi();
    dizer(`bootorder ${e.ordem ?? '?'}`);
    for (const n of e.writer) dizer(`entrada-writer ${n}`);
  };
  if (o.os) {
    dizer(`lugar ${o.os.estado().boot}`);
    contarEfi();
    o.os.aoInstalar = (r) => {
      dizer(`instalar ${r}`);
      contarEfi();
    };
  }
  let tela = '';
  let conferindo = false;

  setInterval(() => {
    if (o.pagina.aberta()) {
      o.pagina
        .qualTela()
        .then((t: unknown) => {
          if (typeof t === 'string' && t && t !== tela) {
            tela = t;
            dizer(`tela ${t}`);
          }
        })
        .catch(() => undefined);
    }
    if (o.dados.aberta && !conferindo) {
      conferindo = true;
      void conferir().catch((e: unknown) => dizer(`erro ${e instanceof Error ? e.message : String(e)}`));
    }
  }, 250);

  async function conferir(): Promise<void> {
    await o.dados.abrirArmazem(DONO_LOCAL);
    const armazem = o.dados.armazemAberto(DONO_LOCAL);
    if (!armazem) throw new Error('sem armazém');
    const escrita = new Escrita(armazem);
    dizer(`integridade ${armazem.integridade()}`);
    let historia = (await escrita.historias()).find((h) => h.titulo === HISTORIA_DE_TESTE);
    let cena = historia ? (await escrita.cenas(historia.id))[0] : undefined;
    let n = 0;
    if (cena && cena.texto.startsWith(MARCA)) {
      n = Number(/gravado=(\d+)/.exec(cena.texto)?.[1] ?? 0);
      dizer('texto ok');
      dizer(`ultimo ${n}`);
    } else dizer('texto falta');
    if (!historia) historia = await escrita.criarHistoria({ titulo: HISTORIA_DE_TESTE });
    if (!cena) cena = await escrita.criarCena(historia.id, { titulo: 'Cena' });

    // o 2º pendrive e o disco interno (§7)
    const outro = (await o.sistema.discos()).find((d) => d.rotulo === 'OUTRO');
    if (outro) {
      const onde = outro.montado ?? (await o.sistema.montar(outro.id));
      try {
        if (!onde) throw new Error('não montou');
        writeFileSync(join(onde, 'ekfrase-teste.txt'), 'ok\n');
        dizer('usb ok');
      } catch {
        dizer('usb negado');
      }
    } else dizer('usb sem-disco');
    dizer(`interno ${await o.sistema.montarInterno()}`);
    if (o.os) await conferirVpn(o.os, o.sistema, dizer);
    if (o.os) await conferirVpnEmpresa(o.os, o.sistema, dizer);

    // o laço: cada linha "gravado N" só sai depois de o banco confirmar a gravação
    for (let i = 0; i < VOLTAS && o.dados.aberta; i++) {
      n += 1;
      await escrita.gravarTexto(cena.id, `${MARCA}\ngravado=${n}\n`);
      dizer(`gravado ${n}`);
      await new Promise((ok) => setTimeout(ok, 250));
    }
    dizer('laco fim');
  }

  return dizer;
}

/** O `.conf` de WireGuard da imagem de teste (o `zz-teste.squashfs`): chaves de mentira, um servidor que não existe. */
export const VPN_DE_TESTE = '/usr/share/ekfrase/teste/vpn-teste.conf';

/**
 * A VPN (PLANO §7): no 1º boot, importa o `.conf` de teste (pelo `ekfrase-vpn.service`, como a tela faz) e conta o dono
 * da conexão (`user:writer`); nos outros, conta as que voltaram do cofre. No simulado não há o arquivo (o roteiro da
 * VPN é o `casca-os.spec.ts`).
 */
async function conferirVpn(os: WriterOS, sistema: Sistema, dizer: (l: string) => void): Promise<void> {
  if (sistema.simulado) return;
  await Promise.race([os.vpnsVoltaram, new Promise((ok) => setTimeout(ok, 30000))]);
  const antes = await os.vpns();
  dizer(`vpns ${antes.length}`);
  if (antes.length) return;
  let bytes: Buffer;
  try {
    bytes = readFileSync(VPN_DE_TESTE);
  } catch {
    dizer('vpn sem-arquivo');
    return;
  }
  const r = await os.importarVpn('ekfrase-teste.conf', new Uint8Array(bytes));
  dizer(`vpn importar ${r.ok ? 'ok' : r.erro}`);
  if (r.ok) dizer(`vpn dono ${(await sistema.donoDaConexao(r.nome)) ?? '?'}`);
}

/** O que o `qemu.py` passa pelo fw_cfg `opt/ekfrase/vpn-empresa` (o `ekfrase-teste.service` copia para cá). */
export const VPN_EMPRESA_DE_TESTE = '/run/ekfrase/teste/vpn-empresa';

/** O código TOTP (RFC 6238: HMAC-SHA1, 30 s, 6 dígitos) da chave em hexadecimal: o segundo fator do ocserv do CI. */
export function totp(chaveHex: string, agora = Date.now()): string {
  const passo = Buffer.alloc(8);
  passo.writeBigUInt64BE(BigInt(Math.floor(agora / 1000 / 30)));
  const h = createHmac('sha1', Buffer.from(chaveHex, 'hex')).update(passo).digest();
  const i = (h[h.length - 1] ?? 0) & 0xf;
  return String((h.readUInt32BE(i) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * A VPN de empresa (W5a; PLANO §7, "VPN de empresa"), contra um ocserv de verdade no computador que roda o QEMU: criar
 * (pelo `ekfrase-vpn.service`), o certificado autoassinado (`certificado` com a impressão), a senha errada, confiar e
 * ligar (o NetworkManager com os segredos do `passwd-file`: o risco que o PLANO manda provar primeiro), o endereço do
 * túnel, desligar e, no 2º servidor, o segundo fator (sem o código = `segundo-fator`; com o TOTP = liga).
 */
async function conferirVpnEmpresa(os: WriterOS, sistema: Sistema, dizer: (l: string) => void): Promise<void> {
  if (sistema.simulado) return;
  let d: Record<string, string>;
  try {
    d = JSON.parse(readFileSync(VPN_EMPRESA_DE_TESTE, 'utf8')) as Record<string, string>;
  } catch {
    return;
  }
  const contarSaida = (rotulo: string) => {
    for (const l of (sistema.ultimaSaidaVpn ?? '').split('\n').filter((x) => x.trim()).slice(-30)) dizer(`vpn empresa saida ${rotulo} ${l.slice(0, 240)}`);
  };
  const resposta = (r: { ok: boolean; erro?: string; impressao?: string }) => (r.ok ? 'ok' : `${r.erro ?? '?'}${r.impressao ? ` ${r.impressao}` : ''}`);
  const ipDoTunel = () =>
    Object.values(networkInterfaces())
      .flat()
      .find((e) => e?.family === 'IPv4' && (e.address ?? '').startsWith(d['rede'] ?? '192.168.99.'))?.address ?? 'nenhum';
  try {
    const a = await os.adicionarVpnEmpresa({ protocolo: 'anyconnect', servidor: d['servidor'], usuario: d['usuario'], senha: d['senha'] });
    dizer(`vpn empresa adicionar ${resposta(a)}`);
    if (!a.ok) return;
    let r = await os.ligarVpn(a.nome);
    dizer(`vpn empresa ligar ${resposta(r)}`);
    contarSaida('ligar');
    const pin = !r.ok && r.erro === 'certificado' ? (r.impressao ?? null) : null;
    if (pin) {
      const e = await os.ligarVpn(a.nome, d['usuario'], 'senha-errada', { confiar: pin });
      dizer(`vpn empresa senha-errada ${resposta(e)}`);
      contarSaida('senha-errada');
      r = await os.ligarVpn(a.nome, null, null, { confiar: pin });
      dizer(`vpn empresa confiar ${resposta(r)}`);
      contarSaida('confiar');
    }
    if (r.ok) {
      const v = (await os.vpns()).find((x) => x.nome === a.nome);
      dizer(`vpn empresa ${v?.ligada ? 'ok' : 'nao-ligada'}`);
      dizer(`vpn empresa ip ${ipDoTunel()}`);
      dizer(`vpn empresa desligar ${resposta(await os.desligarVpn(a.nome))}`);
    }
    if (d['servidor2'] && d['totp']) {
      const b = await os.adicionarVpnEmpresa({ protocolo: 'anyconnect', servidor: d['servidor2'], usuario: d['usuario2'], senha: d['senha2'] });
      dizer(`vpn empresa 2fa-adicionar ${resposta(b)}`);
      if (!b.ok) return;
      let r2 = await os.ligarVpn(b.nome, null, null, pin ? { confiar: pin } : undefined);
      dizer(`vpn empresa 2fa-sem-codigo ${resposta(r2)}`);
      contarSaida('2fa-sem-codigo');
      r2 = await os.ligarVpn(b.nome, null, null, { confiar: pin, codigo: totp(d['totp']) });
      dizer(`vpn empresa 2fa ${resposta(r2)}`);
      contarSaida('2fa');
      if (r2.ok) {
        dizer(`vpn empresa 2fa-ip ${ipDoTunel()}`);
        await os.desligarVpn(b.nome);
      }
    }
  } catch (e) {
    dizer(`vpn empresa erro ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    dizer('vpn empresa fim');
    try {
      writeFileSync('/run/ekfrase/teste/vpn-empresa-fim', '');
    } catch {
      // o relato da imagem espera por este arquivo para mandar o journal do NetworkManager
    }
  }
}
