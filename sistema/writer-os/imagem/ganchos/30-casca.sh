#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# Dentro do sistema novo (chroot). A casca do Writer em /opt/ekfrase-writer: do root, só leitura para
# o resto, sem o chrome-sandbox (um binário SUID a menos; o sandbox do Chromium usa os namespaces do
# kernel, ligados no sysctl). E confere que nenhuma biblioteca falta.
set -euo pipefail
C=/opt/ekfrase-writer

chown -R root:root "$C"
chmod -R u+rwX,go+rX,go-w "$C"
rm -f "$C/chrome-sandbox"

falta=$( (ldd "$C/ekfrase-writer"; ldd "$C/resources/nativo/better_sqlite3.node") 2>&1 | grep 'not found' || true)
if [ -n "$falta" ]; then
  echo "A casca precisa de bibliotecas que não estão na imagem:"
  echo "$falta"
  exit 1
fi
echo "  a casca acha todas as bibliotecas"
