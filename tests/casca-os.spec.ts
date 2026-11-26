// SPDX-License-Identifier: MPL-2.0
/**
 * O WRITER OS SIMULADO (a casca com `EKFRASE_CASCA_OS=simulado`), só pelo teclado: a conferência que dá
 * para fazer fora do pendrive e do QEMU (no Windows também). O sistema de verdade (Cage, Debian, as
 * travas do §7) é testado pelo CI no QEMU (`tests/writer-os/qemu.py`).
 *
 * 1. Com a partição de dados: idioma → teclado → fuso (Enter em cada um: a opção padrão) → senha →
 *    espelho → Wi-Fi ("seguir") → escrever sem conta. O agente de teste conta tudo no relato (texto
 *    falta, usb ok, interno negado, gravado N). Ctrl+Alt+S abre o painel do sistema. O `sistema.json`
 *    fica ao lado dos textos. Fecha e abre de novo: só a senha, e o agente diz "texto ok".
 * 2. Sem a partição de dados: "onde guardar" → a memória → a faixa âmbar → "guardar num pendrive"
 *    → os textos vão para o OUTRO e a senha (a mesma) abre de novo, já lá.
 *
 * 3. Tudo Ekfrase (PLANO §6.5): nenhuma tela tem link para fora do app nem seletor de arquivos do sistema,
 *    "Desligar" está à vista no topo, e importar e salvar passam pela tela dos pendrives (só teclado).
 *
 * 4. As atualizações (DEC-P072, U1): um "GitHub" local; automáticas, o aviso do canto, a parte "Atualizações" do
 *    menu, "Perguntar antes" e Instalar (`percorrerAtualizacoes`).
 *
 * 5. O portal cativo (PLANO §7, W4): um portal de mentira (`/nm` redireciona a `/entrar` até o formulário ser enviado;
 *    a página tem um link para `localhost`, outro site, que é barrado): conecta na "Biblioteca", o aviso aparece com o
 *    foco no botão, a janela abre, o link não sai, entrar faz a janela fechar sozinha (`percorrerPortal`).
 *
 * 6. A VPN (PLANO §7, W4): importar um `.conf` e um `.ovpn` do pendrive simulado OUTRO pela tela dos pendrives, recusar
 *    o `.ovpn` com `up`, ligar (o OpenVPN pede usuário e senha: `vpn123`), o cadeado ao lado da bateria, desligar,
 *    fechar e abrir: as duas voltam do cofre, e a senha guardada liga sem perguntar (`percorrerVpn`).
 *
 * 7. A VPN de empresa (W5a-2): "Adicionar VPN de empresa" (AnyConnect, GlobalProtect, Fortinet) contra o simulado: liga ao
 *    adicionar, o código do segundo fator (o errado e o certo), a impressão e "Confiar neste certificado", o aviso do
 *    login pelo navegador (`sso`), o endereço que não serve; no outro boot voltam do cofre (`percorrerVpnEmpresa`).
 *
 * Os prints de cada tela vão para `EKFRASE_PRINTS_OS` (se houver). Roda por `npm run teclado -- --so-os`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import { assinadorTeste } from './gravador/imagem-teste.ts';
import { Roteiro, type Resultado } from './teclado.spec.ts';

const SENHA = 'escrever2026';

/** Uma vez da casca do Writer OS aberta: a página e como fechar (gravando o que falta, como no Cage). */
export interface SessaoOS {
  pagina(): Promise<Page>;
  fechar(): Promise<void>;
  /** O Electron (as outras janelas, como a do portal cativo, e o processo principal). */
  electron?: ElectronApplication;
}
type Abrir = (env: Record<string, string>) => Promise<SessaoOS>;

async function janela(app: ElectronApplication): Promise<Page> {
  const p = await app.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setIgnoreMouseEvents(true));
  return p;
}

/** Troca de tela como o app faz (caminho limpo, sem recarregar; a janela da casca nunca navega de verdade). */
const irPara = (p: Page, caminho: string): Promise<void> =>
  p.evaluate((c) => {
    history.pushState(null, '', c);
    dispatchEvent(new PopStateEvent('popstate'));
  }, caminho);

async function fechar(app: ElectronApplication): Promise<void> {
  const saiu = new Promise<void>((ok) => app.once('close', () => ok()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await Promise.race([saiu, new Promise((ok) => setTimeout(ok, 15000))]);
}

/** A casca de antes (o Electron com `EKFRASE_CASCA_OS=simulado`). */
export const abrirComElectron =
  (lancar: (env: Record<string, string>) => Promise<ElectronApplication>): Abrir =>
  async (env) => {
    const app = await lancar(env);
    return { pagina: () => janela(app), fechar: () => fechar(app), electron: app };
  };

const lerRelato = (raiz: string): string => {
  try {
    return readFileSync(join(raiz, 'run', 'teste', 'relato'), 'utf8');
  } catch {
    return '';
  }
};

async function esperarRelato(raiz: string, linha: string | RegExp, ms = 15000): Promise<boolean> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const r = lerRelato(raiz);
    if (typeof linha === 'string' ? r.split('\n').includes(linha) : linha.test(r)) return true;
    await new Promise((ok) => setTimeout(ok, 200));
  }
  return false;
}

