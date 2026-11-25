// SPDX-License-Identifier: MPL-2.0

/**
 * A TELA DO GRAVADOR (PLANO §8b): uma tela só, em passos. ① escolher o disco (só USB; o do computador
 * nunca aparece; travados com o motivo) e de onde vem a imagem → ② conferir o que será apagado e digitar
 * o nome do disco → ③ gravando (em palavras simples) → ④ pronto: como bootar por marca e ejetar.
 * Tudo pelo teclado (campos e botões de verdade; o foco vai para o título de cada passo) e com leitor
 * de tela (o progresso é uma região viva e uma barra com valor). O botão ↻ do topo abre as atualizações do próprio
 * Gravador (U2, `Atualizacoes.tsx`).
 */
import { aplicarTema, temaEfetivo } from '@ekfrase/nucleo';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import logo from '../../../../apps/writer/src/img/logo-writer.png';
import { GB, recusaDoPreparar, TAMANHO_PADRAO_GB, TAMANHOS_GB, tamanhosQueCabem } from '../src/nucleo/computador-regras.ts';
import { nomeNormalizado, type DiscoNaTela, type ImagemEscolhida, type InfoComputador, type InfoLancamento, type PonteGravador, type Progresso, type ResultadoPreparar, type ResultadoRemover } from '../src/ponte.ts';
import { AvisoDeAtualizacao, TelaAtualizacoes, useAtualizacoes } from './Atualizacoes.tsx';
import { t, tamanho, textoDoErro } from './textos.ts';

declare global {
  interface Window {
    gravador?: PonteGravador;
  }
}

const ponte = window.gravador!;
type Passo = 'disco' | 'confirmar' | 'gravando' | 'pronto' | 'erro' | 'remover' | 'removendo' | 'removido' | 'reiniciar' | 'reiniciando' | 'atualizacoes';
type Modo = 'criar' | 'atualizar';
const MARCAS = ['lenovo', 'dell', 'hp', 'acer', 'asus', 'msi', 'samsung', 'outra'] as const;

/** O foco vai ao título do passo novo JÁ no desenho (useLayoutEffect): com o useEffect, num computador lento, quem
 *  já tinha ido ao campo do nome perdia as letras seguintes quando o foco pulava para o título (CI do público, 15/11). */
function useFocoNoTitulo(passo: Passo) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
  }, [passo]);
  return ref;
}

function TrocarTema() {
  const [tema, setTema] = useState(temaEfetivo());
  const outro = tema === 'escuro' ? 'claro' : 'escuro';
  return (
    <button
      type="button"
      class="botao-icone"
      aria-label={t(outro === 'escuro' ? 'gravador.tema.escuro' : 'gravador.tema.claro')}
      title={t(outro === 'escuro' ? 'gravador.tema.escuro' : 'gravador.tema.claro')}
      onClick={() => {
        aplicarTema(outro);
        setTema(outro);
      }}
      data-teste="tema"
    >
      <span aria-hidden="true">{tema === 'escuro' ? '☀' : '☾'}</span>
    </button>
  );
}

function textoConteudo(d: DiscoNaTela): string {
  const c = d.conteudo;
  if (!c.particoes) return t('gravador.conteudo.vazio');
  const rotulos = c.rotulos.length ? c.rotulos.join(', ') : t('gravador.conteudo.sem-nome');
  if (c.usado != null && c.usado > 0) return t('gravador.conteudo.usado', { count: c.particoes, usado: tamanho(c.usado), rotulos });
  return t('gravador.conteudo.particoes', { count: c.particoes, rotulos });
}

function textoProgresso(p: Progresso | null): string {
  if (!p) return t('gravador.fase.conferir');
  if (p.fase === 'computador') return t(`gravador.pc.etapa.${p.etapa === 'preparar' || p.etapa === 'copiar' || p.etapa === 'entrada' || p.etapa === 'remover' || p.etapa === 'devolver' || p.etapa === 'reiniciar' ? p.etapa : 'preparar'}`);
  const pct = p.total ? Math.floor(((p.feito ?? 0) / p.total) * 100) : null;
  if (p.fase === 'baixar' && p.total) return t('gravador.fase.baixar-quanto', { feito: tamanho(p.feito ?? 0), total: tamanho(p.total) });
  if ((p.fase === 'gravar' || p.fase === 'verificar') && pct != null) return t(`gravador.fase.${p.fase}-quanto`, { pct });
  return t(`gravador.fase.${p.fase}`);
}

