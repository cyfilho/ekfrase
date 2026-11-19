#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# Monta o Ekfrase Writer OS (PLANO §6 e §8). Roda como root num contêiner Debian trixie
# (o CI: `docker run --privileged debian:trixie bash sistema/writer-os/imagem/montar.sh`).
#
#   1. o sistema com o mmdebstrap (minbase + pacotes.txt), os arquivos de raiz/ e os ganchos/;
#   2. o filesystem.squashfs (o sistema inteiro, só leitura), o kernel e o initrd;
#   3. o GRUB sem menu (grub.cfg.modelo, com uma senha aleatória que ninguém guarda);
#   4. o shim e o GRUB assinados do Debian (o Secure Boot passa sem chave nossa);
#   5. duas imagens GPT (montar-img.sh): a de entrega e a de teste (a mesma + teste/, num
#      squashfs a mais que o live-boot empilha: /etc/ekfrase/teste e o relato na serial).
#
# Entra: a casca já montada para o OS (`node sistema/writer-os/casca/scripts/montar.ts --os`, em
# sistema/writer-os/casca/instalador/linux-unpacked). Sai: sistema/writer-os/imagem/saida/.
# Variáveis: VERSAO (a da tag: X.Y.Z ou X.Y.Z-teste.N), CANAL (estavel|teste; o padrão sai da VERSAO), DONO (uid:gid
# dos arquivos de saída), TRAB (a pasta de trabalho).
#
# A ATUALIZAÇÃO (docs/ATUALIZACOES.md §4, U1): além das imagens, sai/ recebe os arquivos que o Release leva para os
# pendrives se atualizarem sozinhos (ekfrase-writer-os-<v>.squashfs, .vmlinuz, .initrd e .grub.cfg, este com o @HASH@
# no lugar da senha) e a chave de TESTE das atualizações (teste-atualizacao.key, sorteada a cada montagem, sem senha;
# só a imagem de teste confia nela, e ela nunca vai ao Release).
set -euo pipefail

AQUI=$(cd "$(dirname "$0")" && pwd)
CASCA=${CASCA:-$AQUI/../casca/instalador/linux-unpacked}
SAIDA=${SAIDA:-$AQUI/saida}
VERSAO=${VERSAO:-0.1.0}
case "$VERSAO" in *-teste.*) CANAL=${CANAL:-teste} ;; *) CANAL=${CANAL:-estavel} ;; esac
[[ $VERSAO =~ ^[0-9]+\.[0-9]+\.[0-9]+(-teste\.[0-9]+)?$ ]] || { echo "VERSAO inválida: $VERSAO"; exit 1; }
[ "$CANAL" = estavel ] || [ "$CANAL" = teste ] || { echo "CANAL inválido: $CANAL"; exit 1; }
TRAB=${TRAB:-/tmp/ekfrase-os}
LOGO=$AQUI/../../../apps/writer/src/img/logo-writer.png
export AQUI CASCA VERSAO CANAL LOGO

[ -x "$CASCA/ekfrase-writer" ] || { echo "Falta a casca do OS em $CASCA (montar.ts --os)."; exit 1; }
[ -f "$LOGO" ] || { echo "Falta a logo do Writer ($LOGO)."; exit 1; }

echo "== ferramentas da montagem"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends mmdebstrap squashfs-tools dosfstools mtools gdisk grub-common minisign ca-certificates gcc libc6-dev linux-libc-dev >/dev/null

rm -rf "$TRAB"
mkdir -p "$TRAB" "$SAIDA"
RAIZ=$TRAB/raiz

# o ekfrase-numlock (fonte/, C): compilado aqui, no mesmo trixie da imagem; o compilador NÃO entra na imagem
echo "== o ekfrase-numlock"
NUMLOCK=$TRAB/ekfrase-numlock
gcc -std=gnu11 -O2 -Wall -Wextra -D_FORTIFY_SOURCE=2 -fstack-protector-strong -fPIE -pie -Wl,-z,relro,-z,now \
  -o "$NUMLOCK" "$AQUI/fonte/ekfrase-numlock.c"
export NUMLOCK
COMP="main contrib non-free-firmware"

echo "== o sistema (mmdebstrap, trixie)"
mmdebstrap --variant=minbase --mode=root \
  --components="$COMP" \
  --aptopt='APT::Install-Recommends "false"' \
  --include="$(grep -v '^[[:space:]]*#' "$AQUI/pacotes.txt" | xargs | tr ' ' ',')" \
  --customize-hook="bash \"$AQUI/ganchos/rodar.sh\" \"\$1\"" \
  trixie "$RAIZ" \
  "deb http://deb.debian.org/debian trixie $COMP" \
  "deb http://deb.debian.org/debian trixie-updates $COMP" \
  "deb http://security.debian.org/debian-security trixie-security $COMP"

