// SPDX-License-Identifier: MPL-2.0

/**
 * A casca do Maker na família Ekfrase (Preact; o editor continua em TypeScript puro, em main.ts):
 *
 * - idioma: o do Ekfrase manda (o mesmo em todo o site); o tradutor do Maker acompanha;
 * - o topo com os botões-ícone de todo app (passeio, idioma, tema, feedback, conta) e o rodapé;
 * - a ENTRADA: quem não entrou vê a tela inicial do app (computador, online, arquivos), que é o hall
 *   do modo normal. Quem entrou e chegou por link direto aparece no modo da última vez (modo jogo =
 *   as salas da torre do Maker no castelo; DEC-P048). O online exige a conta Ekfrase;
 * - a NUVEM: tudo se salva sozinho, como no Canva (FB-0001): cada mudança vai para o RASCUNHO deste
 *   navegador na hora e para a nuvem alguns segundos depois ("Salvar"/Ctrl+S manda já). "Meus mundos"
 *   lista, abre e apaga. Exportar e Importar continuam com o arquivo .ekfr;
 * - ao abrir (FB-0002): o mundo da última vez (o rascunho, se tinha mudança que a nuvem não tem; senão
 *   o último salvo na nuvem). Mundo novo só na primeira vez ou em "Gerar novo mundo".
 */
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/atkinson-hyperlegible-next/latin-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700.css';
import '@ekfrase/nucleo/estilo/tokens.css';
import { aplicarTema, criarTradutor, iniciarIdioma, montarCatalogo, temaAtual } from '@ekfrase/nucleo';
import { AcoesTopo, EntradaApp, Janela, RodapeEkfrase, entradaPedida, limparEntradaPedida, ponte, type Documento } from '@ekfrase/interface';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import logoMaker from './img/logo-maker.png';
import { formatNumber, getLocale, isLocale, onLocaleChange, setLocale, t } from './i18n';
import { gravarRascunho, lerRascunho } from './rascunho';

export const tr = criarTradutor(montarCatalogo(import.meta.glob('../../../locales/*/*.json', { eager: true, import: 'default' })));
const tn = tr.t;

/** O que a casca precisa do editor. */
export interface Editor {
  nome(): string;
  /** O arquivo .ekfr do mundo aberto (com a miniatura), sem baixar. */
  bytes(): Promise<Uint8Array>;
  /** O mesmo, sem a miniatura (rápido: para o rascunho a cada mudança). */
  bytesRapido(): Uint8Array;
  /** Abre um mundo; `avisar` mostra "Aberto: …". */
  abrir(bytes: Uint8Array, avisar?: boolean): void;
  marcarSalvo(): void;
  marcarSujo(): void;
  sujo(): boolean;
  aviso(texto: string): void;
  erro(e: unknown): void;
  /** A linha da nuvem no painel ("Salvando…", "Salvo na nuvem às…"). */
  estadoNuvem(texto: string): void;
  /** O mundo da última vez já está aberto: o editor pode atender os pedidos do endereço. */
  pronto(): void;
}

let editor: Editor | null = null;
/** O documento da nuvem que está aberto (salvar de novo troca este). */
let nuvemId: number | null = null;
/** De quem é o rascunho (null = sem servidor, no computador de quem desenvolve). */
let dono: number | null = null;
/** Há nuvem (entrou com a conta Ekfrase). */
let comNuvem = false;
/** Só depois de abrir o mundo da última vez o rascunho passa a ser gravado (senão o mundo vazio do começo o apagaria). */
let ligado = false;
/** Conta as mudanças: a nuvem só fica "salva" se nada mudou enquanto enviava. */
let versao = 0;
let salvando: Promise<void> | null = null;
let tempoRascunho = 0;
let tempoNuvem = 0;
const ESPERA_RASCUNHO = 500;
const ESPERA_NUVEM = 4000;
const ESPERA_ERRO = 30000;

/** Idioma e tema do Ekfrase, antes de o editor desenhar qualquer coisa. */
export function iniciarIdiomaETema(): void {
  iniciarIdioma(tr);
  aplicarTema(temaAtual());
  const seguir = () => {
    const i = tr.idioma();
    if (isLocale(i) && i !== getLocale()) setLocale(i);
  };
  seguir();
  tr.aoTrocar(seguir);
}

