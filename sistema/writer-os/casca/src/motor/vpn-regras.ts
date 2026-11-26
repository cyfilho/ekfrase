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

// ---------- a VPN de empresa (W5a; PLANO §7, "VPN de empresa"): Cisco AnyConnect, Palo Alto GlobalProtect e Fortinet ----------
// Não há arquivo: a pessoa diz o tipo, o servidor, o usuário e a senha. A casca autentica como writer
// (`openconnect --authenticate`, sem túnel nem root) e passa o cookie ao NetworkManager pelo `passwd-file`; quem cria a
// conexão é o `ekfrase-vpn.sh` (root), com a mesma regra do servidor.

/** Os protocolos do openconnect que a tela oferece (AnyConnect da Cisco, GlobalProtect da Palo Alto, Fortinet). */
export const PROTOCOLOS_VPN = ['anyconnect', 'gp', 'fortinet'] as const;
export type ProtocoloVpn = (typeof PROTOCOLOS_VPN)[number];
export const protocoloValido = (p: unknown): p is ProtocoloVpn => typeof p === 'string' && (PROTOCOLOS_VPN as readonly string[]).includes(p);

/**
 * O servidor: um nome (rótulos de letras sem acento, números e `-`) ou um IPv4, ou um IPv6 entre colchetes; `:porta` e
 * `/grupo` (o "grupo" da URL do AnyConnect) opcionais. O MESMO texto está no `ekfrase-vpn.sh` (`SERVIDOR=`): o
 * `tests/casca.test.ts` compara. Sem espaço, sem `-` no começo, sem `https://` (a tela tira antes).
 */
export const SERVIDOR_VPN = String.raw`^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]{2,45}\])(:([0-9]{1,5}))?(/[A-Za-z0-9._~/-]{1,64})?$`;
const RE_SERVIDOR = new RegExp(SERVIDOR_VPN);

/** O servidor que a casca e o serviço aceitam (o nome até 253, a porta de 1 a 65535, sem zero à esquerda). */
export function servidorValido(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > 330) return false;
  const m = RE_SERVIDOR.exec(s);
  if (!m) return false;
  if ((m[1] ?? '').length > 253) return false;
  const porta = m[6];
  return porta === undefined || (/^[1-9][0-9]{0,4}$/.test(porta) && Number(porta) <= 65535);
}

