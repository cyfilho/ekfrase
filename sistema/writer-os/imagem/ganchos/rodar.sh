#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# O gancho do mmdebstrap (--customize-hook): roda FORA do sistema novo, com a pasta dele em $1.
# Copia raiz/ (os arquivos do sistema), a casca (/opt/ekfrase-writer), a logo e a versão, e roda
# cada ganchos/NN-*.sh DENTRO do sistema novo (chroot), em ordem. O 90-travas.sh é o último.
set -euo pipefail
R=$1

cp -a "$AQUI/raiz/." "$R/"
chmod 0755 "$R"/usr/lib/ekfrase/*.sh "$R"/etc/initramfs-tools/hooks/ekfrase-*
# o ekfrase-numlock, compilado pelo montar.sh (fonte/ekfrase-numlock.c)
install -m 0755 "$NUMLOCK" "$R/usr/lib/ekfrase/ekfrase-numlock"
mkdir -p "$R/opt" "$R/usr/share/ekfrase" "$R/etc/ekfrase"
rm -rf "$R/opt/ekfrase-writer"
cp -a "$CASCA" "$R/opt/ekfrase-writer"
cp "$LOGO" "$R/usr/share/ekfrase/logo.png"
echo "$VERSAO" > "$R/etc/ekfrase/versao"
# as atualizações (docs/ATUALIZACOES.md §3 e §4): o canal (o de teste vê as pré-releases de teste) e a chave pública do
# lacre da Ekfrase, com que o ekfrase-atualizar.sh (root) confere o manifesto antes de gravar
echo "$CANAL" > "$R/etc/ekfrase/canal"
install -m 0644 "$AQUI/minisign.pub" "$R/usr/share/ekfrase/atualizacao.pub"

# o update-initramfs e o systemctl querem /proc, /sys e /dev (o mmdebstrap costuma deixar montados)
MONTEI=()
for m in proc sys dev; do
  if ! mountpoint -q "$R/$m"; then
    mount --bind "/$m" "$R/$m"
    MONTEI+=("$R/$m")
  fi
done
desmontar() { for m in "${MONTEI[@]}"; do umount -l "$m" || true; done; }
trap desmontar EXIT

# os pacotes da imagem (Bloco F), antes do 90-travas apagar o dpkg: pacote, versão, pacote-fonte, versão da fonte
chroot "$R" /usr/bin/dpkg-query -W -f '${binary:Package}	${Version}	${source:Package}	${source:Version}
' | LC_ALL=C sort > "$PACOTES"
test -s "$PACOTES" || { echo "a lista dos pacotes saiu vazia"; exit 1; }

for g in "$AQUI"/ganchos/[0-9][0-9]-*.sh; do
  echo "== gancho $(basename "$g")"
  chroot "$R" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin VERSAO="$VERSAO" /bin/bash -s < "$g"
done
