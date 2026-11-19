#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# INSTALAR O WRITER OS NO COMPUTADOR (PLANO §8c, fases 3d e 3f). Roda como root, um pedido por conexão
# (ekfrase-instalar.socket, Accept=yes: a entrada e a saída são o próprio socket, que só o grupo writer abre), sem shell
# para ninguém. Lê UMA linha e só aceita, por expressão exata:
#
#   consultar                                            o que há no computador
#   instalar <disco> <levar|nao-levar>                   ao lado do Windows, no maior espaço livre do disco interno
#   apagar-tudo <disco> <bytes> <levar|nao-levar>        APAGA o disco inteiro e instala nele (computador sem Windows)
#
# <disco> é o nome do kernel (nvme0n1, sda, vda, mmcblk0) e é conferido de novo aqui: fora do USB, não é o disco de
# onde o sistema ligou, não é removível nem só leitura, nada dele montado, num computador UEFI, e nenhum OUTRO disco
# interno com o Writer OS (a entrada de boot dele sairia). No apagar-tudo, <bytes> é o tamanho do disco que a tela
# mostrou (a pessoa digitou o nome dele; a casca conferiu): se não bate, é outro disco, e nada muda.
#
# instalar: NUNCA apaga, move nem muda uma partição que existe: só cria duas no espaço livre (EKFRASE-BOOT, FAT32
# tipo ESP de 1400 MiB, cópia conferida da partição de boot do pendrive; e EKFRASE-DADOS, exFAT tipo Linux, que o
# Windows não monta) e acrescenta a entrada "Ekfrase Writer OS" no FIM da ordem de boot (o Windows continua o
# primeiro, e o BitLocker não estranha nada).
# apagar-tudo: apaga as assinaturas de cada partição e a tabela, cria uma GPT nova com as mesmas duas partições no
# disco todo e põe a entrada em PRIMEIRO na ordem de boot (não há outro sistema para ligar).
# Se algo falha no meio, as duas partições novas e a entrada saem (no apagar-tudo, o que havia já não volta: a tela
# sabe e diz).
#
# Saída: uma linha por vez, campos separados por TAB (a casca lê: casca/src/motor/sistema.ts, lerConsulta).
#   consultar  boot <usb|computador|outro> · uefi <sim|nao>
#              · disco <nome> <bytes> <início do livre> <bytes livres> <tabela> <writer sim|nao> <modelo>
#              · parte <disco> <início> <bytes> <sistema de arquivos> <nome GPT> <rótulo>   (em bytes) · fim
#   instalar   passo <apagar|particoes|copiar|conferir|textos|entrada> [feito total] … · ok | erro <código>
set -u
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C
umask 077

T=$'\t'
BOOT_MIB=1400
MINIMO_GIB=8
MAXIMO_GIB=32
NOME_ENTRADA='Ekfrase Writer OS'
NOVO=/run/ekfrase/novo
MEDIO_DIR=/run/live/medium

dizer() {
  local IFS="$T"
  printf '%s\n' "$*"
}
diario() { echo "ekfrase-instalar: $*" >&2; }
# um texto que veio do disco (modelo, rótulo): sem controles nem TAB, curto
limpo() { printf '%s' "$1" | tr -d '\000-\037' | head -c 80; }
erro() {
  diario "erro $1"
  dizer erro "$1"
  exit 0
}

MEDIO=$(findmnt -no SOURCE "$MEDIO_DIR" 2>/dev/null | head -1)
DISCO_BOOT=
[ -n "$MEDIO" ] && DISCO_BOOT=$(lsblk -no PKNAME "$MEDIO" 2>/dev/null | head -1 | tr -d ' ')

lugar() {
  if [ -z "$DISCO_BOOT" ]; then
    echo outro
  elif [ "$(lsblk -dno TRAN "/dev/$DISCO_BOOT" 2>/dev/null | tr -d ' ')" = usb ]; then
    echo usb
  else
    echo computador
  fi
}

# Os discos internos: do tipo disk, com nome de disco de verdade (zram, loop e as partições boot0/rpmb do eMMC
# ficam de fora), fora do USB, não removíveis (o leitor de cartão SD) e não o disco de onde o sistema ligou.
internos() {
  local n tipo tran rm
  lsblk -dnro NAME,TYPE,RM 2>/dev/null | while read -r n tipo rm; do
    [ "$tipo" = disk ] || continue
    [[ $n =~ ^(nvme[0-9]+n[0-9]+|sd[a-z]+|vd[a-z]+|mmcblk[0-9]+)$ ]] || continue
    [ "$rm" = 0 ] || continue
    [ "$n" != "$DISCO_BOOT" ] || continue
    tran=$(lsblk -dno TRAN "/dev/$n" 2>/dev/null | tr -d ' ')
    [ "$tran" != usb ] || continue
    echo "$n"
  done
}

