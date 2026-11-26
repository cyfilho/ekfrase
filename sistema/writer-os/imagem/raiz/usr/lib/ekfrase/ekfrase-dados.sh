#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# A PARTIÇÃO DE DADOS do Writer OS (PLANO §6.1 e §6.1b). Roda como root, uma vez por boot, antes da
# sessão (ekfrase-dados.service), sem shell para ninguém:
#
#   - a memória: /run/ekfrase/ram (tmpfs de 256 MB, só do writer), o destino de última hora (§4.5);
#   - o disco de boot: o que está montado em /run/live/medium (remontado só leitura). Só mexe nele
#     se estiver no barramento USB (pendrive, SSD portátil, HD externo; nunca um disco interno);
#   - a partição EKFRASE-DADOS: se não existe e o disco só tem a partição de boot, cria com o resto
#     do disco (exFAT; ext4 a partir de 1 TB) e formata (rótulo EKFR-DADOS: o exFAT aceita só 11);
#   - confere (fsck) e monta em /dados (do writer, noexec, nosuid, nodev);
#   - o fuso escolhido no primeiro uso (sistema.json) vale de novo;
#   - conta o que achou em /run/ekfrase/dados.json: {"modo": "pendrive" | "sem-dados", "motivo": …,
#     "lugar": "usb" | "computador" | ""}.
#
# INSTALADO NO COMPUTADOR (PLANO §8c, ekfrase-instalar.sh): o disco de boot está fora do USB. Aí só vale a
# EKFRASE-DADOS que o instalador criou: a linha do kernel tem ekfrase.dados=<PARTUUID> (o grub.cfg do disco), a
# partição de onde o sistema ligou se chama EKFRASE-BOOT, e a de dados se chama EKFRASE-DADOS e está NO MESMO DISCO.
# No disco interno nunca cria nem formata nada; qualquer outra partição interna (o Windows) nunca é montada.
#
# Nunca apaga nem reformata uma partição que já existe.
set -u
PATH=/usr/sbin:/usr/bin:/sbin:/bin
RUN=/run/ekfrase
DADOS=/dados
PARTE_ROTULO=EKFRASE-DADOS
FS_ROTULO=EKFR-DADOS
MINIMO_MB=512
WRITER=1000

mkdir -p "$RUN" "$DADOS"
chmod 0755 "$RUN"

LUGAR=
relatar() {
  printf '{"modo":"%s","motivo":"%s","lugar":"%s"}\n' "$1" "$2" "$LUGAR" > "$RUN/dados.json"
  chmod 0644 "$RUN/dados.json"
  echo "ekfrase-dados: $1 $2"
  exit 0
}

mkdir -p "$RUN/ram"
# nosymfollow (revisão de segurança, achado 1): o kernel não segue link nenhum aqui dentro, nem para o root
mountpoint -q "$RUN/ram" || mount -t tmpfs -o size=256M,mode=0700,uid=$WRITER,gid=$WRITER,nosuid,nodev,noexec,nosymfollow tmpfs "$RUN/ram"

udevadm settle -t 30 || true

MEDIO=$(findmnt -no SOURCE /run/live/medium 2>/dev/null | head -1)
[ -n "$MEDIO" ] || relatar sem-dados sem-medio
mount -o remount,ro /run/live/medium 2>/dev/null || true
PAI=$(lsblk -no PKNAME "$MEDIO" 2>/dev/null | head -1 | tr -d ' ')
[ -n "$PAI" ] || relatar sem-dados sem-medio
DISCO=/dev/$PAI
[ -b "$DISCO" ] || relatar sem-dados sem-medio
if [ "$(lsblk -dno TRAN "$DISCO" | tr -d ' ')" = usb ]; then LUGAR=usb; else LUGAR=computador; fi
[ "$(lsblk -dno RO "$DISCO" | tr -d ' ')" != 1 ] || relatar sem-dados protegido

parte_dados() { lsblk -nrpo NAME,PARTLABEL "$DISCO" | awk -v r="$PARTE_ROTULO" '$2 == r { print $1; exit }'; }

if [ "$LUGAR" = computador ]; then
  PU=$(tr ' ' '\n' < /proc/cmdline | sed -n 's/^ekfrase\.dados=//p' | head -1)
  [[ $PU =~ ^[0-9a-f-]{36}$ ]] || relatar sem-dados nao-usb
  [ "$(lsblk -no PARTLABEL "$MEDIO" | head -1 | tr -d ' ')" = EKFRASE-BOOT ] || relatar sem-dados nao-usb
  PARTE=$(readlink -f "/dev/disk/by-partuuid/$PU")
  [ -b "$PARTE" ] || relatar sem-dados nao-monta
  [ "$(lsblk -no PKNAME "$PARTE" | head -1 | tr -d ' ')" = "$PAI" ] || relatar sem-dados nao-usb
  [ "$(lsblk -no PARTLABEL "$PARTE" | head -1 | tr -d ' ')" = "$PARTE_ROTULO" ] || relatar sem-dados nao-usb
else
  PARTE=$(parte_dados)
