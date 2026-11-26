#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# O DIAGNÓSTICO do Writer OS (15/11/2026: a tela preta no notebook de verdade). Roda como root
# (ekfrase-diagnostico.service), depois da partição de dados, e grava o que aconteceu no boot numa
# pasta que o Windows lê: EKFRASE-DADOS → "Ekfrase Writer/.diagnostico/<data>_<boot>/":
#   resumo.txt   versão, linha do kernel, placas de vídeo (driver, fabricante), módulos de vídeo,
#                firmware que faltou, o que a sessão contou (renderer, quedas do Cage), dados.json
#   journal.txt  journalctl -b (o boot inteiro: o Cage roda com -d, então os erros do EGL estão lá)
#   sessao.txt   só a sessão (Cage + o Writer)
#   dmesg.txt    o kernel
# Quando: aos 20 s, 60 s e 180 s de boot, depois a cada 10 min, e sempre que o Cage sai (uma linha
# nova em /run/ekfrase/sessao/quedas). Ficam só os 5 boots mais novos. Sem a partição de dados,
# não grava nada (nunca escreve em outro disco). Nada sai do pendrive: é para o Alcy plugar no
# Windows e o Claude ler.
# SEM REDES (Bloco F, 25/11/2026): a pasta fica em claro, então tudo passa pelo `ekfrase-sem-redes.pl`
# antes de ir ao disco: os nomes das redes Wi-Fi (as conhecidas e as que estão à vista) viram <rede>, e os
# endereços das placas (MAC, BSSID) viram xx:xx:xx:xx:xx:xx. Sem o filtro, não grava journal nem dmesg.
set -u
PATH=/usr/sbin:/usr/bin:/sbin:/bin
BASE="/dados/Ekfrase Writer/.diagnostico"
GUARDAR=5
SESSAO=/run/ekfrase/sessao
FILTRO=/usr/lib/ekfrase/ekfrase-sem-redes.pl
REDES=/run/ekfrase/diagnostico-redes
export REDES

ID=$(tr -d '-' < /proc/sys/kernel/random/boot_id | cut -c1-8)
PASTA="$BASE/$(date +%Y-%m-%d_%H%M%S)_$ID"
criada=0

preparar() {
  findmnt -n /dados >/dev/null 2>&1 || return 1
  [ "$criada" = 1 ] && [ -d "$PASTA" ] && return 0
  mkdir -p "$PASTA" || return 1
  criada=1
  # só os boots mais novos (o nome começa pela data)
  find "$BASE" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort | head -n "-$GUARDAR" |
    while IFS= read -r velha; do rm -rf "${BASE:?}/$velha"; done
  cat > "$BASE/LEIA-ME.txt" <<'FIM'
Diagnóstico do Ekfrase Writer OS: o que aconteceu em cada boot deste pendrive (o sistema, a placa de
vídeo, a sessão). Uma pasta por boot; ficam as 5 mais novas. Não tem nenhum texto seu: os textos
ficam cifrados em "Ekfrase Writer/dados". Os nomes das redes Wi-Fi e os endereços das placas de rede
saem daqui (aparecem como <rede> e xx:xx:xx:xx:xx:xx). Pode apagar esta pasta quando quiser.
FIM
}

placas() {
  for c in /sys/class/drm/card[0-9]; do
    [ -e "$c/device" ] || continue
    drv=$(basename "$(readlink -f "$c/device/driver" 2>/dev/null)" 2>/dev/null)
    printf '%s driver=%s vendor=%s device=%s\n' "$(basename "$c")" "${drv:-?}" \
      "$(cat "$c/device/vendor" 2>/dev/null)" "$(cat "$c/device/device" 2>/dev/null)"
  done
  for c in /sys/class/drm/card[0-9]-*; do
    [ -e "$c/status" ] && printf '  %s %s %s\n' "$(basename "$c")" "$(cat "$c/status")" "$(cat "$c/enabled" 2>/dev/null)"
  done
  ls -l /dev/dri 2>&1
}

# os nomes de rede que o NetworkManager conhece agora (perfis e as redes à vista), um por linha, só para o filtro
nomes_de_rede() {
  ( umask 077
    { nmcli -g NAME connection show 2>/dev/null   # a casca dá à conexão o nome da rede (sistema.ts)
      nmcli -g SSID device wifi list --rescan no 2>/dev/null
      cat /run/ekfrase/vpn-servidores 2>/dev/null   # os servidores das VPNs (o ekfrase-vpn.sh anota; W4)
    } | grep -v '^$' | sort -u > "$REDES.tmp" && mv -f "$REDES.tmp" "$REDES" )
}

