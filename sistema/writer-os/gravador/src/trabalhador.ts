// SPDX-License-Identifier: MPL-2.0
// A entrada do processo que grava no Linux (vira dist/trabalhador.cjs):
//   pkexec /usr/bin/env ELECTRON_RUN_AS_NODE=1 <electron ou AppImage> <cópia do trabalhador.cjs> <tarefa.json>
// No Windows é o próprio executável do Gravador com --ekfrase-trabalhador (main.ts).
import { rodarTrabalhador } from './nucleo/trabalhador.ts';

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('uso: trabalhador.cjs <tarefa.json>');
  process.exit(2);
}
rodarTrabalhador(arquivo).then(
  (c) => process.exit(c),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
