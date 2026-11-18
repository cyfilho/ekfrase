#!/bin/sh
# SPDX-License-Identifier: MPL-2.0
#
# O BRILHO ao ligar (pedido do Alcy em 18/11/2026): a tela começa em 50% no primeiro boot e em todos os
# outros. Quem chama é o udev (91-ekfrase-brilho.rules, como root), quando a luz da tela aparece; o
# "udevadm trigger" do boot repete o "add" das que nasceram ainda no initrd.
#   ekfrase-brilho.sh <nome em /sys/class/backlight>
set -u
case "${1:-}" in '' | */* | .*) exit 0 ;; esac
D=/sys/class/backlight/$1
[ -r "$D/max_brightness" ] && [ -w "$D/brightness" ] || exit 0
MAX=$(cat "$D/max_brightness")
case "$MAX" in '' | *[!0-9]*) exit 0 ;; esac
[ "$MAX" -gt 0 ] || exit 0
echo $(((MAX + 1) / 2)) > "$D/brightness"