echo "== kernel, initrd e squashfs"
cp "$(ls "$RAIZ"/boot/vmlinuz-* | sort -V | tail -1)" "$TRAB/vmlinuz"
cp "$(ls "$RAIZ"/boot/initrd.img-* | sort -V | tail -1)" "$TRAB/initrd.img"
# zstd e não xz (15/11): abre várias vezes mais rápido no boot (o Writer e o Electron saem daqui) e ocupa
# só ~12% a mais (era 557 MB de 1400 em xz); A e B da atualização (fase 4) ainda cabem na EKFR-BOOT.
mksquashfs "$RAIZ" "$TRAB/filesystem.squashfs" -comp zstd -Xcompression-level 19 -b 1M -noappend -quiet \
  -wildcards -e 'boot/*' 'proc/*' 'sys/*' 'dev/*' 'run/*' 'tmp/*'
# as medidas (P3, 18/11): o sistema inteiro comprimido e, sem comprimir, a casca e o sistema; e o initrd (o kernel
# descomprime o initrd inteiro antes de começar: cada MB é tempo de boot)
echo "  medida squashfs $(du -m "$TRAB/filesystem.squashfs" | cut -f1) MB · raiz $(du -sm "$RAIZ" | cut -f1) MB · casca $(du -sm "$RAIZ/opt/ekfrase-writer" | cut -f1) MB · initrd $(du -m "$TRAB/initrd.img" | cut -f1) MB"

echo "$VERSAO" > "$TRAB/versao"

echo "== o squashfs do teste (só na imagem de teste)"
TESTE=$TRAB/teste
cp -a "$AQUI/teste" "$TESTE"
# a chave de TESTE das atualizações (o qemu.py assina com ela uma atualização "maior"; a imagem de entrega nunca confia)
rm -f "$SAIDA/teste-atualizacao.key"
mkdir -p "$TESTE/usr/share/ekfrase"
minisign -G -W -f -p "$TESTE/usr/share/ekfrase/atualizacao-teste.pub" -s "$SAIDA/teste-atualizacao.key" >/dev/null
chmod 0755 "$TESTE"/usr/lib/ekfrase/teste/*.sh
mkdir -p "$TESTE/etc/systemd/system/multi-user.target.wants"
ln -s ../ekfrase-teste.service "$TESTE/etc/systemd/system/multi-user.target.wants/ekfrase-teste.service"
mksquashfs "$TESTE" "$TRAB/zz-teste.squashfs" -comp xz -noappend -quiet -all-root

echo "== shim e GRUB assinados do Debian"
mkdir -p "$TRAB/debs" "$TRAB/efi"
( cd "$TRAB/debs" && apt-get download -qq shim-signed shim-helpers-amd64-signed grub-efi-amd64-signed && for d in *.deb; do dpkg-deb -x "$d" x; done )
acha() { find "$TRAB/debs/x" -name "$1" -type f | sort | head -1; }
cp "$(acha shimx64.efi.signed)" "$TRAB/efi/shimx64.efi.signed"
cp "$(acha mmx64.efi.signed)" "$TRAB/efi/mmx64.efi.signed"
cp "$(acha grubx64.efi.signed)" "$TRAB/efi/grubx64.efi.signed"

echo "== grub.cfg (sem menu; a edição fica trancada por uma senha que ninguém guarda)"
SENHA=$(head -c 48 /dev/urandom | base64 | tr -d '\n')
HASH=$(printf '%s\n%s\n' "$SENHA" "$SENHA" | grub-mkpasswd-pbkdf2 | sed -n 's/.* is \(grub\.pbkdf2\..*\)$/\1/p')
unset SENHA
[ -n "$HASH" ] || { echo "grub-mkpasswd-pbkdf2 não devolveu o hash"; exit 1; }
sed "s|@HASH@|$HASH|; s|@VERSAO@|$VERSAO|" "$AQUI/grub.cfg.modelo" > "$TRAB/grub.cfg"

echo "== as imagens"
NOME=ekfrase-writer-os-$VERSAO
bash "$AQUI/montar-img.sh" "$TRAB" "$SAIDA/$NOME.img"
bash "$AQUI/montar-img.sh" "$TRAB" "$SAIDA/$NOME-teste.img" "$TRAB/zz-teste.squashfs"

echo "== os arquivos da atualização (o Release os leva; o manifesto e o lacre saem no CI)"
cp "$TRAB/filesystem.squashfs" "$SAIDA/$NOME.squashfs"
cp "$TRAB/vmlinuz" "$SAIDA/$NOME.vmlinuz"
cp "$TRAB/initrd.img" "$SAIDA/$NOME.initrd"
sed "s|@VERSAO@|$VERSAO|" "$AQUI/grub.cfg.modelo" > "$SAIDA/$NOME.grub.cfg"
grep -q '@HASH@' "$SAIDA/$NOME.grub.cfg" || { echo "o grub.cfg da atualização perdeu o @HASH@"; exit 1; }

if [ -n "${DONO:-}" ]; then chown -R "$DONO" "$SAIDA"; fi
ls -la "$SAIDA"
echo "Pronto: $SAIDA/$NOME.img (e a de teste)."
