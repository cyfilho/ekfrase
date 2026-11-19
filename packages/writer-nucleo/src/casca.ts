// SPDX-License-Identifier: MPL-2.0

/**
 * A PONTE DA CASCA DO COMPUTADOR (`sistema/writer-os/casca`): o que o preload põe na página, com
 * `contextBridge`, em `window.ekfraseCasca`. É o contrato entre a casca e o app: o MESMO
 * `apps/writer` roda no site e na casca, e é por esta ponte (e só por ela) que ele descobre que está
 * no computador e mostra o que é do computador (a senha, a pasta dos dados, o espelho `.md`, o
 * servidor). A página não tem Node: só estas funções.
 */
import type { RespostaArmazem, MetodoArmazem } from './armazem-ponte.ts';
import type { Mudanca } from './armazem.ts';
import type { ServidorConferido } from './transporte.ts';

/** O espelho `.md` desta pasta: `perguntar` = ainda não respondeu desde que abriu. */
export type EscolhaEspelho = 'sim' | 'sempre' | 'nao';
export type SituacaoEspelho = 'perguntar' | EscolhaEspelho;

export interface EstadoCasca {
  /** A pasta dos dados em uso (`…/Ekfrase Writer`), ou `null` se ainda não há. */
  pasta: string | null;
  /** A pasta que a casca sugere (Documentos/Ekfrase Writer). */
  sugerida: string;
  /** A pasta em uso já tem textos (pede a senha) ou é nova (cria a senha). */
  temSenha: boolean;
  /** A pasta da última vez não está mais lá (o pendrive saiu?). */
  sumiu: string | null;
  /** A senha foi dada: os textos estão abertos. */
  aberta: boolean;
  espelho: SituacaoEspelho;
  /** Onde ficam os `.md` do espelho (dentro da pasta dos dados). */
  pastaEspelho: string | null;
  /** O espelho escreveu tudo o que mudou (ou está desligado). */
  espelhoEmDia: boolean;
  /** A base da API do servidor escolhido (`https://ekfrase.com/api/v1/`). */
  servidor: string;
  /** O servidor é o padrão (ekfrase.com). */
  servidorPadrao: boolean;
  /** `computador` (o instalador da fase 2) ou `os` (o pendrive Writer OS, fase 3). */
  modo: 'computador' | 'os';
  /** No OS: onde os textos estão (`null` = ainda escolhendo, porque não há a partição de dados). */
  destino: DestinoOS | null;
}

/**
 * Onde os textos ficam no Writer OS (PLANO §4.5): a partição de dados do pendrive de boot; se ela não
 * existe, outro pendrive (ou SSD/HD externo) que a pessoa escolhe; se nada servir, a memória (some ao
 * desligar; a faixa âmbar avisa).
 */
export type DestinoOS = 'pendrive' | 'outro-pendrive' | 'ram';

export type ErroCasca = 'senha' | 'senha-curta' | 'pasta' | 'nao-abre' | 'fechada' | 'ja-tem';

export type RespostaCasca = { ok: true; estado: EstadoCasca } | { ok: false; erro: ErroCasca };

/** O tamanho mínimo da senha dos textos. */
export const SENHA_MINIMA = 6;

export interface PonteCasca {
  /** A versão da casca (a do instalador). */
  readonly versao: string;
  /** `win32`, `linux`… */
  readonly plataforma: string;

  estado(): Promise<EstadoCasca>;
  /** O seletor de pastas do sistema. `null` = a pessoa desistiu. */
  escolherPasta(): Promise<string | null>;
  /** Usa esta pasta para os dados (fecha os textos que estavam abertos). */
  usarPasta(caminho: string): Promise<RespostaCasca>;
  /** Pasta nova: cria a senha e abre. */
  criarSenha(senha: string): Promise<RespostaCasca>;
  /** Pasta com textos: abre com a senha. */
  abrir(senha: string): Promise<RespostaCasca>;
  /** Fecha os textos (para trocar de pasta). */
  trancar(): Promise<EstadoCasca>;
  /** A resposta à pergunta do espelho `.md` (sim / sempre neste / não). */
  responderEspelho(escolha: EscolhaEspelho): Promise<EstadoCasca>;