function Topo() {
  const [, setV] = useState(0);
  useEffect(() => tr.aoTrocar(() => setV((n) => n + 1)), []);
  return <AcoesTopo t={tn} tr={tr} app="maker" passeio="/#/torre/maker/salas" aoSair={() => location.reload()} />;
}

function Rodape() {
  const [, setV] = useState(0);
  useEffect(() => tr.aoTrocar(() => setV((n) => n + 1)), []);
  return <RodapeEkfrase t={tn} />;
}

function Entrada({ aoEntrar, aoAbrir }: { aoEntrar: () => void; aoAbrir?: () => void }) {
  const [, setV] = useState(0);
  useEffect(() => tr.aoTrocar(() => setV((n) => n + 1)), []);
  return (
    <EntradaApp
      t={tn}
      tr={tr}
      app="maker"
      logo={logoMaker}
      nome={t('app.title')}
      descricao={t('entry.description')}
      podeCriar
      arquivos
      aoEntrar={aoEntrar}
      {...(aoAbrir ? { aoAbrir } : {})}
    />
  );
}

/** Só no servidor de desenvolvimento (`npm run maker`): o servidor do Ekfrase (/api) não respondeu? */
async function semServidor(): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const r = await fetch('/api/v1/conta/eu');
    return !r.ok || !(r.headers.get('content-type') ?? '').includes('json');
  } catch {
    return true;
  }
}

/**
 * Liga a casca: topo, rodapé e a entrada. O editor fica coberto pela entrada até a conta responder;
 * sem conta, a entrada fica (ou o passeio leva ao hall da torre).
 */
export async function iniciarCasca(e: Editor): Promise<void> {
  editor = e;
  render(<Topo />, document.getElementById('acoes-topo')!);
  render(<Rodape />, document.getElementById('rodape')!);
  const capa = document.getElementById('entrada')!;
  const abrirEditor = (conta: number | null, nuvem: boolean) => {
    render(null, capa);
    capa.hidden = true;
    document.body.classList.remove('so-entrada');
    dispatchEvent(new Event('resize'));
    void restaurar(conta, nuvem);
  };
  // no computador de quem desenvolve, sem o servidor do Ekfrase: o editor abre direto (sem conta e sem nuvem)
  if (await semServidor()) {
    abrirEditor(null, false);
    e.aviso(t('local.aviso'));
    return;
  }
  const estado = await ponte.eu();
  // ekfrase.com/maker cai na tela inicial (as formas de usar), com ou sem conta; com conta ela tem o "Abrir o Maker"
  if (!estado.carregando && estado.conta) {
    const id = estado.conta.id;
    if (!entradaPedida()) return abrirEditor(id, true);
    document.body.classList.add('so-entrada');
    render(
      <Entrada
        aoEntrar={() => abrirEditor(id, true)}
        aoAbrir={() => {
          limparEntradaPedida();
          abrirEditor(id, true);
        }}
      />,
      capa,
    );
    return;
  }
  // só a tela inicial: o editor sai de vista (e a página rola só a entrada)
  document.body.classList.add('so-entrada');
  render(
    <Entrada
      aoEntrar={() => {
        const c = ponte.contaAtual();
        abrirEditor(!c.carregando && c.conta ? c.conta.id : null, true);
      }}
    />,
    capa,
  );
}

/**
 * Abre o mundo da última vez (FB-0002): o rascunho, se ele tem mudanças que a nuvem não tem; senão o
 * documento da nuvem a que o rascunho pertence ou, sem ele, o último salvo na nuvem; senão o rascunho.
 * Só a primeira vez (nada em lugar nenhum) fica com o mundo novo.
 */
