#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# SÓ na imagem de teste. Escreve na serial (ttyS0) linhas "EKFRASE <evento>" que o
# tests/writer-os/qemu.py confere:
#   boot · dados {…} · particao ok <fs> | particao falta · sobrou <programa> · suid <arquivo> ·
#   binarios conferidos · grupos <…> · shell-root <…> · root <L|P|NP> · secureboot <1|0|?> · escrita <bytes> <bytes> ·
#   lado <live|live-b> <versão>
# e depois, uma por uma, as linhas do agente de teste da casca (tela …, texto ok, gravado N…).
set -u
PATH=/usr/sbin:/usr/bin:/sbin:/bin
S=/dev/ttyS0
dizer() { printf 'EKFRASE %s\n' "$*" > "$S"; }

dizer boot
dizer "dados $(tr -d '\n' < /run/ekfrase/dados.json 2>/dev/null)"
if lsblk -nro PARTLABEL | grep -qx EKFRASE-DADOS && findmnt -n /dados >/dev/null; then
  dizer "particao ok $(findmnt -no FSTYPE /dados)"
else
  dizer "particao falta"
fi
for b in sudo su doas pkexec login agetty getty sulogin apt apt-get dpkg; do
  if command -v "$b" >/dev/null 2>&1; then dizer "sobrou $b"; fi
done
find / -xdev -type f -perm /6000 2>/dev/null | while IFS= read -r f; do dizer "suid $f"; done
dizer "binarios conferidos"
dizer "grupos $(id -nG writer)"
dizer "shell-root $(getent passwd root | cut -d: -f7)"
dizer "root $(passwd -S root 2>/dev/null | awk '{print $2}')"
SB=$(od -An -t u1 -j4 -N1 /sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c 2>/dev/null | tr -d ' ')
dizer "secureboot ${SB:-?}"
# o limite do que espera na memória para ir ao disco (raiz/etc/sysctl.d/90-ekfrase.conf): escrita <dirty_bytes> <dirty_background_bytes>
dizer "escrita $(cat /proc/sys/vm/dirty_bytes) $(cat /proc/sys/vm/dirty_background_bytes)"

# O live-boot (P3b): o live-media que o GRUB passou e a partição montada em /run/live/medium (têm de ser a mesma:
# "midia <live-media> = <partição> | midia <live-media> != <partição>"), e o segundo em que o squashfs do sistema
# montou (o loop0; no notebook, 39 s antes do P3b)
MIDIA=$(tr ' ' '\n' < /proc/cmdline | sed -n 's/^live-media=//p')
MONTADA=$(findmnt -no SOURCE /run/live/medium 2>/dev/null)
if [ -n "$MIDIA" ] && [ "$(readlink -f "$MIDIA")" = "$(readlink -f "$MONTADA")" ]; then dizer "midia $MIDIA = $MONTADA"; else dizer "midia ${MIDIA:-nenhum} != ${MONTADA:-nada}"; fi
# a cópia do sistema que ligou (A = live, B = live-b; docs/ATUALIZACOES.md §4) e a versão dela
LADO=$(tr ' ' '\n' < /proc/cmdline | sed -n 's|^live-media-path=/||p')
dizer "lado ${LADO:-?} $(cat "/run/live/medium/${LADO:-live}/versao" 2>/dev/null || echo '?')"
dizer "medida squashfs-montado $(dmesg | sed -n 's/^\[ *\([0-9.]*\)\] loop0: detected capacity.*/\1/p' | head -1)"

# O tempo do boot (só informa; o qemu.py mostra no log do CI): "tempo …" = o systemd-analyze, as 10
# unidades mais lentas e a corrente até a sessão. É a base para otimizar o boot com números.
(
  for _ in $(seq 1 120); do systemctl is-active -q ekfrase-sessao.service && break; sleep 1; done
  sleep 5
  systemd-analyze time 2>/dev/null | head -1 | while IFS= read -r l; do dizer "tempo $l"; done
  systemd-analyze blame 2>/dev/null | head -10 | while IFS= read -r l; do dizer "tempo blame $l"; done
  systemd-analyze critical-chain ekfrase-sessao.service 2>/dev/null | tail -n +3 | head -12 | while IFS= read -r l; do dizer "tempo cadeia $l"; done
) &

