// SPDX-License-Identifier: MPL-2.0

/**
 * A casca do Maker na família Ekfrase (Preact; o editor continua em TypeScript puro, em main.ts):
 *
 * - idioma: o do Ekfrase manda (o mesmo em todo o site); o tradutor do Maker acompanha;
 * - o topo com os botões-ícone de todo app (passeio, idioma, tema, feedback, conta) e o rodapé;
 * - a ENTRADA: quem não entrou vê a tela inicial do app (computador, online, arquivos), que é o hall
 *   do modo normal. Quem entrou e chegou por link direto aparece no modo da última vez (modo jogo =
 *   as salas da torre do Maker no castelo; DEC-P048). O online exige a conta Ekfrase;
 * - a NUVEM: "Salvar" grava o mundo na conta (o mesmo documento é trocado nas vezes seguintes) e
 *   "Meus mundos" lista, abre e apaga. Exportar e Importar continuam com o arquivo .ekfr.
 */
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/atkinson-hyperlegible-next/latin-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700.css';
import '@ekfrase/nucleo/estilo/tokens.css';
import { aplicarTema, criarTradutor, iniciarIdioma, montarCatalogo, temaAtual } from '@ekfrase/nucleo';
import { AcoesTopo, EntradaApp, Janela, RodapeEkfrase, chegouAgora, ponte, voltarAoModoDoApp, type Documento } from '@ekfrase/interface';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import logoMaker from './img/logo-maker.png';
import { formatNumber, getLocale, isLocale, onLocaleChange, setLocale, t } from './i18n';

export const tr = criarTradutor(montarCatalogo(import.meta.glob('../../../locales/*/*.json', { eager: true, import: 'default' })));
const tn = tr.t;

/** O que a casca precisa do editor. */
export interface Editor {
  nome(): string;
  /** O arquivo .ekfr do mundo aberto (com a miniatura), sem baixar. */
  bytes(): Promise<Uint8Array>;
  abrir(bytes: Uint8Array): void;
  marcarSalvo(): void;
  sujo(): boolean;
  aviso(texto: string): void;
  erro(e: unknown): void;
}

let editor: Editor | null = null;
/** O documento da nuvem que está aberto (salvar de novo troca este). */
let nuvemId: number | null = null;

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
  return <RodapeEkfrase t={tn} compacto />;
}

function Entrada({ aoEntrar }: { aoEntrar: () => void }) {
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
  const abrirEditor = () => {
    render(null, capa);
    capa.hidden = true;
    document.body.classList.remove('so-entrada');
    dispatchEvent(new Event('resize'));
  };
  // no computador de quem desenvolve, sem o servidor do Ekfrase: o editor abre direto (sem conta e sem nuvem)
  if (await semServidor()) {
    abrirEditor();
    e.aviso(t('local.aviso'));
    return;
  }
  const veioDireto = chegouAgora() && !location.hash.replace(/^#\/?/, '');
  const estado = await ponte.eu();
  // com a conta e por link direto: o modo da última vez (DEC-P048); sem conta, a tela inicial (o hall do modo normal)
  if (!estado.carregando && estado.conta) {
    if (veioDireto && voltarAoModoDoApp('maker')) return;
    return abrirEditor();
  }
  // só a tela inicial: o editor sai de vista (e a página rola só a entrada)
  document.body.classList.add('so-entrada');
  render(<Entrada aoEntrar={abrirEditor} />, capa);
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

/** Salvar: grava o mundo aberto na nuvem. */
export async function salvarNaNuvem(): Promise<void> {
  if (!editor) return;
  const r = await ponte.salvarDocumento('maker', editor.nome(), await editor.bytes(), nuvemId ?? undefined);
  if (!r.ok) {
    if (r.erro === 'documento') {
      // apagado em outro aparelho: salva como novo
      nuvemId = null;
      return salvarNaNuvem();
    }
    return editor.aviso(erroNuvem(r.erro));
  }
  nuvemId = r.documento.id;
  editor.marcarSalvo();
  editor.aviso(t('cloud.saved', { name: r.documento.nome }));
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
    if (editor?.sujo() && !confirm(t('doc.confirmDiscard'))) return;
    const bytes = await ponte.abrirDocumento(d.id);
    if (!bytes) return setErro(erroNuvem('rede'));
    try {
      editor?.abrir(bytes);
      nuvemId = d.id;
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
