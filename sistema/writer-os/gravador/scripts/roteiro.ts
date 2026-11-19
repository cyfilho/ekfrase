// SPDX-License-Identifier: MPL-2.0
/**
 * O ROTEIRO DO GRAVADOR, de ponta a ponta e SÓ PELO TECLADO (PLANO §2.4): `npm run gravador:roteiro`.
 * Abre o Gravador de verdade (Electron) com discos simulados (arquivos), um "GitHub" local que serve
 * o Release (a imagem `.img.xz` com o lacre de uma chave de teste) e confere:
 *
 *   1. o disco do sistema aparece travado; o pendrive escolhido pelo teclado;
 *   2. Criar: o nome do disco digitado, o download, o lacre, a gravação, a verificação, a EKFRASE-DADOS
 *      (a GPT do arquivo-disco tem as duas partições e a 1 é idêntica à da imagem); ejetar;
 *   3. Atualizar com "Já tenho a imagem" SEM lacre: o aviso vermelho e a frase; os dados ficam;
 *   4. nenhum evento de mouse; prints claro e escuro de cada passo (`--prints <pasta>`);
 *   5. (U2) o próprio Gravador se atualiza: o "GitHub" oferece um Gravador maior; automáticas troca o arquivo no lugar,
 *      a tela ↻ mostra a versão, "Perguntar" fica nos ajustes, Procurar agora e Instalar trocam pela 0.2.2.
 *
 * Opções: `--sem-montar` (usa o dist/ que existe), `--prints <pasta>`.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import { arquivosTeste, assinadorTeste, fat32, imagemTeste, MIB, sha256 } from '../../../../tests/gravador/imagem-teste.ts';
import { lerGpt, NOME_BOOT, NOME_DADOS } from '../src/nucleo/gpt.ts';
import { electron, GRAVADOR, montar } from './montar.ts';

const args = process.argv.slice(2);
const pastaPrints = args.includes('--prints') ? args[args.indexOf('--prints') + 1]! : null;
let passos = 0;
const falhas: string[] = [];
function ok(cond: unknown, msg: string): void {
  passos++;
  if (cond) console.log(`  ok  ${msg}`);
  else {
    falhas.push(msg);
    console.error(`XX    ${msg}`);
  }
}

/** O `xz` do sistema (no Windows, o que vem com o Git). */
function xz(arquivo: string): void {
  const opcoes = [process.env['XZ'], 'xz', 'C:\\Program Files\\Git\\usr\\bin\\xz.exe', 'C:\\Program Files\\Git\\ucrt64\\bin\\xz.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\xz.exe'].filter((x): x is string => !!x);
  for (const x of opcoes) {
    const r = spawnSync(x, ['-T0', '-3', '-f', '-k', arquivo]);
    if (r.status === 0) return;
  }
  throw new Error('sem o xz (no Windows, o do Git for Windows)');
}

const lerDe = (arquivo: string, pos: number, n: number): Buffer => {
  const fd = openSync(arquivo, 'r');
  try {
    const b = Buffer.alloc(n);
    readSync(fd, b, 0, n, pos);
    return b;
  } finally {
    closeSync(fd);
  }
};

if (!args.includes('--sem-montar')) await montar();
const trab = mkdtempSync(join(tmpdir(), 'gravador-roteiro-'));
if (pastaPrints) mkdirSync(pastaPrints, { recursive: true });

// ---- a imagem "oficial" (com lacre de teste) e uma "caseira" (sem lacre)
const assinador = assinadorTeste();
writeFileSync(join(trab, 'chave.pub'), assinador.chave);
const oficial = imagemTeste(fat32(24 * MIB, arquivosTeste('oficial')));
const nomeImg = 'ekfrase-writer-os-0.1.0.img';
writeFileSync(join(trab, nomeImg), oficial);
xz(join(trab, nomeImg));
const xzBytes = readFileSync(join(trab, `${nomeImg}.xz`));
const caseira = imagemTeste(fat32(24 * MIB, arquivosTeste('caseira')));
const arquivoCaseira = join(trab, 'meu-writer-os.img');
writeFileSync(arquivoCaseira, caseira);

