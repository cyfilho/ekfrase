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
# sistema/writer-os/casca/instalador/writer-os: o serviço do Writer, sem o Electron desde o P3). O navegador é o Cog
# (WPE WebKit) do Debian, compilado aqui com o remendo cog/ekfrase.patch. Sai: sistema/writer-os/imagem/saida/.
# Variáveis: VERSAO (a da casca), DONO (uid:gid dos arquivos de saída), TRAB (a pasta de trabalho).
set -euo pipefail

AQUI=$(cd "$(dirname "$0")" && pwd)
CASCA=${CASCA:-$AQUI/../casca/instalador/writer-os}
SAIDA=${SAIDA:-$AQUI/saida}
VERSAO=${VERSAO:-0.1.0}
TRAB=${TRAB:-/tmp/ekfrase-os}
LOGO=$AQUI/../../../apps/writer/src/img/logo-writer.png
export AQUI CASCA VERSAO LOGO COG

[ -x "$CASCA/ekfrase-writer" ] && [ -f "$CASCA/servico-os.cjs" ] || { echo "Falta a casca do OS em $CASCA (montar.ts --os)."; exit 1; }
[ -f "$LOGO" ] || { echo "Falta a logo do Writer ($LOGO)."; exit 1; }

echo "== ferramentas da montagem"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends mmdebstrap squashfs-tools dosfstools mtools gdisk grub-common ca-certificates gcc libc6-dev linux-libc-dev >/dev/null
# o Cog (P3, 18/11): o código-fonte do Debian (apt-get source confere o lacre do arquivo) e o que ele precisa para
# compilar; nada disto entra na imagem (só o Cog compilado e as bibliotecas dele, pelo pacotes.txt)
echo "deb-src http://deb.debian.org/debian trixie main" > /etc/apt/sources.list.d/ekfrase-fonte.list
apt-get update -qq
apt-get install -y -qq --no-install-recommends dpkg-dev patch meson ninja-build pkgconf libwpewebkit-2.0-dev libwpe-1.0-dev   libwpebackend-fdo-1.0-dev libsoup-3.0-dev libglib2.0-dev libcairo2-dev libegl-dev libwayland-dev wayland-protocols libdrm-dev   libxkbcommon-dev libepoxy-dev >/dev/null

rm -rf "$TRAB"
mkdir -p "$TRAB" "$SAIDA"

# O Cog 0.18 do trixie com as travas do Ekfrase (cog/ekfrase.patch: nenhuma tecla do Cog, só a origem do app, nenhuma
# janela nova, nenhum download, nenhuma caixa do sistema, a ponte da página antes de tudo). Só o módulo do Wayland.
echo "== o Cog (WPE WebKit) com as travas do Ekfrase"
COG=$TRAB/cog
mkdir -p "$COG"
(cd "$COG" && apt-get source -qq cog >/dev/null 2>&1)
FONTE=$(ls -d "$COG"/cog-*/ | head -1)
[ "$(basename "$FONTE")" = cog-0.18.4 ] || { echo "O Cog do trixie mudou ($(basename "$FONTE")): confira o cog/ekfrase.patch"; exit 1; }
patch -d "$FONTE" -p1 --forward --no-backup-if-mismatch < "$AQUI/cog/ekfrase.patch"
eval "$(DEB_BUILD_MAINT_OPTIONS=hardening=+all dpkg-buildflags --export=sh)"
meson setup "$COG/build" "$FONTE" --prefix=/usr --libdir=lib/x86_64-linux-gnu --buildtype=release -Dplatforms=wayland -Dwpe_api=2.0   -Dprograms=true -Ddocumentation=false -Dmanpages=false >/dev/null
ninja -C "$COG/build" >/dev/null
DESTDIR=$COG/instalado meson install -C "$COG/build" --quiet >/dev/null
rm -rf "$COG/instalado/usr/include" "$COG/instalado/usr/lib/x86_64-linux-gnu/pkgconfig" "$COG/instalado/usr/share"
[ -x "$COG/instalado/usr/bin/cog" ] || { echo "O Cog não compilou"; exit 1; }
echo "  $(find "$COG/instalado" -type f | wc -l) arquivos do Cog"
export COG=$COG/instalado
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
# zstd e não xz (15/11): abre várias vezes mais rápido no boot (o Writer e o navegador saem daqui) e ocupa
# só ~12% a mais (era 557 MB de 1400 em xz); A e B da atualização (fase 4) ainda cabem na EKFR-BOOT.
mksquashfs "$RAIZ" "$TRAB/filesystem.squashfs" -comp zstd -Xcompression-level 19 -b 1M -noappend -quiet \
  -wildcards -e 'boot/*' 'proc/*' 'sys/*' 'dev/*' 'run/*' 'tmp/*'
# as medidas (P3, 18/11): o sistema inteiro comprimido e, sem comprimir, a casca e o sistema
echo "  medida squashfs $(du -m "$TRAB/filesystem.squashfs" | cut -f1) MB · raiz $(du -sm "$RAIZ" | cut -f1) MB · casca $(du -sm "$RAIZ/opt/ekfrase-writer" | cut -f1) MB"

echo "== o squashfs do teste (só na imagem de teste)"
TESTE=$TRAB/teste
cp -a "$AQUI/teste" "$TESTE"
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

if [ -n "${DONO:-}" ]; then chown -R "$DONO" "$SAIDA"; fi
ls -la "$SAIDA"
echo "Pronto: $SAIDA/$NOME.img (e a de teste)."