# O QUE A SESSÃO (O WRITER) ESCREVEU (achado 2 da revisão de segurança, 25/11): a pasta é do writer, então o root
# nunca segue um link dela (O_NOFOLLOW), não espera num FIFO (O_NONBLOCK + timeout), só lê arquivo comum e no máximo
# 64 KB. Sem isso, um link para /dev/nvme0n1p3 copiava o disco interno para o pendrive, em claro.
da_sessao() {
  timeout 5 perl -e 'use Fcntl; sysopen(my $f, $ARGV[0], O_RDONLY | O_NOFOLLOW | O_NONBLOCK) or exit 1;
    -f $f or exit 1; my $b = ""; sysread($f, $b, 65536); print $b;' -- "$SESSAO/$1" 2>/dev/null
}

# o filtro; sem perl ou sem o filtro, nada passa
limpar() {
  if [ -r "$FILTRO" ] && command -v perl >/dev/null 2>&1; then perl "$FILTRO"; else cat >/dev/null; echo "(sem o filtro de redes: não gravado)"; fi
}

fotografar() {
  preparar || return 0
  nomes_de_rede
  {
    echo "motivo: $1"
    echo "agora: $(date -Is)  ligado há: $(cut -d' ' -f1 /proc/uptime) s"
    echo "versao: $(cat /etc/ekfrase/versao 2>/dev/null)"
    echo "kernel: $(uname -r)"
    echo "cmdline: $(cat /proc/cmdline)"
    echo "maquina: $(cat /sys/class/dmi/id/sys_vendor /sys/class/dmi/id/product_name /sys/class/dmi/id/product_version 2>/dev/null | tr '\n' ' ')"
    echo "bios: $(cat /sys/class/dmi/id/bios_version /sys/class/dmi/id/bios_date 2>/dev/null | tr '\n' ' ')"
    echo "secureboot: $(od -An -t u1 -j4 -N1 /sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c 2>/dev/null | tr -d ' ')"
    # o relógio da placa: LOCAL (como o Windows) e nunca gravado (18/11); o kernel diz a hora que leu dele
    echo "relogio: placa=$(sed -n 3p /etc/adjtime 2>/dev/null) fuso=$(readlink /etc/localtime | sed 's|.*/zoneinfo/||') agora=$(date '+%F %T %z')"
    echo "memoria:$(grep -E '^(MemTotal|MemAvailable)' /proc/meminfo | tr -s ' ' | tr '\n' ' ')"
    echo
    echo "== placas de vídeo"
    placas
    echo
    echo "== módulos de vídeo"
    lsmod 2>/dev/null | grep -E '^(i915|xe|amdgpu|radeon|nouveau|simpledrm|virtio_gpu|efifb|drm) ' || echo "(nenhum)"
    echo
    echo "== firmware que faltou ou falhou (dmesg)"
    dmesg 2>/dev/null | grep -iE 'firmware|fw:|guc|huc|dmc' | grep -iE 'fail|error|missing|not found|-2' | tail -n 40 || true
    echo
    echo "== a sessão"
    echo "renderer: $(da_sessao renderer || echo '?')"
    echo "quedas do Cage (hora código segundos renderer):"
    da_sessao quedas || echo "(nenhuma)"
    echo "dados.json: $(cat /run/ekfrase/dados.json 2>/dev/null)"
    echo
    echo "== serviços que falharam"
    systemctl --failed --no-pager --no-legend 2>&1
  } 2>&1 | limpar > "$PASTA/resumo.txt.tmp"
  journalctl -b --no-pager -o short-monotonic 2>&1 | tail -n 40000 | limpar > "$PASTA/journal.txt.tmp"
  journalctl -b --no-pager -o short-monotonic -u ekfrase-sessao.service 2>&1 | tail -n 8000 | limpar > "$PASTA/sessao.txt.tmp"
  dmesg 2>&1 | limpar > "$PASTA/dmesg.txt.tmp"
  for f in resumo journal sessao dmesg; do mv -f "$PASTA/$f.txt.tmp" "$PASTA/$f.txt"; done
  sync -f "$PASTA/resumo.txt" 2>/dev/null || sync
  echo "ekfrase-diagnostico: gravado ($1) em $PASTA"
}

PROXIMOS=(20 60 180)
quedas_vistas=0
proximo=${PROXIMOS[0]}
i=0
while true; do
  agora=$(cut -d. -f1 /proc/uptime)
  n=$(da_sessao quedas | wc -l)
  if [ "$n" -gt "$quedas_vistas" ]; then
    quedas_vistas=$n
    fotografar "o Cage saiu ($n)"
  elif [ "$agora" -ge "$proximo" ]; then
    fotografar "${agora} s de boot"
    i=$((i + 1))
    if [ "$i" -lt "${#PROXIMOS[@]}" ]; then proximo=${PROXIMOS[$i]}; else proximo=$((agora + 600)); fi
  fi
  sleep 5
done