tem_writer() { lsblk -nro PARTLABEL "$1" 2>/dev/null | grep -qx 'EKFRASE-BOOT'; }

# O maior espaço livre de um disco GPT: "início fim setor" (em setores), ou nada.
livre() {
  local d=/dev/$1 s i f
  s=$(blockdev --getss "$d" 2>/dev/null) || return 0
  i=$(sgdisk -F "$d" 2>/dev/null | tail -1)
  f=$(sgdisk -E "$d" 2>/dev/null | tail -1)
  case "$i$f$s" in '' | *[!0-9]*) return 0 ;; esac
  [ "$f" -gt "$i" ] && echo "$i $f $s"
  return 0
}

consultar() {
  local n d tam tabela livre_i livre_b writer modelo p inicio
  dizer boot "$(lugar)"
  if [ -d /sys/firmware/efi ]; then dizer uefi sim; else dizer uefi nao; fi
  for n in $(internos); do
    d=/dev/$n
    tam=$(lsblk -bdno SIZE "$d" | tr -d ' ')
    tabela=$(lsblk -dno PTTYPE "$d" | tr -d ' ')
    livre_i=0
    livre_b=0
    if [ "$tabela" = gpt ]; then
      read -r i f s <<<"$(livre "$n")"
      if [ -n "${i:-}" ]; then
        livre_i=$((i * s))
        livre_b=$(((f - i + 1) * s))
      fi
    fi
    if tem_writer "$d"; then writer=sim; else writer=nao; fi
    modelo=$(limpo "$(lsblk -dno MODEL "$d" 2>/dev/null)")
    dizer disco "$n" "${tam:-0}" "$livre_i" "$livre_b" "${tabela:-nenhuma}" "$writer" "$modelo"
    for p in $(lsblk -nrpo NAME,TYPE "$d" | awk '$2 == "part" { print $1 }'); do
      inicio=$(cat "/sys/class/block/${p#/dev/}/start" 2>/dev/null || echo 0)
      dizer parte "$n" "$((inicio * 512))" "$(lsblk -bdno SIZE "$p" | tr -d ' ')" \
        "$(limpo "$(lsblk -dno FSTYPE "$p")")" "$(limpo "$(lsblk -dno PARTLABEL "$p")")" "$(limpo "$(lsblk -dno LABEL "$p")")"
    done
  done
  dizer fim
}

# ---------- instalar ----------

D=
N1=
N2=
CRIOU=0
APAGOU=0
NOVA=
ORDEM=

entradas_writer() {
  efibootmgr 2>/dev/null | awk -v nome="$NOME_ENTRADA" '
    /^Boot[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]/ {
      n = substr($0, 5, 4); d = $0
      sub(/^Boot[0-9A-Fa-f]+\*? /, "", d); sub(/\t.*/, "", d)
      if (d == nome) print n
    }'
}
ordem_atual() { efibootmgr 2>/dev/null | sed -n 's/^BootOrder: //p' | tr -d ' '; }

desfazer() {
  umount "$NOVO/dados" 2>/dev/null
  umount "$NOVO/boot" 2>/dev/null
  if [ "$CRIOU" = 1 ]; then
    diario "desfazendo: as partições $N1 e $N2 de $D saem"
    sgdisk -d "$N2" -d "$N1" "$D" >/dev/null 2>&1
    partx -u "$D" 2>/dev/null
  fi
  if [ -n "$NOVA" ]; then
    efibootmgr -q -b "$NOVA" -B 2>/dev/null
    [ -n "$ORDEM" ] && efibootmgr -q -o "$ORDEM" 2>/dev/null
  fi
}
falhar() {
  desfazer
  erro "$1"
}

# O dispositivo de uma partição pelo PARTUUID (o udev demora um pouco a criar o link).
pela_partuuid() {
  local k
  for k in $(seq 1 40); do
    if [ -e "/dev/disk/by-partuuid/$1" ]; then
      readlink -f "/dev/disk/by-partuuid/$1"
      return 0
    fi
    udevadm settle -t 2 2>/dev/null
    sleep 0.25
  done
  return 1
}

