#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# IMPORTAR UMA VPN (PLANO §7, "VPN"; W4, parte 2c). Roda como root, um pedido por conexão (ekfrase-vpn.socket,
# Accept=yes: a entrada e a saída são o próprio socket, que só o grupo writer abre), sem shell para ninguém.
#
# Por que existe: o `nmcli connection import` cria a conexão SEM dono, e o polkit do Writer OS só deixa o writer
# mexer nas conexões DELE (`settings.modify.own`; o `modify.system` é negado de propósito). Então quem importa é
# este serviço, que depois dá a conexão ao writer (`connection.permissions user:writer`) e desliga o "ligar sozinha"
# do NetworkManager (quem liga sozinha é a casca, depois do portal). Ligar, desligar e esquecer, o writer faz.
#
# Lê UMA linha e só aceita, por expressão exata:
#
#   importar <wireguard|openvpn> <nome> <o arquivo em base64>
#
# <nome>: letras sem acento, números, - e _, até 15 (o mesmo NOME_VPN de casca/src/motor/vpn-regras.ts); o arquivo,
# até 64 kB. O arquivo é conferido de novo aqui, pela MESMA lista da casca (o tests/casca.test.ts compara):
# nada que rode programa ou leia arquivo do sistema (o openvpn roda como root), e no WireGuard nada de PostUp e afins.
# Os servidores (o `remote` e o `Endpoint`) vão para /run/ekfrase/vpn-servidores (só root lê): o diagnóstico os tira.
#
# E, para a VPN de empresa (W5a; PLANO §7, "VPN de empresa"), sem arquivo:
#
#   criar openconnect <nome> <anyconnect|gp|fortinet> <servidor>
#
# <servidor>: a MESMA expressão de `SERVIDOR_VPN` em casca/src/motor/vpn-regras.ts (o teste compara): um nome ou um IPv4
# ou um [IPv6], `:porta` e `/grupo` opcionais. O `vpn.data` é uma lista fechada (o servidor, o protocolo e os segredos
# que o NetworkManager pede a cada vez: o cookie, o servidor e o certificado vêm do `openconnect --authenticate` que a
# casca roda como writer); nada de `csd_wrapper`, `--script` nem certificado de arquivo.
#
# Saída: `ok` | `erro <tipo|nome|grande|proibida|arquivo|existe|importar|dono|pedido|servidor>`.
set -u
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C
umask 077

PROIBIDAS='up|down|script-security|plugin|route-up|route-pre-down|ipchange|tls-verify|auth-user-pass-verify|learn-address|client-connect|client-disconnect|management|config|cd|chroot|daemon|log|log-append|writepid|status|iproute|tmp-dir|replay-persist|tls-export-cert|client-config-dir|ifconfig-pool-persist|dev-node'
ARQUIVOS='ca|cert|key|tls-auth|tls-crypt|tls-crypt-v2|extra-certs|pkcs12|dh|secret|crl-verify|capath|askpass|auth-user-pass|http-proxy-user-pass'
PROIBIDAS_WG='preup|postup|predown|postdown|saveconfig'
SERVIDORES=/run/ekfrase/vpn-servidores
MAXIMO=65536
# o servidor da VPN de empresa (o MESMO texto de SERVIDOR_VPN em casca/src/motor/vpn-regras.ts)
SERVIDOR='^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]{2,45}\])(:([0-9]{1,5}))?(/[A-Za-z0-9._~/-]{1,64})?$'

diario() { echo "ekfrase-vpn: $*" >&2; }
erro() {
  diario "erro $1"
  echo "erro $1"
  exit 0
}

# anota um servidor em /run/ekfrase/vpn-servidores (o diagnóstico tira os que estão lá)
anotar_servidores() {
  [ -n "$1" ] || return 0
  { cat "$SERVIDORES" 2>/dev/null; printf '%s\n' "$1"; } | tr -d '\000-\011\013-\037' | grep -v '^$' | sort -u | head -200 > "$SERVIDORES.novo" \
    && chmod 0600 "$SERVIDORES.novo" && mv -f "$SERVIDORES.novo" "$SERVIDORES"
}

# a linha: até ~90 kB (64 kB em base64), nada de ler sem fim
IFS= read -r -n 100000 linha || true
linha=${linha%$'\r'}

