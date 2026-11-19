#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
#
# O WRITER OS SE ATUALIZA (docs/ATUALIZACOES.md §4, U1): duas cópias do sistema na EKFR-BOOT, live/ (A) e live-b/ (B).
# A nova vai para a cópia que não está ligada; o GRUB liga por ela no máximo duas vezes sem confirmação e, na terceira,
# volta sozinho para a de antes (grub.cfg.modelo). Os textos (na EKFRASE-DADOS) nunca são tocados.
#
# Roda como root, um pedido por conexão (ekfrase-atualizar.socket, Accept=yes: a entrada e a saída são o próprio
# socket, que só o grupo writer abre). Lê UMA linha e só aceita, por expressão exata:
#
#   estado              a versão e o lado de agora, a cópia de reserva, a nova que espera ligar e a que falhou
#   aplicar <versão>    grava a versão (já baixada pela casca em /dados/Ekfrase Writer/.atualizacao/<versão>/) na
#                       cópia de reserva e marca no grubenv que a próxima vez liga por ela
#   confirmar           a casca abriu a janela do Writer pela cópia nova: ela passa a ser a que vale
#
# O aplicar NÃO confia no que a casca (o usuário writer) baixou: copia o manifesto para cá, confere DE NOVO o lacre com
# a chave embutida (/usr/share/ekfrase/atualizacao.pub; na imagem de teste, também a chave de teste), a versão (maior
# que a de agora; o canal estável só aceita estável) e, DEPOIS de copiar cada arquivo para a partição de boot (onde o
# writer não grava), o SHA-256 da cópia, lida de volta do disco. A ordem das escritas faz a falta de energia nunca
# estragar o que liga: a cópia em /<outro>.novo/, a troca de nome, o grub.cfg (pelo .novo + troca de nome, nos três
# lugares), e o grubenv por último.
#
# Saída: uma linha por vez, campos separados por TAB (a casca lê: casca/src/motor/sistema.ts, lerEstadoBoot).
#   estado     lado <lado> <versão> · atual <lado> · reserva <lado> <versão> · novo <lado> <versão> <tentativas>
#              · falhou <lado> <versão> · fim
#   aplicar    passo <copiar|conferir|grub> [feito total] … · ok | erro <código>
#   confirmar  ok | erro <código>
set -u
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C
umask 077

T=$'\t'
MEDIO=/run/live/medium
ENV=$MEDIO/boot/grub/grubenv
CHAVE=/usr/share/ekfrase/atualizacao.pub
CHAVE_TESTE=/usr/share/ekfrase/atualizacao-teste.pub
BAIXADAS='/dados/Ekfrase Writer/.atualizacao'
APP=ekfrase-writer-os
NOME_APP='Ekfrase Writer OS'
CFGS='EFI/BOOT/grub.cfg EFI/debian/grub.cfg boot/grub/grub.cfg'

dizer() {
  local IFS="$T"
  printf '%s\n' "$*"
}
diario() { echo "ekfrase-atualizar: $*" >&2; }
erro() {
  diario "erro $1"
  dizer erro "$1"
  exit 0
}

# o lado de agora: o live-media-path que o GRUB passou ao kernel
LADO=$(tr ' ' '\n' </proc/cmdline | sed -n 's|^live-media-path=/||p' | head -1)
case "$LADO" in live | live-b) ;; *) LADO=live ;; esac
outro_de() { if [ "$1" = live ]; then echo live-b; else echo live; fi; }

# uma variável do grubenv (só letras, números, ponto e traço: o resto não é nosso)
ler_env() {
  [ -f "$ENV" ] || return 0
  sed -n "s/^$1=//p" "$ENV" | head -1 | tr -cd 'a-z0-9.-'
}

# o grubenv INTEIRO de novo (o formato do grub-editenv: cabeçalho, as variáveis não vazias, '#' até 1024 bytes),
# pelo .novo + troca de nome
escrever_env() {
  local conteudo par novo="$ENV.novo"
  conteudo="# GRUB Environment Block"$'\n'
  for par in "$@"; do
    [ -n "${par#*=}" ] && conteudo+="$par"$'\n'
  done
  { printf '%s' "$conteudo"; head -c 1024 /dev/zero | tr '\0' '#'; } | head -c 1024 >"$novo" || return 1
  [ "$(stat -c %s "$novo")" = 1024 ] || return 1
  sync
  mv -f "$novo" "$ENV" || return 1
  sync
}