  armazem: {
    /** Abre o armazém de um dono (`local` ou o id da conta); devolve a alça. */
    abrir(dono: string): Promise<string>;
    chamar(alca: string, metodo: MetodoArmazem, args: unknown[]): Promise<RespostaArmazem>;
    aoMudar(alca: string, f: (m: Mudanca) => void): () => void;
    fechar(alca: string): void;
  };

  /** O rascunho de emergência (`apps/writer/src/rascunho.ts`), SÍNCRONO, no banco cifrado. */
  rascunhos: {
    por(chave: string, valor: string): boolean;
    tirar(chave: string): void;
    todos(): Record<string, string>;
  };

  /** "Servidor: Outro…": confere o endereço (pelo processo principal: sem CORS). */
  conferirServidor(endereco: string): Promise<ServidorConferido>;
  /** Passa a usar este servidor (a base que `conferirServidor` devolveu, ou `null` = ekfrase.com). A página recarrega. */
  usarServidor(base: string | null): Promise<void>;

  /** A janela vai fechar: a página grava o que falta (a casca espera, até uns segundos). */
  aoFechar(f: () => Promise<void>): void;

  /** Só no Writer OS (o pendrive): o sistema (Wi-Fi, teclado, pendrives, desligar…). */
  readonly os?: PonteSistema;

  /** As atualizações do app (DEC-P072, docs/ATUALIZACOES.md): no Writer OS desde a U1; no computador, a U2. */
  readonly atualizacoes?: PonteAtualizacoes;
}

// ---------- as atualizações (DEC-P072, docs/ATUALIZACOES.md) ----------

/** "Automáticas (recomendado)", o padrão, ou "Perguntar antes de instalar". */
export type ModoAtualizacoes = 'automaticas' | 'perguntar';

/**
 * Onde a atualização está: `parado` (ainda não procurou), `procurando`, `em-dia`, `disponivel` (achou uma nova e o modo
 * é perguntar), `baixando`, `aplicando` (gravando a cópia de reserva), `pronta` (vale na próxima vez que ligar) ou `erro`.
 */
export type SituacaoAtualizacao = 'parado' | 'procurando' | 'em-dia' | 'disponivel' | 'baixando' | 'aplicando' | 'pronta' | 'erro';

/**
 * `sem-rede` (sem internet ou o GitHub não respondeu), `lacre` (arquivo sem o lacre da Ekfrase ou trocado no caminho),
 * `sem-espaco`, `sem-dados` (o Writer OS sem a partição de dados: não há onde baixar), `pendente` (a última ainda não
 * ligou: reinicie antes), `falhou` (outra coisa).
 */
export type ErroAtualizacao = 'sem-rede' | 'lacre' | 'sem-espaco' | 'sem-dados' | 'pendente' | 'falhou';

export interface EstadoAtualizacoes {
  modo: ModoAtualizacoes;
  /** A versão que está rodando. */
  versao: string;
  canal: 'estavel' | 'teste';
  situacao: SituacaoAtualizacao;
  /** A versão nova (achada, baixando ou pronta). */
  nova: string | null;
  /** O andamento de `baixando` e `aplicando`, em bytes. */
  feito: number;
  total: number;
  erro: ErroAtualizacao | null;
  /** Quando procurou pela última vez (ms desde 1970). */
  ultimaBusca: number | null;
  /** A última atualização não ligou e o sistema voltou para a anterior (Writer OS, A/B). */
  voltou: { de: string; para: string } | null;
}

export interface PonteAtualizacoes {
  estado(): Promise<EstadoAtualizacoes>;
  /** "Procurar agora" (no modo automáticas, achou = já baixa e deixa pronta). */
  procurar(): Promise<EstadoAtualizacoes>;
  /** "Instalar" (no modo perguntar, depois de achar). */
  instalar(): Promise<EstadoAtualizacoes>;
  usarModo(modo: ModoAtualizacoes): Promise<EstadoAtualizacoes>;
  /**
   * "Reiniciar agora" (só o Writer no computador, U2): grava, fecha, aplica a versão pronta e abre de novo. No Writer OS
   * não existe (a nova vale ao ligar de novo, e o menu já tem o Reiniciar).
   */
  reiniciar?(): Promise<void>;
  /** Cada mudança (o andamento, pronta, erro). Devolve o "parar de ouvir". */
  aoMudar(f: (e: EstadoAtualizacoes) => void): () => void;
}

