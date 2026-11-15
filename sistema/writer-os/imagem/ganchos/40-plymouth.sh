#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# Dentro do sistema novo (chroot). A tela do boot (PLANO §6.3): o tema "spinner" do Plymouth com a
# logo do Writer (pixel art por código, scripts/arte/gerar.mjs) no fundo azul-noite do app.
set -euo pipefail
T=/usr/share/plymouth/themes/ekfrase

rm -rf "$T"
cp -a /usr/share/plymouth/themes/spinner "$T"
mv "$T/spinner.plymouth" "$T/ekfrase.plymouth"
sed -i \
  -e 's/^Name=.*/Name=Ekfrase Writer/' \
  -e 's#/themes/spinner#/themes/ekfrase#g' \
  -e 's/^BackgroundStartColor=.*/BackgroundStartColor=0x1d2433/' \
  -e 's/^BackgroundEndColor=.*/BackgroundEndColor=0x1d2433/' \
  "$T/ekfrase.plymouth"
cp /usr/share/ekfrase/logo.png "$T/watermark.png"
plymouth-set-default-theme ekfrase
