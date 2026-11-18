// SPDX-License-Identifier: MPL-2.0
/**
 * Monta a casca do Ekfrase Writer (o app do computador). Da raiz do repositório:
 *
 *   npm run casca                  monta e abre (o Electron desta pasta: `npm ci` aqui antes)
 *   npm run casca -- --sem-abrir   só monta (dist/)
 *   npm run casca:instalador       monta e gera o instalador deste sistema (Windows: NSIS; Linux: AppImage)
 *   node …/montar.ts --os          a pasta da casca para o Writer OS (`electron-builder --linux dir`:
 *                                  `instalador/linux-unpacked/`, que a imagem põe em `/opt/ekfrase-writer`; só no Linux)
 *   node …/montar.ts --os-cog      PARADO (P3b, 18/11): o Writer OS SEM o Electron, `instalador/writer-os/` (o serviço no
 *                                  Node + o Cog; ver `montarOS`). Não reduziu a imagem e o boot lento era o live-boot
 *                                  (DEC-P071); fica testado pelo `npm run teclado -- --so-os-cog`, fora da imagem.
 *
 * Opções: `--sem-writer` usa o `apps/writer/dist` que já existe (não faz o build do app de novo).
 *
 * O que vai para `dist/` (é o que o instalador leva):
 *   app/           o build do MESMO `apps/writer` do site (servido em `app://writer/`)
 *   main.cjs       o processo principal (src/writer/main.ts + src/motor + o núcleo do Writer)
 *   preload.cjs    a ponte para a página (sozinho, num arquivo: o preload com sandbox não importa nada)
 *   nativo/        o binário do SQLite cifrado deste sistema (N-API: o mesmo do Node serve no Electron)
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

export const CASCA = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RAIZ = join(CASCA, '..', '..', '..');
const WRITER = join(RAIZ, 'apps', 'writer');
const DIST = join(CASCA, 'dist');

const externos = ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

/** Um arquivo CommonJS só, sem pedaços (o preload com sandbox não consegue importar outro arquivo). */
async function empacotar(entrada: string, nome: string, saida = DIST, alvo = 'node22'): Promise<void> {
  await build({
    configFile: false,
    root: CASCA,
    logLevel: 'warn',
    resolve: { conditions: ['node'] },
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: entrada,
      outDir: saida,
      emptyOutDir: false,
      target: alvo,
      minify: false,
      sourcemap: false,
      copyPublicDir: false,
      rollupOptions: {
        external: externos,
        output: { format: 'cjs', entryFileNames: `${nome}.cjs`, codeSplitting: false },
      },
    },
  });
}

/** O binário do SQLite cifrado da plataforma (`win32-x64`, `linux-x64`…). */
export function binarioNativo(plataforma = `${process.platform}-${process.arch}`): string {
  const pacote = dirname(createRequire(join(RAIZ, 'package.json')).resolve('better-sqlite3-multiple-ciphers/package.json'));
  const f = join(pacote, 'prebuilds', `${plataforma}.node`);
  if (!existsSync(f)) throw new Error(`sem o binário do SQLite para ${plataforma} (${f})`);
  return f;
}

export async function montar(opcoes: { semWriter?: boolean } = {}): Promise<void> {
  if (!opcoes.semWriter || !existsSync(join(WRITER, 'dist', 'index.html'))) {
    console.log('Build do Writer…');
    await build({ root: WRITER, logLevel: 'warn' });
  }
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  cpSync(join(WRITER, 'dist'), join(DIST, 'app'), { recursive: true });
  console.log('Processo principal e preload…');
  await empacotar('src/writer/main.ts', 'main');
  await empacotar('src/writer/preload.ts', 'preload');
  mkdirSync(join(DIST, 'nativo'), { recursive: true });
  cpSync(binarioNativo(), join(DIST, 'nativo', 'better_sqlite3.node'));
  console.log(`Casca montada em ${DIST}`);
}

/** A pasta da casca do Writer OS sem o Electron (`montar.ts --os-cog`; parada desde o P3b). */
export const OS = join(CASCA, 'instalador', 'writer-os');

/**
 * A casca do Writer OS SEM o Electron (prompt P3; PARADA no P3b, DEC-P071: a imagem voltou ao Electron): o mesmo app,
 * os mesmos canais, outro dono. Para voltar a ela na imagem: o bloco do Cog no `imagem/montar.sh`, o `pacotes.txt`, o
 * `30-casca.sh`, o `rodar.sh` e o `ekfrase-sessao.sh` do commit e5a2e66 (`git show e5a2e66:<arquivo>`).
 *   ekfrase-writer      o lançador (o Cage abre este): o Node da casca com o serviço
 *   node                o Node deste build (só no Linux): o do .nvmrc, o mesmo dos testes
 *   servico-os.cjs      o serviço (src/writer/servico-os.ts + o Motor + o núcleo), para o Node 20 do trixie
 *   ponte-pagina.js     a ponte da página (um IIFE; o Cog o injeta antes de tudo, como o preload)
 *   app/                o build do Writer · nativo/ o SQLite cifrado (N-API: o mesmo binário serve no Node do Debian)
 *   package.json        só o nome e a versão
 */