// ---------- o Writer OS (fase 3): o painel do sistema e o primeiro uso ----------

export interface EstadoOS {
  /** O idioma, o teclado e o fuso escolhidos no primeiro uso (`null` = ainda não). */
  idioma: string | null;
  teclado: string | null;
  fuso: string | null;
  /** O passo do Wi-Fi do primeiro uso já passou (conectou ou pulou). */
  wifiVisto: boolean;
  /** Por que não há a partição de dados (`sem-espaco`, `nao-usb`, `sem-medio`…; `null` = há). */
  motivo: string | null;
  /** De onde o sistema ligou: do pendrive (USB), do disco do computador (instalado, PLANO §8c) ou não se sabe. */
  boot: 'usb' | 'computador' | 'outro';
  /** A pergunta "Como você quer usar o Writer OS?" do primeiro uso já foi respondida (pedido do Alcy, 18/11). */
  usoVisto: boolean;
  /** O Writer OS acabou de ser instalado no computador neste boot: só falta desligar (o cofre já fechou). */
  instalado: boolean;
  /** Instalou APAGANDO o disco inteiro (W3f): o Writer OS ficou em primeiro na ordem de boot e liga sozinho. */
  discoTodo: boolean;
  /** A marca do computador (de `/sys/class/dmi/id/sys_vendor`): o tutorial mostra a tecla do menu de boot dela. */
  marca: MarcaComputador;
  /** Os testes e os prints (fora do pendrive de verdade). */
  simulado: boolean;
}

// ---------- instalar no computador (PLANO §8c, fase 3d) ----------

/** Uma partição do disco interno, para a barra do disco (nada dela muda ao instalar). */
export interface ParteInterna {
  /** Onde começa e quanto ocupa, em bytes. */
  inicio: number;
  tamanho: number;
  /** O sistema de arquivos (`ntfs`, `vfat`…; vazio se não se sabe). */
  fs: string;
  /** O nome da partição na GPT e o rótulo do sistema de arquivos (podem vir vazios). */
  nome: string;
  rotulo: string;
}

/** Um disco interno do computador (SATA, NVMe, eMMC; nunca USB). */
export interface DiscoInterno {
  /** O nome do kernel (`nvme0n1`, `sda`): é o que o pedido de instalar leva. */
  id: string;
  modelo: string;
  tamanho: number;
  /** O maior espaço livre (sem partição): onde começa e quanto tem, em bytes. */
  livreInicio: number;
  livre: number;
  /** `gpt`, `dos` ou `nenhuma`. */
  tabela: string;
  /** O Writer OS já está instalado nele. */
  writer: boolean;
  partes: ParteInterna[];
}

export interface InfoInstalacao {
  uefi: boolean;
  discos: DiscoInterno[];
}

export type PassoInstalar = 'apagar' | 'particoes' | 'copiar' | 'conferir' | 'textos' | 'entrada';
export type ErroInstalar = 'sem-espaco' | 'nao-gpt' | 'nao-uefi' | 'ja-instalado' | 'nao-usb' | 'disco' | 'copia' | 'textos' | 'entrada' | 'ocupado' | 'confirmacao' | 'falhou';
export type RespostaInstalar = { ok: true; estado: EstadoOS } | { ok: false; erro: ErroInstalar };

/** O espaço livre mínimo para instalar (8 GiB) e o máximo que a instalação usa (32 GiB); igual ao ekfrase-instalar.sh. */
export const INSTALAR_MINIMO = 8 * 1024 ** 3;
export const INSTALAR_MAXIMO = 32 * 1024 ** 3;

/** O nome do disco como a tela mostra e a pessoa digita para apagá-lo (o modelo; sem modelo, o nome do kernel). */
export const nomeDoDisco = (d: Pick<DiscoInterno, 'modelo' | 'id'>): string => d.modelo.trim() || d.id;

