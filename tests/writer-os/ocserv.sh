#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# A VPN DE EMPRESA NO CI (W5a; docs/writer/PLANO.md §7, "VPN de empresa"): dois ocserv de verdade (o servidor do
# AnyConnect, livre) no computador que roda o QEMU, para o tests/writer-os/qemu.py (teste_vpn_empresa):
#   - porta 4443: usuário e senha (o `plain`), certificado autoassinado (a casca tem de devolver `certificado`);
#   - porta 4444: o mesmo, mais o código TOTP (`otp=`; o segundo fator).
# Sem UDP (só o túnel pelo TLS), sem banir por senha errada (o teste erra de propósito). Tudo sorteado a cada vez e
# só para o teste: nada disto vale fora do runner.
#
# Uso (como root): bash tests/writer-os/ocserv.sh <pasta>   →   <pasta>/vpn-empresa.json (o EKFRASE_QEMU_VPN do qemu.py)
set -euo pipefail
P=$(realpath -m "$1")
mkdir -p "$P"
chmod 0755 "$P"

# o certificado autoassinado e a impressão que o openconnect sugere (`--servercert pin-sha256:…`)
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$P/chave.pem" -out "$P/cert.pem" -days 2 -subj /CN=vpn.teste.local 2>/dev/null
PIN="pin-sha256:$(openssl x509 -in "$P/cert.pem" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)"

SENHA=$(openssl rand -hex 12)
SENHA2=$(openssl rand -hex 12)
TOTP=$(openssl rand -hex 20)
printf 'vpnteste:*:%s\n' "$(openssl passwd -6 "$SENHA")" > "$P/passwd"
printf 'dois:*:%s\n' "$(openssl passwd -6 "$SENHA2")" > "$P/passwd2"
printf 'HOTP/T30 dois - %s\n' "$TOTP" > "$P/otp"

# conf <nome> <porta> <auth> <rede (o 3º número)>
conf() {
  cat > "$P/$1.conf" <<FIM
auth = "$3"
tcp-port = $2
socket-file = /run/ocserv-$1.socket
pid-file = /run/ocserv-$1.pid
server-cert = $P/cert.pem
server-key = $P/chave.pem
run-as-user = nobody
run-as-group = nogroup
isolate-workers = false
max-clients = 16
max-same-clients = 16
keepalive = 300
dpd = 60
mobile-dpd = 300
try-mtu-discovery = false
tls-priorities = "NORMAL:%SERVER_PRECEDENCE"
auth-timeout = 240
min-reauth-time = 0
max-ban-score = 0
cookie-timeout = 300
deny-roaming = false
rekey-time = 172800
rekey-method = ssl
use-occtl = false
device = oc$1
predictable-ips = true
ipv4-network = 192.168.$4.0
ipv4-netmask = 255.255.255.0
route = 192.168.$4.0/255.255.255.0
cisco-client-compat = true
FIM
}
conf senha 4443 "plain[passwd=$P/passwd]" 99
conf codigo 4444 "plain[passwd=$P/passwd2,otp=$P/otp]" 98

# o ocserv do pacote (na 443) não é o deste teste
systemctl stop ocserv.service ocserv.socket 2>/dev/null || true
for n in senha codigo; do
  ocserv -c "$P/$n.conf"
done
for porta in 4443 4444; do
  for _ in $(seq 1 30); do
    (exec 3<>"/dev/tcp/127.0.0.1/$porta") 2>/dev/null && break
    sleep 1
  done
  (exec 3<>"/dev/tcp/127.0.0.1/$porta") 2>/dev/null || { echo "o ocserv não abriu a porta $porta"; exit 1; }
done

jq -n --arg pin "$PIN" --arg senha "$SENHA" --arg senha2 "$SENHA2" --arg totp "$TOTP" \
  '{porta: 4443, porta2: 4444, usuario: "vpnteste", senha: $senha, usuario2: "dois", senha2: $senha2, totp: $totp, pin: $pin}' \
  > "$P/vpn-empresa.json"
chmod 0644 "$P/vpn-empresa.json"
echo "ocserv: 4443 (senha) e 4444 (senha + código), $PIN"
