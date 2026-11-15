#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# SÓ na imagem de teste. Escreve na serial (ttyS0) linhas "EKFRASE <evento>" que o
# tests/writer-os/qemu.py confere:
#   boot · dados {…} · particao ok <fs> | particao falta · sobrou <programa> · suid <arquivo> ·
#   binarios conferidos · grupos <…> · shell-root <…> · root <L|P|NP> · secureboot <1|0|?>
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

tail -n +1 -F /run/ekfrase/teste/relato 2>/dev/null | while IFS= read -r l; do dizer "$l"; done
