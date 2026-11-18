#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# A SESSÃO do Writer OS (PLANO §6.3), como o usuário writer (ekfrase-sessao.service): o Cage (um
# compositor Wayland de quiosque: uma janela só, sem trocar de terminal) com a casca do Writer em
# modo OS (desde o P3, 18/11/2026: o serviço do Writer no Node, que abre o Cog; o pixman leva junto o
# LIBGL_ALWAYS_SOFTWARE, porque o Cog desenha pelo EGL e, sem placa de vídeo, o Mesa desenha na CPU). É um laço: trocar o teclado é a casca gravar o sistema.json e sair; o Cage abre de novo,
# com o teclado novo (ele só lê o teclado ao abrir).
#
# Em /run/ekfrase/sessao/ (do writer; o ekfrase-diagnostico.service cria): `renderer` (auto | pixman,
# o jeito de desenhar da vez) e `quedas` (uma linha por saída do Cage: hora, código, segundos,
# renderer). O diagnóstico grava o journal no pendrive a cada linha nova.
set -u
export LANG=C.UTF-8 XDG_SESSION_TYPE=wayland
SESSAO=/run/ekfrase/sessao
# a máquina virtual do teste não tem GPU; o teste da placa de vídeo (qemu.py --gpu) tem
if [ -e /etc/ekfrase/teste ] && [ ! -e /run/ekfrase/teste/gpu ]; then export WLR_RENDERER=pixman WLR_NO_HARDWARE_CURSORS=1 LIBGL_ALWAYS_SOFTWARE=1; fi

registrar() { [ -d "$SESSAO" ] && [ -w "$SESSAO" ] && printf '%s\n' "$2" > "$SESSAO/$1.tmp" && mv -f "$SESSAO/$1.tmp" "$SESSAO/$1"; }

# Rede de segurança: se o Cage cai em menos de 15 s duas vezes seguidas (a placa de vídeo não
# abriu: driver, EGL, firmware), passa a desenhar sem a placa (pixman). Antes disso a tela ficava
# preta para sempre, com o Cage abrindo e caindo em laço (15/11/2026).
QUEDAS=0
while true; do
  if [ "$QUEDAS" -ge 2 ] && [ "${WLR_RENDERER:-}" != pixman ]; then
    echo "ekfrase-sessao: o Cage caiu $QUEDAS vezes; sigo sem a placa de vídeo (pixman)" >&2
    export WLR_RENDERER=pixman WLR_NO_HARDWARE_CURSORS=1 LIBGL_ALWAYS_SOFTWARE=1
  fi
  registrar renderer "${WLR_RENDERER:-auto}"
  INICIO=$(date +%s)
  ARQ="/dados/Ekfrase Writer/sistema.json"
  [ -f "$ARQ" ] || ARQ=/run/ekfrase/sistema.json
  TECLADO=$(grep -o '"teclado"[[:space:]]*:[[:space:]]*"[a-z-]*"' "$ARQ" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  VARIANTE=
  case "$TECLADO" in
    us | gb | pt | es | de | fr) LAYOUT=$TECLADO ;;
    us-intl) LAYOUT=us VARIANTE=intl ;;
    *) LAYOUT=br ;;
  esac
  XKB_DEFAULT_LAYOUT=$LAYOUT XKB_DEFAULT_VARIANT=$VARIANTE cage -d -- /opt/ekfrase-writer/ekfrase-writer --modo-os
  CODIGO=$?
  DURACAO=$(($(date +%s) - INICIO))
  echo "ekfrase-sessao: o Cage saiu (código $CODIGO, depois de ${DURACAO} s, renderer ${WLR_RENDERER:-auto})" >&2
  [ -d "$SESSAO" ] && [ -w "$SESSAO" ] && echo "$(date +%s) $CODIGO $DURACAO ${WLR_RENDERER:-auto}" >> "$SESSAO/quedas"
  if [ "$DURACAO" -lt 15 ]; then QUEDAS=$((QUEDAS + 1)); else QUEDAS=0; fi
  sleep 1
done