# ---------- a VPN de empresa: criar a conexão do openconnect (sem arquivo) ----------
if [[ $linha =~ ^criar\ openconnect\ ([A-Za-z0-9_-]{1,15})\ (anyconnect|gp|fortinet)\ ([^[:space:]]{1,330})$ ]]; then
  nome=${BASH_REMATCH[1]}
  protocolo=${BASH_REMATCH[2]}
  servidor=${BASH_REMATCH[3]}
  [[ $servidor =~ $SERVIDOR ]] || erro servidor
  host=${BASH_REMATCH[1]}
  porta=${BASH_REMATCH[6]}
  [ "${#host}" -le 253 ] || erro servidor
  if [ -n "$porta" ]; then
    # sem zero à esquerda (o bash leria 0800 como octal)
    [[ $porta =~ ^[1-9][0-9]{0,4}$ ]] && [ "$porta" -le 65535 ] || erro servidor
  fi
  if nmcli -g NAME connection show 2>/dev/null | grep -Fxq -- "$nome"; then erro existe; fi
  # os três segredos com a marca 2 ("não guardar"): o NetworkManager os pede a cada vez, e o nmcli da casca os dá
  # (o passwd-file); a conexão já nasce do writer e sem ligar sozinha
  saida=$(nmcli connection add type vpn vpn-type openconnect con-name "$nome" \
    vpn.data "gateway=$servidor,protocol=$protocolo,cookie-flags=2,gateway-flags=2,gwcert-flags=2" \
    connection.permissions user:writer connection.autoconnect no 2>&1)
  uuid=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<< "$saida" | head -1)
  if [ -z "$uuid" ]; then
    diario "nmcli: $(head -c 300 <<< "$saida" | tr -d '\000-\011\013-\037')"
    erro importar
  fi
  host=${host#[}
  anotar_servidores "${host%]}"
  diario "criou openconnect $protocolo $nome"
  echo ok
  exit 0
fi
# (o bash não aceita repetição acima de 255 na expressão: o tamanho do base64 é conferido à parte)
[[ $linha =~ ^importar\ (wireguard|openvpn)\ ([A-Za-z0-9_-]{1,15})\ ([A-Za-z0-9+/=]+)$ ]] || erro pedido
tipo=${BASH_REMATCH[1]}
nome=${BASH_REMATCH[2]}
b64=${BASH_REMATCH[3]}
[ "${#b64}" -le 90000 ] || erro grande

# o /tmp é só deste pedido (PrivateTmp; o resto do sistema é só leitura: ProtectSystem=strict)
PASTA=$(mktemp -d /tmp/ekfrase-vpn.XXXXXXXX) || erro importar
trap 'rm -rf "$PASTA"' EXIT
ext=conf
[ "$tipo" = openvpn ] && ext=ovpn
# o nome do arquivo vira o nome da conexão (e, no WireGuard, o da placa de rede)
ARQ="$PASTA/$nome.$ext"
printf '%s' "$b64" | base64 -d > "$ARQ" 2>/dev/null || erro importar
tamanho=$(stat -c %s "$ARQ")
[ "$tamanho" -gt 0 ] && [ "$tamanho" -le "$MAXIMO" ] || erro grande
# nada de NUL (o texto chega inteiro ao grep)
[ "$(tr -d '\000' < "$ARQ" | wc -c)" = "$tamanho" ] || erro importar

if [ "$tipo" = openvpn ]; then
  # as linhas fora dos blocos <ca>…</ca> (dentro deles só há o certificado, em base64)
  diretivas=$(sed -e 's/\r$//' -e '/^[[:space:]]*<\(ca\|cert\|key\|tls-auth\|tls-crypt\|tls-crypt-v2\|extra-certs\|pkcs12\|dh\|secret\|crl-verify\)>[[:space:]]*$/I,/^[[:space:]]*<\/\(ca\|cert\|key\|tls-auth\|tls-crypt\|tls-crypt-v2\|extra-certs\|pkcs12\|dh\|secret\|crl-verify\)>[[:space:]]*$/Id' "$ARQ" \
    | sed -e 's/^[[:space:]]*//' -e '/^[#;]/d' -e '/^$/d')
  if grep -Eiq "^(--)?(${PROIBIDAS}|management-[a-z-]*|plugin[a-z-]*)([[:space:]]|$)" <<< "$diretivas"; then erro proibida; fi
  # outro bloco que não os dos certificados (nem o <connection>, que só agrupa diretivas comuns)
  if grep -Eiv '^</?connection>[[:space:]]*$' <<< "$diretivas" | grep -q '^<'; then erro proibida; fi
  if grep -Ei "^(--)?(${ARQUIVOS})[[:space:]]+[^#;[:space:]]" <<< "$diretivas" | grep -Eivq "^(--)?[a-z0-9-]+[[:space:]]+\[inline\][[:space:]]*([#;].*)?$"; then erro arquivo; fi
  if grep -Ei '^(--)?(http-proxy|socks-proxy)[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^#;[:space:]]' <<< "$diretivas" | grep -Eivq '[[:space:]](auto|auto-nct)([[:space:]]|$)'; then erro arquivo; fi
  servidores=$(grep -Ei '^(--)?remote[[:space:]]+' <<< "$diretivas" | awk '{print $2}')
else
  if sed -e 's/#.*$//' "$ARQ" | grep -Eiq "^[[:space:]]*(${PROIBIDAS_WG})[[:space:]]*="; then erro proibida; fi
  servidores=$(sed -e 's/#.*$//' "$ARQ" | grep -Ei '^[[:space:]]*endpoint[[:space:]]*=' | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*$//; s/^\[([^]]*)\].*$/\1/; s/:[0-9]+$//')
fi

if nmcli -g NAME connection show 2>/dev/null | grep -Fxq -- "$nome"; then erro existe; fi

saida=$(nmcli connection import type "$tipo" file "$ARQ" 2>&1)
uuid=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<< "$saida" | head -1)
if [ -z "$uuid" ]; then
  diario "nmcli: $(head -c 300 <<< "$saida" | tr -d '\000-\011\013-\037')"
  erro importar
fi
# a conexão passa a ser do writer, e o NetworkManager não a liga sozinho (quem liga é a casca, depois do portal)
if ! nmcli connection modify uuid "$uuid" connection.permissions user:writer connection.autoconnect no >/dev/null 2>&1; then
  nmcli connection delete uuid "$uuid" >/dev/null 2>&1
  erro dono
fi
# o WireGuard importado pode ter ligado antes da troca acima
nmcli connection down uuid "$uuid" >/dev/null 2>&1 || true

anotar_servidores "$servidores"
diario "importou $tipo $nome"
echo ok