# A placa de vídeo e o diagnóstico, em paralelo (o relato do agente segue abaixo):
#   gpu <pedido|nao> · cage <egl-mesa|sem-egl-mesa|nenhum> · renderer <auto|pixman> · quedas <N> ·
#   diagnostico <ok|falta>
achar_cage() { for d in /proc/[0-9]*; do [ "$(cat "$d/comm" 2>/dev/null)" = cage ] && { echo "${d#/proc/}"; return; }; done; }
(
  if [ -e /run/ekfrase/teste/gpu ]; then dizer "gpu pedido"; else dizer "gpu nao"; fi
  for _ in $(seq 1 180); do [ -n "$(achar_cage)" ] && break; sleep 1; done
  sleep 25
  p=$(achar_cage)
  if [ -z "$p" ]; then dizer "cage nenhum"
  elif grep -q 'libEGL_mesa' "/proc/$p/maps" 2>/dev/null; then dizer "cage egl-mesa"
  else dizer "cage sem-egl-mesa"; fi
  dizer "renderer $(cat /run/ekfrase/sessao/renderer 2>/dev/null || echo '?')"
  dizer "quedas $(wc -l < /run/ekfrase/sessao/quedas 2>/dev/null || echo 0)"
  for _ in $(seq 1 60); do
    if ls /dados/'Ekfrase Writer'/.diagnostico/*/resumo.txt >/dev/null 2>&1; then dizer "diagnostico ok"; exit 0; fi
    sleep 2
  done
  dizer "diagnostico falta"
) &

# O Num Lock e o brilho (pedidos de 18/11): numlock <ligado|desligado|sem-teclado|sem-cage|sem-uinput|falta>
# (o que o ekfrase-numlock contou) · brilho <sem-luz|N de M> (a máquina virtual não tem luz de tela)
(
  for _ in $(seq 1 240); do [ -s /run/ekfrase/sessao/numlock ] && break; sleep 1; done
  dizer "numlock $(cat /run/ekfrase/sessao/numlock 2>/dev/null || echo falta)"
  luz=
  for d in /sys/class/backlight/*; do [ -r "$d/brightness" ] && luz="$(cat "$d/brightness") de $(cat "$d/max_brightness")"; done
  dizer "brilho ${luz:-sem-luz}"
) &

# As medidas (P3, 18/11: o Electron contra o Cog, com os mesmos números): "medida …"
#   janela <s desde o boot> <s desde a sessão>: quando a casca avisou que a janela apareceu (/run/ekfrase/sessao/pronta)
#   memoria <quando> usada <MB> pss <MB> [<processo>=<MB>…]: o sistema todo (MemTotal − MemAvailable) e o PSS dos
#   processos do writer (a sessão: o Cage, o navegador e o resto), 30 s e 150 s depois da janela
#   disco <MB> squashfs <MB>: a casca em /opt/ekfrase-writer e o sistema inteiro
medir_memoria() {
  usada=$(awk '/^MemTotal/{t=$2} /^MemAvailable/{a=$2} END{printf "%d", (t-a)/1024}' /proc/meminfo)
  uid=$(id -u writer)
  pss=$(for d in /proc/[0-9]*; do
    [ "$(stat -c %u "$d" 2>/dev/null)" = "$uid" ] || continue
    k=$(awk '/^Pss:/{print $2}' "$d/smaps_rollup" 2>/dev/null)
    [ -n "$k" ] && printf '%s %s\n' "$(cat "$d/comm" 2>/dev/null | tr ' ' '_')" "$k"
  done | awk '{s[$1]+=$2; t+=$2} END{printf "%d", t/1024; for (c in s) if (s[c] >= 5120) printf " %s=%d", c, s[c]/1024}')
  dizer "medida memoria $1 usada ${usada} pss ${pss}"
}
(
  for _ in $(seq 1 150); do [ -e /run/ekfrase/sessao/pronta ] && break; sleep 1; done
  if [ -e /run/ekfrase/sessao/pronta ]; then
    agora=$(date +%s.%N); up=$(cut -d' ' -f1 /proc/uptime); pronta=$(date -r /run/ekfrase/sessao/pronta +%s.%N)
    ini=$(systemctl show -p ActiveEnterTimestampMonotonic --value ekfrase-sessao.service)
    dizer "$(awk -v a="$agora" -v u="$up" -v p="$pronta" -v i="$ini" 'BEGIN{t=u-(a-p); printf "medida janela %.1f %.1f", t, t-i/1e6}')"
  else
    dizer "medida janela falta"
    # a janela não apareceu: o que a sessão (o Cage, o serviço do Writer, o Cog) escreveu vai para a serial
    journalctl -b _UID=1000 --no-pager -o cat 2>/dev/null | grep -v "^agente" | tail -n 70 | while IFS= read -r l; do dizer "diario $l"; done
  fi
  dizer "medida disco $(du -sm /opt/ekfrase-writer 2>/dev/null | cut -f1) squashfs $(du -m "/run/live/medium/${LADO:-live}/filesystem.squashfs" 2>/dev/null | cut -f1)"
  sleep 30; medir_memoria 30s
  sleep 120; medir_memoria 150s
) &

# A VIGIA (U2, parte 3: a writer-os-v0.2.0-teste.7 parou a casca inteira no meio do download, sem nada na serial):
#   kernel <linha>: o que o kernel avisou (warn ou pior) depois que a janela abriu
#   vigia D <pid>/<tid> <comm> <wchan> · vigia pilha <função do kernel> · vigia memoria Dirty <kB> Writeback <kB>: quem
#   ficou preso esperando (o estado D) em duas olhadas seguidas, 10 s uma da outra, com a pilha do kernel
# O kernel também conta as tarefas presas há mais de 30 s (hung_task), em vez de 120.
(
  echo 30 > /proc/sys/kernel/hung_task_timeout_secs 2>/dev/null
  for _ in $(seq 1 150); do [ -e /run/ekfrase/sessao/pronta ] && break; sleep 1; done
  nivel=emerg,alert,crit,err,warn
  visto=$(dmesg -l "$nivel" 2>/dev/null | wc -l)
  declare -A antes=() contado=()
  ditas=0
  while sleep 10; do
    k=$(dmesg -l "$nivel" 2>/dev/null | wc -l)
    if [ "$k" -gt "$visto" ] && [ "$ditas" -lt 400 ]; then
      while IFS= read -r l; do dizer "kernel $l"; ditas=$((ditas + 1)); done < <(dmesg -l "$nivel" 2>/dev/null | tail -n +"$((visto + 1))" | head -n 40)
      visto=$k
    fi
    declare -A agora=()
    while IFS= read -r st; do
      t=${st%/status}
      agora[$t]=1
      if [ -n "${antes[$t]:-}" ] && [ -z "${contado[$t]:-}" ] && [ "$ditas" -lt 400 ]; then
        contado[$t]=1
        p=${t#/proc/}; p=${p%%/*}
        dizer "vigia D $p/${t##*/} $(tr ' ' '_' < "$t/comm" 2>/dev/null) $(cat "$t/wchan" 2>/dev/null)"
        while IFS= read -r f; do dizer "vigia pilha ${f#*] }"; done < <(head -n 16 "$t/stack" 2>/dev/null)
        dizer "vigia memoria $(awk '/^(Dirty|Writeback):/{printf "%s %s ", $1, $2}' /proc/meminfo)"
        ditas=$((ditas + 18))
      fi
    done < <(grep -l '^State:[[:space:]]*D' /proc/[0-9]*/task/[0-9]*/status 2>/dev/null)
    antes=()
    for t in "${!agora[@]}"; do antes[$t]=1; done
    unset agora
  done
) &

tail -n +1 -F /run/ekfrase/teste/relato 2>/dev/null | while IFS= read -r l; do dizer "$l"; done