# a versão de uma cópia (o arquivo versao dela; a de agora, se falta, é a do sistema que está rodando)
versao_do_lado() {
  local v=
  [ -f "$MEDIO/$1/versao" ] && v=$(head -c 40 "$MEDIO/$1/versao" | tr -cd '0-9a-z.-')
  [ -z "$v" ] && [ "$1" = "$LADO" ] && v=$(head -c 40 /etc/ekfrase/versao 2>/dev/null | tr -cd '0-9a-z.-')
  printf '%s' "${v:-?}"
}

# [maior menor correção teste] de uma versão (a estável vale mais que as de teste dela)
partes_versao() {
  [[ $1 =~ ^([0-9]{1,6})\.([0-9]{1,6})\.([0-9]{1,6})(-teste\.([0-9]{1,6}))?$ ]] || return 1
  echo "$((10#${BASH_REMATCH[1]})) $((10#${BASH_REMATCH[2]})) $((10#${BASH_REMATCH[3]})) $((10#${BASH_REMATCH[5]:-9999999}))"
}
# $1 é mais nova que $2?
maior() {
  local a b i
  read -ra a <<<"$(partes_versao "$1")"
  read -ra b <<<"$(partes_versao "$2")"
  [ "${#a[@]}" = 4 ] || return 1
  [ "${#b[@]}" = 4 ] || return 0
  for i in 0 1 2 3; do
    [ "${a[i]}" -gt "${b[i]}" ] && return 0
    [ "${a[i]}" -lt "${b[i]}" ] && return 1
  done
  return 1
}

medio_ok() { [ "$(findmnt -no FSTYPE "$MEDIO" 2>/dev/null | head -1)" = vfat ] && [ -f "$ENV" ]; }
REMONTOU=0
gravavel() {
  mount -o remount,rw "$MEDIO" 2>/dev/null || return 1
  REMONTOU=1
}
so_leitura() {
  [ "$REMONTOU" = 1 ] || return 0
  sync
  mount -o remount,ro "$MEDIO" 2>/dev/null
  REMONTOU=0
}
trap so_leitura EXIT

travar() {
  exec 9>/run/ekfrase/atualizar.trava
  flock -w "$1" 9 || erro ocupado
}

# ---------- estado ----------

estado() {
  local atual novo tentou falhou reserva
  atual=$(ler_env ekfrase_atual)
  [ "$atual" = live-b ] || atual=live
  novo=$(ler_env ekfrase_novo)
  tentou=$(ler_env ekfrase_tentou)
  falhou=$(ler_env ekfrase_falhou)
  dizer lado "$LADO" "$(versao_do_lado "$LADO")"
  dizer atual "$atual"
  reserva=$(outro_de "$LADO")
  [ -e "$MEDIO/$reserva/vmlinuz" ] && dizer reserva "$reserva" "$(versao_do_lado "$reserva")"
  case "$novo" in live | live-b) dizer novo "$novo" "$(versao_do_lado "$novo")" "${tentou:-0}" ;; esac
  case "$falhou" in live | live-b) dizer falhou "$falhou" "$(versao_do_lado "$falhou")" ;; esac
  dizer fim
}

# ---------- confirmar ----------

confirmar() {
  local atual novo falhou
  travar 30
  medio_ok || erro medio
  atual=$(ler_env ekfrase_atual)
  [ "$atual" = live-b ] || atual=live
  novo=$(ler_env ekfrase_novo)
  falhou=$(ler_env ekfrase_falhou)
  if [ "$novo" = "$LADO" ]; then
    # ligou pela nova: ela vale, e a de antes fica de reserva
    gravavel || erro medio
    escrever_env "ekfrase_atual=$LADO" || erro grubenv
    diario "confirmada a cópia $LADO ($(versao_do_lado "$LADO"))"
  elif [ -z "$novo" ] && [ "$atual" != "$LADO" ]; then
    gravavel || erro medio
    escrever_env "ekfrase_atual=$LADO" "ekfrase_falhou=$falhou" || erro grubenv
  fi
  dizer ok
}

# ---------- aplicar ----------

# copia $1 para $2 em pedaços de 64 MB, contando ($3 = o que já foi antes, $4 = o total)
copiar() {
  local tam k parte
  tam=$(stat -c %s "$1") || return 1
  : >"$2" || return 1
  k=0
  while [ $((k * 4194304)) -lt "$tam" ]; do
    dd if="$1" of="$2" bs=4M skip=$k seek=$k count=16 conv=notrunc status=none || return 1
    k=$((k + 16))
    parte=$((k * 4194304))
    [ "$parte" -le "$tam" ] || parte=$tam
    dizer passo copiar "$(($3 + parte))" "$4"
  done
  [ "$(stat -c %s "$2")" = "$tam" ]
}

