// SPDX-License-Identifier: MPL-2.0

/**
 * AS REGRAS DA VPN do Writer OS (PLANO §7, "VPN"; W4, parte 2c), sem o Electron e sem o sistema, para o
 * `tests/casca.test.ts`: que arquivo é aceito, o nome que a conexão ganha, o filtro do `.ovpn` e quando a VPN liga
 * sozinha.
 *
 * Por que o filtro: o `openvpn` roda como root (pelo NetworkManager). Um `.ovpn` pode pedir para rodar um programa
 * (`up`, `down`, `plugin`…) ou para ler um arquivo do sistema (`ca /etc/…`). O plugin do NetworkManager já ignora boa
 * parte disso, mas a casca recusa ANTES (e o `ekfrase-vpn.sh` da imagem, que importa como root, recusa de novo pela
 * mesma lista: `tests/casca.test.ts` confere que as duas listas são iguais). Os certificados embutidos (`<ca>…</ca>`)
 * passam; arquivo de fora (`ca arquivo.crt`) não.
 */

/** O maior arquivo de VPN aceito (os de verdade têm poucos kB, com os certificados embutidos). */
export const MAXIMO_VPN = 64 * 1024;

export type TipoVpn = 'wireguard' | 'openvpn';

/** O tipo pelo nome do arquivo: `.conf` = WireGuard, `.ovpn` = OpenVPN; outro = `null`. */
export function tipoDaVpn(arquivo: string): TipoVpn | null {
  const n = arquivo.toLowerCase();
  if (n.endsWith('.conf')) return 'wireguard';
  if (n.endsWith('.ovpn')) return 'openvpn';
  return null;
}

/**
 * O nome da conexão: o do arquivo sem a extensão, só com letras sem acento, números, `-` e `_`, até 15 (o WireGuard
 * vira uma placa de rede com esse nome, e o Linux não aceita mais que 15). Repetido ganha `-2`, `-3`…
 */
export function nomeDaVpn(arquivo: string, existentes: readonly string[]): string {
  const semExt = arquivo.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  const limpo =
    semExt
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 15)
      .replace(/-+$/, '') || 'vpn';
  const ocupado = new Set(existentes.map((e) => e.toLowerCase()));
  if (!ocupado.has(limpo.toLowerCase())) return limpo;
  for (let n = 2; n < 100; n++) {
    const fim = `-${n}`;
    const c = `${limpo.slice(0, 15 - fim.length)}${fim}`;
    if (!ocupado.has(c.toLowerCase())) return c;
  }
  return `vpn-${Date.now() % 100000}`;
}

/** Um nome que a casca e o `ekfrase-vpn.sh` aceitam (o mesmo padrão nos dois). */
export const NOME_VPN = /^[A-Za-z0-9_-]{1,15}$/;

/**
 * As diretivas do `.ovpn` que rodam programa, escrevem ou leem arquivo do sistema, ou mudam o próprio `openvpn`.
 * A MESMA lista está no `ekfrase-vpn.sh` da imagem (`PROIBIDAS=`).
 */
export const PROIBIDAS_OVPN = [
  'up', 'down', 'script-security', 'plugin', 'route-up', 'route-pre-down', 'ipchange', 'tls-verify',
  'auth-user-pass-verify', 'learn-address', 'client-connect', 'client-disconnect', 'management', 'config', 'cd',
  'chroot', 'daemon', 'log', 'log-append', 'writepid', 'status', 'iproute', 'tmp-dir', 'replay-persist',
  'tls-export-cert', 'client-config-dir', 'ifconfig-pool-persist', 'dev-node',
] as const;

/**
 * As diretivas que levam um ARQUIVO: só passam sem argumento ou com `[inline]` (o conteúdo vem no bloco `<ca>…</ca>`).
 * A MESMA lista está no `ekfrase-vpn.sh` (`ARQUIVOS=`).
 */
