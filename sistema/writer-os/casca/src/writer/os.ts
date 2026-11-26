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
 *   pasta dos dados e voltam quando a senha é dada; as VPNs também (o arquivo, o usuário e a senha; PLANO §7).
 */
import {
  marcaDoComputador,
  nomeConfere,
  type DestinoOS,
  type ErroSistema,
  type EscolhaEspelho,
  type EstadoOS,
  type InfoInstalacao,
  type ItemDePasta,
  type ListaDePasta,
  type PassoInstalar,
  type RespostaCasca,
  type RespostaInstalar,
  type FeedbackGuardado,
  type RespostaSistema,
  type RespostaVpn,
  type SobreOS,
  type VpnOS,
} from '@ekfrase/writer-nucleo';
import { closeSync, cpSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { gravarInteiro } from '../motor/pastas.ts';
import type { Conectividade } from '../motor/portal-regras.ts';
import { abrirSelado, novoPar, publicaDaPrivada, selar } from '../motor/selo.ts';
import { FUSOS, TECLADOS, type Sistema } from '../motor/sistema.ts';
import { filtrarVpn, MAXIMO_VPN, nomeDaVpn, qualLigarSozinha, tipoDaVpn, usuarioValido, type TipoVpn } from '../motor/vpn-regras.ts';
import { NOME_DA_PASTA, type DadosDoWriter } from './dados.ts';
import type { Pagina } from './pagina.ts';

interface ArquivoSistema {
  idioma: string | null;
  teclado: string | null;
  fuso: string | null;
  wifiVisto: boolean;
  /** A resposta do espelho `.md` (no pendrive ela vale para os próximos boots: o boot é só senha → estante). */
  espelho: EscolhaEspelho | null;
  /** "Como você quer usar o Writer OS?" (PLANO §8c, pedido do Alcy de 18/11): `pendrive` = respondida, só pelo pendrive. */
  uso: 'pendrive' | null;
  /** As atualizações (docs/ATUALIZACOES.md §1): "Automáticas" (o padrão) ou "Perguntar antes". */
  atualizacoes: 'automaticas' | 'perguntar';
}

interface RedeGuardada {
  ssid: string;
  senha: string | null;
}

/** Uma VPN no cofre (segredo `vpns`): o arquivo como veio (já filtrado), o usuário, a senha e o "ligar sozinha". */
interface VpnGuardada {
  nome: string;
  tipo: TipoVpn;
  arquivo: string;
  pedeSenha: boolean;
  usuario: string | null;
  senha: string | null;
  sozinha: boolean;
}

/** A cada quanto a vigia da VPN olha se é hora de ligar a que liga sozinha (Portal + VPN, PLANO §7). */
const VIGIA_VPN_MS = 20_000;
/** Ligar sozinha falhou: espera isto antes de tentar de novo. */
const ESPERA_VPN_MS = 120_000;

/**
 * O `dados.json` que o `ekfrase-dados.service` da imagem teria escrito, para o simulado: com ou sem a partição de dados,
 * e de onde ligou (`EKFRASE_CASCA_OS_BOOT=usb|computador`; o padrão é o pendrive).
 */
export function dadosSimulados(comDados: boolean, boot: string | undefined): string {
  const lugar = boot === 'computador' ? 'computador' : 'usb';
  return JSON.stringify(comDados ? { modo: 'pendrive', motivo: '', lugar } : { modo: 'sem-dados', motivo: 'sem-espaco', lugar });
}

/** O teclado que o Cage abriu (as variáveis que o `ekfrase-sessao.sh` passou). */
export function tecladoEmUso(env: NodeJS.ProcessEnv = process.env): string {
  const l = env['XKB_DEFAULT_LAYOUT'] ?? 'br';
  return l === 'us' && env['XKB_DEFAULT_VARIANT'] === 'intl' ? 'us-intl' : l;
}

/** O que o Writer importa (`.ekfr`, Markdown, texto, zip): só isto aparece na lista dos pendrives. */
const IMPORTAVEIS = ['.ekfr', '.md', '.markdown', '.txt', '.zip'];
/** Os arquivos de VPN (a parte "VPN" do menu pede a lista só com eles). */
const DE_VPN = ['.conf', '.ovpn'];
/** O maior arquivo que passa pela ponte (a bomba de zip é barrada de novo no núcleo). */
const MAXIMO_ARQUIVO = 64 * 1024 * 1024;
/** O feedback guardado sem internet: o print e os anexos, juntos (o servidor aceita até isto). */
const MAXIMO_FEEDBACK = 20 * 1024 * 1024;
/** A chave pública do selo dos feedbacks, ao lado dos bancos (`<pasta>/dados/selo.pub`); a privada é este segredo do cofre. */
export const ARQUIVO_DO_SELO = 'selo.pub';
const SEGREDO_DO_SELO = 'selo';
/** Os feedbacks no disco: os selados (`.cifrado`) e os em claro das versões 0.2.4 a 0.2.6 (`.json`). */
const FEEDBACK_NO_DISCO = /^feedback-[\w.-]+\.(json|cifrado)$/;

/** O JSON de um feedback guardado, de volta ao formato da página. Estragado: `null`. */
function lerFeedback(id: string, json: string): FeedbackGuardado | null {
  try {
    const j = JSON.parse(json) as { campos: Record<string, string>; arquivos: { campo: string; nome: string; tipo: string; dados: string }[] };
    return { id, campos: j.campos, arquivos: j.arquivos.map((a) => ({ campo: a.campo, nome: a.nome, tipo: a.tipo, bytes: new Uint8Array(Buffer.from(a.dados, 'base64')) })) };
  } catch {
    return null;
  }
}

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
  private pagina: Pagina | null = null;
  private sair: () => Promise<void> = async () => undefined;
  private paginaVoltou = false;
  private versaoApp = '';
  /** De onde o sistema ligou (o `lugar` do `dados.json`). */
  private boot: EstadoOS['boot'] = 'outro';
  /** Instalou no computador neste boot: o cofre fechou e só falta desligar. */
  private instalado = false;
  /** Instalou apagando o disco inteiro (W3f): o Writer OS liga primeiro. */
  private discoTodo = false;
  private instalando = false;
  /** O progresso da instalação vai à página (`os:instalar-passo`). */
  private aoPasso: ((passo: PassoInstalar, feito: number, total: number) => void) | null = null;
  depurar: ((l: string) => void) | null = null;
  /** Só o agente de teste: o fim de uma instalação (`ok` ou o código do erro). */
  aoInstalar: ((r: string) => void) | null = null;

  constructor(sistema: Sistema) {
    this.sistema = sistema;
    const d = this.lerDadosJson();
    this.motivo = d.modo === 'pendrive' ? null : d.motivo || 'sem-dados';
    this.boot = d.lugar === 'usb' || d.lugar === 'computador' ? d.lugar : 'outro';
  }

  /** O que o `ekfrase-dados.service` achou no boot (`/run/ekfrase/dados.json`). */
  private lerDadosJson(): { modo: string; motivo: string; lugar: string } {
    try {
      const j = JSON.parse(readFileSync(join(this.sistema.caminhos.run, 'dados.json'), 'utf8')) as { modo?: string; motivo?: string; lugar?: string };
      return { modo: String(j.modo ?? ''), motivo: String(j.motivo ?? ''), lugar: String(j.lugar ?? '') };
    } catch {
      return { modo: '', motivo: 'sem-servico', lugar: '' };
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
          uso: j.uso === 'pendrive' ? 'pendrive' : null,
          atualizacoes: j.atualizacoes === 'perguntar' ? 'perguntar' : 'automaticas',
        };
      } catch {
        // o próximo
      }
    }
    return { idioma: null, teclado: null, fuso: null, wifiVisto: false, espelho: null, uso: null, atualizacoes: 'automaticas' };
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
  /**
   * `portal`: abre a janela do portal cativo neste endereço (`motor/portal.ts`, que precisa do Electron; nos testes sem
   * ele, não há) e devolve a conectividade quando ela fecha.
   */
  async ligar(o: { dados: DadosDoWriter; pagina: Pagina; sair: () => Promise<void>; versaoApp: string; portal?: (endereco: string) => Promise<Conectividade> }): Promise<void> {
    this.dados = o.dados;
    this.pagina = o.pagina;
    this.sair = o.sair;
    this.versaoApp = o.versaoApp;
    this.janelaDoPortal = o.portal ?? null;
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
    const { idioma, teclado, fuso, wifiVisto, uso } = this.lerSistema();
    return { idioma, teclado, fuso, wifiVisto, motivo: this.motivo, boot: this.boot, usoVisto: uso !== null, instalado: this.instalado, discoTodo: this.discoTodo, marca: marcaDoComputador(this.sistema.fabricante()), simulado: this.sistema.simulado };
  }

  // ---------- as atualizações (docs/ATUALIZACOES.md; quem procura e baixa é o atualizacoes-os.ts) ----------

  modoAtualizacoes(): 'automaticas' | 'perguntar' {
    return this.lerSistema().atualizacoes;
  }

  usarModoAtualizacoes(modo: 'automaticas' | 'perguntar'): void {
    if (modo === 'automaticas' || modo === 'perguntar') this.gravarSistema({ atualizacoes: modo });
  }

  /** Onde baixar as atualizações: na partição de dados (`/dados/Ekfrase Writer/.atualizacao`); sem ela, `null`. */
  pastaDasAtualizacoes(): string | null {
    return this.motivo === null ? join(this.pastaDoPendrive, '.atualizacao') : null;
  }

  /** "Só pelo pendrive": a pergunta do primeiro uso não volta (o item "Instalar neste computador" fica no menu). */
  passarUso(): EstadoOS {
    this.gravarSistema({ uso: 'pendrive' });
    return this.estado();
  }

  // ---------- instalar no computador (PLANO §8c; quem mexe no disco é o ekfrase-instalar.service) ----------

  /** O que há no computador (o serviço só lê). Sem resposta do serviço, nenhum disco. */
  async instalacao(): Promise<InfoInstalacao> {
    return (await this.sistema.consultarInstalacao()) ?? { uefi: true, discos: [] };
  }

  ouvirInstalacao(f: (passo: PassoInstalar, feito: number, total: number) => void): void {
    this.aoPasso = f;
  }

  /**
   * Instala no disco `disco`. Antes, o que a página guarda vai ao cofre e os bancos fecham (o WAL entra no arquivo):
   * o serviço copia a pasta dos textos como ela está no disco. Deu certo: o cofre fica fechado (a tela final só
   * desliga); deu errado: a pessoa dá a senha de novo e continua no pendrive.
   *
   * Com `apagar` (W3f, "Apagar o disco inteiro"): o nome que a pessoa digitou tem de ser o do disco (a regra do
   * Gravador), conferido AQUI antes de tudo; o serviço recebe o tamanho do disco que a tela mostrou e confere de novo.
   */
  async instalar(disco: string, levar: boolean, apagar?: string): Promise<RespostaInstalar> {
    if (this.boot !== 'usb') return { ok: false, erro: 'nao-usb' };
    if (this.instalando || this.instalado) return { ok: false, erro: this.instalado ? 'ja-instalado' : 'ocupado' };
    if (typeof disco !== 'string' || !/^(nvme[0-9]+n[0-9]+|sd[a-z]+|vd[a-z]+|mmcblk[0-9]+)$/.test(disco)) return { ok: false, erro: 'disco' };
    this.instalando = true;
    try {
      let bytes: number | undefined;
      if (apagar !== undefined) {
        const d = (await this.instalacao()).discos.find((x) => x.id === disco);
        if (!d) return { ok: false, erro: 'disco' };
        if (typeof apagar !== 'string' || !nomeConfere(d, apagar)) return { ok: false, erro: 'confirmacao' };
        bytes = d.tamanho;
      }
      await this.salvarPagina();
      await this.dados?.trancar();
      const r = await this.sistema.instalar(disco, levar === true, (passo, feito, total) => this.aoPasso?.(passo, feito, total), bytes);
      this.aoInstalar?.(r.ok ? 'ok' : r.erro);
      if (!r.ok) return r;
      this.instalado = true;
      this.discoTodo = bytes !== undefined;
      return { ok: true, estado: this.estado() };
    } finally {
      this.instalando = false;
    }
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

  async listar(caminho: string, tipo?: unknown): Promise<ListaDePasta> {
    const aceitos = tipo === 'vpn' ? DE_VPN : IMPORTAVEIS;
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
        else if (st.isFile() && aceitos.includes(extname(nome).toLowerCase())) itens.push({ nome, pasta: false, tamanho: st.size });
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

  // ---------- o portal cativo (PLANO §7): a rede pede login numa página ----------
  private janelaDoPortal: ((endereco: string) => Promise<Conectividade>) | null = null;

  /** A internet chega? (o NetworkManager confere agora). */
  internet(): Promise<Conectividade> {
    return this.sistema.conectividade();
  }

  /**
   * Abre a página de login da rede. Só se o sistema diz `portal` AGORA (a página não abre uma janela da internet por
   * conta própria) e há o endereço do teste; senão, só responde a conectividade.
   */
  async abrirPortal(): Promise<Conectividade> {
    const agora = await this.sistema.conectividade();
    const endereco = this.sistema.enderecoDoTeste();
    if (agora !== 'portal' || !endereco || !this.janelaDoPortal) return agora;
    this.depurar?.('portal abriu');
    const c = await this.janelaDoPortal(endereco);
    this.depurar?.(`portal fechou ${c}`);
    return c;
  }

  // ---------- a VPN (PLANO §7): WireGuard e OpenVPN, o arquivo cifrado no cofre, ligar sozinha depois do portal ----------

  /** O que se sabe de cada VPN mesmo com o cofre fechado (o `pedeSenha` do filtro). */
  private infoVpn = new Map<string, { pedeSenha: boolean }>();
  /** As que a pessoa desligou neste boot: não ligam sozinhas de novo. */
  private desligadasAMao = new Set<string>();
  /** Ligar sozinha falhou: até quando esperar. */
  private esperarVpn = new Map<string, number>();
  private vigiaVpn: ReturnType<typeof setInterval> | null = null;
  private ligandoSozinha = false;
  private vpnsProntas: () => void = () => undefined;
  /** As VPNs do cofre voltando ao NetworkManager (depois da senha); `null` quando terminou. */
  private restaurando: Promise<void> | null = null;
  /** As VPNs do cofre já voltaram ao NetworkManager neste boot (o agente de teste espera por isto). */
  vpnsVoltaram: Promise<void> = new Promise((ok) => (this.vpnsProntas = ok));

  private vpnsGuardadas(): VpnGuardada[] {
    try {
      const l = JSON.parse(this.dados?.cofreAberto?.segredo('vpns') ?? '[]') as VpnGuardada[];
      return Array.isArray(l) ? l.filter((v) => typeof v?.nome === 'string' && (v.tipo === 'wireguard' || v.tipo === 'openvpn') && typeof v.arquivo === 'string') : [];
    } catch {
      return [];
    }
  }

  private guardarVpns(lista: VpnGuardada[]): void {
    this.dados?.cofreAberto?.porSegredo('vpns', JSON.stringify(lista));
  }

  private mudarVpnGuardada(nome: string, mudar: Partial<VpnGuardada>): void {
    const l = this.vpnsGuardadas();
    const i = l.findIndex((v) => v.nome === nome);
    if (i < 0) return;
    l[i] = { ...(l[i] as VpnGuardada), ...mudar };
    this.guardarVpns(l);
  }

  async vpns(): Promise<VpnOS[]> {
    // logo depois da senha as do cofre ainda estão voltando ao NetworkManager: a lista espera (até 10 s)
    if (this.restaurando) await Promise.race([this.restaurando, new Promise((ok) => setTimeout(ok, 10_000).unref?.())]);
    const guardadas = this.vpnsGuardadas();
    return (await this.sistema.vpns()).map((v) => {
      const g = guardadas.find((x) => x.nome === v.nome);
      const pedeSenha = g?.pedeSenha ?? this.infoVpn.get(v.nome)?.pedeSenha ?? false;
      return { nome: v.nome, tipo: v.tipo, ligada: v.ligada, pedeSenha, temSenha: !!(g?.usuario && g.senha), usuario: g?.usuario ?? null, sozinha: g?.sozinha ?? false };
    });
  }

  /** Um `.conf` ou `.ovpn` vindo de um pendrive: o filtro, o nome, o NetworkManager (pelo serviço) e o cofre. */
  async importarVpn(arquivo: unknown, bytes: unknown): Promise<RespostaVpn> {
    if (typeof arquivo !== 'string' || !(bytes instanceof Uint8Array)) return { ok: false, erro: 'invalido' };
    const tipo = tipoDaVpn(arquivo);
    if (!tipo) return { ok: false, erro: 'tipo' };
    if (bytes.byteLength > MAXIMO_VPN) return { ok: false, erro: 'grande' };
    let texto: string;
    try {
      texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch {
      return { ok: false, erro: 'invalido' };
    }
    const f = filtrarVpn(tipo, texto);
    if (!f.ok) return { ok: false, erro: f.erro, ...(f.diretiva ? { diretiva: f.diretiva.slice(0, 40) } : {}) };
    const existentes = [...(await this.sistema.vpns()).map((v) => v.nome), ...this.vpnsGuardadas().map((v) => v.nome)];
    const nome = nomeDaVpn(arquivo, existentes);
    const r = await this.sistema.importarVpn(tipo, nome, texto);
    this.depurar?.(`vpn importou ${tipo} ${r.ok ? 'ok' : r.erro}`);
    if (!r.ok) return r;
    this.infoVpn.set(nome, { pedeSenha: f.pedeSenha });
    this.guardarVpns([...this.vpnsGuardadas().filter((v) => v.nome !== nome), { nome, tipo, arquivo: texto, pedeSenha: f.pedeSenha, usuario: null, senha: null, sozinha: false }]);
    return { ok: true, nome };
  }

  /** Liga. No OpenVPN que pede usuário e senha: os dados agora ou os do cofre (e os novos vão ao cofre se der certo). */
  async ligarVpn(nome: string, usuario?: unknown, senha?: unknown): Promise<RespostaVpn> {
    const g = this.vpnsGuardadas().find((v) => v.nome === nome);
    if (!g && !(await this.sistema.vpns()).some((v) => v.nome === nome)) return { ok: false, erro: 'falhou' };
    const pede = g?.pedeSenha ?? this.infoVpn.get(nome)?.pedeSenha ?? false;
    let u: string | null = null;
    let s: string | null = null;
    if (pede) {
      u = typeof usuario === 'string' && usuario ? usuario : (g?.usuario ?? null);
      s = typeof senha === 'string' && senha ? senha : (g?.senha ?? null);
      if (!u || !s || !usuarioValido(u) || s.length > 256 || /[\r\n\u0000]/.test(s)) return { ok: false, erro: 'senha' };
    }
    const r = await this.sistema.ligarVpn(nome, u, s);
    this.depurar?.(`vpn ligar ${r.ok ? 'ok' : r.erro}`);
    if (!r.ok) return { ok: false, erro: r.erro === 'senha' || r.erro === 'negado' ? r.erro : 'falhou' };
    this.desligadasAMao.delete(nome);
    this.esperarVpn.delete(nome);
    if (pede && g && (g.usuario !== u || g.senha !== s)) this.mudarVpnGuardada(nome, { usuario: u, senha: s });
    return { ok: true, nome };
  }

  async desligarVpn(nome: string): Promise<RespostaVpn> {
    this.desligadasAMao.add(nome);
    const ok = await this.sistema.desligarVpn(nome);
    this.depurar?.(`vpn desligar ${ok ? 'ok' : 'falhou'}`);
    return ok ? { ok: true, nome } : { ok: false, erro: 'falhou' };
  }

  async esquecerVpn(nome: string): Promise<void> {
    await this.sistema.esquecerVpn(nome);
    this.infoVpn.delete(nome);
    this.guardarVpns(this.vpnsGuardadas().filter((v) => v.nome !== nome));
  }

  async vpnSozinha(nome: string, sim: boolean): Promise<VpnOS[]> {
    this.mudarVpnGuardada(nome, { sozinha: sim === true });
    if (sim === true) this.desligadasAMao.delete(nome);
    return this.vpns();
  }

  /** A senha foi dada: as VPNs do cofre voltam ao NetworkManager (que vive na memória) e a vigia começa. */
  private async restaurarVpns(): Promise<void> {
    const noSistema = new Set((await this.sistema.vpns()).map((v) => v.nome));
    for (const g of this.vpnsGuardadas()) {
      this.infoVpn.set(g.nome, { pedeSenha: g.pedeSenha });
      if (noSistema.has(g.nome)) continue;
      const r = await this.sistema.importarVpn(g.tipo, g.nome, g.arquivo);
      this.depurar?.(`vpn voltou ${r.ok ? 'ok' : r.erro}`);
    }
    if (!this.vigiaVpn) {
      this.vigiaVpn = setInterval(() => void this.vezDaVpn(), VIGIA_VPN_MS);
      this.vigiaVpn.unref?.();
    }
  }

  /**
   * Portal + VPN (PLANO §7): a que liga sozinha só liga quando a internet chega de verdade (no hotel, depois do portal).
   * Pergunta ao NetworkManager a ÚLTIMA conectividade (sem um teste novo a cada volta).
   */
  async vezDaVpn(): Promise<string | null> {
    if (this.ligandoSozinha) return null;
    this.ligandoSozinha = true;
    try {
      const agora = Date.now();
      const lista = (await this.vpns()).map((v) => ({ nome: v.nome, ligada: v.ligada, sozinha: v.sozinha && (this.esperarVpn.get(v.nome) ?? 0) <= agora, faltaSenha: v.pedeSenha && !v.temSenha }));
      if (!lista.some((v) => v.sozinha)) return null;
      const nome = qualLigarSozinha(lista, await this.sistema.conectividade(false), this.desligadasAMao);
      if (!nome) return null;
      const r = await this.ligarVpn(nome);
      this.depurar?.(`vpn sozinha ${nome} ${r.ok ? 'ok' : r.erro}`);
      if (!r.ok) this.esperarVpn.set(nome, Date.now() + ESPERA_VPN_MS);
      return r.ok ? nome : null;
    } finally {
      this.ligandoSozinha = false;
    }
  }

  // ---------- feedback sem internet: guardado em `Ekfrase Writer/feedbacks`, enviado quando a internet volta ----------
  // SELADO (Bloco F, 25/11): o feedback leva o print da tela, que pode mostrar o texto. Vai ao disco cifrado com a
  // chave pública da pasta (`motor/selo.ts`), o que dá certo mesmo com os textos trancados; só a senha abre de novo.
  // Sem a chave ainda (a pasta nunca foi aberta nesta versão, ou não há pasta), espera na memória e vai ao disco,
  // selado, quando a senha é dada. Os `.json` em claro das versões 0.2.4 a 0.2.6 são selados nessa hora.

  private pastaDosFeedbacks(): string | null {
    const base = this.dados?.pastaDoApp;
    return base ? join(base, 'feedbacks') : null;
  }

  private arquivoDoSelo(): string | null {
    const base = this.dados?.pastaDoApp;
    return base ? join(base, 'dados', ARQUIVO_DO_SELO) : null;
  }

  private publicaDoSelo(): string | null {
    const f = this.arquivoDoSelo();
    try {
      return f && existsSync(f) ? readFileSync(f, 'utf8').trim() || null : null;
    } catch {
      return null;
    }
  }

  /** Com o cofre aberto: o par do selo existe (a privada no cofre, a pública ao lado dos bancos). */
  private garantirSelo(): string | null {
    const cofre = this.dados?.cofreAberto;
    const f = this.arquivoDoSelo();
    if (!cofre || !f) return null;
    let privada = cofre.segredo(SEGREDO_DO_SELO);
    let publica: string;
    if (privada) {
      publica = publicaDaPrivada(privada);
    } else {
      const par = novoPar();
      cofre.porSegredo(SEGREDO_DO_SELO, par.privada);
      privada = par.privada;
      publica = par.publica;
    }
    try {
      if (this.publicaDoSelo() !== publica) gravarInteiro(f, Buffer.from(publica));
    } catch {
      return null;
    }
    return privada;
  }

  /** O que espera na memória (sem a chave do selo): `<base>` → o JSON do feedback. */
  private feedbacksNaMemoria = new Map<string, string>();

  private quantosFeedbacks(pasta: string | null): number {
    const noDisco = pasta && existsSync(pasta) ? readdirSync(pasta).filter((n) => FEEDBACK_NO_DISCO.test(n)).length : 0;
    return noDisco + this.feedbacksNaMemoria.size;
  }

  /** Grava selado em `<base>.cifrado` (arquivo inteiro de uma vez, com `fsync`). */
  private selarNoDisco(pasta: string, base: string, json: string, publica: string): void {
    mkdirSync(pasta, { recursive: true });
    gravarInteiro(join(pasta, `${base}.cifrado`), Buffer.from(selar(publica, Buffer.from(json))));
  }

  async guardarFeedback(f: unknown): Promise<RespostaSistema> {
    const pasta = this.pastaDosFeedbacks();
    const v = f as { campos?: Record<string, unknown>; arquivos?: { campo?: unknown; nome?: unknown; tipo?: unknown; bytes?: unknown }[] } | null;
    if (!v || typeof v.campos !== 'object' || !v.campos) return { ok: false, erro: 'negado' };
    const campos: Record<string, string> = {};
    for (const [k, x] of Object.entries(v.campos)) if (typeof x === 'string' && k.length <= 40) campos[k] = x.slice(0, 6000);
    const arquivos: { campo: string; nome: string; tipo: string; dados: string }[] = [];
    let total = 0;
    for (const a of Array.isArray(v.arquivos) ? v.arquivos.slice(0, 6) : []) {
      if (!(a.bytes instanceof Uint8Array) || typeof a.campo !== 'string' || typeof a.nome !== 'string') return { ok: false, erro: 'negado' };
      total += a.bytes.byteLength;
      if (total > MAXIMO_FEEDBACK) return { ok: false, erro: 'grande' };
      arquivos.push({ campo: a.campo.slice(0, 40), nome: a.nome.slice(0, 120), tipo: typeof a.tipo === 'string' ? a.tipo.slice(0, 80) : '', dados: Buffer.from(a.bytes).toString('base64') });
    }
    try {
      if (this.quantosFeedbacks(pasta) >= 100) return { ok: false, erro: 'grande' };
      const base = `feedback-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
      const json = JSON.stringify({ campos, arquivos });
      const publica = this.publicaDoSelo();
      if (pasta && publica) this.selarNoDisco(pasta, base, json, publica);
      else this.feedbacksNaMemoria.set(base, json);
      return { ok: true };
    } catch {
      return { ok: false, erro: 'falhou' };
    }
  }

  async feedbacksGuardados(): Promise<FeedbackGuardado[]> {
    const lista: FeedbackGuardado[] = [];
    for (const [base, json] of this.feedbacksNaMemoria) {
      const f = lerFeedback(`${base}.memoria`, json);
      if (f) lista.push(f);
    }
    const pasta = this.pastaDosFeedbacks();
    if (!pasta || !existsSync(pasta)) return lista;
    const privada = this.dados?.cofreAberto?.segredo(SEGREDO_DO_SELO) ?? null;
    for (const id of readdirSync(pasta).filter((n) => FEEDBACK_NO_DISCO.test(n)).sort()) {
      try {
        const conteudo = readFileSync(join(pasta, id), 'utf8');
        // selado: só com a senha dada (trancado, fica para depois)
        const json = id.endsWith('.cifrado') ? (privada ? abrirSelado(privada, conteudo)?.toString('utf8') : undefined) : conteudo;
        const f = json ? lerFeedback(id, json) : null;
        if (f) lista.push(f);
      } catch {
        // arquivo estragado: fica na pasta, não trava os outros
      }
    }
    return lista;
  }

  /** Apaga o feedback que foi enviado, onde quer que esteja agora (memória, `.json` antigo ou selado). */
  async apagarFeedback(id: string): Promise<void> {
    const m = /^(feedback-[\w.-]+)\.(json|cifrado|memoria)$/.exec(id);
    if (!m) return;
    const base = m[1]!;
    this.feedbacksNaMemoria.delete(base);
    const pasta = this.pastaDosFeedbacks();
    if (pasta) for (const ext of ['json', 'cifrado']) rmSync(join(pasta, `${base}.${ext}`), { force: true });
  }

  /** A senha foi dada: o par do selo, o que esperava na memória vai ao disco selado, e os `.json` em claro são selados. */
  private selarOsGuardados(): void {
    if (!this.garantirSelo()) return;
    const pasta = this.pastaDosFeedbacks();
    const publica = this.publicaDoSelo();
    if (!pasta || !publica) return;
    for (const [base, json] of [...this.feedbacksNaMemoria]) {
      try {
        this.selarNoDisco(pasta, base, json, publica);
        this.feedbacksNaMemoria.delete(base);
      } catch {
        // fica na memória
      }
    }
    if (!existsSync(pasta)) return;
    for (const id of readdirSync(pasta).filter((n) => /^feedback-[\w.-]+\.json$/.test(n))) {
      try {
        const json = readFileSync(join(pasta, id), 'utf8');
        this.selarNoDisco(pasta, id.slice(0, -'.json'.length), json, publica);
        rmSync(join(pasta, id), { force: true });
      } catch {
        // fica como estava
      }
    }
  }

  // ---------- o que a página guarda (localStorage): cifrado no cofre ----------

  /** Grava no cofre as chaves `ekfrase*` do `localStorage` da página (nada de texto: o rascunho já vai ao cofre). */
  async salvarPagina(): Promise<void> {
    const j = this.pagina;
    const cofre = this.dados?.cofreAberto;
    if (!j?.aberta() || !cofre) return;
    try {
      const copia = await j.copiarGuardado();
      if (typeof copia === 'string') cofre.porSegredo('pagina', copia);
      this.depurar?.(`pagina salva ${copia.length}`);
    } catch (e) {
      this.depurar?.(`pagina nao salva ${String(e)}`);
      // a página está recarregando: fica para a próxima
    }
  }

  /** A senha foi dada: as redes voltam ao NetworkManager e o `localStorage` da página volta (uma vez por boot). */
  async depoisDeAbrir(): Promise<void> {
    this.selarOsGuardados();
    for (const r of this.redesGuardadas()) await this.sistema.lembrarRede(r.ssid, r.senha);
    const volta = this.restaurarVpns()
      .catch((e: unknown) => this.depurar?.(`vpn nao voltou ${String(e)}`))
      .finally(() => {
        if (this.restaurando === volta) this.restaurando = null;
        this.vpnsProntas();
      });
    this.restaurando = volta;

    if (this.paginaVoltou) return;
    this.paginaVoltou = true;
    const guardado = this.dados?.cofreAberto?.segredo('pagina');
    const j = this.pagina;
    if (!guardado || !j?.aberta()) return;
    try {
      const mudou = await j.porGuardado(guardado);
      // a página leu o localStorage ao abrir: recarrega para valer (os textos continuam abertos)
      if (mudou) setTimeout(() => j.recarregar(), 50);
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