// ---- as versões novas do próprio Gravador (U2): um Release writer-os-v<v> com os dois Gravadores e o manifesto
const gravadores = new Map<string, Buffer>();
const ofertasGravador: string[] = [];
const PAPEL = process.platform === 'linux' ? 'linux' : 'windows';
const publicarGravador = (v: string) => {
  const exe = Buffer.from(`Gravador ${v} para Windows ${'x'.repeat(200_000)}`);
  const app = Buffer.from(`Gravador ${v} para Linux ${'y'.repeat(150_000)}`);
  gravadores.set(`${v}/Ekfrase-Gravador.exe`, exe);
  gravadores.set(`${v}/Ekfrase-Gravador.AppImage`, app);
  const texto = Buffer.from(JSON.stringify({ app: 'ekfrase-gravador', versao: v, canal: 'estavel', arquivos: [{ papel: 'windows', nome: 'Ekfrase-Gravador.exe', tamanho: exe.length, sha256: sha256(exe) }, { papel: 'linux', nome: 'Ekfrase-Gravador.AppImage', tamanho: app.length, sha256: sha256(app) }] }));
  gravadores.set(`${v}/ekfrase-gravador-${v}.atualizacao.json`, texto);
  gravadores.set(`${v}/ekfrase-gravador-${v}.atualizacao.json.minisig`, Buffer.from(assinador.assinar(texto, `Ekfrase Gravador ${v} atualizacao`)));
  ofertasGravador.unshift(v);
};
/** O Gravador deste sistema na versão `v` (o que tem de estar no lugar do `.exe` depois de atualizar). */
const gravadorDe = (v: string) => gravadores.get(`${v}/${PAPEL === 'linux' ? 'Ekfrase-Gravador.AppImage' : 'Ekfrase-Gravador.exe'}`)!;

