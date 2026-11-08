// SPDX-License-Identifier: MPL-2.0

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A raiz do repositório (as ferramentas de `scripts/` leem e gravam a partir daqui). */
export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