# Copia a partição de boot do pendrive, contando os bytes (o squashfs, de ~500 MB, em pedaços de 64 MB).
copiar_boot() {
  local total feito=0 f tam k parte
  total=$(du -sb "$MEDIO_DIR" | cut -f1)
  dizer passo copiar 0 "$total"
  (cd "$MEDIO_DIR" && find . -mindepth 1 -type d) | while IFS= read -r f; do mkdir -p "$NOVO/boot/$f" || exit 1; done || return 1
  while IFS= read -r f; do
    tam=$(stat -c %s "$MEDIO_DIR/$f") || return 1
    if [ "$tam" -gt 67108864 ]; then
      : >"$NOVO/boot/$f" || return 1
      k=0
      while [ $((k * 4194304)) -lt "$tam" ]; do
        dd if="$MEDIO_DIR/$f" of="$NOVO/boot/$f" bs=4M skip=$k seek=$k count=16 conv=notrunc status=none || return 1
        k=$((k + 16))
        parte=$((k * 4194304))
        [ "$parte" -le "$tam" ] || parte=$tam
        dizer passo copiar "$((feito + parte))" "$total"
      done
    else
      cp -P "$MEDIO_DIR/$f" "$NOVO/boot/$f" || return 1
    fi
    feito=$((feito + tam))
    dizer passo copiar "$feito" "$total"
  done < <(cd "$MEDIO_DIR" && find . -type f)
}

# Nada segura o disco: nenhuma partição dele aberta por LVM, RAID ou criptografia (um holder no /sys).
livre_de_holders() {
  local h
  for h in /sys/block/$1/holders /sys/block/$1/$1*/holders; do
    [ -d "$h" ] || continue
    [ -z "$(ls -A "$h" 2>/dev/null)" ] || return 1
  done
  return 0
}

# APAGAR O DISCO INTEIRO (só o apagar-tudo): as assinaturas de cada partição (o NTFS, o ext4, o BitLocker não ficam
# para trás), as do disco e as duas cópias da GPT; depois uma GPT nova, vazia, e o kernel relê.
apagar_disco() {
  local p
  dizer passo apagar
  APAGOU=1
  diario "apagando $D inteiro ($(lsblk -bdno SIZE "$D" | tr -d ' ') bytes)"
  for p in $(lsblk -nrpo NAME,TYPE "$D" | awk '$2 == "part" { print $1 }'); do
    wipefs -a -q "$p" >/dev/null 2>&1
  done
  wipefs -a -q "$D" >/dev/null 2>&1
  sgdisk -Z "$D" >/dev/null 2>&1
  sgdisk -o "$D" >/dev/null || return 1
  blockdev --rereadpt "$D" 2>/dev/null || partx -u "$D" 2>/dev/null
  udevadm settle -t 10 2>/dev/null
  [ "$(lsblk -nro TYPE "$D" | grep -c part)" = 0 ] || return 1
  [ "$(blkid -p -o value -s PTTYPE "$D" 2>/dev/null)" = gpt ]
}

