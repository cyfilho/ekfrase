#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# Dentro do sistema novo (chroot). O usuário `writer` (sem senha, sem shell, sem grupos especiais) e
# a conta root trancada (PLANO §7: não há como obter um shell de root).
set -euo pipefail

useradd --create-home --uid 1000 --user-group --shell /usr/sbin/nologin writer
usermod -p '*' writer
usermod -s /usr/sbin/nologin root
passwd -l root >/dev/null

echo ekfrase-writer > /etc/hostname
printf '127.0.0.1\tlocalhost\n127.0.1.1\tekfrase-writer\n::1\tlocalhost ip6-localhost ip6-loopback\n' > /etc/hosts
echo 'LANG=C.UTF-8' > /etc/default/locale
ln -sf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime
echo America/Sao_Paulo > /etc/timezone
mkdir -p /dados