export const COM_ARQUIVO_OVPN = [
  'ca', 'cert', 'key', 'tls-auth', 'tls-crypt', 'tls-crypt-v2', 'extra-certs', 'pkcs12', 'dh', 'secret', 'crl-verify',
  'capath', 'askpass', 'auth-user-pass', 'http-proxy-user-pass',
] as const;

/** Os blocos embutidos aceitos (`<ca>…</ca>`). */
const BLOCOS_OVPN = new Set(['ca', 'cert', 'key', 'tls-auth', 'tls-crypt', 'tls-crypt-v2', 'extra-certs', 'pkcs12', 'dh', 'secret', 'crl-verify']);

export type FiltroVpn =
  | { ok: true; pedeSenha: boolean; servidores: string[] }
  | { ok: false; erro: 'proibida' | 'arquivo' | 'invalido'; diretiva?: string };

const MAXIMO_SERVIDORES = 32;

/** O filtro do `.ovpn`: recusa o que roda programa ou lê arquivo; conta se pede usuário e senha e quais servidores. */
export function filtrarOvpn(texto: string): FiltroVpn {
  if (texto.includes('\0')) return { ok: false, erro: 'invalido' };
  const proibidas = new Set<string>(PROIBIDAS_OVPN);
  const comArquivo = new Set<string>(COM_ARQUIVO_OVPN);
  let bloco: string | null = null;
  let pedeSenha = false;
  let temRemoto = false;
  const servidores: string[] = [];
  for (const cru of texto.split(/\r?\n/)) {
    const linha = cru.trim();
    if (bloco) {
      if (linha.toLowerCase() === `</${bloco}>`) bloco = null;
      continue;
    }
    if (!linha || linha.startsWith('#') || linha.startsWith(';')) continue;
    const abre = /^<([a-z0-9-]+)>$/i.exec(linha);
    if (abre) {
      const tag = (abre[1] ?? '').toLowerCase();
      // `<connection>` (vários servidores) traz diretivas comuns dentro: o filtro olha linha a linha, sem pular
      if (tag === 'connection') continue;
      if (!BLOCOS_OVPN.has(tag)) return { ok: false, erro: 'proibida', diretiva: `<${tag}>` };
      bloco = tag;
      continue;
    }
    if (/^<\/connection>$/i.test(linha)) continue;
    if (linha.startsWith('<')) return { ok: false, erro: 'invalido' };
    const partes = linha.split(/\s+/);
    const diretiva = (partes[0] ?? '').replace(/^--/, '').toLowerCase();
    const args = partes.slice(1).filter((a) => !a.startsWith('#') && !a.startsWith(';'));
    if (proibidas.has(diretiva) || diretiva.startsWith('management-') || diretiva.startsWith('plugin')) return { ok: false, erro: 'proibida', diretiva };
    if (comArquivo.has(diretiva)) {
      // `auth-user-pass` sem argumento = pede usuário e senha (a tela pergunta); com um arquivo, não
      if (args.length && !(args.length === 1 && args[0]?.toLowerCase() === '[inline]')) return { ok: false, erro: 'arquivo', diretiva };
      if (diretiva === 'auth-user-pass') pedeSenha = true;
      continue;
    }
    // o proxy com o arquivo da senha (o 3º argumento): só `auto`/`auto-nct`
    if ((diretiva === 'http-proxy' || diretiva === 'socks-proxy') && args.length >= 3 && !/^(auto|auto-nct)$/i.test(args[2] ?? '')) return { ok: false, erro: 'arquivo', diretiva };
    if (diretiva === 'remote') {
      temRemoto = true;
      const s = args[0];
      if (s && servidores.length < MAXIMO_SERVIDORES && !servidores.includes(s)) servidores.push(s);
    }
  }
  if (bloco) return { ok: false, erro: 'invalido' };
  if (!temRemoto) return { ok: false, erro: 'invalido' };
  return { ok: true, pedeSenha, servidores };
}

