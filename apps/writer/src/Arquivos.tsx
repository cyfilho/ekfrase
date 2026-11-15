// SPDX-License-Identifier: MPL-2.0

/**
 * EXPORTAR e IMPORTAR (PLANO §2.1 item 6). Exportar: `.md` num arquivo só, `.zip` (uma pasta, uma
 * cena por arquivo), `.docx` (manuscrito padrão) e `.ekfr`. Importar: `.ekfr`, `.md` e `.zip`; tudo
 * entra como registros NOVOS (nunca escreve por cima). Um `.ekfr` de outro app da família: oferece
 * abrir lá (como o Maker faz, DEC-P053). E `#/abrir/<chave>`: um arquivo entregue por outro app.
 */
import { ACEITA, TIPO_MIDIA, enderecoDaEntrega, entregar, identificar, podeAbrir, receber } from '@ekfrase/arquivo';
import {
  TIPO_DOCX,
  exportarDocx,
  exportarEkfrHistoria,
  exportarEkfrIdeias,
  exportarHistoriaMd,
  exportarHistoriaZip,
  exportarIdeiasMd,
  exportarTudoZip,
  importarArquivo,
  nomeSeguro,
  type Escrita,
  type HistoriaCompleta,
} from '@ekfrase/writer-nucleo';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useComandos } from './comandos.ts';
import { useSessao, useVivo } from './estado.ts';
import { IconeBaixar } from '@ekfrase/interface';
import { IconeEntra } from './icones.tsx';
import { ir } from './rotas.ts';
import { t, tr, textoDoErro } from './textos.ts';
import { avisar, baixar, confirmar } from './ui.tsx';

const GRAVADO_POR = 'writer-web@0.1.0';
const TIPO_MD = 'text/markdown;charset=utf-8';
const TIPO_ZIP = 'application/zip';

/** O que aconteceu ao importar (para a tela dizer). */
type Resultado = { ok: true; historias: string[]; ideias: number } | { ok: false; texto: string } | { ok: 'outro-app' };

/** Importa um arquivo; se ele é de outro app da família, pergunta e manda para lá. */
export async function importarComCuidado(escrita: Escrita, nome: string, bytes: Uint8Array): Promise<Resultado> {
  const id = bytes[0] === 0x50 && bytes[1] === 0x4b ? identificar(bytes) : null;
  if (id?.ok) {
    const v = podeAbrir('writer', id.envelope);
    if (!v.abre && v.motivo === 'outro-app') {
      const app = tr.t(`nucleo.app.${v.app.id}`);
      if (await confirmar(t('writer.importar.outro-app', { app }), t('writer.importar.abrir-la', { app }))) {
        location.href = enderecoDaEntrega(v.app.endereco, await entregar(bytes, nome));
      }
      return { ok: 'outro-app' };
    }
    if (!v.abre && v.motivo === 'app-desconhecido') return { ok: false, texto: t('writer.importar.app-desconhecido', { app: id.envelope.app }) };
  }
  const r = await importarArquivo(escrita, nome, bytes);
  if (r.ok) return r;
  return { ok: false, texto: textoDoErro(r.erro, 'importar.erro') };
}

function contar(r: { historias: string[]; ideias: number }): string {
  return t('writer.importar.feito', { historias: r.historias.length, ideias: r.ideias });
}