instalar() {
  local n=$1 levar=$2 modo=$3 bytes=${4:-} i f s alinha boot_s minimo maximo b_fim d_ini d_fim antes usados k pu1 pu2 p1 p2 trab origem sj c outro
  exec 9>/run/ekfrase/instalar.trava
  flock -n 9 || erro ocupado
  [ "$(lugar)" = usb ] || erro nao-usb
  [ -d /sys/firmware/efi ] || erro nao-uefi
  internos | grep -qx "$n" || erro disco
  D=/dev/$n
  [ -b "$D" ] || erro disco
  [ "$(lsblk -dno RO "$D" | tr -d ' ')" = 0 ] || erro disco
  # o Writer OS nunca monta o disco interno; se algo dele estiver montado (ou é swap ativo), não é hora de mexer
  ! lsblk -nro MOUNTPOINT "$D" | grep -q . || erro disco
  # o Writer OS em outro disco: a entrada de boot dele sairia (só há uma "Ekfrase Writer OS")
  for outro in $(internos); do
    [ "$outro" = "$n" ] || ! tem_writer "/dev/$outro" || erro ja-instalado
  done
  minimo=$((MINIMO_GIB * 1073741824))

  if [ "$modo" = disco-todo ]; then
    # o tamanho que a tela mostrou: outro disco (trocado no meio) não bate
    [ "$(lsblk -bdno SIZE "$D" | tr -d ' ')" = "$bytes" ] || erro disco
    [ "$bytes" -ge $((minimo + BOOT_MIB * 1048576)) ] || erro sem-espaco
    livre_de_holders "$n" || erro disco
    apagar_disco || erro disco
  else
    [ "$(lsblk -dno PTTYPE "$D" | tr -d ' ')" = gpt ] || erro nao-gpt
    ! tem_writer "$D" || erro ja-instalado
  fi

  read -r i f s <<<"$(livre "$n")"
  [ -n "${i:-}" ] || erro sem-espaco
  alinha=$((1048576 / s))
  i=$(((i + alinha - 1) / alinha * alinha))
  boot_s=$((BOOT_MIB * 1048576 / s))
  minimo=$((minimo / s))
  maximo=$((MAXIMO_GIB * 1073741824 / s))
  [ $((f - i + 1)) -ge "$minimo" ] || erro sem-espaco
  # ao lado do Windows, até 32 GiB; no disco todo, a partição de dados fica com tudo o que sobra
  [ "$modo" = disco-todo ] || [ $((f - i + 1)) -le "$maximo" ] || f=$((i + maximo - 1))
  b_fim=$((i + boot_s - 1))
  d_ini=$((b_fim + 1))
  d_fim=$(((f + 1) / alinha * alinha - 1))

  # os dois primeiros números de partição livres
  usados=$(sgdisk -p "$D" 2>/dev/null | awk '/^ +[0-9]+ +[0-9]+ +[0-9]+ / { print $1 }')
  for k in $(seq 1 128); do
    grep -qx "$k" <<<"$usados" && continue
    if [ -z "$N1" ]; then N1=$k; else
      N2=$k
      break
    fi
  done
  [ -n "$N2" ] || erro disco
  antes=$(sgdisk -p "$D" 2>/dev/null | awk '/^ +[0-9]+ +[0-9]+ +[0-9]+ /')
  diario "em $D: EKFRASE-BOOT ($N1) $i-$b_fim, EKFRASE-DADOS ($N2) $d_ini-$d_fim, setor $s"

  dizer passo particoes
  CRIOU=1
  sgdisk -a "$alinha" -n "$N1:$i:$b_fim" -t "$N1:EF00" -c "$N1:EKFRASE-BOOT" \
    -n "$N2:$d_ini:$d_fim" -t "$N2:8300" -c "$N2:EKFRASE-DADOS" "$D" >/dev/null || falhar disco
  # as partições de antes continuam exatamente iguais (número, início, fim, tipo, nome)
  while IFS= read -r k; do
    [ -z "$k" ] || sgdisk -p "$D" 2>/dev/null | grep -qxF "$k" || falhar disco
  done <<<"$antes"
  partx -u "$D" 2>/dev/null || partx -a "$D" 2>/dev/null
  udevadm settle -t 10 2>/dev/null
  pu1=$(sgdisk -i "$N1" "$D" 2>/dev/null | sed -n 's/^Partition unique GUID: //p' | tr 'A-F' 'a-f')
  pu2=$(sgdisk -i "$N2" "$D" 2>/dev/null | sed -n 's/^Partition unique GUID: //p' | tr 'A-F' 'a-f')
  [[ $pu1 =~ ^[0-9a-f-]{36}$ && $pu2 =~ ^[0-9a-f-]{36}$ ]] || falhar disco
  p1=$(pela_partuuid "$pu1") || falhar disco
  p2=$(pela_partuuid "$pu2") || falhar disco
  mkfs.vfat -F 32 -n EKFR-BOOT "$p1" >/dev/null || falhar disco
  mkfs.exfat -L EKFR-DADOS "$p2" >/dev/null || falhar disco

  mkdir -p "$NOVO/boot" "$NOVO/dados"
  mount -t vfat -o noexec,nosuid,nodev "$p1" "$NOVO/boot" || falhar disco
  copiar_boot || falhar copia

  dizer passo conferir
  trab=$(mktemp -d) || falhar copia
  (cd "$MEDIO_DIR" && find . -type f -print0 | sort -z | xargs -0 sha256sum) >"$trab/somas" || falhar copia
  sync
  echo 3 >/proc/sys/vm/drop_caches
  (cd "$NOVO/boot" && sha256sum --quiet --strict -c "$trab/somas") >/dev/null 2>&1 || falhar copia
  # o GRUB do disco acha a partição de dados pelo PARTUUID (o live-media ele já tira da partição de onde ligou)
  for c in EFI/BOOT/grub.cfg EFI/debian/grub.cfg boot/grub/grub.cfg; do
    [ -f "$NOVO/boot/$c" ] || falhar copia
    sed -i "s|^\(  linux /live/vmlinuz .*\)\$|\1 ekfrase.dados=$pu2|" "$NOVO/boot/$c" || falhar copia
    grep -q " ekfrase.dados=$pu2\$" "$NOVO/boot/$c" || falhar copia
  done
  [ ! -e "$NOVO/boot/EFI/BOOT/fbx64.efi" ] || falhar copia
  sync

  dizer passo textos
  mount -t exfat -o noexec,nosuid,nodev "$p2" "$NOVO/dados" || falhar disco
  mkdir -p "$NOVO/dados/Ekfrase Writer" || falhar textos
  origem=
  if mountpoint -q /dados && [ -d "/dados/Ekfrase Writer" ]; then
    origem="/dados/Ekfrase Writer"
  elif [ -d "/run/ekfrase/ram/Ekfrase Writer" ]; then
    origem="/run/ekfrase/ram/Ekfrase Writer"
  fi
  if [ "$levar" = levar ] && [ -n "$origem" ]; then
    # a casca já gravou e fechou os bancos (o WAL entrou no arquivo); os diagnósticos do pendrive ficam nele
    (cd "$origem" && find . -mindepth 1 -maxdepth 1 ! -name .diagnostico -print0 | xargs -0 -r cp -rP --no-preserve=all -t "$NOVO/dados/Ekfrase Writer/") || falhar textos
  else
    # só o idioma, o teclado e o fuso do primeiro uso
    for sj in "$origem/sistema.json" /run/ekfrase/sistema.json; do
      if [ -f "$sj" ] && [ ! -L "$sj" ]; then
        cp --no-preserve=all "$sj" "$NOVO/dados/Ekfrase Writer/sistema.json" || falhar textos
        break
      fi
    done
  fi
  sync
  umount "$NOVO/dados" || falhar textos
  umount "$NOVO/boot" || falhar copia

  dizer passo entrada
  # uma entrada com o mesmo nome que sobrou de uma instalação apagada sem o Gravador sai antes
  for k in $(entradas_writer); do efibootmgr -q -b "$k" -B >/dev/null 2>&1; done
  ORDEM=$(ordem_atual)
  efibootmgr -q -c -d "$D" -p "$N1" -L "$NOME_ENTRADA" -l '\EFI\BOOT\BOOTX64.EFI' >/dev/null 2>&1 || falhar entrada
  NOVA=$(entradas_writer | head -1)
  [ -n "$NOVA" ] || falhar entrada
  if [ "$modo" = disco-todo ]; then
    # não há outro sistema neste disco: o Writer OS liga primeiro (o resto da ordem fica atrás, como estava)
    c="$NOVA${ORDEM:+,$ORDEM}"
  else
    # o efibootmgr põe a nova em primeiro; volta a ordem de antes, com a nova no fim (aparece no menu do F12)
    c="${ORDEM:+$ORDEM,}$NOVA"
  fi
  efibootmgr -q -o "$c" >/dev/null 2>&1 || falhar entrada
  [ "$(ordem_atual)" = "$c" ] || falhar entrada
  diario "instalado em $D ($modo; partições $N1 e $N2; entrada Boot$NOVA, ordem $c)"
  dizer ok
}

IFS= read -r -t 10 LINHA || exit 0
LINHA=${LINHA%$'\r'}
if [ "$LINHA" = consultar ]; then
  consultar
elif [[ $LINHA =~ ^instalar\ (nvme[0-9]+n[0-9]+|sd[a-z]+|vd[a-z]+|mmcblk[0-9]+)\ (levar|nao-levar)$ ]]; then
  diario "pedido: $LINHA"
  instalar "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" ao-lado
elif [[ $LINHA =~ ^apagar-tudo\ (nvme[0-9]+n[0-9]+|sd[a-z]+|vd[a-z]+|mmcblk[0-9]+)\ ([1-9][0-9]{0,19})\ (levar|nao-levar)$ ]]; then
  diario "pedido: $LINHA"
  instalar "${BASH_REMATCH[1]}" "${BASH_REMATCH[3]}" disco-todo "${BASH_REMATCH[2]}"
else
  erro pedido
fi