export async function percorrerCascaOS(abrir: Abrir, falar: (linha: string) => void = console.log): Promise<Resultado> {
  const prints = process.env['EKFRASE_PRINTS_OS'];
  if (prints) mkdirSync(prints, { recursive: true });
  const falhas: string[] = [];
  let passos = 0;
  const somar = (r: Roteiro) => {
    passos += r.passos;
    falhas.push(...r.falhas);
  };
  const foto = async (p: Page, nome: string) => {
    if (prints) await p.screenshot({ path: join(prints, `${nome}.png`) });
  };

  /** O que, na tela, leva para fora do app (um link que não é interno) ou abre o seletor de arquivos do sistema. */
  // links para dentro do app (`/writer/...`, caminho limpo) não são saída: o app troca de tela sem recarregar
  const saidas = (pg: Page): Promise<string[]> =>
    pg.evaluate(() => [
      ...[...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '').filter((h) => !(h.startsWith('#') || /^\/writer(\/[^#]*)?$/.test(h))),
      ...[...document.querySelectorAll('a[target="_blank"], input[type="file"], form[action]')].map((e) => e.tagName.toLowerCase()),
    ]);

  /** A engrenagem do menu do sistema é o último botão do topo, na ponta direita (pedido do Alcy, 18/11). */
  const engrenagemNaPonta = (pg: Page): Promise<boolean> =>
    pg.evaluate(() => {
      const botoes = [...document.querySelectorAll('.ekf-acoes button, .ekf-acoes a')].filter((b) => (b as HTMLElement).offsetParent !== null);
      return botoes[botoes.length - 1]?.getAttribute('data-teste') === 'botao-sistema';
    });

  const base = mkdtempSync(join(tmpdir(), 'ekfrase-os-'));
  const comum = { EKFRASE_CASCA_OS: 'simulado', EKFRASE_CASCA_SERVIDOR: 'http://127.0.0.1:9/api/v1/', EKFRASE_CASCA_ESPELHO_MS: '200' };

  /** Uma tela do primeiro uso: espera, confere o foco, tira o print e aperta Enter (a opção padrão). */
  const enter = async (r: Roteiro, teste: string, nome: string, relato?: string) => {
    const veio = await r.esperar(teste, 10000);
    r.ok(veio, `a tela "${teste}" aparece`);
    if (!veio) return;
    // como o QEMU: só digita depois de o agente de teste contar que a tela abriu
    if (relato) r.ok(await esperarRelato(relato, `tela ${teste}`), `o agente de teste viu "${teste}"`);
    await r.passo(`${teste}: o foco começa na opção padrão`);
    await foto(r.p, nome);
    await r.tecla('Enter');
  };

  const senhaNova = async (r: Roteiro) => {
    r.ok(await r.esperar('casca-criar-senha', 10000), 'a senha nova aparece (o app abriu)');
    await r.passo('o foco está na senha');
    await foto(r.p, '04-senha');
    await r.p.keyboard.type(SENHA);
    if (await r.tabAte('casca-senha-repetir')) await r.p.keyboard.type(SENHA);
    await r.tecla('Enter');
  };

  // ================= 1. com a partição de dados =================
  const raiz1 = join(base, 'pendrive');
  const env1 = { ...comum, EKFRASE_CASCA_OS_RAIZ: raiz1, EKFRASE_CASCA_OS_DADOS: 'pendrive', EKFRASE_CASCA_OS_TESTE: '1', EKFRASE_CASCA_PERFIL: join(raiz1, 'perfil') };
  // o 2º pendrive já tem um arquivo para importar (o Writer só mostra .ekfr, .md, .txt e .zip)
  const pendrive = join(raiz1, 'media', 'OUTRO');
  mkdirSync(pendrive, { recursive: true });
  writeFileSync(join(pendrive, 'conto.md'), ['# O conto', '', 'Havia uma vez um pendrive.', ''].join(String.fromCharCode(10)));
  let app = await abrir(env1);
  let p = await app.pagina();
  let r = new Roteiro(p, falar);
  falar('— Writer OS (simulado), com a partição de dados: o primeiro uso');
  // a data e a hora em todas as telas depois do boot (pedido do Alcy em 18/11), já no idioma
  if (await r.esperar('os-idioma', 10000)) {
    const relogio = await p.textContent('[data-teste="os-relogio"]').catch(() => null);
    r.ok(!!relogio && /\d{1,2}:\d{2}/.test(relogio) && /\d/.test(relogio.replace(/\d{1,2}:\d{2}/, '')), `o relógio mostra a data e a hora já no idioma (${relogio})`);
  }
  await enter(r, 'os-idioma', '01-idioma', raiz1);
  // ligou pelo pendrive: "Como você quer usar o Writer OS?" logo depois do idioma; Enter = só pelo pendrive
  await enter(r, 'os-uso', '01b-uso', raiz1);
  await enter(r, 'os-teclado', '02-teclado', raiz1);
  await enter(r, 'os-fuso', '03-fuso', raiz1);
  await senhaNova(r);
  await enter(r, 'casca-espelho', '05-espelho');
  await enter(r, 'os-wifi', '06-wifi');
  await p.waitForSelector('[data-teste="entrada-outra-forma"]', { timeout: 10000 }).catch(() => null);
  await foto(p, '07-conta');
  r.ok((await saidas(p)).length === 0, `a tela inicial não leva a lugar nenhum fora do app (${(await saidas(p)).join(', ')})`);
  r.ok((await p.$('[data-teste="botao-passeio"]')) === null && (await p.$('a[href*="torre"]')) === null, 'no Writer OS não há o botão do modo jogo');
  // desligar sem entrar no app (Alcy, 18/11): a engrenagem no topo da tela inicial e o Ctrl+Alt+S
  r.ok(!!(await p.$('[data-teste="botao-sistema"]')), 'a tela inicial tem a engrenagem do sistema no topo');
  r.ok(await engrenagemNaPonta(p), 'na tela inicial, a engrenagem é o último botão do topo (a ponta direita)');
  await r.tecla('Control+Alt+s');
  if (await r.esperar('menu-sistema', 5000)) {
    r.ok(await r.focoEm('os-desligar'), 'na tela inicial, Ctrl+Alt+S abre o menu com o foco em Desligar');
    r.ok(!(await p.$('[data-teste="os-menu-ajustes"]')), 'fora do app o menu não tem os Ajustes do Writer');
    await foto(p, '07b-menu-na-entrada');
    await r.tecla('Escape');
    r.ok(!(await p.$('[data-teste="menu-sistema"]')), 'Esc fecha o menu na tela inicial');
  } else r.ok(false, 'na tela inicial, Ctrl+Alt+S abre o menu do sistema');
  if (await r.tabAte('entrada-outra-forma')) await r.tecla('Enter');
  r.ok(await r.esperar('nova-historia', 10000), 'a estante abre (escrever sem conta)');
  r.ok(await esperarRelato(raiz1, 'texto falta'), 'o agente: na primeira vez, o texto de teste não existe');
  r.ok(await esperarRelato(raiz1, 'usb ok'), 'o agente: o 2º pendrive monta e aceita um arquivo');
  r.ok(await esperarRelato(raiz1, 'interno negado'), 'o agente: o disco interno não monta');
  r.ok(await esperarRelato(raiz1, 'gravado 5'), 'o agente: o laço de gravação anda');
  r.ok(await esperarRelato(raiz1, 'integridade ok'), 'o agente: o banco está íntegro');
  const sistemaJson = join(raiz1, 'dados', 'Ekfrase Writer', 'sistema.json');
  let sj: Record<string, unknown> = {};
  try {
    sj = JSON.parse(readFileSync(sistemaJson, 'utf8')) as Record<string, unknown>;
  } catch {
    // fica vazio
  }
  r.ok(sj['idioma'] === 'pt-BR' && sj['teclado'] === 'br' && sj['fuso'] === 'America/Sao_Paulo' && sj['wifiVisto'] === true, `o sistema.json fica ao lado dos textos (${JSON.stringify(sj)})`);
  r.ok(sj['uso'] === 'pendrive', `"Só pelo pendrive" fica lembrado no sistema.json (${String(sj['uso'])})`);
  r.ok(await esperarRelato(raiz1, 'lugar usb'), 'o agente: ligou pelo pendrive (lugar usb)');
  r.ok(!!(await p.$('[data-teste="os-relogio"]')), 'a estante também mostra o relógio');
  // tocar na data e na hora abre as configurações de data e hora (20/11)
  await p.click('[data-teste="os-relogio"]');
  r.ok(await r.esperar('os-painel-fuso', 5000), 'tocar na data e hora abre as configurações de data e hora');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  r.ok(existsSync(join(raiz1, 'dados', 'Ekfrase Writer', 'dados', 'cofre.db')), 'os textos estão na partição de dados (a mesma pasta do computador)');

  // as abas do topo: "Início" antes de todas (18/11)
  const abas = await p.$$eval('.topo-nav a', (l) => l.map((a) => a.getAttribute('data-teste')));
  r.ok(abas[0] === 'nav-inicio', `a primeira aba é "Início" (${abas.join(', ')})`);

  // o menu do sistema (18/11): Ctrl+Alt+S ou a engrenagem; Desligar e Reiniciar em cima, a conta, o resto
  await r.tecla('Control+Alt+s');
  const menu = await r.esperar('menu-sistema', 5000);
  r.ok(menu, 'Ctrl+Alt+S abre o menu do sistema');
  if (menu) {
    await r.passo('o foco começa no menu', 'menu-sistema');
    r.ok(await r.focoEm('os-desligar'), 'o foco começa em Desligar, no alto do menu');
    const itens = await p.$$eval('[data-teste="menu-sistema"] [role="menuitem"]', (l) => l.map((e) => e.getAttribute('data-teste') ?? ''));
    r.ok(itens[0] === 'os-desligar' && itens[1] === 'os-reiniciar' && itens[2] === 'os-conta-entrar', `Desligar e Reiniciar em cima, depois a conta (${itens.join(', ')})`);
    for (const s of ['os-menu-wifi', 'os-menu-energia', 'os-menu-teclado', 'os-menu-fuso', 'os-menu-servidor', 'os-menu-discos', 'os-menu-sobre', 'os-menu-ajustes']) r.ok(itens.includes(s), `o menu tem "${s}"`);
    r.ok(itens[itens.length - 1] === 'os-menu-instalar', `ligado pelo pendrive, "Instalar neste computador" é o último item do menu (${itens[itens.length - 1]})`);
    r.ok(((await p.textContent('[data-teste="os-menu-conta"]')) ?? '').includes('sem conta'), 'o menu mostra a conta (aqui, escrevendo sem conta, com Entrar)');
    await p.waitForTimeout(300);
    await foto(p, '08-menu');
    if (prints) {
      await p.emulateMedia({ colorScheme: 'dark' });
      await p.waitForTimeout(200);
      await foto(p, '08-menu-escuro');
      await p.emulateMedia({ colorScheme: 'light' });
    }
    // as setas andam pelo menu, em roda
    await r.tecla('ArrowDown');
    r.ok(await r.focoEm('os-reiniciar'), 'seta para baixo: Reiniciar');
    await r.tecla('ArrowUp', 2);
    r.ok(await r.focoEm(itens[itens.length - 1] ?? ''), 'seta para cima no primeiro: vai ao último');
    // Bateria e tela: setas até ele, Enter
    for (let i = 0; i < itens.length && !(await r.focoEm('os-menu-energia')); i++) await r.tecla('ArrowDown');
    await r.tecla('Enter');
    if (await r.esperar('os-painel-energia', 5000)) {
      await p.waitForTimeout(300);
      r.ok((await p.textContent('[data-teste="os-painel-energia"]'))?.includes('50') === true, 'o brilho começa em 50%');
      await foto(p, '08b-menu-energia');
      if (await r.tabAte('os-brilho-mais')) {
        await r.tecla('Enter');
        await p.waitForTimeout(200);
        r.ok((await p.textContent('[data-teste="os-painel-energia"]'))?.includes('60') === true, 'o brilho sobe (50% → 60%)');
      }
      await r.tecla('Escape');
      r.ok((await r.esperar('os-menu-energia', 3000)) && (await r.focoEm('os-menu-energia')), 'Esc numa parte volta ao menu, no item dela');
    } else r.ok(false, 'Enter em "Bateria e tela" abre a parte');
    // Wi-Fi: a senha da rede escolhida aparece ACIMA da lista (18/11)
    for (let i = 0; i < itens.length && !(await r.focoEm('os-menu-wifi')); i++) await r.tecla('ArrowUp');
    await r.tecla('Enter');
    if ((await r.esperar('os-rede', 5000)) && (await r.tabAte('os-rede'))) {
      // a rede "Casa" (com senha) vem antes da "Biblioteca" (aberta); o Tab pode ter chegado pela outra ponta
      const naCasa = () => p.evaluate(() => (document.activeElement?.textContent ?? '').startsWith('Casa'));
      for (let i = 0; i < 6 && !(await naCasa()); i++) await r.tecla('Shift+Tab');
      await r.tecla('Enter');
      if (await r.esperar('os-rede-senha', 3000)) {
        r.ok(await r.focoEm('os-rede-senha'), 'escolher a rede põe o foco na senha');
        const acima = await p.evaluate(() => {
          const senha = document.querySelector('[data-teste="os-rede-senha"]');
          const rede = document.querySelector('[data-teste="os-rede"]');
          return !!senha && !!rede && (senha.compareDocumentPosition(rede) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        });
        r.ok(acima, 'o campo da senha do Wi-Fi fica acima da lista de redes');
        await foto(p, '08c-menu-wifi-senha');
        if (await r.tabAte('os-rede-cancelar')) {
          await r.tecla('Enter');
          await p.waitForTimeout(150);
          r.ok(await naCasa(), 'Cancelar: o foco volta para a rede');
        }
      } else {
        const onde = await p.evaluate(() => `${document.activeElement?.getAttribute('data-teste')} | ${document.activeElement?.textContent} | ${[...document.querySelectorAll('[data-teste="os-rede"]')].map((e) => e.textContent).join(' / ')}`);
        r.ok(false, `a rede com senha pede a senha (foco: ${onde})`);
      }
      await r.tecla('Escape');
    } else r.ok(false, 'a lista de redes aparece no menu');
    await r.esperar('os-menu-wifi', 3000);
    // "Servidor e conta": entrar (e sair) dali mesmo, não só o servidor (Alcy, 18/11)
    for (let i = 0; i < itens.length && !(await r.focoEm('os-menu-servidor')); i++) await r.tecla('ArrowDown');
    await r.tecla('Enter');
    if (await r.esperar('os-servidor-conta', 5000)) {
      const temEntrar = await p.evaluate(() => !!document.querySelector('[data-teste="os-servidor-conta"] input[type="email"]') && !!document.querySelector('[data-teste="os-servidor-conta"] input[type="password"]'));
      r.ok(temEntrar, '"Servidor e conta" tem o formulário de entrar (e-mail e senha) ali mesmo');
      await foto(p, '08d-menu-servidor-conta');
      await r.tecla('Escape');
      r.ok((await r.esperar('os-menu-servidor', 3000)) && (await r.focoEm('os-menu-servidor')), 'Esc em "Servidor e conta" volta ao menu');
    } else r.ok(false, 'Enter em "Servidor e conta" mostra a conta');
    await r.tecla('Escape');
    r.ok(!(await p.$('[data-teste="menu-sistema"]')), 'Esc no menu fecha');
  }
  r.ok(existsSync(join(raiz1, 'run', 'sessao', 'pronta')), 'a casca avisou que a sessão abriu (o Num Lock da imagem)');

  // ---- tudo Ekfrase (§6.5): nenhum link para fora, importar e salvar pela tela dos pendrives
  // o menu do sistema: a engrenagem, só com o ícone, à vista; sem o botão da conta nem o dos Ajustes no topo
  const sistema = await p.$('[data-teste="botao-sistema"]');
  r.ok(sistema !== null && (await sistema.isVisible()) && ((await sistema.textContent()) ?? '').trim().length === 0 && !(await p.$('[data-teste="botao-desligar"]')), 'o topo tem o menu do sistema só com o ícone, à vista');
  const rotulos = await p.$$eval('.topo .ekf-acoes [aria-label]', (l) => l.map((e) => e.getAttribute('aria-label') ?? ''));
  r.ok(!(await p.$('[data-teste="botao-ajustes"]')) && !rotulos.some((x) => x.includes('Entrar')), `no topo do OS não há o botão da conta nem o dos Ajustes: estão no menu (${rotulos.join(', ')})`);
  r.ok(await engrenagemNaPonta(p), 'na estante, a engrenagem é o último botão do topo (a ponta direita)');
  r.ok((await saidas(p)).length === 0, `a estante não leva a lugar nenhum fora do app (${(await saidas(p)).join(', ')})`);
  await irPara(p, '/writer/');
  r.ok(await r.esperar('entrada-abrir', 6000), 'o hall abre');
  r.ok(!!(await p.$('[data-teste="botao-sistema"]')), 'o hall (Início) tem a engrenagem do sistema no topo');
  r.ok(await engrenagemNaPonta(p), 'no hall, a engrenagem é o último botão do topo (a ponta direita)');
  r.ok((await saidas(p)).length === 0, `o hall não leva a lugar nenhum fora do app (${(await saidas(p)).join(', ')})`);
  await irPara(p, '/writer/app/arquivos');
  if (await r.esperar('tela-arquivos', 6000)) {
    r.ok((await saidas(p)).length === 0, `Arquivos não tem link para fora nem seletor do sistema (${(await saidas(p)).join(', ')})`);
    if (await r.tabAte('importar-pendrive')) await r.tecla('Enter');
    r.ok(await r.esperar('os-pendrive', 5000), 'importar abre a tela dos pendrives (não o seletor do Linux)');
    if (await r.esperar('os-pendrive-disco', 5000)) {
      await foto(p, '12-importar-pendrives');
      await r.passo('o foco começa no pendrive', 'os-pendrive');
      await r.tecla('Enter');
      if (await r.esperar('os-pendrive-arquivo', 6000)) {
        await r.passo('o foco passa para a lista de arquivos', 'os-pendrive');
        await foto(p, '13-importar-lista');
        await p.keyboard.press('Space');
        if (await r.tabAte('os-pendrive-importar')) await r.tecla('Enter');
        r.ok(await r.esperar('tela-historia', 8000), 'o arquivo do pendrive foi importado (a história abre)');
      } else r.ok(false, 'o conto aparece na lista do pendrive');
    }
    // exportar: o "salvar" é a tela dos pendrives, não o do sistema
    await irPara(p, '/writer/app/arquivos');
    if (await r.esperar('exportar-md', 6000)) {
      if (await r.tabAte('exportar-md')) await r.tecla('Enter');
      r.ok(await r.esperar('os-pendrive', 5000), 'exportar abre a tela dos pendrives');
      if (await r.esperar('os-pendrive-disco', 5000)) {
        // o foco vai ao pendrive depois que a lista de discos chega; Enter antes disso caía no "exportar" de trás
        await p
          .waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-pendrive-disco', null, { timeout: 5000 })
          .catch(() => undefined);
        await r.passo('salvar: o foco começa no pendrive', 'os-pendrive');
        await r.tecla('Enter');
        // o pendrive monta e a pasta lista antes de o botão existir (num computador lento leva um tempo)
        await r.esperar('os-pendrive-salvar', 10000);
        if (await r.tabAte('os-pendrive-salvar')) {
          await foto(p, '14-salvar-pendrive');
          await r.tecla('Enter');
        }
      }
      await p.waitForTimeout(600);
      const md = readdirSync(pendrive).filter((n) => n.toLowerCase().endsWith('.md'));
      r.ok(md.length >= 2, `o arquivo exportado foi para o pendrive (${md.join(', ')})`);
      r.ok((await p.$('[data-teste="os-pendrive"]')) === null, 'a tela dos pendrives fecha depois de salvar');
    }
  }
  await app.fechar();
  somar(r);

  // ---- outro boot: só a senha
  falar('— outro boot: só a senha, e o texto continua lá');
  // o perfil do Chromium vive na memória do pendrive: num boot novo ele começa vazio
  app = await abrir({ ...env1, EKFRASE_CASCA_PERFIL: join(raiz1, 'perfil-2') });
  p = await app.pagina();
  r = new Roteiro(p, falar);
  r.ok(await r.esperar('casca-abrir', 10000), 'no segundo boot, direto na senha (o primeiro uso não volta)');
  await foto(p, '09-senha-de-novo');
  await p.keyboard.type(SENHA);
  await r.tecla('Enter');
  r.ok(await esperarRelato(raiz1, 'texto ok'), 'o agente: o texto gravado no boot anterior está lá');
  const lembrou = await r.esperar('nova-historia', 10000);
  r.ok(lembrou, 'escrever sem conta foi lembrado (cifrado no cofre)');
  if (!lembrou) falar(`   (tela: ${await p.evaluate(() => document.querySelector('main[data-teste], [data-teste^="tela-"], [data-teste^="entrada"]')?.getAttribute('data-teste'))}; relato: ${lerRelato(raiz1).split('\n').filter((l) => !l.startsWith('gravado')).join(' | ')})`);

  // ---- instalar no computador (PLANO §8c), pelo menu: End chega no último item, como o qemu.py
  falar('— instalar no computador (o disco interno simulado: 16 GB livres)');
  await r.tecla('Control+Alt+s');
  if (await r.esperar('menu-sistema', 5000)) {
    await r.tecla('End');
    r.ok(await r.focoEm('os-menu-instalar'), 'End no menu: "Instalar neste computador"');
    await r.tecla('Enter');
    if (await r.esperar('os-instalar-botao', 8000)) {
      await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-instalar-botao', null, { timeout: 5000 }).catch(() => undefined);
      await r.passo('instalar: o foco visível em "Instalar"');
      r.ok(await r.focoEm('os-instalar-botao'), 'o foco começa em "Instalar"');
      r.ok(await p.isChecked('[data-teste="os-instalar-levar"]'), '"Levar os textos deste pendrive" vem marcado (há textos)');
      r.ok(!!(await p.$('[data-teste="os-instalar-barra"]')), 'a barra do disco aparece');
      await foto(p, '15-instalar');
      await r.tecla('Enter');
      r.ok(await r.esperar('os-instalado', 15000), 'instalou: a tela final com o tutorial');
      if (await r.esperar('os-instalado-desligar', 3000)) r.ok(await r.focoEm('os-instalado-desligar'), 'na tela final, o foco está em Desligar');
      r.ok(!!(await p.$('[data-teste="os-tutorial"]')) && !!(await p.$('[data-teste="os-relogio"]')), 'a tela final tem o tutorial e o relógio');
      // W3f: a tecla do tutorial é a da marca do computador (o simulado é um Lenovo: F12), e o instalar ao lado não apaga
      const tecla = await p.evaluate(() => [document.querySelector('[data-teste="os-tutorial"]')?.getAttribute('data-marca'), document.querySelector('[data-teste="os-tutorial-tecla"]')?.textContent]);
      r.ok(tecla[0] === 'lenovo' && tecla[1] === 'F12', `o tutorial mostra a tecla da marca do computador (${tecla.join(' ')})`);
      r.ok(!!(await p.$('[data-teste="os-instalado-ao-lado"]')), 'instalado ao lado do Windows: o texto do F12, não o do disco todo');
      r.ok(await esperarRelato(raiz1, 'instalar ok'), 'o agente: instalar ok');
      await foto(p, '16-instalado');
    } else r.ok(false, 'a tela de instalar mostra o botão "Instalar"');
  } else r.ok(false, 'Ctrl+Alt+S abre o menu para instalar');
  await app.fechar();
  somar(r);

  // ---- ligado pelo disco do computador: sem a pergunta do uso; o menu tem o tutorial, não o "Instalar"
  falar('— ligado pelo disco do computador: o tutorial no menu');
  app = await abrir({ ...env1, EKFRASE_CASCA_OS_BOOT: 'computador', EKFRASE_CASCA_PERFIL: join(raiz1, 'perfil-3') });
  p = await app.pagina();
  r = new Roteiro(p, falar);
  r.ok(await r.esperar('casca-abrir', 10000), 'ligado pelo disco: direto na senha');
  await p.keyboard.type(SENHA);
  await r.tecla('Enter');
  if (await r.esperar('nova-historia', 10000)) {
    await r.tecla('Control+Alt+s');
    if (await r.esperar('menu-sistema', 5000)) {
      r.ok(!(await p.$('[data-teste="os-menu-instalar"]')), 'ligado pelo disco, o menu não tem "Instalar neste computador"');
      await r.tecla('End');
      r.ok(await r.focoEm('os-menu-tutorial'), 'o último item é "Como ligar no Writer OS"');
      await r.tecla('Enter');
      r.ok(await r.esperar('os-painel-tutorial', 5000), 'o tutorial abre dentro do menu');
      await foto(p, '17-tutorial-no-menu');
      await r.tecla('Escape');
      await r.tecla('Escape');
    } else r.ok(false, 'Ctrl+Alt+S abre o menu (ligado pelo disco)');
  } else r.ok(false, 'a estante abre (ligado pelo disco)');
  await app.fechar();
  somar(r);

  // ================= 2. sem a partição de dados =================
  falar('— Writer OS (simulado), sem a partição de dados: memória → outro pendrive');
  const raiz2 = join(base, 'sem-dados');
  const env2 = { ...comum, EKFRASE_CASCA_OS_RAIZ: raiz2, EKFRASE_CASCA_OS_DADOS: 'sem-dados', EKFRASE_CASCA_OS_INTERNO: 'sem-espaco', EKFRASE_CASCA_PERFIL: join(raiz2, 'perfil') };
  app = await abrir(env2);
  p = await app.pagina();
  r = new Roteiro(p, falar);
  await enter(r, 'os-idioma', 'sem-dados-os-idioma');
  // "Instalar neste computador" sem espaço livre no disco: a tela explica o "preparar" do Gravador e volta
  if (await r.esperar('os-uso', 10000)) {
    if (await r.tabAte('os-uso-instalar')) await r.tecla('Enter');
    r.ok(await r.esperar('os-instalar-motivo-sem-espaco', 8000), 'sem espaço livre: a tela de instalar explica o "preparar" do Gravador');
    await foto(p, '10a-instalar-sem-espaco');
    // W3f: "Outras opções" vem recolhido; aberto pelo teclado, o disco com Windows mostra o Windows em vermelho
    r.ok(await p.evaluate(() => (document.querySelector('[data-teste="os-instalar-outras"]') as HTMLDetailsElement | null)?.open === false), '"Outras opções" aparece, recolhido');
    await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-instalar-voltar', null, { timeout: 5000 }).catch(() => undefined);
    if (await r.tabAte('os-instalar-outras-abrir')) {
      await r.tecla('Enter');
      if (await r.tabAte('os-apagar-disco-nvme0n1')) {
        await r.tecla('Enter');
        r.ok(await r.esperar('os-apagar-nome', 3000), 'escolhido o disco, aparece o campo do nome');
        await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-apagar-nome', null, { timeout: 3000 }).catch(() => undefined);
        r.ok(await r.focoEm('os-apagar-nome'), 'o foco vai para o nome do disco');
        const vermelho = await p.evaluate(() => {
          const w = document.querySelector('[data-teste="os-apagar-parte-windows"]');
          const erro = getComputedStyle(document.documentElement).getPropertyValue('--erro').trim();
          return !!w && w.classList.contains('parte-windows') && getComputedStyle(w).color !== getComputedStyle(document.body).color && erro !== '';
        });
        r.ok(vermelho, 'o Windows aparece na lista, em vermelho');
        await foto(p, '10b-apagar-com-windows');
      } else r.ok(false, 'a lista dos discos em "Outras opções"');
    } else r.ok(false, '"Outras opções" pelo teclado');
    // de volta a Voltar (fica antes de "Outras opções")
    await r.tabAte('os-instalar-voltar');
    if (await r.esperar('os-instalar-voltar', 3000)) {
      await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-instalar-voltar', null, { timeout: 5000 }).catch(() => undefined);
      r.ok(await r.focoEm('os-instalar-voltar'), 'sem espaço: o foco está em Voltar');
      await r.tecla('Enter');
    }
  }
  for (const t of ['os-uso', 'os-teclado', 'os-fuso']) await enter(r, t, `sem-dados-${t}`);
  r.ok(await r.esperar('os-onde-guardar', 10000), 'sem a partição de dados: "onde guardar"');
  await p.waitForSelector('[data-teste="os-guardar-disco"]', { timeout: 6000 }).catch(() => null);
  await r.passo('o foco começa no pendrive OUTRO');
  await foto(p, '10-onde-guardar');
  if (await r.tabAte('os-guardar-memoria')) await r.tecla('Enter');
  await senhaNova(r);
  await enter(r, 'casca-espelho', 'sem-dados-espelho');
  await enter(r, 'os-wifi', 'sem-dados-wifi');
  r.ok(await r.esperar('os-faixa-memoria', 10000), 'a faixa âmbar avisa que os textos estão na memória');
  await foto(p, '11-faixa-memoria');
  if (await r.tabAte('os-faixa-guardar')) await r.tecla('Enter');
  if (await r.esperar('os-levar-disco', 6000)) {
    await r.passo('"guardar num pendrive" abre a lista', 'os-levar-memoria');
    if (await r.tabAte('os-levar-disco')) await r.tecla('Enter');
  } else r.ok(false, 'a lista de pendrives aparece');
  r.ok(await r.esperar('casca-abrir', 10000), 'os textos foram para o pendrive: a senha (a mesma) abre de novo');
  await p.keyboard.type(SENHA);
  await r.tecla('Enter');
  await p.waitForTimeout(800);
  r.ok(existsSync(join(raiz2, 'media', 'OUTRO', 'Ekfrase Writer', 'dados', 'cofre.db')), 'o cofre está no OUTRO');
  r.ok(!existsSync(join(raiz2, 'ram', 'Ekfrase Writer')), 'e saiu da memória');
  r.ok((await p.$('[data-teste="os-faixa-memoria"]')) === null, 'a faixa âmbar some');
  await app.fechar();
  somar(r);

  // ================= 3. o computador sem Windows: apagar o disco inteiro (W3f) =================
  falar('— computador sem Windows (o disco todo com Linux): "Apagar o disco inteiro" com o nome digitado');
  const raiz3 = join(base, 'sem-windows');
  const env3 = { ...comum, EKFRASE_CASCA_OS_RAIZ: raiz3, EKFRASE_CASCA_OS_DADOS: 'pendrive', EKFRASE_CASCA_OS_TESTE: '1', EKFRASE_CASCA_OS_INTERNO: 'linux', EKFRASE_CASCA_OS_MARCA: 'Dell Inc.', EKFRASE_CASCA_PERFIL: join(raiz3, 'perfil') };
  app = await abrir(env3);
  p = await app.pagina();
  r = new Roteiro(p, falar);
  await enter(r, 'os-idioma', 'sem-windows-os-idioma');
  if (await r.esperar('os-uso', 10000)) {
    if (await r.tabAte('os-uso-instalar')) await r.tecla('Enter');
    r.ok(await r.esperar('os-instalar-motivo-sem-espaco', 8000), 'o Linux ocupa o disco: sem espaço ao lado');
    await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-instalar-voltar', null, { timeout: 5000 }).catch(() => undefined);
    if ((await r.tabAte('os-instalar-outras-abrir')) && (await r.tecla('Enter'), await r.tabAte('os-apagar-disco-nvme0n1'))) {
      r.ok(!!(await p.$('[data-teste="os-apagar-parte-linux"]')) && !(await p.$('[data-teste="os-apagar-parte-windows"]')), 'a lista mostra o Linux e nenhum Windows');
      await r.tecla('Enter');
      await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-apagar-nome', null, { timeout: 3000 }).catch(() => undefined);
      r.ok(await r.focoEm('os-apagar-nome'), 'o foco vai para o nome do disco');
      // o nome errado: nada acontece além do aviso
      await p.keyboard.type('outro disco');
      await r.tecla('Enter');
      r.ok(await r.esperar('os-apagar-nome-errado', 3000), 'o nome errado: o aviso, e nada é apagado');
      r.ok(!(await esperarRelato(raiz3, /^instalar /m, 800)), 'o nome errado não chega a instalar');
      await foto(p, '18-apagar-nome-errado');
      await r.tecla('Control+a');
      await p.keyboard.type('ssd linux simulado');
      await r.passo('o nome certo, digitado');
      await r.tecla('Enter');
      r.ok(await r.esperar('os-instalado', 15000), 'apagou e instalou: a tela final');
      r.ok(!!(await p.$('[data-teste="os-instalado-todo"]')) && !(await p.$('[data-teste="os-tutorial"]')), 'no disco todo, o Writer OS liga sozinho: sem o tutorial do F12');
      if (await r.esperar('os-instalado-desligar', 3000)) r.ok(await r.focoEm('os-instalado-desligar'), 'na tela final, o foco está em Desligar');
      r.ok(await esperarRelato(raiz3, 'instalar ok'), 'o agente: instalar ok');
      await foto(p, '19-apagou-instalado');
    } else r.ok(false, '"Outras opções" e o disco, pelo teclado');
  } else r.ok(false, 'a pergunta do uso aparece (sem Windows)');
  await app.fechar();
  somar(r);

  // ================= 4. as atualizações (DEC-P072, U1) =================
  await percorrerAtualizacoes(abrir, base, comum, falar, foto, somar);

  // ================= 5. o portal cativo (PLANO §7) =================
  await percorrerPortal(abrir, base, comum, falar, foto, somar);

  // ================= 6. a VPN (PLANO §7) =================
  await percorrerVpn(abrir, base, comum, falar, foto, somar);

  // ================= 7. a VPN de empresa (PLANO §7) =================
  await percorrerVpnEmpresa(abrir, base, comum, falar, foto, somar);

  return { passos, falhas };
}

/**
 * 4. AS ATUALIZAÇÕES (docs/ATUALIZACOES.md): um "GitHub" local oferece a 0.2.1 (assinada com uma chave de teste, em que
 * a casca simulada confia por `EKFRASE_CASCA_ATUALIZACOES_CHAVE`). Automáticas: logo depois de abrir, a casca baixa,
 * confere e grava na cópia de reserva; o aviso do canto diz "pronta". Pelo menu (só teclado): a parte "Atualizações"
 * com a versão, o ajuste e "Procurar agora"; troca para "Perguntar" (fica no `sistema.json`); a 0.2.2 aparece, o aviso
 * oferece Instalar, e Instalar a deixa pronta. O Writer OS sem o Electron (parado) não tem atualizações: pula.
 */
async function percorrerAtualizacoes(abrir: Abrir, base: string, comum: Record<string, string>, falar: (l: string) => void, foto: (p: Page, nome: string) => Promise<void>, somar: (r: Roteiro) => void): Promise<void> {
  const ass = assinadorTeste();
  const arquivos = new Map<string, Buffer>();
  let ofertas: string[] = [];
  const publicar = (v: string) => {
    const lista = (['squashfs', 'vmlinuz', 'initrd', 'grub.cfg'] as const).map((papel) => {
      const b = papel === 'grub.cfg' ? Buffer.from(`# ${v}\n`) : randomBytes(200_000);
      const nome = `ekfrase-writer-os-${v}.${papel}`;
      arquivos.set(nome, b);
      return { papel, nome, tamanho: b.length, sha256: createHash('sha256').update(b).digest('hex') };
    });
    const texto = Buffer.from(JSON.stringify({ app: 'ekfrase-writer-os', versao: v, canal: 'estavel', arquivos: lista }));
    arquivos.set(`ekfrase-writer-os-${v}.atualizacao.json`, texto);
    arquivos.set(`ekfrase-writer-os-${v}.atualizacao.json.minisig`, Buffer.from(ass.assinar(texto, `Ekfrase Writer OS ${v} atualizacao`)));
    ofertas.push(v);
  };
  let endereco = '';
  const servidor = createServer((q, s) => {
    if (q.url === '/repos/cyfilho/ekfrase/releases?per_page=50') {
      s.setHeader('content-type', 'application/json');
      s.end(JSON.stringify(ofertas.map((v) => ({ tag_name: `writer-os-v${v}`, assets: [...arquivos.keys()].filter((n) => n.startsWith(`ekfrase-writer-os-${v}.`)).map((n) => ({ name: n, browser_download_url: `${endereco}/d/${n}`, size: arquivos.get(n)!.length })) }))));
      return;
    }
    const b = q.url?.startsWith('/d/') ? arquivos.get(q.url.slice(3)) : undefined;
    s.writeHead(b ? 200 : 404, b ? { 'content-length': b.length } : {});
    s.end(b);
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const ad = servidor.address();
  endereco = `http://127.0.0.1:${typeof ad === 'object' && ad ? ad.port : 0}`;
  try {
    publicar('0.2.1');
    const raiz = join(base, 'atualizar');
    const chave = join(base, 'chave-teste.pub');
    writeFileSync(chave, ass.chave);
    // o primeiro uso já respondido (só a senha nova): o que interessa aqui é o menu
    mkdirSync(join(raiz, 'dados', 'Ekfrase Writer'), { recursive: true });
    const sistemaJson = join(raiz, 'dados', 'Ekfrase Writer', 'sistema.json');
    writeFileSync(sistemaJson, JSON.stringify({ idioma: 'pt-BR', teclado: 'br', fuso: 'America/Sao_Paulo', wifiVisto: true, espelho: 'nao', uso: 'pendrive' }));
    const env = { ...comum, EKFRASE_CASCA_OS_RAIZ: raiz, EKFRASE_CASCA_OS_DADOS: 'pendrive', EKFRASE_CASCA_OS_TESTE: '1', EKFRASE_CASCA_PERFIL: join(raiz, 'perfil'), EKFRASE_CASCA_ATUALIZACOES_API: endereco, EKFRASE_CASCA_ATUALIZACOES_CHAVE: chave, EKFRASE_CASCA_ATUALIZACOES_ATRASO: '500', EKFRASE_CASCA_OS_VERSAO: '0.2.0' };
    const app = await abrir(env);
    const p = await app.pagina();
    const r = new Roteiro(p, falar);
    if (!(await p.evaluate(() => !!(globalThis as { ekfraseCasca?: { atualizacoes?: unknown } }).ekfraseCasca?.atualizacoes))) {
      falar('  (esta casca não tem as atualizações: o Writer OS sem o Electron, parado; pula)');
      await app.fechar();
      return;
    }
    falar('— as atualizações: automáticas, o aviso, a parte do menu, perguntar antes');
    r.ok(await r.esperar('casca-criar-senha', 10000), 'com o primeiro uso respondido, abre na senha nova');
    await p.keyboard.type(SENHA);
    if (await r.tabAte('casca-senha-repetir')) await p.keyboard.type(SENHA);
    await r.tecla('Enter');
    r.ok(await esperarRelato(raiz, 'atualizacao pronta 0.2.1 -', 20000), 'automáticas: a 0.2.1 baixou, o lacre conferiu e ficou pronta (o agente: atualizacao pronta)');
    r.ok(await r.esperar('aviso-atualizacao', 5000), 'o aviso discreto aparece no canto');
    r.ok(((await p.textContent('[data-teste="aviso-atualizacao"]')) ?? '').includes('0.2.1'), 'o aviso diz a versão pronta');
    r.ok(!(await r.focoEm('aviso-atualizacao-entendi')), 'o aviso não pega o foco');
    await foto(p, '20-atualizacao-pronta');
    await r.tecla('Control+Alt+s');
    if (await r.esperar('menu-sistema', 5000)) {
      const itens = await p.$$eval('[data-teste="menu-sistema"] [role="menuitem"]', (l) => l.map((e) => e.getAttribute('data-teste') ?? ''));
      r.ok(itens.indexOf('os-menu-atualizacoes') >= 0 && itens.indexOf('os-menu-atualizacoes') === itens.indexOf('os-menu-sobre') - 1, `o menu tem "Atualizações", logo antes de "Sobre" (${itens.join(', ')})`);
      for (let i = 0; i < itens.length && !(await r.focoEm('os-menu-atualizacoes')); i++) await r.tecla('ArrowDown');
      await r.tecla('Enter');
      if (await r.esperar('os-painel-atualizacoes', 5000)) {
        await p.waitForTimeout(300);
        await r.passo('a parte "Atualizações": o foco no ajuste de agora', 'menu-sistema');
        r.ok(await r.focoEm('atualizacoes-modo-automaticas'), 'o foco começa em "Automáticas (recomendado)", o padrão');
        r.ok(((await p.textContent('[data-teste="atualizacoes-versao"]')) ?? '').includes('0.2.0'), 'mostra a versão de agora');
        r.ok(!!(await p.$('[data-teste="atualizacoes-situacao-pronta"]')), 'mostra que a 0.2.1 está pronta');
        await foto(p, '21-atualizacoes');
        // as setas trocam o ajuste (botões de opção)
        await r.tecla('ArrowDown');
        await p.waitForTimeout(300);
        let sj: Record<string, unknown> = {};
        try {
          sj = JSON.parse(readFileSync(sistemaJson, 'utf8')) as Record<string, unknown>;
        } catch {
          // fica vazio
        }
        r.ok(sj['atualizacoes'] === 'perguntar', `"Perguntar antes de instalar" fica no sistema.json (${String(sj['atualizacoes'])})`);
        // uma versão ainda mais nova: Procurar agora → "há uma versão nova", com Instalar
        publicar('0.2.2');
        if (await r.tabAte('atualizacoes-procurar')) await r.tecla('Enter');
        r.ok(await r.esperar('atualizacoes-situacao-disponivel', 8000), 'perguntar: "Procurar agora" acha a 0.2.2 e espera o Instalar');
        r.ok(!(await esperarRelato(raiz, 'atualizacao baixando 0.2.2 -', 500)), 'perguntar: não baixa sozinho');
        r.ok(!!(await p.$('[data-teste="aviso-atualizacao-instalar"]')), 'o aviso do canto oferece Instalar e Agora não');
        await foto(p, '22-atualizacao-disponivel');
        if (await r.tabAte('atualizacoes-instalar')) await r.tecla('Enter');
        r.ok(await r.esperar('atualizacoes-situacao-pronta', 15000), 'Instalar: a 0.2.2 baixa, confere e fica pronta');
        r.ok(await r.focoEm('atualizacoes-procurar'), 'depois do Instalar, o foco continua no mesmo botão (agora "Procurar agora")');
        r.ok(await esperarRelato(raiz, 'atualizacao pronta 0.2.2 -'), 'o agente: atualizacao pronta 0.2.2');
        await r.tecla('Escape');
        r.ok((await r.esperar('os-menu-atualizacoes', 3000)) && (await r.focoEm('os-menu-atualizacoes')), 'Esc volta ao menu, no item "Atualizações"');
        await r.tecla('Escape');
      } else r.ok(false, 'Enter em "Atualizações" abre a parte');
    } else r.ok(false, 'Ctrl+Alt+S abre o menu do sistema');
    r.ok(!existsSync(join(raiz, 'dados', 'Ekfrase Writer', '.atualizacao', '0.2.2')), 'o que foi baixado sai da partição de dados depois de gravado');
    await app.fechar();
    somar(r);
  } finally {
    servidor.close();
  }
}

/**
 * 5. O portal cativo (PLANO §7, W4): o sistema simulado com `EKFRASE_CASCA_OS_PORTAL` pergunta ao portal de mentira se
 * há internet (`/nm`: redireciona a `/entrar` até o formulário ser enviado; depois, `X-NetworkManager-Status: online`).
 * Conecta na "Biblioteca" pelo menu, o aviso aparece com o foco no botão, Enter abre a janela presa ao site do portal; o
 * link para `localhost` (outro site) não sai; entrar faz a janela fechar sozinha e o foco voltar à rede.
 */
async function percorrerPortal(abrir: Abrir, base: string, comum: Record<string, string>, falar: (l: string) => void, foto: (p: Page, nome: string) => Promise<void>, somar: (r: Roteiro) => void): Promise<void> {
  const prints = process.env['EKFRASE_PRINTS_OS'];
  let entrou = false;
  let saiuDoPortal = false;
  let porta = 0;
  const servidor = createServer((q, s) => {
    // o link "de fora" aponta para localhost: se o pedido chegar aqui, a janela deixou sair para outro site
    if ((q.headers.host ?? '').startsWith('localhost')) saiuDoPortal = true;
    const caminho = (q.url ?? '').split('?')[0];
    if (caminho === '/nm') {
      if (entrou) s.writeHead(204, { 'X-NetworkManager-Status': 'online' });
      else s.writeHead(302, { location: `http://127.0.0.1:${porta}/entrar` });
      s.end();
      return;
    }
    if (caminho === '/entrar' && q.method === 'POST') {
      q.resume();
      q.on('end', () => {
        entrou = true;
        s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        s.end('<!doctype html><title>Bem-vindo</title><p id="ok">Bem-vindo à rede da Biblioteca.</p>');
      });
      return;
    }
    if (caminho === '/entrar') {
      s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      s.end(
        '<!doctype html><title>Wi-Fi da Biblioteca</title><h1>Wi-Fi da Biblioteca</h1>' +
          `<p><a id="fora" href="http://localhost:${porta}/fora">Conheça o nosso site</a></p>` +
          '<form method="post" action="/entrar"><label>Quarto <input id="quarto" name="quarto"></label> <button id="entrar">Entrar</button></form>',
      );
      return;
    }
    s.writeHead(404);
    s.end();
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const ad = servidor.address();
  porta = typeof ad === 'object' && ad ? ad.port : 0;
  try {
    const raiz = join(base, 'portal');
    // o primeiro uso já respondido (só a senha nova): o que interessa aqui é o Wi-Fi do menu
    mkdirSync(join(raiz, 'dados', 'Ekfrase Writer'), { recursive: true });
    writeFileSync(join(raiz, 'dados', 'Ekfrase Writer', 'sistema.json'), JSON.stringify({ idioma: 'pt-BR', teclado: 'br', fuso: 'America/Sao_Paulo', wifiVisto: true, espelho: 'nao', uso: 'pendrive' }));
    const env = { ...comum, EKFRASE_CASCA_OS_RAIZ: raiz, EKFRASE_CASCA_OS_DADOS: 'pendrive', EKFRASE_CASCA_OS_TESTE: '1', EKFRASE_CASCA_PERFIL: join(raiz, 'perfil'), EKFRASE_CASCA_OS_PORTAL: `http://127.0.0.1:${porta}` };
    const app = await abrir(env);
    const electron = app.electron;
    if (!electron) {
      falar('  (esta casca não dá acesso às outras janelas: pula o portal)');
      await app.fechar();
      return;
    }
    falar('— o portal cativo: o aviso, a janela presa ao site, o link barrado, entrar e fechar sozinha');
    const p = await app.pagina();
    const r = new Roteiro(p, falar);
    r.ok(await r.esperar('casca-criar-senha', 10000), 'com o primeiro uso respondido, abre na senha nova');
    await p.keyboard.type(SENHA);
    if (await r.tabAte('casca-senha-repetir')) await p.keyboard.type(SENHA);
    await r.tecla('Enter');
    await p.waitForTimeout(500);
    await r.tecla('Control+Alt+s');
    if (await r.esperar('menu-sistema', 5000)) {
      const itens = await p.$$eval('[data-teste="menu-sistema"] [role="menuitem"]', (l) => l.map((e) => e.getAttribute('data-teste') ?? ''));
      for (let i = 0; i < itens.length && !(await r.focoEm('os-menu-wifi')); i++) await r.tecla('ArrowDown');
      await r.tecla('Enter');
      const naBiblioteca = () => p.evaluate(() => (document.activeElement?.textContent ?? '').startsWith('Biblioteca'));
      if ((await r.esperar('os-rede', 5000)) && (await r.tabAte('os-rede'))) {
        for (let i = 0; i < 6 && !(await naBiblioteca()); i++) await r.tecla('Tab');
        r.ok(await naBiblioteca(), 'o Tab chega na rede "Biblioteca" (aberta)');
        await r.tecla('Enter');
      } else r.ok(false, 'a lista de redes aparece no menu');
      const aviso = await r.esperar('os-portal-abrir', 10000);
      r.ok(aviso, 'conectado numa rede com portal: aparece "Esta rede pede login numa página"');
      if (aviso) {
        await p.waitForTimeout(200);
        r.ok(await r.focoEm('os-portal-abrir'), 'o foco vai no botão "Abrir a página de login"');
        await r.passo('o aviso do portal', 'menu-sistema');
        await foto(p, '30-portal-aviso');
        await r.tecla('Enter');
        // a janela do portal, já no fim da cadeia /nm → /entrar
        let portal: Page | null = null;
        for (let i = 0; i < 50 && !portal; i++) {
          portal = electron.windows().find((w) => w.url().includes('/entrar')) ?? null;
          if (!portal) await new Promise((ok) => setTimeout(ok, 200));
        }
        r.ok(!!portal, 'Enter abre a janela do portal, já na página de login (o redirecionamento do teste)');
        r.ok(await esperarRelato(raiz, 'portal abriu', 5000), 'o agente: portal abriu');
        if (portal) {
          const janelaDoPortal = portal;
          await janelaDoPortal.waitForSelector('#fora', { timeout: 5000 }).catch(() => undefined);
          if (prints) await janelaDoPortal.screenshot({ path: join(prints, '31-portal-janela.png') }).catch(() => undefined);
          const focoNo = () => janelaDoPortal.evaluate(() => document.activeElement?.id ?? '');
          for (let i = 0; i < 6 && (await focoNo()) !== 'fora'; i++) await janelaDoPortal.keyboard.press('Tab');
          await janelaDoPortal.keyboard.press('Enter');
          await janelaDoPortal.waitForTimeout(1000);
          r.ok(!saiuDoPortal, 'o link para outro site (localhost) não sai: o pedido nem chega');
          r.ok(janelaDoPortal.url().includes('127.0.0.1') && janelaDoPortal.url().includes('/entrar'), `a janela continua na página do portal (${janelaDoPortal.url()})`);
          const barrado = await electron.evaluate(() => {
            const b = (globalThis as unknown as { ekfraseCasca?: { travas: { bloqueado: { tipo: string; alvo: string }[] } } }).ekfraseCasca?.travas.bloqueado ?? [];
            return b.some((x) => x.alvo.startsWith('http://localhost'));
          });
          r.ok(barrado, 'a trava anotou o link barrado');
          for (let i = 0; i < 6 && (await focoNo()) !== 'quarto'; i++) await janelaDoPortal.keyboard.press('Tab');
          await janelaDoPortal.keyboard.type('101');
          await janelaDoPortal.keyboard.press('Enter');
          const fechou = await esperarRelato(raiz, 'portal fechou internet', 15000);
          r.ok(entrou, 'o formulário do portal foi enviado (o POST chegou)');
          r.ok(fechou, 'entrou: a janela fecha sozinha quando a internet chega (o agente: portal fechou internet)');
          await p.waitForTimeout(300);
          r.ok(electron.windows().every((w) => !w.url().includes(`127.0.0.1:${porta}`)), 'a janela do portal sumiu');
        }
        r.ok(await r.esperar('os-rede', 3000), 'a lista de redes continua');
        r.ok(!(await p.$('[data-teste="os-portal"]')), 'com a internet, o aviso do portal sai');
        r.ok(((await p.textContent('[data-teste="os-redes"]')) ?? '').includes('internet chegou'), 'o recado diz que a internet chegou');
        r.ok(await naBiblioteca(), 'o foco volta para a rede conectada');
        await foto(p, '32-portal-fechou');
      }
      await r.tecla('Escape');
      await r.tecla('Escape');
    } else r.ok(false, 'Ctrl+Alt+S abre o menu do sistema');
    await app.fechar();
    somar(r);
  } finally {
    servidor.close();
  }
}

/** Todos os arquivos de uma pasta, com as subpastas (para procurar algo que não pode estar em claro). */
function arquivosDe(pasta: string): string[] {
  const fora: string[] = [];
  for (const e of readdirSync(pasta, { withFileTypes: true })) {
    const c = join(pasta, e.name);
    if (e.isDirectory()) fora.push(...arquivosDe(c));
    else if (e.isFile()) fora.push(c);
  }
  return fora;
}

/**
 * 6. A VPN (PLANO §7, W4, parte 2c-2): no pendrive simulado OUTRO, um `.conf` de WireGuard, um `.ovpn` que pede usuário
 * e senha (o simulado só liga com `vpn123`), um `.ovpn` com `up` (recusado) e um `.txt` (que nem aparece). Tudo pelo
 * teclado: o menu → "VPN" → "Importar o arquivo da VPN" → a tela dos pendrives → Enter no arquivo; ligar, a senha, o
 * cadeado, desligar, "Ligar sozinha"; fechar e abrir (outro boot): as duas voltaram do cofre, e a senha guardada liga
 * sem perguntar; Esquecer pergunta antes.
 */
async function percorrerVpn(abrir: Abrir, base: string, comum: Record<string, string>, falar: (l: string) => void, foto: (p: Page, nome: string) => Promise<void>, somar: (r: Roteiro) => void): Promise<void> {
  const raiz = join(base, 'vpn');
  mkdirSync(join(raiz, 'dados', 'Ekfrase Writer'), { recursive: true });
  writeFileSync(join(raiz, 'dados', 'Ekfrase Writer', 'sistema.json'), JSON.stringify({ idioma: 'pt-BR', teclado: 'br', fuso: 'America/Sao_Paulo', wifiVisto: true, espelho: 'nao', uso: 'pendrive' }));
  const outro = join(raiz, 'media', 'OUTRO');
  mkdirSync(outro, { recursive: true });
  const nl = String.fromCharCode(10);
  // as chaves da imagem de teste (sorteadas, não abrem nada); o servidor é da faixa de documentação
  const privada = '/C+IDWTXV8Ok/uFRSeUrbTnRysu0mJDtwnI6l7KDC18=';
  writeFileSync(join(outro, 'casa.conf'), ['[Interface]', `PrivateKey = ${privada}`, 'Address = 10.99.0.2/32', '', '[Peer]', 'PublicKey = r29dFHxRpkv75xw5E0CTX53XY0M08+YZFznO6aIGfcM=', 'AllowedIPs = 0.0.0.0/0', 'Endpoint = 192.0.2.1:51820', ''].join(nl));
  const certificado = ['<ca>', '-----BEGIN CERTIFICATE-----', 'MIIBszCCAVmgAwIBAgIUEkfrase', '-----END CERTIFICATE-----', '</ca>'];
  writeFileSync(join(outro, 'empresa.ovpn'), ['client', 'dev tun', 'remote vpn.empresa.example 1194', 'auth-user-pass', ...certificado, 'verb 3', ''].join(nl));
  writeFileSync(join(outro, 'perigosa.ovpn'), ['client', 'dev tun', 'remote 203.0.113.9 1194', 'up /bin/sh', ...certificado, ''].join(nl));
  writeFileSync(join(outro, 'notas.txt'), 'não é VPN');
  const env = { ...comum, EKFRASE_CASCA_OS_RAIZ: raiz, EKFRASE_CASCA_OS_DADOS: 'pendrive', EKFRASE_CASCA_OS_TESTE: '1', EKFRASE_CASCA_PERFIL: join(raiz, 'perfil') };

  falar('— a VPN: importar do pendrive, recusar o .ovpn com up, ligar com a senha, o cadeado, desligar');
  let app = await abrir(env);
  let p = await app.pagina();
  let r = new Roteiro(p, falar);
  /** Onde está o foco: `<nome da VPN>|<data-teste>`. */
  const foco = () => p.evaluate(() => `${document.activeElement?.closest('[data-teste="os-vpn"]')?.getAttribute('data-nome') ?? ''}|${document.activeElement?.getAttribute('data-teste') ?? ''}`);
  const esperarFoco = (alvo: string) =>
    p
      .waitForFunction((a) => `${document.activeElement?.closest('[data-teste="os-vpn"]')?.getAttribute('data-nome') ?? ''}|${document.activeElement?.getAttribute('data-teste') ?? ''}` === a, alvo, { timeout: 5000 })
      .then(
        () => true,
        () => false,
      );
  /** Tab (até 20) até o foco chegar no botão `teste` da VPN `nome`. */
  const irAte = async (nome: string, teste: string) => {
    for (let i = 0; i < 20 && (await foco()) !== `${nome}|${teste}`; i++) await r.tecla('Tab');
    return (await foco()) === `${nome}|${teste}`;
  };
  const ligada = (nome: string) => p.evaluate((n) => document.querySelector(`[data-teste="os-vpn"][data-nome="${n}"]`)?.getAttribute('data-ligada') === 'sim', nome);
  const cadeado = () => p.evaluate(() => document.querySelector('[data-teste="os-vpn-cadeado"]')?.getAttribute('aria-label') ?? null);
  const sozinhaMarcada = (nome: string) => p.evaluate((n) => document.querySelector<HTMLInputElement>(`[data-teste="os-vpn"][data-nome="${n}"] [data-teste="os-vpn-sozinha"]`)?.checked === true, nome);
  /** O menu → "VPN" (setas até o item, Enter). */
  const abrirVpn = async (): Promise<boolean> => {
    await r.tecla('Control+Alt+s');
    if (!(await r.esperar('menu-sistema', 5000))) return false;
    const itens = await p.$$eval('[data-teste="menu-sistema"] [role="menuitem"]', (l) => l.map((e) => e.getAttribute('data-teste') ?? ''));
    r.ok(itens.indexOf('os-menu-vpn') === itens.indexOf('os-menu-wifi') + 1, `"VPN" vem logo depois do Wi-Fi no menu (${itens.join(', ')})`);
    for (let i = 0; i < itens.length && !(await r.focoEm('os-menu-vpn')); i++) await r.tecla('ArrowDown');
    await r.tecla('Enter');
    return r.esperar('os-painel-vpn', 5000);
  };
  /** "Importar o arquivo da VPN" → o pendrive OUTRO → Enter no arquivo. */
  const importar = async (arquivo: string, print?: string): Promise<boolean> => {
    if (!(await r.focoEm('os-vpn-importar')) && !(await r.tabAte('os-vpn-importar', 20))) return false;
    await r.tecla('Enter');
    if (!(await r.esperar('os-pendrive-disco', 5000))) return false;
    await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-pendrive-disco', null, { timeout: 5000 }).catch(() => undefined);
    await r.tecla('Enter');
    if (!(await r.esperar('os-pendrive-vpn', 6000))) return false;
    await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-pendrive-vpn', null, { timeout: 5000 }).catch(() => undefined);
    if (print) {
      const lista = await p.$$eval('[data-teste="os-pendrive-vpn"]', (l) => l.map((b) => (b.textContent ?? '').split(' (')[0]));
      r.ok([...lista].sort().join(',') === 'casa.conf,empresa.ovpn,perigosa.ovpn', `a tela dos pendrives mostra só os arquivos de VPN (${lista.join(', ')})`);
      await r.passo('a lista dos arquivos de VPN', 'os-pendrive');
      await foto(p, print);
    }
    const noArquivo = () => p.evaluate((a) => (document.activeElement?.textContent ?? '').startsWith(a), arquivo);
    for (let i = 0; i < 8 && !(await noArquivo()); i++) await r.tecla('Tab');
    if (!(await noArquivo())) return false;
    await r.tecla('Enter');
    return true;
  };

  r.ok(await r.esperar('casca-criar-senha', 10000), 'com o primeiro uso respondido, abre na senha nova');
  await p.keyboard.type(SENHA);
  if (await r.tabAte('casca-senha-repetir')) await p.keyboard.type(SENHA);
  await r.tecla('Enter');
  await p.waitForTimeout(500);
  if (await abrirVpn()) {
    r.ok(await r.esperar('os-vpn-nenhuma', 3000), 'a parte "VPN" diz que ainda não há nenhuma');
    await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-vpn-importar', null, { timeout: 3000 }).catch(() => undefined);
    r.ok(await r.focoEm('os-vpn-importar'), 'sem VPN, o foco começa em "Importar o arquivo da VPN"');
    await r.passo('a parte "VPN"', 'menu-sistema');
    await foto(p, '40-vpn-vazia');

    // o .conf (WireGuard)
    r.ok(await importar('casa.conf', '41-vpn-pendrive'), 'importar: a tela dos pendrives e Enter em casa.conf');
    r.ok(await esperarFoco('casa|os-vpn-ligar'), `importou: a VPN "casa" aparece, com o foco no Ligar dela (${await foco()})`);
    r.ok(((await p.textContent('[data-teste="os-vpn-recado"]').catch(() => '')) ?? '').includes('casa'), 'o recado diz que a VPN casa foi importada');
    r.ok(!(await p.$('[data-teste="os-pendrive"]')), 'a tela dos pendrives fechou');

    // o .ovpn com "up": recusado, dizendo a linha
    r.ok(await importar('perigosa.ovpn'), 'importar perigosa.ovpn pelo teclado');
    const erro = (await r.esperar('os-vpn-erro', 5000)) ? ((await p.textContent('[data-teste="os-vpn-erro"]')) ?? '') : '';
    r.ok(erro.includes('"up"'), `o .ovpn que roda programa é recusado, dizendo a linha (${erro})`);
    r.ok((await p.$$('[data-teste="os-vpn"]')).length === 1, 'a recusada não entra na lista');
    await r.passo('a recusa do .ovpn', 'menu-sistema');
    await foto(p, '42-vpn-recusada');

    // o .ovpn que pede usuário e senha
    r.ok(await importar('empresa.ovpn'), 'importar empresa.ovpn pelo teclado');
    r.ok(await esperarFoco('empresa|os-vpn-ligar'), `importou a "empresa", com o foco no Ligar dela (${await foco()})`);

    // ligar o WireGuard: o cadeado ao lado da bateria
    r.ok(await irAte('casa', 'os-vpn-ligar'), 'o Tab chega no Ligar da "casa"');
    await r.tecla('Enter');
    r.ok(await esperarFoco('casa|os-vpn-desligar'), `ligou a "casa": o botão vira Desligar, com o foco (${await foco()})`);
    r.ok(await ligada('casa'), 'a "casa" aparece ligada');
    r.ok((await cadeado())?.includes('casa') === true, `o cadeado aparece (${await cadeado()})`);
    r.ok(await p.evaluate(() => !!document.querySelector('[data-teste="os-relogio"] [data-teste="os-vpn-cadeado"] + [data-teste="bateria-nivel"]')), 'o cadeado fica logo antes da bateria, no relógio');

    // ligar o OpenVPN: o usuário e a senha (a errada, depois a certa)
    r.ok(await irAte('empresa', 'os-vpn-ligar'), 'o Tab chega no Ligar da "empresa"');
    // diagnóstico (o Linux do CI perdia o foco aqui): quem chama focus() e para onde o foco vai
    await p.evaluate(() => {
      const w = window as unknown as { __foco?: string[] };
      w.__foco = [];
      const orig = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (...a: []) {
        w.__foco?.push(`focus() em ${this.getAttribute('data-teste') ?? this.tagName} por ${(new Error().stack ?? '').split('\n').slice(2, 4).join(' < ').replace(/\s+/g, ' ')}`);
        return orig.apply(this, a);
      };
      document.addEventListener('focusin', (e) => w.__foco?.push(`focusin ${(e.target as HTMLElement).getAttribute?.('data-teste') ?? '?'}`), true);
      document.addEventListener('focusout', (e) => w.__foco?.push(`focusout ${(e.target as HTMLElement).getAttribute?.('data-teste') ?? '?'}`), true);
    });
    await r.tecla('Enter');
    if (await r.esperar('os-vpn-usuario', 3000)) {
      const noUsuario = await p
        .waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-vpn-usuario', null, { timeout: 5000 })
        .then(
          () => true,
          () => false,
        );
      r.ok(noUsuario, 'o OpenVPN pede o usuário, com o foco nele');
      if (!noUsuario) falar(`diagnóstico do foco:\n${((await p.evaluate(() => (window as unknown as { __foco?: string[] }).__foco ?? [])) as string[]).join('\n')}`);
      const acima = await p.evaluate(() => {
        const campo = document.querySelector('[data-teste="os-vpn-usuario"]');
        const lista = document.querySelector('[data-teste="os-vpn"]');
        return !!campo && !!lista && (campo.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      });
      r.ok(acima, 'o usuário e a senha ficam acima da lista');
      await p.keyboard.type('ana');
      await r.tecla('Tab');
      const naSenha = await p
        .waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-vpn-senha', null, { timeout: 5000 })
        .then(
          () => true,
          () => false,
        );
      r.ok(naSenha, `Tab: a senha (foco em ${await foco()})`);
      await p.keyboard.type('errada');
      await foto(p, '43-vpn-senha');
      await r.tecla('Enter');
      const errada = (await r.esperar('os-vpn-erro', 5000)) ? ((await p.textContent('[data-teste="os-vpn-erro"]')) ?? '') : '';
      r.ok(errada.includes('senha'), `a senha errada: o aviso (${errada})`);
      await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-vpn-senha', null, { timeout: 3000 }).catch(() => undefined);
      r.ok(await r.focoEm('os-vpn-senha'), 'o foco volta à senha, para digitar de novo');
      r.ok(!(await ligada('empresa')), 'com a senha errada, a "empresa" não liga');
      // o campo guarda a senha errada (o app a deixa selecionada, mas a seleção chega depois do aviso): apaga tudo antes de digitar
      await r.tecla('Control+a');
      await p.keyboard.type('vpn123');
      await r.tecla('Enter');
      r.ok(await esperarFoco('empresa|os-vpn-desligar'), `a senha certa: ligou, com o foco no Desligar dela (${await foco()})`);
      r.ok(!(await p.$('[data-teste="os-vpn-usuario"]')), 'os campos do usuário e da senha somem');
      r.ok((await ligada('empresa')) && !(await ligada('casa')), 'a "empresa" ligada; a "casa" desligou (uma VPN por vez)');
      r.ok((await cadeado())?.includes('empresa') === true, `o cadeado diz qual está ligada (${await cadeado()})`);
      await r.passo('a VPN ligada', 'menu-sistema');
      await foto(p, '44-vpn-ligada');
    } else r.ok(false, 'o OpenVPN pede usuário e senha');

    // desligar: o cadeado some
    if ((await foco()) === 'empresa|os-vpn-desligar') await r.tecla('Enter');
    r.ok(await esperarFoco('empresa|os-vpn-ligar'), `desligou: o botão volta a Ligar, com o foco (${await foco()})`);
    r.ok((await cadeado()) === null, 'desligada, o cadeado some');
    // "Ligar sozinha quando houver internet" (padrão: não)
    r.ok(!(await sozinhaMarcada('casa')) && !(await sozinhaMarcada('empresa')), '"Ligar sozinha" vem desmarcado');
    r.ok(await irAte('casa', 'os-vpn-sozinha'), 'o Tab chega em "Ligar sozinha" da "casa"');
    await r.tecla('Space');
    await p.waitForTimeout(300);
    r.ok(await sozinhaMarcada('casa'), 'a barra de espaço marca "Ligar sozinha"');
    await r.tecla('Escape');
    await r.tecla('Escape');
  } else r.ok(false, 'o menu do sistema abre a parte "VPN"');
  await app.fechar();
  // nada da VPN em claro no pendrive: nem o arquivo (a chave, o servidor), nem a senha
  const emClaro = arquivosDe(join(raiz, 'dados')).filter((f) => {
    const b = readFileSync(f);
    return b.includes(privada) || b.includes('vpn123') || b.includes('vpn.empresa.example');
  });
  r.ok(emClaro.length === 0, `nada da VPN em claro no pendrive (${emClaro.join(', ')})`);
  somar(r);

  // ---- outro boot: as VPNs voltam do cofre
  falar('— a VPN, outro boot: voltaram do cofre; a senha guardada liga sem perguntar');
  app = await abrir({ ...env, EKFRASE_CASCA_PERFIL: join(raiz, 'perfil-2') });
  p = await app.pagina();
  r = new Roteiro(p, falar);
  r.ok(await r.esperar('casca-abrir', 10000), 'no outro boot, a senha');
  await p.keyboard.type(SENHA);
  await r.tecla('Enter');
  await p.waitForTimeout(500);
  if (await abrirVpn()) {
    await p.waitForSelector('[data-teste="os-vpn"]', { timeout: 5000 }).catch(() => undefined);
    const nomes = await p.$$eval('[data-teste="os-vpn"]', (l) => l.map((e) => e.getAttribute('data-nome') ?? ''));
    r.ok([...nomes].sort().join(',') === 'casa,empresa', `as duas VPNs voltaram do cofre (${nomes.join(', ')})`);
    r.ok(await esperarFoco(`${nomes[0] ?? ''}|os-vpn-ligar`), `o foco começa no Ligar da primeira (${await foco()})`);
    r.ok(await sozinhaMarcada('casa'), '"Ligar sozinha" da "casa" foi lembrado');
    r.ok(!(await ligada('empresa')) && (await cadeado()) === null, 'voltam desligadas (sem o cadeado)');
    r.ok(await irAte('empresa', 'os-vpn-ligar'), 'o Tab chega no Ligar da "empresa"');
    await r.tecla('Enter');
    r.ok(await esperarFoco('empresa|os-vpn-desligar'), `a senha guardada no cofre: liga sem perguntar (${await foco()})`);
    r.ok(!(await p.$('[data-teste="os-vpn-usuario"]')) && (await ligada('empresa')), 'nenhum campo de senha, e a "empresa" está ligada');
    // Esquecer pergunta antes; confirmado, sai da lista
    r.ok(await irAte('empresa', 'os-vpn-esquecer'), 'o Tab chega no Esquecer da "empresa"');
    await r.tecla('Enter');
    if (await r.esperar('confirmar', 3000)) {
      await foto(p, '45-vpn-esquecer');
      r.ok(await r.focoEm('confirmar-sim'), 'Esquecer pergunta antes (o foco em "Esquecer")');
      await r.tecla('Enter');
      await p.waitForFunction(() => document.querySelectorAll('[data-teste="os-vpn"]').length === 1, null, { timeout: 5000 }).catch(() => undefined);
      const ficou = await p.$$eval('[data-teste="os-vpn"]', (l) => l.map((e) => e.getAttribute('data-nome') ?? ''));
      r.ok(ficou.join(',') === 'casa', `a "empresa" saiu da lista (${ficou.join(', ')})`);
      r.ok((await cadeado()) === null, 'esquecida a que estava ligada, o cadeado some');
      r.ok(await esperarFoco('casa|os-vpn-ligar'), `o foco vai para a VPN que ficou (${await foco()})`);
    } else r.ok(false, 'Esquecer pede confirmação');
    await r.tecla('Escape');
    await r.tecla('Escape');
  } else r.ok(false, 'o menu do sistema abre a parte "VPN" (outro boot)');
  await app.fechar();
  somar(r);
}

/**
 * 7. A VPN de empresa (PLANO §7, W5a-2): "Adicionar VPN de empresa" pelo teclado, contra o sistema simulado: `vpn.exemplo.local`
 * (senha `vpn123`; o usuário `dois` pede o código `123456`), `autoassinado.exemplo.local` (pede para confiar na impressão)
 * e `sso.exemplo.local` (só pelo navegador). Liga ao adicionar; o cadeado; o código errado e o certo; a impressão e
 * "Confiar neste certificado"; o aviso do `sso`; o endereço que não serve; no outro boot, voltam do cofre (a que pediu
 * código pergunta de novo e não liga sozinha).
 */
async function percorrerVpnEmpresa(abrir: Abrir, base: string, comum: Record<string, string>, falar: (l: string) => void, foto: (p: Page, nome: string) => Promise<void>, somar: (r: Roteiro) => void): Promise<void> {
  const raiz = join(base, 'vpn-empresa');
  mkdirSync(join(raiz, 'dados', 'Ekfrase Writer'), { recursive: true });
  writeFileSync(join(raiz, 'dados', 'Ekfrase Writer', 'sistema.json'), JSON.stringify({ idioma: 'pt-BR', teclado: 'br', fuso: 'America/Sao_Paulo', wifiVisto: true, espelho: 'nao', uso: 'pendrive' }));
  const env = { ...comum, EKFRASE_CASCA_OS_RAIZ: raiz, EKFRASE_CASCA_OS_DADOS: 'pendrive', EKFRASE_CASCA_OS_TESTE: '1', EKFRASE_CASCA_PERFIL: join(raiz, 'perfil') };

  falar('— a VPN de empresa: adicionar, ligar, o código, o certificado, o login pelo navegador');
  let app = await abrir(env);
  let p = await app.pagina();
  let r = new Roteiro(p, falar);
  const nomes = () => p.$$eval('[data-teste="os-vpn"]', (l) => l.map((e) => e.getAttribute('data-nome') ?? ''));
  const ligada = (nome: string) => p.evaluate((n) => document.querySelector(`[data-teste="os-vpn"][data-nome="${n}"]`)?.getAttribute('data-ligada') === 'sim', nome);
  const cadeado = () => p.evaluate(() => document.querySelector('[data-teste="os-vpn-cadeado"]')?.getAttribute('aria-label') ?? null);
  const textoDe = async (teste: string) => ((await p.textContent(`[data-teste="${teste}"]`).catch(() => '')) ?? '');
  const esperarLigada = (nome: string) =>
    p.waitForFunction((n) => document.querySelector(`[data-teste="os-vpn"][data-nome="${n}"]`)?.getAttribute('data-ligada') === 'sim', nome, { timeout: 8000 }).then(
      () => true,
      () => false,
    );
  const abrirVpn = async (): Promise<boolean> => {
    await r.tecla('Control+Alt+s');
    if (!(await r.esperar('menu-sistema', 5000))) return false;
    const itens = await p.$$eval('[data-teste="menu-sistema"] [role="menuitem"]', (l) => l.map((e) => e.getAttribute('data-teste') ?? ''));
    for (let i = 0; i < itens.length && !(await r.focoEm('os-menu-vpn')); i++) await r.tecla('ArrowDown');
    await r.tecla('Enter');
    return r.esperar('os-painel-vpn', 5000);
  };
  /** O botão "Adicionar VPN de empresa" → o servidor, o usuário e a senha, tudo digitado; Enter envia. */
  const adicionar = async (servidor: string, usuario: string, senha: string): Promise<boolean> => {
    if (!(await r.focoEm('os-vpn-empresa')) && !(await r.tabAte('os-vpn-empresa', 30))) return false;
    await r.tecla('Enter');
    if (!(await r.esperar('os-vpn-empresa-form', 3000))) return false;
    await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-vpn-empresa-servidor', null, { timeout: 3000 }).catch(() => undefined);
    if (!(await r.focoEm('os-vpn-empresa-servidor'))) return false;
    await p.keyboard.type(servidor);
    await r.tecla('Tab');
    await p.keyboard.type(usuario);
    await r.tecla('Tab');
    await p.keyboard.type(senha);
    await r.tecla('Enter');
    return true;
  };

  r.ok(await r.esperar('casca-criar-senha', 10000), 'com o primeiro uso respondido, abre na senha nova');
  await p.keyboard.type(SENHA);
  if (await r.tabAte('casca-senha-repetir')) await p.keyboard.type(SENHA);
  await r.tecla('Enter');
  await p.waitForTimeout(500);
  if (await abrirVpn()) {
    r.ok(await r.esperar('os-vpn-nenhuma', 3000), 'a parte "VPN" diz que ainda não há nenhuma');
    r.ok(await r.tabAte('os-vpn-empresa', 10), 'o Tab chega em "Adicionar VPN de empresa"');
    await r.tecla('Enter');
    r.ok(await r.esperar('os-vpn-empresa-form', 3000), 'o formulário abre');
    await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-vpn-empresa-servidor', null, { timeout: 3000 }).catch(() => undefined);
    r.ok(await r.focoEm('os-vpn-empresa-servidor'), `o foco começa no servidor (${await p.evaluate(() => document.activeElement?.getAttribute('data-teste') ?? document.activeElement?.tagName)})`);
    const tipos = await p.$$eval('[data-teste="os-vpn-empresa-tipo"] option', (l) => l.map((o) => (o as HTMLOptionElement).value).join(','));
    r.ok(tipos === 'anyconnect,gp,fortinet', `o tipo oferece AnyConnect, GlobalProtect e Fortinet (${tipos})`);
    await foto(p, '46-vpn-empresa-formulario');
    r.ok(await r.tabAte('os-vpn-empresa-cancelar', 12), 'o Tab chega no Cancelar do formulário');
    await r.tecla('Enter');
    r.ok(!(await p.$('[data-teste="os-vpn-empresa-form"]')), 'cancelar fecha o formulário sem criar nada');
    r.ok((await nomes()).length === 0, 'cancelar não criou VPN');

    // o endereço que não serve: o aviso, e o formulário continua
    r.ok(await adicionar('isto nao e endereco', 'ana', 'vpn123'), 'preencher com um endereço que não serve');
    const ruim = (await r.esperar('os-vpn-erro', 5000)) ? await textoDe('os-vpn-erro') : '';
    r.ok(ruim.includes('endereço'), `o endereço que não serve é dito (${ruim})`);
    r.ok(!!(await p.$('[data-teste="os-vpn-empresa-form"]')) && (await nomes()).length === 0, 'o formulário fica aberto e nada foi criado');
    r.ok(await r.focoEm('os-vpn-empresa-servidor'), 'o foco volta ao servidor');
    await p.keyboard.press('Control+a');
    await p.keyboard.type('vpn.exemplo.local');
    r.ok(await r.tabAte('os-vpn-senha', 4), 'Tab até a senha');
    await r.tecla('Enter');

    // a VPN simples: adiciona e liga
    const a = (await esperarVpn(p, 1))[0] ?? '';
    r.ok(a !== '' && (await esperarLigada(a)), `adicionada e ligada ao mesmo tempo (${a})`);
    r.ok((await cadeado())?.includes(a) === true, `o cadeado aparece (${await cadeado()})`);
    r.ok((await textoDe('os-vpn')).includes('AnyConnect') && (await textoDe('os-vpn')).includes('vpn.exemplo.local'), 'a lista diz o tipo e o servidor');
    r.ok(!(await p.$('[data-teste="os-vpn-empresa-form"]')), 'o formulário fechou');
    await foto(p, '47-vpn-empresa-ligada');

    // o segundo fator
    r.ok(await adicionar('vpn.exemplo.local', 'dois', 'vpn123'), 'adicionar a VPN do usuário "dois"');
    r.ok(await r.esperar('os-vpn-codigo-form', 8000), 'o servidor pediu o código: o campo "Código" aparece');
    await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-vpn-codigo', null, { timeout: 3000 }).catch(() => undefined);
    r.ok(await r.focoEm('os-vpn-codigo'), 'o foco vai ao código');
    await foto(p, '48-vpn-empresa-codigo');
    await p.keyboard.type('000000');
    await r.tecla('Enter');
    r.ok(((await r.esperar('os-vpn-erro', 5000)) ? await textoDe('os-vpn-erro') : '').includes('senha'), 'o código errado é recusado');
    r.ok(!!(await p.$('[data-teste="os-vpn-codigo-form"]')) && (await r.focoEm('os-vpn-codigo')), 'o campo do código continua, com o foco');
    await p.keyboard.press('Control+a');
    await p.keyboard.type('123456');
    await r.tecla('Enter');
    const b = (await nomes()).find((n) => n !== a) ?? '';
    r.ok(b !== '' && (await esperarLigada(b)), `o código certo liga (${b})`);
    r.ok(!(await ligada(a)) && !(await p.$('[data-teste="os-vpn-codigo-form"]')), 'a anterior desligou (uma por vez) e o campo do código sumiu');

    // o certificado que o sistema não conhece
    r.ok(await adicionar('autoassinado.exemplo.local', 'eva', 'vpn123'), 'adicionar a VPN do servidor de certificado próprio');
    r.ok(await r.esperar('os-vpn-certificado', 8000), 'o sistema não conhece o certificado: o aviso aparece');
    const imp = await textoDe('os-vpn-impressao');
    r.ok(imp === 'pin-sha256:EkfraseWriterOSsimuladoAutoassinado01234567=', `a impressão para conferir com a TI (${imp})`);
    await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-vpn-confiar', null, { timeout: 3000 }).catch(() => undefined);
    r.ok(await r.focoEm('os-vpn-confiar'), 'o foco vai ao "Confiar neste certificado"');
    await foto(p, '49-vpn-empresa-certificado');
    await r.tecla('Enter');
    const c = (await nomes()).find((n) => n !== a && n !== b) ?? '';
    r.ok(c !== '' && (await esperarLigada(c)), `confiou: a VPN liga (${c})`);
    r.ok(!(await p.$('[data-teste="os-vpn-certificado"]')), 'o aviso do certificado sumiu');

    // o login só pelo navegador
    r.ok(await adicionar('sso.exemplo.local', 'ana', 'vpn123'), 'adicionar a VPN que só aceita o navegador');
    const sso = (await r.esperar('os-vpn-erro', 8000)) ? await textoDe('os-vpn-erro') : '';
    r.ok(sso.includes('navegador'), `o aviso do login pelo navegador (${sso})`);
    await foto(p, '50-vpn-empresa-sso');
    // um servidor que não responde
    r.ok(await adicionar('sumiu.exemplo.local', 'ana', 'vpn123'), 'adicionar uma VPN de servidor que não responde');
    const fora = await r.esperar('os-vpn-erro', 8000).then(async (ok) => (ok ? ((await p.textContent('[data-teste="os-vpn-erro"]')) ?? '') : ''));
    r.ok(fora.includes('servidor'), `o servidor que não responde é dito (${fora})`);
    await r.tecla('Escape');
    await r.tecla('Escape');
  } else r.ok(false, 'o menu do sistema abre a parte "VPN"');
  await app.fechar();
  somar(r);

  // ---- outro boot: voltam do cofre; a que pediu código pergunta de novo
  falar('— a VPN de empresa, outro boot: voltaram do cofre');
  app = await abrir({ ...env, EKFRASE_CASCA_PERFIL: join(raiz, 'perfil-2') });
  p = await app.pagina();
  r = new Roteiro(p, falar);
  r.ok(await r.esperar('casca-abrir', 10000), 'no outro boot, a senha');
  await p.keyboard.type(SENHA);
  await r.tecla('Enter');
  await p.waitForTimeout(500);
  if (await abrirVpn()) {
    await p.waitForSelector('[data-teste="os-vpn"]', { timeout: 5000 }).catch(() => undefined);
    const todas = await nomes();
    r.ok(todas.length === 5, `as cinco VPNs de empresa voltaram do cofre (${todas.join(', ')})`);
    await r.tecla('Escape');
    await r.tecla('Escape');
  } else r.ok(false, 'o menu do sistema abre a parte "VPN" (outro boot)');
  await app.fechar();
  somar(r);
}

/** Espera a lista ter `n` VPNs e devolve os nomes. */
async function esperarVpn(p: Page, n: number): Promise<string[]> {
  await p.waitForFunction((k) => document.querySelectorAll('[data-teste="os-vpn"]').length >= k, n, { timeout: 8000 }).catch(() => undefined);
  return p.$$eval('[data-teste="os-vpn"]', (l) => l.map((e) => e.getAttribute('data-nome') ?? ''));
}