export function Arquivos({ historia }: { historia?: string }) {
  const s = useSessao();
  const dados = useVivo(async (x) => ({ historias: await x.escrita.historias(), ideias: await x.escrita.ideias() }), []);
  const [escolhida, setEscolhida] = useState<string | null>(historia ?? null);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!escolhida && dados?.historias[0]) setEscolhida(historia ?? dados.historias[0].id);
  }, [dados]);

  useComandos(() => [{ id: 'importar', rotulo: t('writer.cmd.importar'), fazer: () => arquivo.current?.click() }]);

  const completa = async (): Promise<HistoriaCompleta | null> => {
    if (!escolhida) return null;
    try {
      return await s.escrita.completa(escolhida);
    } catch (e) {
      avisar(textoDoErro((e as { codigo?: string }).codigo), 'erro');
      return null;
    }
  };
  const nomeDe = (h: HistoriaCompleta) => nomeSeguro(h.historia.titulo) || t('writer.arquivo.nome-padrao');

  const exportar = async (formato: 'md' | 'zip' | 'docx' | 'ekfr') => {
    const h = await completa();
    if (!h) return;
    const nome = nomeDe(h);
    if (formato === 'md') baixar(exportarHistoriaMd(h), `${nome}.md`, TIPO_MD);
    else if (formato === 'zip') baixar(exportarHistoriaZip(h), `${nome}.zip`, TIPO_ZIP);
    else if (formato === 'docx') baixar(exportarDocx(h), `${nome}.docx`, TIPO_DOCX);
    else baixar(exportarEkfrHistoria(h, { gravadoPor: GRAVADO_POR, modificado: new Date().toISOString() }), `${nome}.ekfr`, TIPO_MIDIA);
    avisar(t('writer.exportar.pronto'));
  };

  const exportarTudo = async () => {
    const todas: HistoriaCompleta[] = [];
    for (const h of dados?.historias ?? []) todas.push(await s.escrita.completa(h.id));
    baixar(exportarTudoZip(todas, await s.escrita.ideias({ historia: null })), `${t('writer.arquivo.nome-tudo')}.zip`, TIPO_ZIP);
    avisar(t('writer.exportar.pronto'));
  };

  const exportarIdeias = async (formato: 'md' | 'ekfr') => {
    const ideias = await s.escrita.ideias();
    const nome = t('writer.arquivo.nome-ideias');
    if (formato === 'md') baixar(exportarIdeiasMd(ideias), `${nome}.md`, TIPO_MD);
    else baixar(exportarEkfrIdeias(ideias, { gravadoPor: GRAVADO_POR, modificado: new Date().toISOString() }), `${nome}.ekfr`, TIPO_MIDIA);
    avisar(t('writer.exportar.pronto'));
  };

  const importar = async (lista: FileList | null) => {
    if (!lista?.length) return;
    setImportando(true);
    setResultado(null);
    const criadas: string[] = [];
    let ideias = 0;
    const erros: string[] = [];
    for (const f of [...lista]) {
      const r = await importarComCuidado(s.escrita, f.name, new Uint8Array(await f.arrayBuffer()));
      if (r.ok === true) {
        criadas.push(...r.historias);
        ideias += r.ideias;
      } else if (r.ok === false) erros.push(`${f.name}: ${r.texto}`);
    }
    setImportando(false);
    if (arquivo.current) arquivo.current.value = '';
    const partes = [criadas.length || ideias ? contar({ historias: criadas, ideias }) : '', ...erros].filter(Boolean);
    setResultado(partes.join('\n') || null);
    if (criadas.length === 1 && !erros.length) ir({ tela: 'historia', id: criadas[0]! });
  };

  const temHistorias = !!dados?.historias.length;

  return (
    <div class="tela-arquivos" data-teste="tela-arquivos">
      <h1>{t('writer.arquivos.titulo')}</h1>

      <section class="painel-simples" aria-labelledby="titulo-exportar">
        <h2 id="titulo-exportar">
          <IconeBaixar tamanho={16} /> {t('writer.exportar.titulo')}
        </h2>
        {!temHistorias && dados && <p class="dica">{t('writer.exportar.nada')}</p>}
        {temHistorias && (
          <>
            <label>
              {t('writer.exportar.qual')}
              <select value={escolhida ?? ''} onChange={(e) => setEscolhida(e.currentTarget.value)} data-teste="exportar-historia">
                {dados!.historias.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.titulo || t('writer.historia.sem-titulo')}
                  </option>
                ))}
              </select>
            </label>
            <ul class="formatos">
              <li>
                <button type="button" class="botao" onClick={() => void exportar('md')} data-teste="exportar-md">
                  {t('writer.exportar.md')}
                </button>
                <small>{t('writer.exportar.md-dica')}</small>
              </li>
              <li>
                <button type="button" class="botao" onClick={() => void exportar('zip')} data-teste="exportar-zip">
                  {t('writer.exportar.zip')}
                </button>
                <small>{t('writer.exportar.zip-dica')}</small>
              </li>
              <li>
                <button type="button" class="botao" onClick={() => void exportar('docx')} data-teste="exportar-docx">
                  {t('writer.exportar.docx')}
                </button>
                <small>{t('writer.exportar.docx-dica')}</small>
              </li>
              <li>
                <button type="button" class="botao" onClick={() => void exportar('ekfr')} data-teste="exportar-ekfr">
                  {t('writer.exportar.ekfr')}
                </button>
                <small>{t('writer.exportar.ekfr-dica')}</small>
              </li>
            </ul>
            <div class="acoes-linha esquerda">
              <button type="button" class="botao pequeno" onClick={() => void exportarTudo()} data-teste="exportar-tudo">
                {t('writer.exportar.tudo')}
              </button>
            </div>
          </>
        )}
        {dados && dados.ideias.length > 0 && (
          <div class="acoes-linha esquerda">
            <button type="button" class="botao pequeno" onClick={() => void exportarIdeias('md')} data-teste="exportar-ideias-md">
              {t('writer.exportar.ideias-md')}
            </button>
            <button type="button" class="botao pequeno" onClick={() => void exportarIdeias('ekfr')} data-teste="exportar-ideias-ekfr">
              {t('writer.exportar.ideias-ekfr')}
            </button>
          </div>
        )}
      </section>

      <section class="painel-simples" aria-labelledby="titulo-importar">
        <h2 id="titulo-importar">
          <IconeEntra tamanho={16} /> {t('writer.importar.titulo')}
        </h2>
        <p>{t('writer.importar.explica')}</p>
        <label class="botao principal escolher-arquivo">
          {importando ? t('writer.importar.lendo') : t('writer.importar.escolher')}
          <input
            ref={arquivo}
            type="file"
            class="so-leitor"
            multiple
            accept={`${ACEITA},.md,.markdown,.txt,.zip,application/zip,text/markdown`}
            onChange={(e) => void importar(e.currentTarget.files)}
            disabled={importando}
            data-teste="importar-arquivo"
          />
        </label>
        {resultado && (
          <p class="resultado-importar" role="status" data-teste="resultado-importar">
            {resultado}
          </p>
        )}
      </section>
    </div>
  );
}

/** `#/abrir/<chave>`: o arquivo que outro app (ou o site) entregou para o Writer. */
export function Abrir({ chave }: { chave: string }) {
  const s = useSessao();
  const [msg, setMsg] = useState<string | null>(null);
  const feito = useRef(false);
  useEffect(() => {
    if (feito.current) return;
    feito.current = true;
    void (async () => {
      const e = await receber(chave).catch(() => null);
      if (!e) return setMsg(t('writer.abrir.venceu'));
      const r = await importarComCuidado(s.escrita, e.nome, e.bytes);
      if (r.ok === true) {
        avisar(contar(r));
        if (r.historias.length === 1) ir({ tela: 'historia', id: r.historias[0]! });
        else ir({ tela: r.historias.length ? 'estante' : 'ideias' });
      } else if (r.ok === false) setMsg(r.texto);
    })();
  }, [chave]);
  return (
    <div class="vazio" data-teste="tela-abrir">
      <p>{msg ?? t('writer.abrir.abrindo')}</p>
      {msg && (
        <a class="botao" href="#/">
          {t('writer.estante.ir')}
        </a>
      )}
    </div>
  );
}
