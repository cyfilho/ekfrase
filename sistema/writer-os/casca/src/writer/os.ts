// SPDX-License-Identifier: MPL-2.0

/**
 * O WRITER NO PENDRIVE (Writer OS, fase 3; PLANO §4.5, §6.3, §6.4). A mesma casca da fase 2, com
 * `--modo-os`, dentro do Cage. O que muda:
 *
 * - **onde os textos ficam** (§4.5): a partição de dados do pendrive de boot (`/dados/Ekfrase Writer`,
 *   a MESMA disposição do computador: o pendrive abre também no Writer do Windows, com a mesma senha);
 *   se ela não existe, outro disco USB que a pessoa escolhe; senão, a memória (some ao desligar);
 * - **o `sistema.json`** (idioma, teclado, fuso, o passo do Wi-Fi), ao lado dos textos (e uma cópia em
 *   `/run/ekfrase`): o `ekfrase-sessao.sh` lê o teclado dele, o `ekfrase-dados.sh` lê o fuso;
 * - **o teclado** só muda reabrindo o Cage: a casca grava o arquivo, fecha os textos e sai; o laço da
 *   sessão abre de novo;
 * - **o que se perderia a cada boot** (o sistema roda na memória): as redes Wi-Fi conhecidas e o que a
 *   página guarda no `localStorage` (escrever sem conta, idioma, tema) vão CIFRADOS para o cofre da
 *   pasta dos dados e voltam quando a senha é dada.
 */
