#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# Dentro do sistema novo (chroot). A casca do Writer OS em /opt/ekfrase-writer (desde o P3, 18/11/2026, sem o
# Electron: o serviço do Writer, `servico-os.cjs`, no Node que vem com a casca (`node`, o do build), e o navegador Cog com as travas do Ekfrase em
# /usr/bin/cog): do root, só leitura para o resto. E confere que nenhuma biblioteca falta e que o Node da casca
# carrega o SQLite cifrado (o Node 20 do Debian caía ao carregar: teste.9, 18/11).
set -euo pipefail
C=/opt/ekfrase-writer

chown -R root:root "$C"
chmod -R u+rwX,go+rX,go-w "$C"
chmod 0755 "$C/ekfrase-writer" "$C/node"
ldconfig

MODULOS=$(ls /usr/lib/x86_64-linux-gnu/cog/modules/*.so 2>/dev/null || true)
[ -n "$MODULOS" ] || { echo "O Cog está sem o módulo do Wayland"; exit 1; }
falta=$( (ldd /usr/bin/cog; for m in $MODULOS; do ldd "$m"; done; ldd "$C/nativo/better_sqlite3.node"; ldd "$C/node";
  for p in /usr/lib/x86_64-linux-gnu/wpe-webkit-2.0/WPE*Process; do ldd "$p"; done) 2>&1 | grep 'not found' || true)
if [ -n "$falta" ]; then
  echo "A casca precisa de bibliotecas que não estão na imagem:"
  echo "$falta"
  exit 1
fi
"$C/node" -e "
  const m = { exports: {} };
  process.dlopen(m, '$C/nativo/better_sqlite3.node');
  if (!Object.keys(m.exports).length) { console.error('o SQLite cifrado não abriu no Node da casca'); process.exit(1); }
"
echo "  a casca acha todas as bibliotecas (Node $("$C/node" -v), $(cog --version 2>/dev/null | head -1))"