aplicar() {
  local v=$1 agora canal dir man sig tmp k comentario papel linha nome tam sha f outro total feito livre falhou hash dados c
  local -A NOME TAM SHA
  travar 1
  medio_ok || erro medio
  [ "$(ler_env ekfrase_atual)" = "$LADO" ] || { [ "$LADO" = live ] && [ -z "$(ler_env ekfrase_atual)" ]; } || erro pendente
  agora=$(head -c 40 /etc/ekfrase/versao 2>/dev/null | tr -cd '0-9a-z.-')
  maior "$v" "$agora" || erro versao
  canal=$(head -c 10 /etc/ekfrase/canal 2>/dev/null | tr -cd 'a-z')
  [ "$canal" = teste ] || [[ $v != *-teste.* ]] || erro versao

  # o manifesto e o lacre, copiados para cá ANTES de conferir (o writer não troca o arquivo no meio)
  dir="$BAIXADAS/$v"
  man="$dir/$APP-$v.atualizacao.json"
  sig="$man.minisig"
  for f in "$man" "$sig"; do
    [ -f "$f" ] && [ ! -L "$f" ] || erro arquivos
  done
  [ "$(stat -c %s "$man")" -le 65536 ] && [ "$(stat -c %s "$sig")" -le 4096 ] || erro arquivos
  tmp=$(mktemp -d) || erro falhou
  cp "$man" "$tmp/m.json" && cp "$sig" "$tmp/m.json.minisig" || erro arquivos
  comentario=
  for k in "$CHAVE" "$CHAVE_TESTE"; do
    [ -f "$k" ] || continue
    # a chave de teste só existe na imagem de teste (zz-teste.squashfs) e só vale com o marcador dela
    [ "$k" = "$CHAVE" ] || [ -e /etc/ekfrase/teste ] || continue
    if comentario=$(minisign -V -Q -p "$k" -m "$tmp/m.json" -x "$tmp/m.json.minisig" 2>/dev/null); then break; fi
    comentario=
  done
  [ "$comentario" = "$NOME_APP $v atualizacao" ] || erro lacre
  jq -e --arg app "$APP" --arg v "$v" '.app == $app and .versao == $v and (.canal == "estavel" or .canal == "teste") and (.arquivos | type == "array")' "$tmp/m.json" >/dev/null 2>&1 || erro lacre
  total=4194304
  for papel in squashfs vmlinuz initrd grub.cfg; do
    linha=$(jq -r --arg p "$papel" '[.arquivos[] | select(.papel == $p)] | if length == 1 then (.[0] | "\(.nome)\t\(.tamanho)\t\(.sha256)") else "" end' "$tmp/m.json" 2>/dev/null)
    IFS="$T" read -r nome tam sha <<<"$linha"
    [[ ${nome:-} =~ ^[a-z0-9][a-z0-9.-]{0,120}$ && ${tam:-} =~ ^[1-9][0-9]{0,11}$ && ${sha:-} =~ ^[0-9a-f]{64}$ ]] || erro lacre
    f="$dir/$nome"
    [ -f "$f" ] && [ ! -L "$f" ] && [ "$(stat -c %s "$f")" = "$tam" ] || erro arquivos
    NOME[$papel]=$nome
    TAM[$papel]=$tam
    SHA[$papel]=$sha
    total=$((total + tam))
  done
  # o grub.cfg novo também vem para cá antes de conferir
  cp "$dir/${NOME[grub.cfg]}" "$tmp/grub.cfg" || erro arquivos
  [ "$(sha256sum "$tmp/grub.cfg" | cut -d' ' -f1)" = "${SHA[grub.cfg]}" ] || erro conferir

  outro=$(outro_de "$LADO")
  falhou=$(ler_env ekfrase_falhou)
  diario "aplicando $v na cópia $outro (agora: $LADO, $agora)"
  gravavel || erro medio
  # uma nova que ainda esperava ligar (aplicada e não reiniciada) sai da fila antes de a cópia dela ser apagada
  escrever_env "ekfrase_atual=$LADO" "ekfrase_falhou=$falhou" || erro grubenv
  rm -rf "${MEDIO:?}/$outro.novo" "${MEDIO:?}/$outro"
  # na imagem de teste, a nova continua de teste (o relato e o agente moram no zz-teste.squashfs)
  if [ -e /etc/ekfrase/teste ] && [ -f "$MEDIO/$LADO/zz-teste.squashfs" ]; then total=$((total + $(stat -c %s "$MEDIO/$LADO/zz-teste.squashfs"))); fi
  livre=$(df -B1 --output=avail "$MEDIO" | tail -1 | tr -d ' ')
  [ "${livre:-0}" -gt "$total" ] || erro sem-espaco

  mkdir "$MEDIO/$outro.novo" || erro falhou
  dizer passo copiar 0 "$total"
  feito=0
  copiar "$dir/${NOME[squashfs]}" "$MEDIO/$outro.novo/filesystem.squashfs" "$feito" "$total" || erro copia
  feito=$((feito + ${TAM[squashfs]}))
  copiar "$dir/${NOME[vmlinuz]}" "$MEDIO/$outro.novo/vmlinuz" "$feito" "$total" || erro copia
  feito=$((feito + ${TAM[vmlinuz]}))
  copiar "$dir/${NOME[initrd]}" "$MEDIO/$outro.novo/initrd.img" "$feito" "$total" || erro copia
  printf '%s\n' "$v" >"$MEDIO/$outro.novo/versao" || erro copia
  if [ -e /etc/ekfrase/teste ] && [ -f "$MEDIO/$LADO/zz-teste.squashfs" ]; then
    cp "$MEDIO/$LADO/zz-teste.squashfs" "$MEDIO/$outro.novo/zz-teste.squashfs" || erro copia
  fi

  # o que foi gravado, lido de volta do disco (o cache esvaziado), contra o manifesto
  dizer passo conferir
  sync
  echo 3 >/proc/sys/vm/drop_caches
  for papel in squashfs vmlinuz initrd; do
    case "$papel" in squashfs) f=filesystem.squashfs ;; vmlinuz) f=vmlinuz ;; initrd) f=initrd.img ;; esac
    if [ "$(sha256sum "$MEDIO/$outro.novo/$f" | cut -d' ' -f1)" != "${SHA[$papel]}" ]; then
      rm -rf "${MEDIO:?}/$outro.novo"
      erro conferir
    fi
  done
  mv "$MEDIO/$outro.novo" "$MEDIO/$outro" || erro copia
  sync

  # o grub.cfg novo, com a senha e o ekfrase.dados= do de agora (só se mudou)
  dizer passo grub
  hash=$(sed -n 's/^password_pbkdf2 ekfrase \(grub\.pbkdf2\.[A-Za-z0-9.]*\)$/\1/p' "$MEDIO/boot/grub/grub.cfg" | head -1)
  [ -n "$hash" ] || erro grub
  # SÓ da linha do kernel (o comentário do grub.cfg também fala em "ekfrase.dados=": pegar de lá apagava a partição
  # de dados do Writer OS instalado no disco, achado no CI em 19/11), e só um PARTUUID inteiro
  dados=$(sed -n 's/^  linux \/[$]ekfrase_lado\/vmlinuz .*\( ekfrase\.dados=[0-9a-f-]\{36\}\)$/\1/p' "$MEDIO/boot/grub/grub.cfg" | head -1)
  if grep -q '^  linux /[$]ekfrase_lado/vmlinuz .* ekfrase\.dados=' "$MEDIO/boot/grub/grub.cfg"; then [ -n "$dados" ] || erro grub; fi
  [ "$(grep -c '^password_pbkdf2 ekfrase @HASH@$' "$tmp/grub.cfg")" = 1 ] || erro grub
  [ "$(grep -c '^  linux /[$]ekfrase_lado/vmlinuz ' "$tmp/grub.cfg")" = 1 ] || erro grub
  sed -i "s|@HASH@|$hash|" "$tmp/grub.cfg" || erro grub
  if [ -n "$dados" ]; then sed -i "s|^\(  linux /[$]ekfrase_lado/vmlinuz .*\)\$|\1$dados|" "$tmp/grub.cfg" || erro grub; fi
  ! grep -q '@HASH@' "$tmp/grub.cfg" || erro grub
  if ! cmp -s "$tmp/grub.cfg" "$MEDIO/boot/grub/grub.cfg"; then
    for c in $CFGS; do
      cp "$tmp/grub.cfg" "$MEDIO/$c.novo" || erro grub
      sync
      mv -f "$MEDIO/$c.novo" "$MEDIO/$c" || erro grub
    done
    sync
  fi

  # por último: a próxima vez liga pela nova
  escrever_env "ekfrase_atual=$LADO" "ekfrase_novo=$outro" || erro grubenv
  rm -rf "$tmp"
  diario "pronta: $v na cópia $outro (vale no próximo boot)"
  dizer ok
}

IFS= read -r -t 10 LINHA || exit 0
LINHA=${LINHA%$'\r'}
if [ "$LINHA" = estado ]; then
  estado
elif [ "$LINHA" = confirmar ]; then
  confirmar
elif [[ $LINHA =~ ^aplicar\ ([0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(-teste\.[0-9]{1,6})?)$ ]]; then
  diario "pedido: $LINHA"
  aplicar "${BASH_REMATCH[1]}"
else
  erro pedido
fi