import {
  type DestinoOS,
  type ErroSistema,
  type EscolhaEspelho,
  type EstadoOS,
  type ItemDePasta,
  type ListaDePasta,
  type RespostaCasca,
  type RespostaSistema,
  type SobreOS,
} from '@ekfrase/writer-nucleo';
import { closeSync, cpSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { gravarInteiro } from '../motor/pastas.ts';
import { FUSOS, TECLADOS, type Sistema } from '../motor/sistema.ts';
import { NOME_DA_PASTA, type DadosDoWriter } from './dados.ts';

/**
 * O pedaço da janela do Electron que este arquivo usa. Sem importar o tipo do `electron`: o teste de
 * `tests/casca.test.ts` importa este arquivo, e a cópia pública do repositório não tem o Electron.
 */
interface JanelaDaPagina {
  webContents: { executeJavaScript(codigo: string): Promise<unknown>; reload(): void };
}

interface ArquivoSistema {
  idioma: string | null;
  teclado: string | null;
  fuso: string | null;
  wifiVisto: boolean;
  /** A resposta do espelho `.md` (no pendrive ela vale para os próximos boots: o boot é só senha → estante). */
  espelho: EscolhaEspelho | null;
}

interface RedeGuardada {
  ssid: string;
  senha: string | null;
}

/** O teclado que o Cage abriu (as variáveis que o `ekfrase-sessao.sh` passou). */
export function tecladoEmUso(env: NodeJS.ProcessEnv = process.env): string {
  const l = env['XKB_DEFAULT_LAYOUT'] ?? 'br';
  return l === 'us' && env['XKB_DEFAULT_VARIANT'] === 'intl' ? 'us-intl' : l;
}

/** O que o Writer importa (`.ekfr`, Markdown, texto, zip): só isto aparece na lista dos pendrives. */
const IMPORTAVEIS = ['.ekfr', '.md', '.markdown', '.txt', '.zip'];
/** O maior arquivo que passa pela ponte (a bomba de zip é barrada de novo no núcleo). */
const MAXIMO_ARQUIVO = 64 * 1024 * 1024;
/** Caracteres que um nome de arquivo não pode ter (nos pendrives FAT/exFAT e no Windows): barras, : * ? " < > | e controles. */
const NOME_PROIBIDO = new RegExp(`[${String.fromCharCode(92, 92)}/:*?"<>|\\u0000-\\u001f]`, 'g');

const tipoDe = (f: string): 'pasta' | 'outro' | null => {
  try {
    return statSync(f).isDirectory() ? 'pasta' : 'outro';
  } catch {
    return null;
  }
};

const idiomaValido =(c: unknown): c is string => typeof c === 'string' && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(c);

export class WriterOS {
  readonly sistema: Sistema;
  destino: DestinoOS | null = null;
  private motivo: string | null = null;
  private dados: DadosDoWriter | null = null;
  private janela: () => JanelaDaPagina | null = () => null;
  private sair: () => Promise<void> = async () => undefined;
  private paginaVoltou = false;
  private versaoApp = '';
  depurar: ((l: string) => void) | null = null;

  constructor(sistema: Sistema) {
    this.sistema = sistema;
    const d = this.lerDadosJson();
    this.motivo = d.modo === 'pendrive' ? null : d.motivo || 'sem-dados';
  }

  /** O que o `ekfrase-dados.service` achou no boot (`/run/ekfrase/dados.json`). */
  private lerDadosJson(): { modo: string; motivo: string } {
    try {
      const j = JSON.parse(readFileSync(join(this.sistema.caminhos.run, 'dados.json'), 'utf8')) as { modo?: string; motivo?: string };
      return { modo: String(j.modo ?? ''), motivo: String(j.motivo ?? '') };
    } catch {
      return { modo: '', motivo: 'sem-servico' };
    }
  }

  get pastaDoPendrive(): string {
    return join(this.sistema.caminhos.dados, NOME_DA_PASTA);
  }

  get pastaDaMemoria(): string {
    return join(this.sistema.caminhos.ram, NOME_DA_PASTA);
  }

  /** Os `sistema.json` que valem (o do pendrive, se há partição de dados, e o de `/run`). */
  private arquivosSistema(): string[] {
    const lista = [join(this.sistema.caminhos.run, 'sistema.json')];
    if (this.motivo === null) lista.unshift(join(this.pastaDoPendrive, 'sistema.json'));
    return lista;
  }

  lerSistema(): ArquivoSistema {
    for (const f of this.arquivosSistema()) {
      try {
        const j = JSON.parse(readFileSync(f, 'utf8')) as Partial<ArquivoSistema>;
        return {
          idioma: idiomaValido(j.idioma) ? j.idioma : null,
          teclado: (TECLADOS as readonly string[]).includes(String(j.teclado)) ? String(j.teclado) : null,
          fuso: (FUSOS as readonly string[]).includes(String(j.fuso)) ? String(j.fuso) : null,
          wifiVisto: j.wifiVisto === true,
          espelho: j.espelho === 'sim' || j.espelho === 'sempre' || j.espelho === 'nao' ? j.espelho : null,
        };
      } catch {
        // o próximo
      }
    }
    return { idioma: null, teclado: null, fuso: null, wifiVisto: false, espelho: null };
  }

  private gravarSistema(mudar: Partial<ArquivoSistema>): void {
    const novo = { ...this.lerSistema(), ...mudar };
    for (const f of this.arquivosSistema()) {
      try {
        gravarInteiro(f, `${JSON.stringify(novo, null, 2)}\n`);
      } catch {
        // o pendrive saiu: a cópia em /run vale até desligar
      }
    }
  }

  /** O idioma escolhido no primeiro uso (o `main.ts` passa ao Chromium, antes de abrir). */
  idiomaGuardado(): string | null {
    return this.lerSistema().idioma;
  }

  /** Liga às peças (depois de criar os dados) e abre a partição de dados, se há. */
  async ligar(o: { dados: DadosDoWriter; janela: () => JanelaDaPagina | null; sair: () => Promise<void>; versaoApp: string }): Promise<void> {
    this.dados = o.dados;
    this.janela = o.janela;
    this.sair = o.sair;
    this.versaoApp = o.versaoApp;
    if (this.motivo === null) {
      mkdirSync(this.pastaDoPendrive, { recursive: true });
      this.destino = 'pendrive';
      const r = await o.dados.usarPasta(this.pastaDoPendrive);
      if (!r.ok) {
        this.destino = null;
        this.motivo = 'nao-grava';
      }
    }
  }

  estado(): EstadoOS {
    const { idioma, teclado, fuso, wifiVisto } = this.lerSistema();
    return { idioma, teclado, fuso, wifiVisto, motivo: this.motivo, simulado: this.sistema.simulado };
  }

  /** A resposta do espelho fica lembrada (a pergunta só aparece no primeiro uso). */
  lembrarEspelho(escolha: EscolhaEspelho): void {
    if (escolha === 'sim' || escolha === 'sempre' || escolha === 'nao') this.gravarSistema({ espelho: escolha });
  }

  /** Logo depois da senha: a resposta do espelho da última vez vale de novo. */
  async aplicarEspelho(): Promise<void> {
    const e = this.lerSistema().espelho;
    if (e && this.dados?.estado().espelho === 'perguntar') await this.dados.responderEspelho(e);
  }

  usarIdioma(codigo: string): EstadoOS {
    if (idiomaValido(codigo)) this.gravarSistema({ idioma: codigo });
    return this.estado();
  }

  async usarTeclado(id: string): Promise<{ estado: EstadoOS; reabrindo: boolean }> {
    if (!(TECLADOS as readonly string[]).includes(id)) return { estado: this.estado(), reabrindo: false };
    this.gravarSistema({ teclado: id });
    const reabrindo = !this.sistema.simulado && id !== tecladoEmUso();
    // o Cage só lê o teclado ao abrir: sai, e o laço da sessão abre de novo com o novo
    if (reabrindo) setTimeout(() => void this.sair(), 300);
    return { estado: this.estado(), reabrindo };
  }

  async usarFuso(id: string): Promise<EstadoOS> {
    if ((FUSOS as readonly string[]).includes(id)) {
      await this.sistema.usarFuso(id);
      this.gravarSistema({ fuso: id });
    }
    return this.estado();
  }

  passarWifi(): EstadoOS {
    this.gravarSistema({ wifiVisto: true });
    return this.estado();
  }

  // ---------- onde guardar (§4.5) ----------

  async guardarEm(id: string): Promise<RespostaCasca> {
    const dados = this.dados;
    if (!dados || this.destino === 'pendrive') return { ok: false, erro: 'pasta' };
    const disco = (await this.sistema.discos()).find((d) => d.id === id);
    const montado = disco ? (disco.montado ?? (await this.sistema.montar(id))) : null;
    if (!montado) return { ok: false, erro: 'pasta' };
    const pasta = join(montado, NOME_DA_PASTA);
    const vemDaMemoria = this.destino === 'ram' && existsSync(join(this.pastaDaMemoria, 'dados', 'cofre.db'));
    if (vemDaMemoria) {
      // "salvar tudo nele agora": os bancos fecham (o WAL entra no arquivo) e vão inteiros para o disco
      if (existsSync(join(pasta, 'dados', 'cofre.db'))) return { ok: false, erro: 'ja-tem' };
      await this.salvarPagina();
      await dados.trancar();
      try {
        cpSync(this.pastaDaMemoria, pasta, { recursive: true });
      } catch {
        return dados.usarPasta(this.pastaDaMemoria);
      }
      rmSync(this.pastaDaMemoria, { recursive: true, force: true });
    }
    this.destino = 'outro-pendrive';
    const r = await dados.usarPasta(pasta);
    if (!r.ok && !vemDaMemoria) this.destino = null;
    return r.ok ? { ok: true, estado: dados.estado() } : r;
  }

  async guardarNaMemoria(): Promise<RespostaCasca> {
    if (!this.dados || this.destino === 'pendrive') return { ok: false, erro: 'pasta' };
    mkdirSync(this.pastaDaMemoria, { recursive: true });
    this.destino = 'ram';
    return this.dados.usarPasta(this.pastaDaMemoria);
  }

  // ---------- importar e salvar pelos pendrives, sem o seletor do sistema (PLANO §6.5 item 5, §7) ----------

  /**
   * O caminho de verdade (links resolvidos) SE ele está dentro de um disco USB montado; senão, `null`. É a única
   * porta: a página nunca enxerga o disco interno, o `/dados` nem o resto do sistema.
   */
  private async dentroDeUmPendrive(caminho: unknown): Promise<string | null> {
    if (typeof caminho !== 'string' || !caminho || caminho.includes('\0')) return null;
    let real: string;
    try {
      real = realpathSync(caminho);
    } catch {
      return null;
    }
    for (const d of await this.sistema.discos()) {
      if (!d.montado) continue;
      let raiz: string;
      try {
        raiz = realpathSync(d.montado);
      } catch {
        continue;
      }
      if (real === raiz || real.startsWith(raiz.endsWith(sep) ? raiz : raiz + sep)) return real;
    }
    return null;
  }

  async abrirDisco(id: string): Promise<{ ok: true; raiz: string } | { ok: false; erro: ErroSistema }> {
    const montado = await this.sistema.montar(id);
    return montado ? { ok: true, raiz: montado } : { ok: false, erro: 'falhou' };
  }

  async listar(caminho: string): Promise<ListaDePasta> {
    const real = await this.dentroDeUmPendrive(caminho);
    if (!real) return { ok: false, erro: 'negado' };
    try {
      const itens: ItemDePasta[] = [];
      for (const nome of readdirSync(real)) {
        if (nome.startsWith('.') || itens.length >= 2000) continue;
        let st;
        try {
          st = statSync(join(real, nome));
        } catch {
          continue;
        }
        if (st.isDirectory()) itens.push({ nome, pasta: true, tamanho: 0 });
        else if (st.isFile() && IMPORTAVEIS.includes(extname(nome).toLowerCase())) itens.push({ nome, pasta: false, tamanho: st.size });
      }
      itens.sort((a, b) => Number(b.pasta) - Number(a.pasta) || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
      return { ok: true, caminho: real, itens };
    } catch {
      return { ok: false, erro: 'falhou' };
    }
  }

  async lerArquivo(caminho: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; erro: ErroSistema }> {
    const real = await this.dentroDeUmPendrive(caminho);
    if (!real) return { ok: false, erro: 'negado' };
    try {
      const st = statSync(real);
      if (!st.isFile()) return { ok: false, erro: 'negado' };
      if (st.size > MAXIMO_ARQUIVO) return { ok: false, erro: 'grande' };
      return { ok: true, bytes: new Uint8Array(readFileSync(real)) };
    } catch {
      return { ok: false, erro: 'falhou' };
    }
  }

  /** Grava um arquivo NOVO na pasta (nunca por cima de outro: o nome ganha " (2)"); o disco confirma antes de responder. */
  async gravarArquivo(pasta: string, nome: string, bytes: unknown): Promise<{ ok: true; nome: string } | { ok: false; erro: ErroSistema }> {
    const real = await this.dentroDeUmPendrive(pasta);
    if (!real || tipoDe(real) !== 'pasta') return { ok: false, erro: 'negado' };
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAXIMO_ARQUIVO) return { ok: false, erro: 'grande' };
    const limpo = nome.replace(NOME_PROIBIDO, '_').trim();
    if (!limpo || limpo.startsWith('.') || limpo.length > 180) return { ok: false, erro: 'negado' };
    const ext = extname(limpo);
    const base = limpo.slice(0, limpo.length - ext.length);
    for (let n = 1; n <= 99; n++) {
      const final = n === 1 ? limpo : `${base} (${n})${ext}`;
      try {
        const fd = openSync(join(real, final), 'wx');
        try {
          writeSync(fd, bytes);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        return { ok: true, nome: final };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue;
        return { ok: false, erro: 'falhou' };
      }
    }
    return { ok: false, erro: 'falhou' };
  }

  // ---------- Wi-Fi: as redes conhecidas ficam cifradas no cofre ----------

  private redesGuardadas(): RedeGuardada[] {
    try {
      const l = JSON.parse(this.dados?.cofreAberto?.segredo('redes') ?? '[]') as RedeGuardada[];
      return Array.isArray(l) ? l.filter((r) => typeof r?.ssid === 'string') : [];
    } catch {
      return [];
    }
  }

  private guardarRedes(lista: RedeGuardada[]): void {
    this.dados?.cofreAberto?.porSegredo('redes', JSON.stringify(lista));
  }

  async conectar(ssid: string, senha: string | null): Promise<RespostaSistema> {
    if (typeof ssid !== 'string' || !ssid || ssid.length > 64) return { ok: false, erro: 'falhou' };
    const s = typeof senha === 'string' && senha ? senha : null;
    const r = await this.sistema.conectar(ssid, s);
    if (r.ok) {
      const antes = this.redesGuardadas().find((x) => x.ssid === ssid);
      this.guardarRedes([...this.redesGuardadas().filter((x) => x.ssid !== ssid), { ssid, senha: s ?? antes?.senha ?? null }]);
    }
    return r;
  }

  async esquecer(ssid: string): Promise<void> {
    await this.sistema.esquecer(String(ssid));
    this.guardarRedes(this.redesGuardadas().filter((x) => x.ssid !== ssid));
  }

  // ---------- o que a página guarda (localStorage): cifrado no cofre ----------

  /** Grava no cofre as chaves `ekfrase*` do `localStorage` da página (nada de texto: o rascunho já vai ao cofre). */
  async salvarPagina(): Promise<void> {
    const j = this.janela();
    const cofre = this.dados?.cofreAberto;
    if (!j || !cofre) return;
    try {
      const copia = (await j.webContents.executeJavaScript(
        'JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("ekfrase")).map((k) => [k, localStorage.getItem(k)])))',
      )) as string;
      if (typeof copia === 'string') cofre.porSegredo('pagina', copia);
      this.depurar?.(`pagina salva ${copia.length}`);
    } catch (e) {
      this.depurar?.(`pagina nao salva ${String(e)}`);
      // a página está recarregando: fica para a próxima
    }
  }

  /** A senha foi dada: as redes voltam ao NetworkManager e o `localStorage` da página volta (uma vez por boot). */
  async depoisDeAbrir(): Promise<void> {
    for (const r of this.redesGuardadas()) await this.sistema.lembrarRede(r.ssid, r.senha);
    if (this.paginaVoltou) return;
    this.paginaVoltou = true;
    const guardado = this.dados?.cofreAberto?.segredo('pagina');
    const j = this.janela();
    if (!guardado || !j) return;
    try {
      const mudou = (await j.webContents.executeJavaScript(
        `(() => { const o = JSON.parse(${JSON.stringify(guardado)}); let mudou = false; for (const [k, v] of Object.entries(o)) { if (typeof v === 'string' && k.startsWith('ekfrase') && localStorage.getItem(k) !== v) { localStorage.setItem(k, v); mudou = true; } } return mudou; })()`,
      )) as boolean;
      // a página leu o localStorage ao abrir: recarrega para valer (os textos continuam abertos)
      if (mudou) setTimeout(() => j.webContents.reload(), 50);
    } catch {
      // segue sem
    }
  }

  // ---------- desligar, reiniciar, sobre ----------

  async desligar(reiniciar: boolean): Promise<void> {
    await this.salvarPagina();
    await this.dados?.trancar();
    await (reiniciar ? this.sistema.reiniciar() : this.sistema.desligar());
  }

  sobre(): SobreOS {
    return { sistema: this.sistema.versao(), app: this.versaoApp, kernel: this.sistema.kernel(), secureBoot: this.sistema.secureBoot() };
  }

  // ---------- as teclas de brilho e o Num Lock (pedidos do Alcy em 18/11) ----------

  private mudandoBrilho = false;

  /**
   * Uma tecla de brilho do notebook: 10% a mais ou a menos. Em alguns notebooks o firmware (ou o kernel) já muda
   * o brilho sozinho com a mesma tecla; então, se o brilho mudou logo depois da tecla, só conta o novo (nunca
   * muda duas vezes). Uma tecla por vez (segurar a tecla não empilha pedidos). `null` = nada a contar.
   */
  async teclaDeBrilho(passo: number, esperar = 150): Promise<number | null> {
    if (this.mudandoBrilho || !passo) return null;
    this.mudandoBrilho = true;
    try {
      const antes = await this.sistema.brilho();
      if (antes === null) return null;
      await new Promise((ok) => setTimeout(ok, esperar));
      const depois = await this.sistema.brilho();
      if (depois !== null && depois !== antes) return depois;
      return await this.sistema.brilho(passo);
    } finally {
      this.mudandoBrilho = false;
    }
  }

  /**
   * A janela do Writer apareceu (o Cage já abriu e já tem os teclados): o aviso que liga o Num Lock. O
   * `ekfrase-numlock.path` da imagem vê o arquivo mudar e o `ekfrase-numlock` (root) aperta o Num Lock numa
   * tecla virtual, que o Cage junta ao grupo dos teclados. Uma vez por sessão do Cage (a casca é o único app dele).
   */
  sessaoPronta(): void {
    const pasta = join(this.sistema.caminhos.run, 'sessao');
    try {
      if (this.sistema.simulado) mkdirSync(pasta, { recursive: true });
      writeFileSync(join(pasta, 'pronta'), `${process.pid} ${Date.now()}\n`);
    } catch {
      // sem a pasta da sessão (o serviço do diagnóstico a cria): fica sem o Num Lock, nada mais
    }
  }
}

/**
 * As teclas de brilho do notebook. No Cage, a tecla chega ao Writer como qualquer outra (o XKB a chama de
 * XF86MonBrightnessUp/Down; o Chromium, de "BrightnessUp"/"BrightnessDown"): +10, −10 ou 0 (não é de brilho).
 */
export function passoDaTecla(i: { type: string; key: string; code: string }): number {
  if (i.type !== 'keyDown') return 0;
  if (i.key === 'BrightnessUp' || i.code === 'BrightnessUp') return 10;
  if (i.key === 'BrightnessDown' || i.code === 'BrightnessDown') return -10;
  return 0;
}
