#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# Dentro do sistema novo (chroot). O ÚLTIMO gancho (PLANO §7 e §8): o initrd final, nenhum SUID,
# e fora su, login, getty, pkexec, sudo, doas, apt e dpkg. FALHA se algum sobrar.
set -euo pipefail

echo "  initrd (live-boot + Plymouth + os módulos do pendrive)"
update-initramfs -u -k all >/dev/null
# o initrd sem os drivers de vídeo pesados (raiz/etc/initramfs-tools/hooks/ekfrase-video, P3b): confere o pronto
INITRD=$(ls /boot/initrd.img-* | sort -V | tail -1)
CONTEUDO=$(lsinitramfs "$INITRD")
pesado=$(grep -E '/(amdgpu|radeon|nouveau|xe)\.ko|/firmware/(amdgpu|radeon|nvidia)/' <<< "$CONTEUDO" || true)
[ -z "$pesado" ] || { echo "O initrd ainda leva drivers de vídeo pesados:"; head -5 <<< "$pesado"; exit 1; }
grep -q '/i915\.ko' <<< "$CONTEUDO" || { echo "O initrd ficou sem o i915 (a tela do boot nas placas Intel)"; exit 1; }
grep -q 'scripts/live' <<< "$CONTEUDO" || { echo "O initrd ficou sem o live-boot"; exit 1; }
echo "  initrd de $(du -m "$INITRD" | cut -f1) MB, sem amdgpu, radeon, nouveau e xe"

# nenhum programa SUID/SGID (o polkit decide o que o writer pode, pelo D-Bus)
find / -xdev -type f -perm /6000 -exec chmod u-s,g-s {} +

rm -f /usr/bin/su /bin/su /usr/sbin/agetty /sbin/agetty /usr/bin/login /bin/login \
  /usr/bin/pkexec /usr/bin/sudo /usr/bin/doas /usr/sbin/sulogin /sbin/sulogin

# apt e dpkg por último: depois deles, nada mais se instala
rm -rf /usr/bin/apt /usr/bin/apt-* /usr/bin/dpkg /usr/bin/dpkg-* /usr/sbin/dpkg-* /usr/lib/apt /usr/lib/dpkg \
  /etc/apt /var/lib/apt /var/cache/apt /var/lib/dpkg /var/log/apt /var/log/dpkg.log

# o que é só documentação sai; as licenças (copyright) ficam
find /usr/share/doc -type f ! -name copyright -delete 2>/dev/null || true
rm -rf /usr/share/man /usr/share/info

sobrou=0
for b in sudo su doas pkexec login agetty getty sulogin apt apt-get dpkg; do
  if command -v "$b" >/dev/null 2>&1; then
    echo "SOBROU: $b ($(command -v "$b"))"
    sobrou=1
  fi
done
suid=$(find / -xdev -type f -perm /6000 2>/dev/null || true)
if [ -n "$suid" ]; then
  echo "SOBROU SUID: $suid"
  sobrou=1
fi
[ "$sobrou" = 0 ] || exit 1
echo "  travas conferidas: sem sudo, su, login, getty, pkexec, apt, dpkg e sem SUID"

# os timers do apt e do dpkg (que já não existem) não acordam nunca
systemctl mask apt-daily.timer apt-daily-upgrade.timer dpkg-db-backup.timer >/dev/null 2>&1 || true

# O sistema já nasce "atualizado" (P3b): sem o /etc/.updated e o /var/.updated, o systemd acha a cada boot que o /usr
# mudou (ConditionNeedsUpdate) e roda o ldconfig e o catálogo do journal antes da sessão (~2 s no notebook, 17/11).
# Fica por último: os carimbos guardam a hora do /usr de agora.
/usr/lib/systemd/systemd-update-done
[ -s /etc/.updated ] && [ -s /var/.updated ] || { echo "Faltam o /etc/.updated e o /var/.updated"; exit 1; }
echo "  /etc e /var marcados como atualizados (sem ldconfig a cada boot)"
