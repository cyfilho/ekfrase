#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# Dentro do sistema novo (chroot). A tela do boot (PLANO §6.3): o tema "script" próprio do Plymouth
# (raiz/usr/share/plymouth/themes/ekfrase: fundo azul-noite, a logo do Writer e a pena escrevendo,
# pixel art por código em scripts/arte/writer-os.mjs). Nada de spinner genérico.
set -euo pipefail
T=/usr/share/plymouth/themes/ekfrase

[ -f "$T/ekfrase.script" ] || { echo "Falta o tema do Plymouth ($T)."; exit 1; }
find /usr/lib -path '*/plymouth/script.so' | grep -q . || { echo "Falta o módulo script do Plymouth (plymouth-themes?)."; exit 1; }
cp /usr/share/ekfrase/logo.png "$T/logo.png"
plymouth-set-default-theme ekfrase