/** O nome digitado confere com o do disco? A regra do Gravador (`nomeNormalizado`): sem diferença de maiúsculas e espaços. */
export function nomeConfere(d: Pick<DiscoInterno, 'modelo' | 'id'>, digitado: string): boolean {
  const n = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  return n(digitado) !== '' && n(digitado) === n(nomeDoDisco(d));
}

/** O que é uma partição, para a lista de "Apagar o disco inteiro" (o Windows aparece em vermelho). */
export type TipoDeParte = 'windows' | 'recuperacao' | 'efi' | 'linux' | 'writer' | 'outra';

export function tipoDaParte(p: ParteInterna): TipoDeParte {
  const nome = `${p.nome} ${p.rotulo}`;
  if (p.nome === 'EKFRASE-BOOT' || p.nome === 'EKFRASE-DADOS') return 'writer';
  if (p.fs === 'vfat' && (/EFI|ESP|SYSTEM/i.test(nome) || p.tamanho < 1024 ** 3)) return 'efi';
  if (/recovery|recupera|winre/i.test(nome)) return 'recuperacao';
  if (p.fs === 'ntfs' || p.fs === 'BitLocker' || /Microsoft|Basic data/i.test(p.nome)) return 'windows';
  if (/^(ext[234]|btrfs|xfs|f2fs|swap|crypto_LUKS|LVM2_member)$/.test(p.fs)) return 'linux';
  return 'outra';
}

/** As marcas que o tutorial conhece (a tabela do "como bootar" do Gravador, mais a Positivo). */
export const MARCAS = ['lenovo', 'dell', 'hp', 'acer', 'asus', 'msi', 'samsung', 'positivo', 'outra'] as const;
export type MarcaComputador = (typeof MARCAS)[number];

/** A marca pelo `sys_vendor` do firmware ("LENOVO", "Dell Inc.", "HP", "Hewlett-Packard", "ASUSTeK COMPUTER INC."…). */
export function marcaDoComputador(fabricante: string): MarcaComputador {
  const f = fabricante.trim().toLowerCase();
  if (f.startsWith('lenovo')) return 'lenovo';
  if (f.startsWith('dell')) return 'dell';
  if (f === 'hp' || f.startsWith('hp ') || f.startsWith('hewlett')) return 'hp';
  if (f.startsWith('acer')) return 'acer';
  if (f.startsWith('asus')) return 'asus';
  if (f.startsWith('micro-star') || f.startsWith('msi')) return 'msi';
  if (f.startsWith('samsung')) return 'samsung';
  if (f.startsWith('positivo')) return 'positivo';
  return 'outra';
}

export interface RedeWifi {
  ssid: string;
  /** 0 a 100. */
  sinal: number;
  /** Pede senha. */
  segura: boolean;
  /** Já conectou nela (a senha está guardada, cifrada, no pendrive). */
  conhecida: boolean;
  conectada: boolean;
}

/** Um disco ligado por USB (pendrive, SSD portátil, HD externo), menos o de boot (PLANO §6.1b). */
export interface DiscoUSB {
  /** O dispositivo (`/dev/sdb1`). */
  id: string;
  /** O fabricante e o modelo. */
  nome: string;
  rotulo: string;
  /** Em bytes. */
  tamanho: number;
  montado: string | null;
  /** Já tem uma pasta do Writer com textos. */
  temWriter: boolean;
}

export interface Bateria {
  /** 0 a 100. */
  nivel: number;
  carregando: boolean;
}

export interface SobreOS {
  sistema: string;
  app: string;
  kernel: string;
  secureBoot: 'ligado' | 'desligado' | 'desconhecido';
}

/** Um item de uma pasta de um pendrive (a tela de importar e de salvar do Writer OS). */
export interface ItemDePasta {
  nome: string;
  pasta: boolean;
  /** Em bytes (0 para pasta). */
  tamanho: number;
}

export type ListaDePasta = { ok: true; caminho: string; itens: ItemDePasta[] } | { ok: false; erro: ErroSistema };

export type ErroSistema = 'senha' | 'falhou' | 'negado' | 'grande';
export type RespostaSistema = { ok: true } | { ok: false; erro: ErroSistema };