export function App() {
  const [passo, setPasso] = useState<Passo>('disco');
  const [discos, setDiscos] = useState<DiscoNaTela[] | null>(null);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>('criar');
  const [lancamento, setLancamento] = useState<InfoLancamento | null>(null);
  const [arquivo, setArquivo] = useState<ImagemEscolhida>(null);
  const [usarArquivo, setUsarArquivo] = useState(false);
  const [conferindoArquivo, setConferindoArquivo] = useState(false);
  const [limitar, setLimitar] = useState(false);
  const [limiteGb, setLimiteGb] = useState('32');
  const [confirmacao, setConfirmacao] = useState('');
  const [frase, setFrase] = useState('');
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState('');
  const [dadosCriados, setDadosCriados] = useState<string | null>(null);
  const [ejetado, setEjetado] = useState<'nao' | 'ok' | 'falhou'>('nao');
  const [avisoFechar, setAvisoFechar] = useState(false);
  // o disco deste computador (PLANO §8c): "Também preparar este computador" e "Remover o Writer OS deste computador"
  const [pc, setPc] = useState<InfoComputador | null>(null);
  const [preparar, setPreparar] = useState(false);
  const [prepararGb, setPrepararGb] = useState<number>(TAMANHO_PADRAO_GB);
  const [preparado, setPreparado] = useState<ResultadoPreparar | null>(null);
  const [copiarTextos, setCopiarTextos] = useState(true);
  const [removido, setRemovido] = useState<Extract<ResultadoRemover, { ok: true }> | null>(null);
  // "Reiniciar no Writer OS": a contagem (null = esperando a permissão de administrador) e o aviso de que cancelou
  const [contagem, setContagem] = useState<number | null>(null);
  const [reinicioCancelado, setReinicioCancelado] = useState(false);
  const titulo = useFocoNoTitulo(passo);
  // as atualizações do próprio Gravador (U2): a tela do botão ↻ e o aviso de baixo
  const at = useAtualizacoes();
  const [antesDasAtualizacoes, setAntesDasAtualizacoes] = useState<Passo>('disco');
  const trabalhando = passo === 'gravando' || passo === 'removendo';
  useEffect(() => void ponte.computador().then(setPc), []);
  const recusaPc = pc ? recusaDoPreparar(pc, prepararGb) : null;
  // o tamanho escolhido não cabe mais: o maior que cabe
  useEffect(() => {
    if (!pc) return;
    const cabem = tamanhosQueCabem(pc);
    if (cabem.length && !cabem.includes(prepararGb)) setPrepararGb(cabem.includes(TAMANHO_PADRAO_GB) ? TAMANHO_PADRAO_GB : cabem[cabem.length - 1]!);
  }, [pc]);

  // a lista de discos, de novo a cada 3 s enquanto a pessoa escolhe
  useEffect(() => {
    if (passo !== 'disco') return;
    let vivo = true;
    const ler = () =>
      ponte.discos().then((l) => {
        if (vivo) setDiscos(l);
      });
    void ler();
    const i = setInterval(ler, 3000);
    return () => {
      vivo = false;
      clearInterval(i);
    };
  }, [passo]);

  useEffect(() => {
    void ponte.lancamento().then(setLancamento);
    const a = ponte.aoProgresso(setProgresso);
    const b = ponte.aoTentarFechar(() => setAvisoFechar(true));
    return () => {
      a();
      b();
    };
  }, []);

  const disco = discos?.find((d) => d.id === escolhido) ?? null;
  // o disco escolhido saiu ou ficou travado: a escolha some
  useEffect(() => {
    if (escolhido && discos && (!disco || disco.recusa)) setEscolhido(null);
  }, [discos, escolhido, disco]);
  // o modo padrão segue o disco: num Writer OS, Atualizar (os textos ficam); nos outros, só Criar
  useEffect(() => {
    if (disco) setModo(disco.writerOS ? 'atualizar' : 'criar');
  }, [disco?.id, disco?.writerOS]);

  const imagemOk = usarArquivo ? arquivo?.ok === true : lancamento?.ok === true;
  const semLacre = usarArquivo && arquivo?.ok === true && arquivo.lacre === 'ausente';
  const fraseOk = !semLacre || nomeNormalizado(frase) === nomeNormalizado(t('gravador.semlacre.frase'));
  const nomeOk = !!disco && nomeNormalizado(confirmacao) === nomeNormalizado(disco.nome);
  const limiteOk = !limitar || (Number(limiteGb) >= 1 && Number.isFinite(Number(limiteGb)));

  async function escolherArquivo() {
    setConferindoArquivo(true);
    try {
      const r = await ponte.escolherImagem();
      if (r) {
        setArquivo(r);
        setUsarArquivo(true);
      }
    } finally {
      setConferindoArquivo(false);
      setProgresso(null);
    }
  }

  async function gravar() {
    if (!disco) return;
    setPasso('gravando');
    setProgresso(null);
    setErro(null);
    const r = await ponte.gravar({
      modo,
      disco: disco.id,
      confirmacao,
      origem: usarArquivo ? 'arquivo' : 'release',
      semLacreConfirmado: semLacre && fraseOk,
      limiteGb: modo === 'criar' && limitar ? Number(limiteGb) : null,
      prepararGb: preparar && !recusaPc ? prepararGb : null,
    });
    setAvisoFechar(false);
    if (r.ok) {
      setPreparado(r.preparar ?? null);
      if (r.preparar?.ok) void ponte.computador().then(setPc);
      setDadosCriados(r.dados);
      setEjetado('nao');
      setPasso('pronto');
    } else {
      setErro(r.erro);
      setDetalhe(r.detalhe ?? '');
      setPasso('erro');
    }
  }

  async function remover() {
    setPasso('removendo');
    setProgresso({ fase: 'permissao' });
    setErro(null);
    const r = await ponte.remover(copiarTextos);
    if (r.ok) {
      setRemovido(r);
      setPasso('removido');
      void ponte.computador().then(setPc);
    } else {
      setErro(r.erro === 'permissao-recusada' || r.erro === 'sem-pkexec' ? r.erro : `pc-${r.erro}`);
      setDetalhe(r.detalhe ?? '');
      setPasso('erro');
    }
  }

  async function reiniciar() {
    setPasso('reiniciando');
    setContagem(null);
    setProgresso({ fase: 'permissao' });
    setErro(null);
    setReinicioCancelado(false);
    const r = await ponte.reiniciar();
    if (r.ok) {
      setContagem(r.segundos);
    } else {
      setErro(r.erro === 'permissao-recusada' || r.erro === 'sem-pkexec' ? r.erro : `pc-${r.erro}`);
      setDetalhe(r.detalhe ?? '');
      setPasso('erro');
    }
  }

  // a contagem do "Reiniciar no Writer OS": um segundo por vez, até zero (o Windows reinicia sozinho)
  useEffect(() => {
    if (passo !== 'reiniciando' || contagem === null || contagem <= 0) return;
    const i = setTimeout(() => setContagem((c) => (c === null ? c : c - 1)), 1000);
    return () => clearTimeout(i);
  }, [passo, contagem]);

  async function cancelarReinicio() {
    await ponte.cancelarReinicio();
    setContagem(null);
    setReinicioCancelado(true);
    setPasso('disco');
  }

  function recomecar() {
    setPasso('disco');
    setPreparado(null);
    setEscolhido(null);
    setConfirmacao('');
    setFrase('');
    setErro(null);
    setProgresso(null);
  }

  const passos = (
    <ol class="passos" aria-label={t('gravador.passos')}>
      {(['disco', 'confirmar', 'gravando'] as const).map((p, i) => {
        const atual = passo === p || (p === 'gravando' && (passo === 'pronto' || passo === 'erro'));
        return (
          <li key={p} class={atual ? 'atual' : ''} aria-current={atual ? 'step' : undefined}>
            <span class="numero" aria-hidden="true">
              {i + 1}
            </span>
            {t(`gravador.passo.${p}`)}
          </li>
        );
      })}
    </ol>
  );

  return (
    <div class="gravador">
      <header class="topo-gravador">
        <img src={logo} alt="" width={40} height={40} />
        <div>
          <p class="nome">{t('gravador.titulo')}</p>
          <p class="sub">{t('gravador.subtitulo')}</p>
        </div>
        {at && !trabalhando && passo !== 'atualizacoes' && (
          <button
            type="button"
            class="botao-icone"
            aria-label={t('gravador.atualizacoes.abrir')}
            title={t('gravador.atualizacoes.abrir')}
            onClick={() => {
              setAntesDasAtualizacoes(passo);
              setPasso('atualizacoes');
            }}
            data-teste="ir-atualizacoes"
          >
            <span aria-hidden="true">↻</span>
          </button>
        )}
        <TrocarTema />
      </header>
      {passo !== 'remover' && passo !== 'removendo' && passo !== 'removido' && passo !== 'reiniciar' && passo !== 'reiniciando' && passo !== 'atualizacoes' && passos}

      {passo === 'atualizacoes' && at && (
        <main data-teste="passo-atualizacoes">
          <h1 ref={titulo} tabIndex={-1}>
            {t('gravador.atualizacoes.titulo')}
          </h1>
          <TelaAtualizacoes e={at} voltar={() => setPasso(antesDasAtualizacoes)} />
        </main>
      )}

      {passo === 'disco' && (
        <main data-teste="passo-disco">
          <h1 ref={titulo} tabIndex={-1}>
            {t('gravador.disco.titulo')}
          </h1>
          <fieldset class="lista-discos">
            <legend>{t('gravador.disco.legenda')}</legend>
            {discos === null && <p>{t('gravador.disco.procurando')}</p>}
            {discos?.length === 0 && (
              <p class="vazio" data-teste="sem-discos">
                {t('gravador.disco.nenhum')}
              </p>
            )}
            {discos?.map((d) => (
              <label key={d.id} class={`disco ${d.recusa ? 'travado' : ''} ${escolhido === d.id ? 'escolhido' : ''}`} data-teste={`disco-${d.id}`}>
                <input type="radio" name="disco" value={d.id} checked={escolhido === d.id} disabled={!!d.recusa} onChange={() => {
                  setEscolhido(d.id);
                  setModo(d.writerOS ? 'atualizar' : 'criar');
                  setConfirmacao('');
                }} />
                <span class={`icone-disco ${d.tipo}`} aria-hidden="true" />
                <span class="texto-disco">
                  <strong>{d.nome}</strong>
                  <span>
                    {tamanho(d.tamanho)} · {t(`gravador.tipo.${d.tipo}`)}
                    {d.writerOS ? ` · ${t('gravador.disco.ja-writer')}` : ''}
                  </span>
                  {d.recusa && <span class="motivo">{t(`gravador.recusa.${d.recusa}`)}</span>}
                </span>
              </label>
            ))}
          </fieldset>
          <p class="nota">{t('gravador.disco.nunca-interno')}</p>

          {disco?.writerOS && (
            <fieldset class="modo">
              <legend>{t('gravador.modo.legenda')}</legend>
              <label>
                <input type="radio" name="modo" checked={modo === 'atualizar'} onChange={() => setModo('atualizar')} data-teste="modo-atualizar" />
                <span>
                  <strong>{t('gravador.modo.atualizar')}</strong> {t('gravador.modo.atualizar.texto')}
                </span>
              </label>
              <label>
                <input type="radio" name="modo" checked={modo === 'criar'} onChange={() => setModo('criar')} data-teste="modo-criar" />
                <span>
                  <strong>{t('gravador.modo.criar')}</strong> {t('gravador.modo.criar.texto')}
                </span>
              </label>
            </fieldset>
          )}

          <section class="imagem" aria-labelledby="titulo-imagem">
            <h2 id="titulo-imagem">{t('gravador.imagem.titulo')}</h2>
            {!usarArquivo && lancamento === null && <p>{t('gravador.imagem.procurando')}</p>}
            {!usarArquivo && lancamento?.ok === true && <p data-teste="imagem-release">{t('gravador.imagem.release', { versao: lancamento.versao, tamanho: tamanho(lancamento.tamanho) })}</p>}
            {!usarArquivo && lancamento?.ok === false && (
              <p class="aviso" data-teste="imagem-sem-release">
                {t(lancamento.erro === 'sem-rede' ? 'gravador.imagem.sem-rede' : 'gravador.imagem.sem-release')}
              </p>
            )}
            {usarArquivo && arquivo?.ok === true && (
              <p data-teste="imagem-arquivo">
                {t('gravador.imagem.arquivo', { nome: arquivo.nome })} {arquivo.lacre === 'ekfrase' ? <span class="lacre-ok">{t('gravador.imagem.com-lacre')}</span> : <span class="lacre-sem">{t('gravador.imagem.sem-lacre')}</span>}
              </p>
            )}
            {arquivo?.ok === false && (
              <p class="erro" role="alert" data-teste="imagem-erro">
                {textoDoErro(arquivo.erro)}
              </p>
            )}
            {conferindoArquivo && <p aria-live="polite">{textoProgresso(progresso)}</p>}
            <div class="acoes-linha">
              <button type="button" class="botao" onClick={() => void escolherArquivo()} disabled={conferindoArquivo} data-teste="ja-tenho">
                {t('gravador.imagem.ja-tenho')}
              </button>
              {usarArquivo && lancamento?.ok === true && (
                <button type="button" class="botao" onClick={() => setUsarArquivo(false)} data-teste="usar-release">
                  {t('gravador.imagem.usar-release')}
                </button>
              )}
            </div>
          </section>

          {pc?.disponivel && (
            <section class="computador" aria-labelledby="titulo-computador" data-teste="computador">
              <h2 id="titulo-computador">{t('gravador.pc.titulo')}</h2>
              {pc.writer ? (
                <>
                  <p>{t('gravador.pc.tem-writer')}</p>
                  <div class="acoes-linha">
                    <button type="button" class="botao" onClick={() => setPasso('remover')} data-teste="ir-remover">
                      {t('gravador.remover.botao')}
                    </button>
                    <button type="button" class="botao" onClick={() => setPasso('reiniciar')} data-teste="ir-reiniciar">
                      {t('gravador.reiniciar.botao')}
                    </button>
                  </div>
                  {reinicioCancelado && (
                    <p class="nota" data-teste="reinicio-cancelado" aria-live="polite">
                      {t('gravador.reiniciar.cancelado')}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <label class="marcar">
                    <input type="checkbox" checked={preparar} onChange={(e) => setPreparar((e.target as HTMLInputElement).checked)} data-teste="preparar" />
                    <span>{t('gravador.pc.preparar')}</span>
                  </label>
                  {preparar && recusaPc && (
                    <p class="aviso" data-teste="preparar-recusa">
                      {t(`gravador.pc.recusa.${recusaPc}`)}
                    </p>
                  )}
                  {preparar && !recusaPc && pc.windows && (
                    <>
                      <div class="barra-pc" aria-hidden="true">
                        <span class="pc-windows" style={{ flexGrow: Math.max(1, pc.windows.tamanho - prepararGb * GB) }} />
                        <span class="pc-writer" style={{ flexGrow: prepararGb * GB }} />
                      </div>
                      <p data-teste="preparar-fica">{t('gravador.pc.fica', { windows: tamanho(pc.windows.livre - prepararGb * GB), writer: prepararGb })}</p>
                      <fieldset class="tamanho-pc">
                        <legend>{t('gravador.pc.tamanho')}</legend>
                        {TAMANHOS_GB.map((g) => (
                          <label key={g}>
                            <input type="radio" name="tamanho-pc" checked={prepararGb === g} disabled={!tamanhosQueCabem(pc).includes(g)} onChange={() => setPrepararGb(g)} data-teste={`preparar-${g}`} />
                            <span>{t('gravador.pc.gb', { n: g })}</span>
                          </label>
                        ))}
                      </fieldset>
                      <p class="nota">{t('gravador.pc.nada-apaga')}</p>
                    </>
                  )}
                </>
              )}
            </section>
          )}

          <div class="acoes">
            <button type="button" class="botao principal" disabled={!disco || !imagemOk} onClick={() => setPasso('confirmar')} data-teste="continuar">
              {t('gravador.continuar')}
            </button>
          </div>
        </main>
      )}

      {passo === 'remover' && (
        <main data-teste="passo-remover">
          <h1 ref={titulo} tabIndex={-1}>
            {t('gravador.remover.titulo')}
          </h1>
          <p>{t('gravador.remover.texto')}</p>
          <label class="marcar">
            <input type="checkbox" checked={copiarTextos} onChange={(e) => setCopiarTextos((e.target as HTMLInputElement).checked)} data-teste="remover-copiar" />
            <span>{t('gravador.remover.copiar')}</span>
          </label>
          {!copiarTextos && (
            <p class="perigo" data-teste="remover-sem-copia">
              {t('gravador.remover.sem-copia')}
            </p>
          )}
          <p class="nota">{t('gravador.remover.windows-fica')}</p>
          <div class="acoes">
            <button type="button" class="botao" onClick={() => setPasso('disco')} data-teste="remover-voltar">
              {t('gravador.voltar')}
            </button>
            <button type="button" class="botao principal perigoso" onClick={() => void remover()} data-teste="remover">
              {t('gravador.remover.confirmar')}
            </button>
          </div>
        </main>
      )}

      {passo === 'reiniciar' && (
        <main data-teste="passo-reiniciar">
          <h1 ref={titulo} tabIndex={-1}>
            {t('gravador.reiniciar.titulo')}
          </h1>
          <p>{t('gravador.reiniciar.texto')}</p>
          <p class="perigo" data-teste="reiniciar-salve">
            {t('gravador.reiniciar.salve')}
          </p>
          <p class="nota">{t('gravador.reiniciar.uma-vez')}</p>
          <div class="acoes">
            <button type="button" class="botao" onClick={() => setPasso('disco')} data-teste="reiniciar-voltar">
              {t('gravador.cancelar')}
            </button>
            <button type="button" class="botao principal" onClick={() => void reiniciar()} data-teste="reiniciar">
              {t('gravador.reiniciar.confirmar')}
            </button>
          </div>
        </main>
      )}

      {passo === 'reiniciando' && (
        <main data-teste="passo-reiniciando">
          <h1 ref={titulo} tabIndex={-1}>
            {t('gravador.reiniciar.reiniciando')}
          </h1>
          {contagem === null ? (
            <p aria-live="polite" class="fase" data-teste="fase">
              {progresso?.fase === 'permissao' ? t('gravador.fase.permissao') : textoProgresso(progresso)}
            </p>
          ) : (
            <>
              <p aria-live="polite" class="fase" data-teste="reiniciar-contagem">
                {t('gravador.reiniciar.contagem', { count: contagem })}
              </p>
              <div class="acoes">
                <button type="button" class="botao principal" onClick={() => void cancelarReinicio()} data-teste="reiniciar-cancelar">
                  {t('gravador.cancelar')}
                </button>
              </div>
            </>
          )}
        </main>
      )}

      {passo === 'removendo' && (
        <main data-teste="passo-removendo">
          <h1 ref={titulo} tabIndex={-1}>
            {t('gravador.remover.removendo')}
          </h1>
          <p aria-live="polite" class="fase" data-teste="fase">
            {progresso?.fase === 'permissao' ? t('gravador.fase.permissao') : textoProgresso(progresso)}
          </p>
          <p class="nota">{t('gravador.remover.nao-desligue')}</p>
        </main>
      )}

      {passo === 'removido' && removido && (
        <main data-teste="passo-removido">
          <h1 ref={titulo} tabIndex={-1}>
            {t('gravador.remover.pronto')}
          </h1>
          {removido.copiado ? <p data-teste="removido-copiado">{t('gravador.remover.copiado', { pasta: removido.copiado })}</p> : <p>{t('gravador.remover.nao-copiado')}</p>}
          <p data-teste={`removido-${removido.espaco}`}>{t(removido.espaco === 'devolvido' ? 'gravador.remover.devolvido' : 'gravador.remover.solto')}</p>
          <div class="acoes">
            <button type="button" class="botao principal" onClick={recomecar} data-teste="recomecar">
              {t('gravador.recomecar')}
            </button>
          </div>
        </main>
      )}

      {passo === 'confirmar' && disco && (
        <main data-teste="passo-confirmar">
          <h1 ref={titulo} tabIndex={-1}>
            {t(modo === 'criar' ? 'gravador.confirmar.titulo-criar' : 'gravador.confirmar.titulo-atualizar')}
          </h1>
          <div class="cartao-disco">
            <strong>{disco.nome}</strong> · {tamanho(disco.tamanho)}
            <p data-teste="conteudo">{textoConteudo(disco)}</p>
          </div>
          {modo === 'criar' ? (
            <>
              <p class="perigo" data-teste="vai-apagar">
                {t('gravador.confirmar.apaga')}
              </p>
              <p class="nota">{t('gravador.confirmar.so-writer')}</p>
              <fieldset class="espaco">
                <legend>{t('gravador.espaco.legenda')}</legend>
                <label>
                  <input type="radio" name="espaco" checked={!limitar} onChange={() => setLimitar(false)} />
                  <span>{t('gravador.espaco.tudo')}</span>
                </label>
                <label>
                  <input type="radio" name="espaco" checked={limitar} onChange={() => setLimitar(true)} data-teste="espaco-limitar" />
                  <span>{t('gravador.espaco.limitar')}</span>
                </label>
                {limitar && (
                  <label class="campo-limite">
                    <span>{t('gravador.espaco.gb')}</span>
                    <input type="number" min={1} step={1} inputMode="numeric" value={limiteGb} onInput={(e) => setLimiteGb((e.target as HTMLInputElement).value)} data-teste="espaco-gb" />
                  </label>
                )}
              </fieldset>
            </>
          ) : (
            <p class="nota" data-teste="vai-atualizar">
              {t('gravador.confirmar.atualiza')}
            </p>
          )}

          {semLacre && (
            <div class="alerta-vermelho" role="alert" data-teste="aviso-sem-lacre">
              <p>
                <strong>{t('gravador.semlacre.titulo')}</strong> {t('gravador.semlacre.texto')}
              </p>
              <label>
                <span>{t('gravador.semlacre.digite', { frase: t('gravador.semlacre.frase') })}</span>
                <input type="text" value={frase} onInput={(e) => setFrase((e.target as HTMLInputElement).value)} autoComplete="off" spellcheck={false} data-teste="frase-sem-lacre" />
              </label>
            </div>
          )}

          <label class="campo-confirmar">
            <span>
              {t('gravador.confirmar.digite')} <strong class="nome-disco">{disco.nome}</strong>
            </span>
            <input type="text" value={confirmacao} onInput={(e) => setConfirmacao((e.target as HTMLInputElement).value)} autoComplete="off" spellcheck={false} data-teste="confirmar-nome" />
          </label>

          <div class="acoes">
            <button type="button" class="botao" onClick={() => setPasso('disco')} data-teste="voltar">
              {t('gravador.voltar')}
            </button>
            <button type="button" class={`botao principal ${modo === 'criar' ? 'perigoso' : ''}`} disabled={!nomeOk || !fraseOk || !limiteOk} onClick={() => void gravar()} data-teste="gravar">
              {t(modo === 'criar' ? 'gravador.criar' : 'gravador.atualizar')}
            </button>
          </div>
        </main>
      )}

      {passo === 'gravando' && (
        <main data-teste="passo-gravando">
          <h1 ref={titulo} tabIndex={-1}>
            {t(modo === 'criar' ? 'gravador.gravando.titulo-criar' : 'gravador.gravando.titulo-atualizar')}
          </h1>
          <p aria-live="polite" class="fase" data-teste="fase">
            {textoProgresso(progresso)}
          </p>
          <div class="barra" role="progressbar" aria-label={textoProgresso(progresso)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progresso?.total ? Math.floor(((progresso.feito ?? 0) / progresso.total) * 100) : undefined}>
            <span style={{ width: `${progresso?.total ? Math.min(100, ((progresso.feito ?? 0) / progresso.total) * 100) : 0}%` }} />
          </div>
          <p class="nota">{t('gravador.gravando.nao-tire')}</p>
          {avisoFechar && (
            <p class="aviso" role="alert">
              {t('gravador.gravando.nao-feche')}
            </p>
          )}
          {progresso?.fase === 'baixar' && (
            <div class="acoes">
              <button type="button" class="botao" onClick={() => void ponte.cancelar()} data-teste="cancelar">
                {t('gravador.cancelar')}
              </button>
            </div>
          )}
        </main>
      )}

      {passo === 'erro' && (
        <main data-teste="passo-erro">
          <h1 ref={titulo} tabIndex={-1}>
            {t('gravador.erro.titulo')}
          </h1>
          <p class="erro" role="alert" data-teste="erro" data-detalhe={detalhe}>
            {textoDoErro(erro ?? 'escrita')}
          </p>
          <div class="acoes">
            <button type="button" class="botao principal" onClick={recomecar} data-teste="recomecar">
              {t('gravador.recomecar')}
            </button>
          </div>
        </main>
      )}

      {passo === 'pronto' && (
        <main data-teste="passo-pronto">
          <h1 ref={titulo} tabIndex={-1}>
            {t(modo === 'criar' ? 'gravador.pronto.titulo-criar' : 'gravador.pronto.titulo-atualizar')}
          </h1>
          <p>{t('gravador.pronto.texto')}</p>
          {modo === 'criar' && !dadosCriados && <p class="nota">{t('gravador.pronto.dados-no-boot')}</p>}
          {preparado?.ok === true && (
            <p class="lacre-ok" data-teste="preparado">
              {t('gravador.pc.preparado', { livre: tamanho(preparado.livre) })}
            </p>
          )}
          {preparado?.ok === false && (
            <p class="aviso" role="alert" data-teste="preparar-falhou">
              {preparado.erro === 'nao-encolhe' ? t('gravador.pc.erro.nao-encolhe', { maximo: tamanho(preparado.maximo ?? 0) }) : textoDoErro(`pc-${preparado.erro}`)}
            </p>
          )}
          <h2>{t('gravador.boot.titulo')}</h2>
          <ul class="marcas" data-teste="marcas">
            {MARCAS.map((m) => (
              <li key={m}>
                <strong>{t(`gravador.boot.${m}`)}</strong> {t(`gravador.boot.${m}.tecla`)}
              </li>
            ))}
          </ul>
          <p class="nota">{t('gravador.boot.secure')}</p>
          {ejetado === 'ok' && (
            <p class="lacre-ok" role="status" data-teste="ejetado">
              {t('gravador.ejetar.ok')}
            </p>
          )}
          {ejetado === 'falhou' && (
            <p class="aviso" role="alert">
              {t('gravador.ejetar.falhou')}
            </p>
          )}
          <div class="acoes">
            <button type="button" class="botao" onClick={recomecar} data-teste="outro">
              {t('gravador.outro')}
            </button>
            <button
              type="button"
              class="botao principal"
              disabled={ejetado === 'ok'}
              onClick={() =>
                void ponte.ejetar(escolhido ?? '').then((r) => {
                  setEjetado(r.ok ? 'ok' : 'falhou');
                })
              }
              data-teste="ejetar"
            >
              {t('gravador.ejetar')}
            </button>
          </div>
        </main>
      )}
      {!trabalhando && passo !== 'atualizacoes' && <AvisoDeAtualizacao e={at} />}
    </div>
  );
}
