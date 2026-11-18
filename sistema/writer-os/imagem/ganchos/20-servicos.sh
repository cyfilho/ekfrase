#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# Dentro do sistema novo (chroot). Os serviços: a partição de dados e a sessão (Cage + a casca)
# ligados; nenhum terminal (PLANO §7: getty, autovt, console serial, Ctrl+Alt+Del, shell de
# depuração, modo de recuperação e de emergência, tudo mascarado).
set -euo pipefail

systemctl enable ekfrase-dados.service ekfrase-diagnostico.service ekfrase-sessao.service ekfrase-numlock.path NetworkManager.service systemd-timesyncd.service
systemctl set-default graphical.target
systemctl mask getty@.service autovt@.service serial-getty@.service console-getty.service container-getty@.service \
  ctrl-alt-del.target debug-shell.service rescue.service emergency.service
# o brilho começa sempre em 50% (91-ekfrase-brilho.rules, 18/11): nada de voltar o do último desligamento
systemctl mask systemd-backlight@.service

# os módulos que o initrd precisa para achar o pendrive (FAT32, USB 2/3, UAS) e montar o squashfs
cat >> /etc/initramfs-tools/modules <<'FIM'
vfat
nls_cp437
nls_ascii
nls_utf8
squashfs
overlay
loop
usb_storage
uas
xhci_pci
ehci_pci
sd_mod
FIM