// ---- o "GitHub"
const servidor = createServer((q, r) => {
  const base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;
  if (q.url?.startsWith('/repos/cyfilho/ekfrase/releases')) {
    r.setHeader('content-type', 'application/json');
    const a = (n: string, size: number) => ({ name: n, browser_download_url: `${base}/d/${n}`, size });
    // os Releases só com o Gravador (sem imagem) não mudam a imagem que o Gravador grava: ele procura a mais nova COM imagem
    const doGravador = ofertasGravador.map((v) => ({ tag_name: `writer-os-v${v}`, assets: [...gravadores.keys()].filter((n) => n.startsWith(`${v}/`)).map((n) => a(n, gravadores.get(n)!.length)).map((x) => ({ ...x, name: x.name.slice(v.length + 1) })) }));
    r.end(JSON.stringify([...doGravador, { tag_name: 'writer-os-v0.1.0', assets: [a(`${nomeImg}.xz`, xzBytes.length), a(`${nomeImg}.xz.sha256`, 90), a(`${nomeImg}.xz.minisig`, 300)] }]));
    return;
  }
  const g = q.url?.startsWith('/d/') ? gravadores.get(q.url.slice(3)) : undefined;
  if (g) return void r.end(g);
  if (q.url === `/d/${nomeImg}.xz`) return void r.end(xzBytes);
  if (q.url === `/d/${nomeImg}.xz.sha256`) return void r.end(`${sha256(xzBytes)}  ${nomeImg}.xz\n`);
  if (q.url === `/d/${nomeImg}.xz.minisig`) return void r.end(assinador.assinar(xzBytes, 'Ekfrase Writer OS 0.1.0'));
  r.statusCode = 404;
  r.end();
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const api = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;

// ---- os discos simulados
const arquivoPen = join(trab, 'pendrive.disco');
writeFileSync(arquivoPen, '');
truncateSync(arquivoPen, 640 * MIB);
const pen = { id: 'sim:pen', caminho: arquivoPen, nome: 'Kingston DataTraveler 3.0', tamanho: 640 * MIB, setor: 512, barramento: 'usb', tipo: 'pendrive', serial: 'K1', somenteLeitura: false, particoes: [{ numero: 1, rotulo: 'FOTOS', nomeGpt: null, tipoGpt: null, sistema: 'exFAT', inicio: MIB, tamanho: 600 * MIB, usado: 412 * MIB, montagens: ['F:'] }], recusa: null, writerOS: false };
const sistema = { ...pen, id: 'sim:sistema', caminho: join(trab, 'nao-existe.disco'), nome: 'Disco com o Windows To Go', serial: 'S', tipo: 'externo', particoes: [], recusa: 'sistema' };
const arquivoDiscos = join(trab, 'discos.json');
const gravarDiscos = (l: unknown[]) => writeFileSync(arquivoDiscos, JSON.stringify(l));
gravarDiscos([sistema, pen]);

// ---- o Gravador
const { _electron } = await import('playwright');
const { ELECTRON_RUN_AS_NODE: _comoNode, ...doSistema } = process.env;
/** O Gravador com os discos simulados e um computador simulado (`livre`: dá para preparar; `writer`: tem o Writer OS). */
const abrir = (computador: string, mais: Record<string, string> = {}): Promise<ElectronApplication> =>
  _electron.launch({
    executablePath: electron(),
    args: [GRAVADOR],
    env: { ...doSistema, EKFRASE_GRAVADOR_DISCOS: arquivoDiscos, EKFRASE_GRAVADOR_API: api, EKFRASE_GRAVADOR_CHAVE: join(trab, 'chave.pub'), EKFRASE_GRAVADOR_CACHE: join(trab, 'cache'), EKFRASE_GRAVADOR_IMAGEM: arquivoCaseira, EKFRASE_GRAVADOR_LOG: '1', EKFRASE_GRAVADOR_COMPUTADOR: computador, ...mais } as Record<string, string>,
  });
let app: ElectronApplication = await abrir('livre');
app.process().stderr?.on('data', (d: Buffer) => process.stdout.write(`   `+d.toString().trim()+`\n`));
let p: Page = await app.firstWindow();
const foto = async (nome: string) => {
  if (!pastaPrints) return;
  for (const tema of ['claro', 'escuro'] as const) {
    await p.evaluate((t) => document.documentElement.setAttribute('data-tema', t), tema);
    await p.screenshot({ path: join(pastaPrints, `${nome}-${tema}.png`) });
  }
  await p.evaluate(() => document.documentElement.removeAttribute('data-tema'));
};
const tab = async (vezes = 1) => {
  for (let i = 0; i < vezes; i++) await p.keyboard.press('Tab');
};
/** Tab até o foco chegar no elemento (no máximo 25 vezes). */
const ate = async (teste: string): Promise<boolean> => {
  for (let i = 0; i < 25; i++) {
    if (await p.evaluate((t) => document.activeElement?.closest(`[data-teste="${t}"]`) !== null || document.activeElement?.getAttribute('data-teste') === t, teste)) return true;
    await tab();
  }
  return false;
};

try {
  await p.waitForSelector('[data-teste="passo-disco"]');
  await p.evaluate(() => {
    (window as unknown as { cliques: number }).cliques = 0;
    for (const ev of ['mousedown', 'pointerdown', 'mouseup']) document.addEventListener(ev, () => ((window as unknown as { cliques: number }).cliques += 1), true);
  });
  await p.waitForSelector('[data-teste="disco-sim:pen"]');
  await p.waitForSelector('[data-teste="imagem-release"]');
  ok(await p.isDisabled('[data-teste="disco-sim:sistema"] input'), 'o disco do sistema aparece travado');
  // O idioma da janela segue o do computador (no CI é inglês): conferir que há um motivo escrito, não a palavra.
  const motivo = ((await p.textContent('[data-teste="disco-sim:sistema"] .motivo')) ?? '').trim();
  ok(motivo.length > 10 && !motivo.startsWith('gravador.'), 'com o motivo escrito');
  ok((await p.textContent('[data-teste="imagem-release"]'))?.includes('0.1.0'), 'acha o Release do Writer OS 0.1.0');
  await foto('1-disco');

  // ① escolher pelo teclado
  ok(await ate('disco-sim:pen'), 'Tab chega no pendrive');
  await p.keyboard.press('Space');
  ok(await p.isChecked('[data-teste="disco-sim:pen"] input'), 'Espaço escolhe o pendrive');
  // "Também preparar este computador" (PLANO §8c): o padrão é 16 GB, e a tela diz com quanto o Windows fica
  await p.waitForSelector('[data-teste="computador"]');
  ok(await ate('preparar'), 'Tab chega em "Também preparar este computador"');
  await p.keyboard.press('Space');
  await p.waitForSelector('[data-teste="preparar-fica"]');
  ok(await p.isChecked('[data-teste="preparar-16"]'), 'preparar: o padrão é 16 GB');
  ok(((await p.textContent('[data-teste="preparar-fica"]')) ?? '').includes('16'), 'a tela diz com quanto o Windows e o Writer OS ficam');
  await foto('1b-preparar');
  ok(await ate('continuar'), 'Tab chega em Continuar');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-teste="passo-confirmar"]');
  // o passo novo começa com o foco no título (h1); só então o Tab anda
  await p.waitForFunction(() => document.activeElement?.tagName === 'H1', null, { timeout: 10_000 }).catch(() => undefined);
  ok((await p.textContent('[data-teste="conteudo"]'))?.includes('FOTOS'), 'mostra o que tem no disco antes de apagar');
  await foto('2-confirmar');

  // ② digitar o nome e criar
  ok(await ate('confirmar-nome'), 'Tab chega no campo do nome');
  ok(await p.isDisabled('[data-teste="gravar"]'), 'sem o nome, o botão de apagar fica desligado');
  // com intervalo, como gente: de uma vez só, o campo controlado do Preact às vezes perdia letras (15/11/2026)
  await p.keyboard.type('kingston  datatraveler 3.0', { delay: 25 });
  // espera a tela redesenhar (no runner lento do público, conferir logo depois de digitar pegava o botão ainda desligado)
  const ligou = await p.waitForSelector('[data-teste="gravar"]:not([disabled])', { timeout: 10_000 }).then(() => true, () => false);
  ok(ligou, `com o nome (sem diferença de maiúsculas e espaços), liga${ligou ? '' : ` (no campo: "${await p.inputValue('[data-teste="confirmar-nome"]')}"; foco: ${await p.evaluate(() => document.activeElement?.getAttribute('data-teste'))})`}`);
  ok(await ate('gravar'), 'Tab chega em "Apagar e criar"');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-teste="passo-gravando"]');
  await foto('3-gravando');
  await p.waitForSelector('[data-teste="passo-pronto"], [data-teste="passo-erro"]', { timeout: 120_000 });
  ok(await p.isVisible('[data-teste="passo-pronto"]'), `gravou (${(await p.getAttribute('[data-teste="erro"]', 'data-detalhe', { timeout: 500 }).catch(() => '')) ?? ''})`);
  await foto('4-pronto');
  const g = await lerGpt(async (pos, n) => lerDe(arquivoPen, pos, n), 512);
  ok(g.particoes.map((x) => x.nome).join() === `${NOME_BOOT},${NOME_DADOS}`, 'o disco tem a EKFRASE-BOOT e a EKFRASE-DADOS');
  const p1 = oficial.subarray(MIB, oficial.length - MIB);
  ok(sha256(lerDe(arquivoPen, MIB, p1.length)) === sha256(p1), 'a partição 1 é idêntica à da imagem');
  ok((await p.textContent('[data-teste="marcas"]'))?.includes('Lenovo'), 'mostra como bootar por marca');
  ok(await p.isVisible('[data-teste="preparado"]'), 'o computador também foi preparado (no mesmo pedido de permissão)');
  ok(await ate('ejetar'), 'Tab chega em Ejetar');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-teste="ejetado"]');
  ok(true, 'ejetou');

  // ③ Atualizar com uma imagem SEM lacre ("Já tenho a imagem")
  const p2 = g.particoes[1]!;
  const marca = Buffer.alloc(512, 0x42);
  const fd = openSync(arquivoPen, 'r+');
  (await import('node:fs')).writeSync(fd, marca, 0, 512, p2.inicio * 512 + 4096);
  closeSync(fd);
  const dadosAntes = sha256(lerDe(arquivoPen, p2.inicio * 512, 8 * MIB));
  gravarDiscos([sistema, { ...pen, writerOS: true, particoes: [{ numero: 1, rotulo: 'EKFR-BOOT', nomeGpt: NOME_BOOT, tipoGpt: null, sistema: 'vfat', inicio: MIB, tamanho: p1.length, usado: null, montagens: [] }, { numero: 2, rotulo: 'EKFR-DADOS', nomeGpt: NOME_DADOS, tipoGpt: null, sistema: 'exfat', inicio: p2.inicio * 512, tamanho: (p2.fim - p2.inicio + 1) * 512, usado: 1 * MIB, montagens: [] }] }]);
  ok(await ate('outro'), 'Tab chega em "Criar outro"');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-teste="passo-disco"]');
  await p.waitForFunction(() => document.querySelector('[data-teste="disco-sim:pen"]')?.textContent?.includes('Writer OS'), null, { timeout: 15_000 });
  ok(await ate('disco-sim:pen'), 'Tab chega no pendrive (agora um Writer OS)');
  await p.keyboard.press('Space');
  await p.waitForSelector('[data-teste="modo-atualizar"]');
  ok(await p.isChecked('[data-teste="modo-atualizar"]'), 'num Writer OS, o padrão é Atualizar (os textos ficam)');
  ok(await ate('ja-tenho'), 'Tab chega em "Já tenho a imagem"');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-teste="imagem-arquivo"]');
  ok((await p.textContent('[data-teste="imagem-arquivo"]'))?.includes('meu-writer-os.img'), 'a imagem escolhida aparece, sem lacre');
  ok(await ate('continuar'), 'Tab chega em Continuar');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-teste="aviso-sem-lacre"]');
  ok(await p.isVisible('[data-teste="vai-atualizar"]'), 'diz que só o sistema é trocado');
  await foto('5-sem-lacre');
  ok(await ate('frase-sem-lacre'), 'Tab chega na frase do aviso vermelho');
  const frase = await p.evaluate(() => /:\s*(.+)$/.exec(document.querySelector('[data-teste="aviso-sem-lacre"] label span')?.textContent ?? '')?.[1] ?? '');
  await p.keyboard.type(frase);
  ok(await ate('confirmar-nome'), 'Tab chega no nome do disco');
  await p.keyboard.type('Kingston DataTraveler 3.0');
  ok(await ate('gravar'), 'Tab chega em Atualizar');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-teste="passo-pronto"], [data-teste="passo-erro"]', { timeout: 120_000 });
  ok(await p.isVisible('[data-teste="passo-pronto"]'), `atualizou (${(await p.textContent('[data-teste="erro"]').catch(() => '')) ?? ''})`);
  const p1nova = caseira.subarray(MIB, caseira.length - MIB);
  ok(sha256(lerDe(arquivoPen, MIB, p1nova.length)) === sha256(p1nova), 'a partição 1 agora é a da imagem nova');
  ok(sha256(lerDe(arquivoPen, p2.inicio * 512, 8 * MIB)) === dadosAntes, 'a EKFRASE-DADOS ficou igual (o arquivo de teste está lá)');
  ok((await p.evaluate(() => (window as unknown as { cliques: number }).cliques)) === 0, 'nenhum evento de mouse');

  // ④ remover o Writer OS deste computador (outro Gravador: um computador com o Writer OS instalado)
  await app.close();
  app = await abrir('writer');
  p = await app.firstWindow();
  await p.waitForSelector('[data-teste="ir-remover"]', { timeout: 20_000 });
  ok(true, 'com o Writer OS instalado, aparece "Remover o Writer OS deste computador"');
  ok(!(await p.$('[data-teste="preparar"]')), 'e não aparece o "preparar"');
  ok(await ate('ir-remover'), 'Tab chega em "Remover o Writer OS deste computador"');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-teste="passo-remover"]');
  ok(await p.isChecked('[data-teste="remover-copiar"]'), 'copiar os textos para os Documentos vem marcado');
  ok(await ate('remover-copiar'), 'Tab chega em "copiar os textos"');
  await p.keyboard.press('Space');
  ok(await p.isVisible('[data-teste="remover-sem-copia"]'), 'sem a cópia, o aviso de que os textos serão apagados');
  await p.keyboard.press('Space');
  await foto('6-remover');
  ok(await ate('remover'), 'Tab chega em Remover');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-teste="passo-removido"], [data-teste="passo-erro"]', { timeout: 30_000 });
  ok(await p.isVisible('[data-teste="passo-removido"]'), `removeu (${(await p.textContent('[data-teste="erro"]').catch(() => '')) ?? ''})`);
  ok(((await p.textContent('[data-teste="removido-copiado"]').catch(() => '')) ?? '').includes('Ekfrase Writer (Writer OS'), 'diz para onde os textos foram');
  ok(await p.isVisible('[data-teste="removido-devolvido"]'), 'o espaço voltou ao Windows');
  await foto('7-removido');

  // ⑤ o Gravador se atualiza (U2): um "Gravador 0.2.0" no lugar do .exe; o "GitHub" oferece a 0.2.1 e depois a 0.2.2
  await app.close();
  const alvo = join(trab, PAPEL === 'linux' ? 'Ekfrase-Gravador.AppImage' : 'Ekfrase-Gravador.exe');
  writeFileSync(alvo, 'o Gravador 0.2.0');
  publicarGravador('0.2.1');
  app = await abrir('livre', { EKFRASE_GRAVADOR_VERSAO: '0.2.0', EKFRASE_GRAVADOR_ATUALIZAR_ALVO: alvo, EKFRASE_GRAVADOR_ATUALIZACOES_ATRASO: '500' });
  p = await app.firstWindow();
  await p.waitForSelector('[data-teste="passo-disco"]');
  await p.evaluate(() => {
    (window as unknown as { cliques: number }).cliques = 0;
    for (const ev of ['mousedown', 'pointerdown', 'mouseup']) document.addEventListener(ev, () => ((window as unknown as { cliques: number }).cliques += 1), true);
  });
  const aviso = await p.waitForSelector('[data-teste="aviso-atualizacao"]', { timeout: 20_000 }).then(() => true, () => false);
  ok(aviso, 'automáticas: a 0.2.1 do Gravador baixou, o lacre conferiu, e o aviso aparece embaixo');
  ok(((await p.textContent('[data-teste="aviso-atualizacao"]').catch(() => '')) ?? '').includes('0.2.1'), 'o aviso diz a versão pronta');
  ok(readFileSync(alvo).equals(gravadorDe('0.2.1')), 'o Gravador 0.2.1 deste sistema está no lugar do de agora (vale na próxima vez que abrir)');
  if (PAPEL === 'windows') ok(readFileSync(`${alvo}.velho`, 'utf8') === 'o Gravador 0.2.0', 'o de agora virou .velho (o Windows não apaga um .exe aberto)');
  ok((await p.textContent('[data-teste="imagem-release"]'))?.includes('0.1.0'), 'a imagem continua a do Release com imagem (0.1.0)');
  await foto('8-gravador-atualizado');
  // o ↻ está no topo, antes do título do passo (onde o foco começa): Shift+Tab
  await p.waitForFunction(() => document.activeElement?.tagName === 'H1', null, { timeout: 5_000 }).catch(() => undefined);
  let noBotao = false;
  for (let i = 0; i < 4 && !noBotao; i++) {
    await p.keyboard.press('Shift+Tab');
    noBotao = await p.evaluate(() => document.activeElement?.getAttribute('data-teste') === 'ir-atualizacoes');
  }
  ok(noBotao, 'Shift+Tab chega no botão das atualizações (↻), no topo');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-teste="passo-atualizacoes"]');
  await p.waitForFunction(() => document.activeElement?.tagName === 'H1', null, { timeout: 5_000 }).catch(() => undefined);
  ok(((await p.textContent('[data-teste="atualizacoes-versao"]')) ?? '').includes('0.2.0'), 'a tela das atualizações mostra a versão de agora');
  ok(!!(await p.$('[data-teste="atualizacoes-situacao-pronta"]')), 'e que a 0.2.1 está pronta');
  ok(await ate('atualizacoes-modo-automaticas'), 'Tab chega em "Automáticas (recomendado)"');
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(300);
  let ajustes: Record<string, unknown> = {};
  try {
    ajustes = JSON.parse(readFileSync(join(trab, 'cache', 'ajustes.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    // fica vazio
  }
  ok(ajustes['atualizacoes'] === 'perguntar', `"Perguntar antes de instalar" fica nos ajustes do Gravador (${String(ajustes['atualizacoes'])})`);
  publicarGravador('0.2.2');
  ok(await ate('atualizacoes-procurar'), 'Tab chega em "Procurar agora"');
  await p.keyboard.press('Enter');
  ok(await p.waitForSelector('[data-teste="atualizacoes-situacao-disponivel"]', { timeout: 10_000 }).then(() => true, () => false), 'perguntar: acha a 0.2.2 e espera o Instalar');
  ok(readFileSync(alvo).equals(gravadorDe('0.2.1')), 'perguntar: não troca sozinho');
  await foto('9-gravador-disponivel');
  ok(await ate('atualizacoes-instalar'), 'Tab chega em Instalar');
  await p.keyboard.press('Enter');
  ok(await p.waitForSelector('[data-teste="atualizacoes-situacao-pronta"]', { timeout: 15_000 }).then(() => true, () => false), 'Instalar: a 0.2.2 baixa, confere e fica pronta');
  ok(readFileSync(alvo).equals(gravadorDe('0.2.2')), 'o Gravador 0.2.2 está no lugar');
  // Voltar fica à esquerda do botão principal (antes dele no Tab)
  await p.keyboard.press('Shift+Tab');
  ok(await p.evaluate(() => document.activeElement?.getAttribute('data-teste') === 'atualizacoes-voltar'), 'Shift+Tab chega em Voltar');
  await p.keyboard.press('Enter');
  ok(await p.waitForSelector('[data-teste="passo-disco"]', { timeout: 5_000 }).then(() => true, () => false), 'Voltar leva ao passo de antes');
  ok((await p.evaluate(() => (window as unknown as { cliques: number }).cliques)) === 0, 'nenhum evento de mouse (atualizações)');
} catch (e) {
  falhas.push(String(e));
  console.error(e);
  await foto('falha').catch(() => undefined);
} finally {
  await app.close().catch(() => undefined);
  servidor.close();
  if (existsSync(trab)) rmSync(trab, { recursive: true, force: true });
}
console.log(falhas.length ? `\n${falhas.length} de ${passos} passos do Gravador falharam.` : `\nGravador: ${passos} passos, tudo certo, sem nenhum evento de mouse.`);
process.exit(falhas.length ? 1 : 0);
