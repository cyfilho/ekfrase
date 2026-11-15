#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# A SESSÃO do Writer OS (PLANO §6.3), como o usuário writer (ekfrase-sessao.service): o Cage (um
# compositor Wayland de quiosque: uma janela só, sem trocar de terminal) com a casca do Writer em
# modo OS. É um laço: trocar o teclado é a casca gravar o sistema.json e sair; o Cage abre de novo,
# com o teclado novo (ele só lê o teclado ao abrir).
set -u
export LANG=C.UTF-8 XDG_SESSION_TYPE=wayland
# a máquina virtual do teste não tem GPU
if [ -e /etc/ekfrase/teste ]; then export WLR_RENDERER=pixman WLR_NO_HARDWARE_CURSORS=1; fi

while true; do
  ARQ="/dados/Ekfrase Writer/sistema.json"
  [ -f "$ARQ" ] || ARQ=/run/ekfrase/sistema.json
  TECLADO=$(grep -o '"teclado"[[:space:]]*:[[:space:]]*"[a-z-]*"' "$ARQ" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  VARIANTE=
  case "$TECLADO" in
    us | gb | pt | es | de | fr) LAYOUT=$TECLADO ;;
    us-intl) LAYOUT=us VARIANTE=intl ;;
    *) LAYOUT=br ;;
  esac
  XKB_DEFAULT_LAYOUT=$LAYOUT XKB_DEFAULT_VARIANT=$VARIANTE cage -d -- /opt/ekfrase-writer/ekfrase-writer --modo-os --ozone-platform=wayland
  sleep 1
done