async function restaurar(conta: number | null, nuvem: boolean): Promise<void> {
  const e = editor!;
  dono = conta;
  comNuvem = nuvem;
  const r = await lerRascunho(conta);
  const abrir = (bytes: Uint8Array, id: number | null): boolean => {
    try {
      e.abrir(bytes, false);
      nuvemId = id;
      return true;
    } catch {
      return false;
    }
  };
  let aberto = false;
  if (r?.sujo && abrir(r.bytes, r.nuvemId)) {
    e.marcarSujo();
    aberto = true;
  }
  if (!aberto && nuvem) {
    const lista = await ponte.listarDocumentos('maker');
    if (lista.ok && lista.documentos.length) {
      const alvo = lista.documentos.find((d) => d.id === r?.nuvemId) ?? lista.documentos[0]!;
      const bytes = await ponte.abrirDocumento(alvo.id);
      aberto = Boolean(bytes && abrir(bytes, alvo.id));
    }
  }
  if (!aberto && r) abrir(r.bytes, r.nuvemId);
  ligado = true;
  if (e.sujo()) mudou();
  else void guardarRascunho();
  e.pronto();
}

/** O editor avisa a cada mudança do mundo: rascunho já, nuvem em alguns segundos. */
export function mudou(): void {
  if (!ligado) return;
  versao++;
  clearTimeout(tempoRascunho);
  tempoRascunho = window.setTimeout(() => void guardarRascunho(), ESPERA_RASCUNHO);
  if (comNuvem) {
    clearTimeout(tempoNuvem);
    tempoNuvem = window.setTimeout(() => void salvarNaNuvem(true), ESPERA_NUVEM);
  }
}

/** Saindo da página (outra aba, fechar): grava o rascunho e manda para a nuvem já. */
export function guardarJa(): void {
  if (!ligado || !editor) return;
  clearTimeout(tempoRascunho);
  void guardarRascunho();
  if (comNuvem && editor.sujo()) void salvarNaNuvem(true);
}

/** Há algo que ainda não chegou à nuvem (o navegador pergunta antes de fechar). */
export const temPendencia = (): boolean => Boolean(editor?.sujo() || salvando);

/** O mundo vai para a nuvem sozinho (entrou com a conta). */
export const temNuvem = (): boolean => comNuvem;

/**
 * Antes de trocar o mundo aberto (novo, importar, abrir outro): com a nuvem, manda o atual para lá e
 * espera; só pergunta se não deu (ou se não há nuvem e há mudanças). Devolve se pode trocar.
 */
export async function guardarAntesDeTrocar(): Promise<boolean> {
  if (!editor?.sujo()) return true;
  if (comNuvem) await salvarNaNuvem(true);
  return !editor.sujo() || confirm(t('doc.confirmDiscard'));
}

async function guardarRascunho(): Promise<void> {
  if (!ligado || !editor) return;
  await gravarRascunho(dono, { bytes: editor.bytesRapido(), nuvemId, sujo: editor.sujo(), quando: Date.now() });
}

// ---------- a nuvem ----------

const ERROS_NUVEM: Readonly<Record<string, string>> = {
  rede: 'cloud.error.rede',
  grande: 'cloud.error.grande',
  cota: 'cloud.error.cota',
  tipo: 'cloud.error.tipo',
  login: 'cloud.error.login',
};
const erroNuvem = (codigo: string) => t(ERROS_NUVEM[codigo] ?? 'cloud.error.server');

/** Esquece o documento da nuvem (mundo novo ou importado de arquivo: o próximo Salvar cria outro). */
export function esquecerNuvem(): void {
  nuvemId = null;
}

/**
 * Grava o mundo aberto na nuvem. `auto` = o salvamento automático (sem aviso na tela, só a linha da
 * nuvem no painel; se falhar, tenta de novo daqui a pouco). Sem `auto` = o botão Salvar ou Ctrl+S.
 */