export interface PonteSistema {
  estado(): Promise<EstadoOS>;
  /** Os idiomas do primeiro uso: grava a escolha (a página troca o dela). */
  usarIdioma(codigo: string): Promise<EstadoOS>;
  /** Os teclados que o sistema conhece (`br`, `us`, `us-intl`…). */
  teclados(): Promise<string[]>;
  /** Troca o teclado. Se é outro, a sessão reabre (o Cage só lê o teclado ao abrir): a página grava antes. */
  usarTeclado(id: string): Promise<{ estado: EstadoOS; reabrindo: boolean }>;
  fusos(): Promise<string[]>;
  usarFuso(id: string): Promise<EstadoOS>;
  /** O passo do Wi-Fi do primeiro uso terminou. */
  passarWifi(): Promise<EstadoOS>;
  /** A pergunta "Como você quer usar?" foi respondida com "Só pelo pendrive". */
  passarUso(): Promise<EstadoOS>;
  /** O que há no computador para instalar (pergunta ao serviço do sistema; nada muda). */
  instalacao(): Promise<InfoInstalacao>;
  /**
   * Instala no maior espaço livre do disco. Antes, a casca grava e fecha os textos; `levar` copia a pasta deles.
   * Com `apagar` (o nome do disco, como a pessoa digitou): APAGA o disco inteiro e instala nele (W3f); a casca confere
   * o nome de novo (`nomeConfere`) antes de pedir ao serviço.
   */
  instalar(disco: string, levar: boolean, apagar?: string): Promise<RespostaInstalar>;
  /** O progresso da instalação (o passo e, ao copiar, os bytes). Devolve o "parar de ouvir". */
  aoPassoDaInstalacao(f: (passo: PassoInstalar, feito: number, total: number) => void): () => void;
  redes(): Promise<RedeWifi[]>;
  conectar(ssid: string, senha: string | null): Promise<RespostaSistema>;
  esquecer(ssid: string): Promise<void>;
  bateria(): Promise<Bateria | null>;
  /** O brilho (0 a 100), ou `null` se a tela não deixa. Com `passo` (+10, −10), muda antes de responder. */
  brilho(passo?: number): Promise<number | null>;
  /** As teclas de brilho do notebook (a casca as lê): o brilho novo, a cada tecla. Devolve o "parar de ouvir". */
  aoMudarBrilho(f: (n: number) => void): () => void;
  discos(): Promise<DiscoUSB[]>;
  /** Guarda os textos neste disco (`Ekfrase Writer/` nele). Vindo da memória, leva o que já estava lá. */
  guardarEm(id: string): Promise<RespostaCasca>;
  /** Guarda os textos na memória (some ao desligar). */
  guardarNaMemoria(): Promise<RespostaCasca>;
  ejetar(id: string): Promise<RespostaSistema>;
  /**
   * Importar e salvar SEM o seletor do sistema (PLANO §6.5 item 5, §7): a página só enxerga o que está nos
   * pendrives (o disco interno e o resto do sistema nunca). `abrirDisco` monta o disco e devolve a raiz;
   * `listar` mostra uma pasta (só pastas e os arquivos que o Writer importa); `lerArquivo` e `gravarArquivo`
   * trabalham com um arquivo (nunca por cima de um que já existe: o nome ganha " (2)").
   */
  abrirDisco(id: string): Promise<{ ok: true; raiz: string } | { ok: false; erro: ErroSistema }>;
  listar(caminho: string): Promise<ListaDePasta>;
  lerArquivo(caminho: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; erro: ErroSistema }>;
  gravarArquivo(pasta: string, nome: string, bytes: Uint8Array): Promise<{ ok: true; nome: string } | { ok: false; erro: ErroSistema }>;
  /** Desliga e reinicia: os textos fecham antes (a página grava antes de pedir). */
  desligar(): Promise<void>;
  reiniciar(): Promise<void>;
  sobre(): Promise<SobreOS>;
}

/** A ponte, se o app está dentro da casca do computador. */
export function ponteDaCasca(): PonteCasca | null {
  const p = (globalThis as { ekfraseCasca?: PonteCasca }).ekfraseCasca;
  return p && typeof p === 'object' && typeof p.estado === 'function' ? p : null;
}