/** O que a pessoa colou, do jeito que o serviço aceita: sem espaços nas pontas, sem `https://` e sem a `/` do fim. */
export function limparServidor(s: string): string {
  return s.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/** O nome do servidor (sem a porta nem o grupo, sem os colchetes do IPv6): vai ao `/run/ekfrase/vpn-servidores`. */
export function hostDoServidor(s: string): string {
  const m = RE_SERVIDOR.exec(s);
  return (m?.[1] ?? s).replace(/^\[|\]$/g, '');
}

/** O nome da conexão de uma VPN de empresa: o do servidor, como o `nomeDaVpn` faria com um arquivo (até 15, sem repetir). */
export const nomeDaVpnEmpresa = (servidor: string, existentes: readonly string[]): string =>
  nomeDaVpn(`${hostDoServidor(servidor).replace(/[.:]/g, '-')}.vpn`, existentes);

/** A impressão do certificado que o `--servercert` aceita (a que o openconnect sugere: `pin-sha256:` + SHA-256 em base64). */
export const IMPRESSAO_VPN = /^pin-sha256:[A-Za-z0-9+/]{43}=$/;

/** A impressão do `autoassinado.exemplo.local` do sistema simulado (os roteiros conferem que a tela a mostra). */
export const IMPRESSAO_SIMULADA = 'pin-sha256:EkfraseWriterOSsimuladoAutoassinado01234567=';

/** O código do segundo fator (o do aplicativo, do SMS ou do token): sem espaço nem controle, até 64. */
export const codigoValido = (c: unknown): c is string => typeof c === 'string' && /^[\x21-\x7e]{1,64}$/.test(c);

/** O que o `openconnect --authenticate` imprime (como atribuições de shell) e a casca passa ao NetworkManager. */
export interface Autenticacao {
  cookie: string;
  /** O servidor para o túnel: o `CONNECT_URL` (com a porta e o grupo) ou, sem ele, o `HOST`. */
  gateway: string;
  /** O certificado do servidor (`FINGERPRINT`), que o túnel exige igual (`--servercert`). */
  gwcert: string;
  resolve: string | null;
}

/**
 * Lê a saída do `openconnect --authenticate`: só as linhas `NOME='valor'` dos cinco nomes (`COOKIE`, `HOST`,
 * `CONNECT_URL`, `FINGERPRINT`, `RESOLVE`), desfazendo o `'\''` das aspas; qualquer outra coisa é ignorada. Sem o
 * cookie, o servidor ou o certificado, `null`.
 */
export function lerAutenticacao(saida: string): Autenticacao | null {
  const v = new Map<string, string>();
  for (const linha of saida.split(/\r?\n/)) {
    const m = /^(COOKIE|HOST|CONNECT_URL|FINGERPRINT|RESOLVE)='((?:[^']|'\\'')*)'$/.exec(linha);
    if (!m?.[1] || v.has(m[1])) continue;
    const valor = (m[2] ?? '').replace(/'\\''/g, "'");
    // nada de quebra de linha nem controle: o valor vai a uma linha do passwd-file
    if (!valor || /[\u0000-\u001f\u007f]/.test(valor) || valor.length > 8192) continue;
    v.set(m[1], valor);
  }
  const cookie = v.get('COOKIE');
  const gateway = v.get('CONNECT_URL') ?? v.get('HOST');
  const gwcert = v.get('FINGERPRINT');
  if (!cookie || !gateway || !gwcert) return null;
  return { cookie, gateway, gwcert, resolve: v.get('RESOLVE') ?? null };
}

export type ErroOpenconnect = 'certificado' | 'senha' | 'segundo-fator' | 'servidor' | 'sso' | 'falhou';

/**
 * O que deu errado, pelo que o openconnect escreveu no stderr (com `LC_ALL=C`, em inglês):
 * - `certificado`: o sistema não conhece o certificado do servidor; o openconnect sugere `--servercert pin-sha256:…`,
 *   que volta como `impressao` (a tela mostra, "confira com a TI", e "Confiar" liga com ele);
 * - `sso`: o servidor só aceita o login pelo navegador (SAML), que o Writer OS não tem (o limite do PLANO);
 * - `senha`: usuário, senha ou código recusados;
 * - `segundo-fator`: a senha passou e o servidor pediu mais um campo (o código), que não havia (`--non-inter`);
 * - `servidor`: o servidor não respondeu (nome que não existe, porta fechada, sem internet);
 * - `falhou`: o resto.
 */
export function erroDoOpenconnect(stderr: string, comCodigo: boolean): { erro: ErroOpenconnect; impressao?: string } {
  const pin = /--servercert\s+(pin-sha256:[A-Za-z0-9+/]{43}=)/.exec(stderr)?.[1];
  if (pin) return { erro: 'certificado', impressao: pin };
  if (/\bSAML\b|single sign-on|external browser|\bSSO\b/i.test(stderr)) return { erro: 'sso' };
  const recusou = /login failed|authentication failed|auth(?:entication)? (?:error|rejected)|invalid (?:user|password|credential|login)|incorrect|access denied|wrong password|bad password|password (?:is )?incorrect|login error|unauthori[sz]ed/i.test(stderr);
  if (recusou) return { erro: 'senha' };
  if (/User input required in non-interactive mode/i.test(stderr)) return { erro: comCodigo ? 'senha' : 'segundo-fator' };
  if (/Failed to (?:connect to|open HTTPS connection|reconnect)|getaddrinfo failed|Failed to resolve|Connection refused|Connection timed out|timed out|No route to host|Network is unreachable|SSL connection failure|Failed to establish/i.test(stderr)) return { erro: 'servidor' };
  return { erro: 'falhou' };
}