export async function montarOS(opcoes: { semWriter?: boolean } = {}): Promise<string> {
  await montar(opcoes);
  rmSync(OS, { recursive: true, force: true });
  mkdirSync(join(OS, 'nativo'), { recursive: true });
  cpSync(join(DIST, 'app'), join(OS, 'app'), { recursive: true });
  console.log('Serviço do Writer OS e a ponte da página…');
  await empacotar('src/writer/servico-os.ts', 'servico-os', OS, 'node20');
  await build({
    configFile: false,
    root: CASCA,
    logLevel: 'warn',
    build: {
      outDir: OS,
      emptyOutDir: false,
      target: 'es2022',
      minify: false,
      copyPublicDir: false,
      lib: { entry: join(CASCA, 'src', 'writer', 'ponte-pagina.ts'), formats: ['iife'], name: 'ekfrasePontePagina', fileName: () => 'ponte-pagina.js' },
    },
  });
  cpSync(binarioNativo(), join(OS, 'nativo', 'better_sqlite3.node'));
  // o Node que roda o serviço no pendrive: o MESMO deste build (o do .nvmrc, que os testes usam com este SQLite cifrado).
  // O Node 20 do Debian caía ao carregar o binário (teste.9, 18/11); só no Linux (no Windows o roteiro usa o Node local).
  if (process.platform === 'linux') cpSync(process.execPath, join(OS, 'node'));
  const pacote = JSON.parse(readFileSync(join(CASCA, 'package.json'), 'utf8')) as { name: string; version: string };
  writeFileSync(join(OS, 'package.json'), `${JSON.stringify({ name: pacote.name, version: pacote.version, private: true }, null, 2)}\n`);
  const lancador = [
    '#!/bin/sh',
    '# SPDX-License-Identifier: MPL-2.0',
    '# O Writer OS: o serviço do Writer no Node que vem com a casca (ele abre o Cog). O Cage abre este arquivo.',
    'exec /opt/ekfrase-writer/node /opt/ekfrase-writer/servico-os.cjs "$@"',
    '',
  ];
  writeFileSync(join(OS, 'ekfrase-writer'), lancador.join('\n'), { mode: 0o755 });
  console.log(`Casca do Writer OS montada em ${OS}`);
  return OS;
}

/** O executável do Electron desta pasta (`npm ci` em sistema/writer-os/casca). */
export function electron(): string {
  try {
    return createRequire(join(CASCA, 'package.json'))('electron') as unknown as string;
  } catch {
    throw new Error('O Electron da casca não está instalado: rode "npm ci" em sistema/writer-os/casca.');
  }
}

function instalador(os = false): number {
  if (os && process.platform !== 'linux') throw new Error('a casca do Writer OS só se monta no Linux (o binário do SQLite é o do Linux)');
  const alvo = os ? ['--linux', 'dir'] : process.platform === 'win32' ? ['--win', 'nsis'] : process.platform === 'linux' ? ['--linux', 'AppImage'] : [];
  if (!alvo.length) throw new Error(`instalador só para Windows e Linux (aqui: ${process.platform})`);
  const bin = join(CASCA, 'node_modules', 'electron-builder', 'cli.js');
  const r = spawnSync(process.execPath, [bin, ...alvo, '--x64', '--publish', 'never', '--config', 'electron-builder.yml'], { cwd: CASCA, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  return r.status ?? 1;
}

// rodado direto
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.includes('--os-cog')) {
    await montarOS({ semWriter: args.includes('--sem-writer') });
    process.exit(0);
  }
  await montar({ semWriter: args.includes('--sem-writer') });
  if (args.includes('--os')) process.exit(instalador(true));
  if (args.includes('--instalador')) process.exit(instalador());
  if (!args.includes('--sem-abrir')) {
    // sem ELECTRON_RUN_AS_NODE (o VS Code passa =1): com ela, o Electron vira um Node sem a API
    const { ELECTRON_RUN_AS_NODE: _comoNode, ...env } = process.env;
    const r = spawnSync(electron(), [CASCA], { stdio: 'inherit', env });
    process.exit(r.status ?? 0);
  }
}
