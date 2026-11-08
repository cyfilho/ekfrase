#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# Confere se cada commit do intervalo tem "Signed-off-by:" com o e-mail do autor (DCO 1.1).
# Uso: scripts/check-dco.sh BASE..HEAD
set -euo pipefail

range="${1:?uso: check-dco.sh BASE..HEAD}"
fail=0
for sha in $(git rev-list --no-merges "$range"); do
  email="$(git log -1 --format='%ae' "$sha")"
  subject="$(git log -1 --format='%s' "$sha")"
  if git log -1 --format='%B' "$sha" | grep -i '^Signed-off-by: ' | grep -qiF "<${email}>"; then
    echo "ok     ${sha:0:7} ${subject}"
  else
    echo "FALTA  ${sha:0:7} ${subject}  (esperado: Signed-off-by: Nome <${email}>)"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo
  echo "Algum commit está sem assinatura DCO. Quem fez o commit assina com: git commit --amend -s --no-edit"
  echo "(vários commits: git rebase --signoff <base>) e depois: git push --force-with-lease"
fi
exit "$fail"