/** As chaves do `wg-quick` que rodam programa (o NetworkManager não as usa; a casca recusa por clareza). */
export const PROIBIDAS_WIREGUARD = ['preup', 'postup', 'predown', 'postdown', 'saveconfig'] as const;

/** O `.conf` do WireGuard: tem a `[Interface]` com a `PrivateKey` e ao menos um `[Peer]` com a `PublicKey`. */
export function filtrarWireguard(texto: string): FiltroVpn {
  if (texto.includes('\0')) return { ok: false, erro: 'invalido' };
  const proibidas = new Set<string>(PROIBIDAS_WIREGUARD);
  let secao = '';
  let chavePrivada = false;
  let pares = 0;
  let parComChave = 0;
  const servidores: string[] = [];
  const chave = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;
  for (const cru of texto.split(/\r?\n/)) {
    const linha = cru.replace(/#.*$/, '').trim();
    if (!linha) continue;
    const s = /^\[([A-Za-z]+)\]$/.exec(linha);
    if (s) {
      secao = (s[1] ?? '').toLowerCase();
      if (secao === 'peer') pares++;
      else if (secao !== 'interface') return { ok: false, erro: 'invalido' };
      continue;
    }
    const kv = /^([A-Za-z0-9]+)\s*=\s*(.*)$/.exec(linha);
    if (!kv || !secao) return { ok: false, erro: 'invalido' };
    const k = (kv[1] ?? '').toLowerCase();
    const v = (kv[2] ?? '').trim();
    if (proibidas.has(k)) return { ok: false, erro: 'proibida', diretiva: kv[1] ?? k };
    if (secao === 'interface' && k === 'privatekey' && chave.test(v)) chavePrivada = true;
    if (secao === 'peer' && k === 'publickey' && chave.test(v)) parComChave++;
    if (secao === 'peer' && k === 'endpoint') {
      const host = v.startsWith('[') ? v.slice(1, v.indexOf(']')) : v.replace(/:\d+$/, '');
      if (host && servidores.length < MAXIMO_SERVIDORES && !servidores.includes(host)) servidores.push(host);
    }
  }
  if (!chavePrivada || !pares || parComChave !== pares) return { ok: false, erro: 'invalido' };
  return { ok: true, pedeSenha: false, servidores };
}

/** O filtro pelo tipo. */
export const filtrarVpn = (tipo: TipoVpn, texto: string): FiltroVpn => (tipo === 'openvpn' ? filtrarOvpn(texto) : filtrarWireguard(texto));

/** Uma VPN para a decisão de ligar sozinha. */
export interface VpnParaLigar {
  nome: string;
  ligada: boolean;
  sozinha: boolean;
  /** Pede usuário e senha e ainda não há os dois guardados: não dá para ligar sem a pessoa. */
  faltaSenha: boolean;
}

/**
 * "Portal + VPN" (PLANO §7): a VPN que liga sozinha só liga depois que a internet chega de verdade (`internet`; no
 * hotel, primeiro o portal, depois a VPN). Uma VPN por vez: se alguma já está ligada, nada. A que a pessoa desligou à
 * mão neste boot não volta sozinha. Devolve o nome da que deve ligar agora, ou `null`.
 */
export function qualLigarSozinha(vpns: readonly VpnParaLigar[], conectividade: string, desligadasAMao: ReadonlySet<string>): string | null {
  if (conectividade !== 'internet') return null;
  if (vpns.some((v) => v.ligada)) return null;
  return vpns.find((v) => v.sozinha && !v.faltaSenha && !desligadasAMao.has(v.nome))?.nome ?? null;
}

/** Usuário de VPN que vai ao `vpn.data` do NetworkManager (sem vírgula, `=`, barra invertida nem controles). */
export const usuarioValido = (u: string): boolean => u.length >= 1 && u.length <= 128 && !/[,=\\\u0000-\u001f\u007f]/.test(u);
