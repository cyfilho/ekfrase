#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# A imagem GPT do Writer OS (PLANO §6.1), SEM root e sem loop: a partição 1 (EKFRASE-BOOT, FAT32 de
# 1,4 GB, tipo ESP) é montada num arquivo com mkfs.vfat -C + mtools e copiada para dentro da GPT
# com dd. A partição 2 (EKFRASE-DADOS) NÃO vem na imagem: o ekfrase-dados.service a cria no
# primeiro boot, com o resto do pendrive.
#
#   montar-img.sh <pasta de trabalho do montar.sh> <saida.img> [squashfs a mais…]
#
# Rótulos: a partição GPT se chama EKFRASE-BOOT; o FAT32 tem o rótulo EKFR-BOOT (o FAT aceita só 11
# letras). O GRUB assinado do Debian procura o grub.cfg em EFI/debian, EFI/BOOT e boot/grub: vai nos três.
#
# AS DUAS CÓPIAS (docs/ATUALIZACOES.md §4, U1): a imagem leva só o lado A (live/, com a versão em live/versao) e o
# boot/grub/grubenv (1024 bytes, ekfrase_atual=live). O lado B (live-b/) nasce na primeira atualização; a partição
# tem de caber as DUAS cópias (o teste abaixo falha antes).
set -euo pipefail

TRAB=$1
IMG=$2
shift 2
ESP_MB=1400
export MTOOLS_SKIP_CHECK=1

PRECISA=$(du -cm "$TRAB/vmlinuz" "$TRAB/initrd.img" "$TRAB/filesystem.squashfs" "$@" | tail -1 | cut -f1)
echo "  o sistema ocupa $PRECISA MB de $ESP_MB MB"
[ "$PRECISA" -lt $((ESP_MB - 40)) ] || { echo "Não cabe na partição de boot ($PRECISA MB)."; exit 1; }
[ $((PRECISA * 2 + 40)) -lt "$ESP_MB" ] || { echo "As duas cópias do sistema (A e B, a atualização) não cabem na partição de boot (2 × $PRECISA MB)."; exit 1; }
[ -s "$TRAB/versao" ] || { echo "Falta $TRAB/versao (o montar.sh escreve)."; exit 1; }

# o bloco do GRUB (o formato do grub-editenv: o cabeçalho, as variáveis e '#' até 1024 bytes); o ekfrase-atualizar.sh
# escreve o mesmo formato
GRUBENV=$TRAB/grubenv
{ printf '# GRUB Environment Block\nekfrase_atual=live\n'; head -c 1024 /dev/zero | tr '\0' '#'; } | head -c 1024 > "$GRUBENV"
[ "$(stat -c %s "$GRUBENV")" = 1024 ] || { echo "grubenv com tamanho errado"; exit 1; }

ESP=$TRAB/esp.img
rm -f "$ESP" "$IMG"
mkfs.vfat -C -F 32 -n EKFR-BOOT "$ESP" $((ESP_MB * 1024)) >/dev/null
mmd -i "$ESP" ::/EFI ::/EFI/BOOT ::/EFI/debian ::/boot ::/boot/grub ::/live
mcopy -i "$ESP" "$TRAB/efi/shimx64.efi.signed" ::/EFI/BOOT/BOOTX64.EFI
mcopy -i "$ESP" "$TRAB/efi/grubx64.efi.signed" ::/EFI/BOOT/grubx64.efi
mcopy -i "$ESP" "$TRAB/efi/mmx64.efi.signed" ::/EFI/BOOT/mmx64.efi
for d in EFI/BOOT EFI/debian boot/grub; do mcopy -i "$ESP" "$TRAB/grub.cfg" "::/$d/grub.cfg"; done
mcopy -i "$ESP" "$GRUBENV" ::/boot/grub/grubenv
mcopy -i "$ESP" "$TRAB/vmlinuz" "$TRAB/initrd.img" "$TRAB/filesystem.squashfs" "$TRAB/versao" ::/live/
for extra in "$@"; do mcopy -i "$ESP" "$extra" ::/live/; done
# sem o fbx64.efi: com ele, o shim rodaria o fallback e mexeria na ordem de boot do computador (PLANO §8c)
! mdir -b -i "$ESP" ::/EFI/BOOT | grep -qi fbx64 || { echo "A partição de boot não pode ter o fbx64.efi."; exit 1; }

# 1 MiB antes (a GPT) + a partição + 1 MiB depois (a cópia da GPT)
truncate -s $((ESP_MB + 2))M "$IMG"
sgdisk -o -n 1:2048:+${ESP_MB}M -t 1:EF00 -c 1:EKFRASE-BOOT "$IMG" >/dev/null
dd if="$ESP" of="$IMG" bs=1M seek=1 conv=notrunc status=none
sgdisk -v "$IMG" | tail -2
rm -f "$ESP"
echo "  $IMG"