export async function salvarNaNuvem(auto = false): Promise<void> {
  const e = editor;
  if (!e) return;
  if (salvando) {
    await salvando;
    if (auto && !e.sujo()) return;
  }
  clearTimeout(tempoNuvem);
  const v = versao;
  e.estadoNuvem(t('cloud.auto.saving'));
  let deuCerto = false;
  salvando = (async () => {
    let r = await ponte.salvarDocumento('maker', e.nome(), await e.bytes(), nuvemId ?? undefined);
    if (!r.ok && r.erro === 'documento') {
      // apagado em outro aparelho: salva como novo
      nuvemId = null;
      r = await ponte.salvarDocumento('maker', e.nome(), await e.bytes());
    }
    if (!r.ok) {
      e.estadoNuvem(t('cloud.auto.error'));
      if (!auto) e.aviso(erroNuvem(r.erro));
      return;
    }
    deuCerto = true;
    nuvemId = r.documento.id;
    if (versao === v) e.marcarSalvo();
    e.estadoNuvem(t('cloud.auto.saved', { time: new Date().toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) }));
    if (!auto) e.aviso(t('cloud.saved', { name: r.documento.nome }));
  })();
  try {
    await salvando;
  } finally {
    salvando = null;
  }
  void guardarRascunho();
  // mudou enquanto enviava (ou falhou): manda de novo daqui a pouco
  if (comNuvem && e.sujo()) tempoNuvem = window.setTimeout(() => void salvarNaNuvem(true), deuCerto ? ESPERA_NUVEM : ESPERA_ERRO);
}

/** Meus mundos: a lista da nuvem, para abrir ou apagar. */
export function abrirMeusMundos(): void {
  const lugar = document.getElementById('janelas')!;
  const fechar = () => render(null, lugar);
  render(<MeusMundos fechar={fechar} />, lugar);
}

const tamanho = (b: number) => `${formatNumber(b / 1024 / 1024, { maximumFractionDigits: b < 1024 * 1024 ? 2 : 1 })} MB`;

function MeusMundos({ fechar }: { fechar: () => void }) {
  const [lista, setLista] = useState<{ documentos: Documento[]; usado: number; cota: number } | null>(null);
  const [erro, setErro] = useState('');
  const [, setV] = useState(0);
  useEffect(() => onLocaleChange(() => setV((n) => n + 1)), []);
  const carregar = async () => {
    const r = await ponte.listarDocumentos('maker');
    if (r.ok) setLista({ documentos: r.documentos, usado: r.usado, cota: r.cota });
    else setErro(erroNuvem(r.erro));
  };
  useEffect(() => void carregar(), []);

  const abrir = async (d: Documento) => {
    if (!(await guardarAntesDeTrocar())) return;
    const bytes = await ponte.abrirDocumento(d.id);
    if (!bytes) return setErro(erroNuvem('rede'));
    try {
      editor?.abrir(bytes);
      nuvemId = d.id;
      void guardarRascunho();
      fechar();
    } catch (e) {
      editor?.erro(e);
    }
  };
  const apagar = async (d: Documento) => {
    if (!confirm(t('cloud.confirmDelete', { name: d.nome }))) return;
    const r = await ponte.apagarDocumento(d.id);
    if (!r.ok) return setErro(erroNuvem(r.erro));
    if (nuvemId === d.id) nuvemId = null;
    void carregar();
  };

  return (
    <Janela titulo={t('cloud.title')} t={tn} fechar={fechar}>
      {!lista && !erro && <p class="ekf-dica">{t('cloud.loading')}</p>}
      {erro && (
        <p class="ekf-erro" role="alert">
          {erro}
        </p>
      )}
      {lista && lista.documentos.length === 0 && <p>{t('cloud.empty')}</p>}
      {lista && lista.documentos.length > 0 && (
        <ul class="mundos">
          {lista.documentos.map((d) => (
            <li key={d.id} class={d.id === nuvemId ? 'aberto' : ''}>
              <div>
                <strong>{d.nome}</strong>
                <small>
                  {t('cloud.updated', { date: new Date(d.atualizado_em.replace(' ', 'T')).toLocaleString(getLocale()) })} · {tamanho(d.tamanho)}
                </small>
              </div>
              <div class="ekf-linha">
                <button type="button" class="ekf-botao principal" onClick={() => void abrir(d)}>
                  {t('cloud.open')}
                </button>
                <button type="button" class="ekf-botao" onClick={() => void apagar(d)}>
                  {t('cloud.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {lista && <p class="ekf-dica">{t('cloud.usage', { used: tamanho(lista.usado), quota: tamanho(lista.cota) })}</p>}
    </Janela>
  );
}