fi
if [ -z "$PARTE" ]; then
  # só num disco que tem SÓ a partição de boot: nunca mexe numa partição de outra pessoa
  [ "$(lsblk -nrpo TYPE "$DISCO" | grep -c '^part$')" = 1 ] || relatar sem-dados outras-particoes
  # a imagem é menor que o disco: a cópia da GPT vai para o fim de verdade
  sgdisk -e "$DISCO" >/dev/null 2>&1 || true
  INICIO=$(sgdisk -F "$DISCO" 2>/dev/null | tail -1)
  FIM=$(sgdisk -E "$DISCO" 2>/dev/null | tail -1)
  SETOR=$(blockdev --getss "$DISCO")
  case "$INICIO$FIM" in '' | *[!0-9]*) relatar sem-dados sem-espaco ;; esac
  [ $(((FIM - INICIO + 1) * SETOR / 1048576)) -ge $MINIMO_MB ] || relatar sem-dados sem-espaco
  if [ "$(lsblk -bdno SIZE "$DISCO" | tr -d ' ')" -ge 1000000000000 ]; then FS=ext4 TIPO=8300; else FS=exfat TIPO=0700; fi
  sgdisk -n "2:$INICIO:$FIM" -t "2:$TIPO" -c "2:$PARTE_ROTULO" "$DISCO" >/dev/null || relatar sem-dados nao-cria
  # a partição 1 está em uso: o kernel aprende só a nova
  partx -a -n 2 "$DISCO" 2>/dev/null || partx -u "$DISCO" 2>/dev/null || true
  udevadm settle -t 30 || true
  PARTE=$(parte_dados)
  [ -n "$PARTE" ] || relatar sem-dados nao-cria
  if [ "$FS" = ext4 ]; then
    mkfs.ext4 -q -F -L "$FS_ROTULO" -E root_owner=$WRITER:$WRITER "$PARTE" || relatar sem-dados nao-formata
  else
    mkfs.exfat -L "$FS_ROTULO" "$PARTE" >/dev/null || relatar sem-dados nao-formata
  fi
  echo "ekfrase-dados: criei $PARTE ($FS)"
fi

TIPO_FS=$(blkid -o value -s TYPE "$PARTE" 2>/dev/null)
case "$TIPO_FS" in
  exfat)
    # tirar o pendrive no susto deixa o exFAT "sujo": conserta antes de montar
    fsck.exfat -y "$PARTE" >/dev/null 2>&1 || true
    mount -t exfat -o uid=$WRITER,gid=$WRITER,fmask=0077,dmask=0077,noexec,nosuid,nodev,noatime,nosymfollow "$PARTE" "$DADOS" || relatar sem-dados nao-monta
    ;;
  ext4)
    e2fsck -p "$PARTE" >/dev/null 2>&1 || true
    mount -t ext4 -o noexec,nosuid,nodev,noatime,nosymfollow "$PARTE" "$DADOS" || relatar sem-dados nao-monta
    chown $WRITER:$WRITER "$DADOS"
    chmod 0700 "$DADOS"
    ;;
  *) relatar sem-dados nao-monta ;;
esac

# A PARTIÇÃO É DO WRITER (no ext4, ele pode deixar links nela; achado 1 da revisão de segurança): o root nunca segue
# um nome que já estava lá. O nosymfollow da montagem já barra; aqui vai a segunda camada.
GRAVA=$(mktemp -p "$DADOS" .ekfrase-grava.XXXXXX 2>/dev/null) && rm -f -- "$GRAVA" || {
  umount "$DADOS" || true
  relatar sem-dados nao-grava
}
PASTA_APP="$DADOS/Ekfrase Writer"
if [ -L "$PASTA_APP" ] || { [ -e "$PASTA_APP" ] && [ ! -d "$PASTA_APP" ]; }; then
  echo "ekfrase-dados: '$PASTA_APP' não é uma pasta de verdade (link?): a partição fica de fora"
  umount "$DADOS" || true
  relatar sem-dados nao-grava
fi
mkdir -p -- "$PASTA_APP"
[ "$TIPO_FS" = exfat ] || chown -h "$WRITER:$WRITER" -- "$PASTA_APP"

# o fuso do primeiro uso (o /etc está na memória: volta ao padrão a cada boot)
SJ="$PASTA_APP/sistema.json"
if [ -f "$SJ" ] && [ ! -L "$SJ" ]; then
  FUSO=$(grep -o '"fuso"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_+/-]*"' "$SJ" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  case "$FUSO" in
    '' | *..*) ;;
    *)
      if [ -f "/usr/share/zoneinfo/$FUSO" ]; then
        # o relógio da placa guarda a hora LOCAL (/etc/adjtime = LOCAL, como o Windows; 18/11), e o systemd a leu no
        # fuso padrão da imagem. No fuso escolhido, a mesma hora da placa é outro instante: anda a diferença.
        # (A hora da rede, se houver, chega depois: o chrony começa depois deste serviço.)
        segundos() { local z=$1 s=1; [ "${z:0:1}" = - ] && s=-1; echo $((s * (10#${z:1:2} * 3600 + 10#${z:3:2} * 60))); }
        ANTES=$(segundos "$(date +%z)")
        ln -sf "/usr/share/zoneinfo/$FUSO" /etc/localtime
        DEPOIS=$(segundos "$(date +%z)")
        if [ "$ANTES" != "$DEPOIS" ]; then
          date -s "@$(($(date +%s) + ANTES - DEPOIS))" >/dev/null || true
        fi
      fi
      ;;
  esac
fi

relatar pendrive ""
