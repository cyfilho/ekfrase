// SPDX-License-Identifier: MPL-2.0
/**
 * `npm run teclado`: o Writer inteiro só pelo teclado (PLANO §2.4), num navegador de verdade.
 * Faz o build do Writer, sobe o `vite preview` numa porta livre, roda `tests/teclado.spec.ts` e
 * desliga tudo. Sai com erro se algum passo falhar (o CI roda isto no Linux).
 *
 *   npm run teclado                 (com o build; depois, a casca do computador, se o Electron dela
 *                                   estiver instalado: `npm ci` em sistema/writer-os/casca)
 *   npm run teclado -- --sem-build  (usa o apps/writer/dist que já existe)
 *   npm run teclado -- --so-casca   (só a casca: tests/casca.spec.ts; no Linux sem tela, com xvfb-run)
 *
 * O navegador: o Chromium do Playwright (`npx playwright install chromium`). Se o download não
 * der certo neste computador, PLAYWRIGHT_DIR=<pasta com node_modules/playwright> usa outro (como o
 * de ~/.persis-teste/playwright do scripts/ver.ts).
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { BrowserType } from 'playwright';
import { build, preview } from 'vite';
import { abrirComElectron, percorrerCascaOS } from '../tests/casca-os.spec.ts';
import { percorrerCasca } from '../tests/casca.spec.ts';
import { percorrer } from '../tests/teclado.spec.ts';
import { RAIZ } from './raiz.ts';

const APP = join(RAIZ, 'apps', 'writer');

function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = createServer();
    s.once('error', falha);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const porta = typeof a === 'object' && a ? a.port : 0;
      s.close(() => ok(porta));
    });
  });
}

async function navegador(): Promise<BrowserType> {
  const dir = process.env['PLAYWRIGHT_DIR'];
  if (dir) return (createRequire(join(dir, 'package.json'))('playwright') as { chromium: BrowserType }).chromium;
  return (await import('playwright')).chromium;
}

const args = process.argv.slice(2);
const soOS = args.includes('--so-os');
const soCasca = args.includes('--so-casca') || soOS;
const falar = (l: string) => (l.startsWith('XX') ? console.error(l) : console.log(l));
let falhas = 0;

if (!args.includes('--sem-build') || soCasca) {
  console.log('Build do Writer…');
  await build({ root: APP, logLevel: 'warn' });
}

if (!soCasca) {
  const porta = await portaLivre();
  // sem a ponte: o roteiro escreve sem conta (o /api responde 404 e o app segue no aparelho)
  const servidor = await preview({ root: APP, logLevel: 'warn', preview: { host: '127.0.0.1', port: porta, strictPort: true, proxy: {} } });
  const url = `http://127.0.0.1:${porta}/writer/`;
  console.log(`Writer em ${url}`);
  falhas = 1;
  try {
    const nav = await (await navegador()).launch();
    try {
      const r = await percorrer(nav, url, falar);
      falhas = r.falhas.length;
      console.log(falhas ? `\n${falhas} de ${r.passos} passos falharam.` : `\nTeclado: ${r.passos} passos, tudo certo, sem nenhum evento de mouse.`);
    } finally {
      await nav.close();
    }
  } finally {
    await servidor.close();
  }
}

// ---- a casca do computador (Electron): só se o Electron dela estiver instalado (ou com --so-casca)
const { electron, montar } = await import('../sistema/writer-os/casca/scripts/montar.ts');
let executavel: string | null = null;
try {
  executavel = electron();
} catch (e) {
  if (soCasca) throw e;
  console.log('\n(A casca do computador ficou de fora: o Electron dela não está instalado. "npm ci" em sistema/writer-os/casca.)');
}
if (executavel) {
  console.log('\nCasca do computador…');
  await montar({ semWriter: true });
  const { _electron } = await import('playwright');
  const CASCA = join(RAIZ, 'sistema', 'writer-os', 'casca');
  // o VS Code (e outros apps feitos em Electron) passa ELECTRON_RUN_AS_NODE=1: com ela, o Electron vira um Node sem a API
  const { ELECTRON_RUN_AS_NODE: _comoNode, ...doSistema } = process.env;
  const abrir = abrirComElectron((env: Record<string, string>) => _electron.launch({ executablePath: executavel, args: [CASCA], env: { ...doSistema, ...env } as Record<string, string> }));
  if (!soOS) {
    const r = await percorrerCasca((env) => _electron.launch({ executablePath: executavel, args: [CASCA], env: { ...doSistema, ...env } as Record<string, string> }), falar);
    falhas += r.falhas.length;
    console.log(r.falhas.length ? `\n${r.falhas.length} de ${r.passos} passos da casca falharam.` : `\nCasca: ${r.passos} passos, tudo certo, sem nenhum evento de mouse.`);
  }
  // o Writer OS simulado (a mesma casca com EKFRASE_CASCA_OS=simulado: o primeiro uso, o painel, onde guardar)
  console.log('\nWriter OS (simulado)…');
  const o = await percorrerCascaOS(abrir, falar);
  falhas += o.falhas.length;
  console.log(o.falhas.length ? `\n${o.falhas.length} de ${o.passos} passos do Writer OS falharam.` : `\nWriter OS: ${o.passos} passos, tudo certo.`);
}
process.exit(falhas ? 1 : 0);
