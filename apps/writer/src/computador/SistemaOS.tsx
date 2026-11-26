// SPDX-License-Identifier: MPL-2.0

/**
 * As telas do WRITER OS (o pendrive, fase 3; PLANO §6.3, §6.4, §4.5). Só aparecem quando a casca
 * abriu dentro da imagem (`casca.os`); no computador e no site, nada disto existe.
 *
 * - `PortaoOS`: o primeiro uso, nesta ordem: idioma → teclado → fuso → onde guardar (só se não há a
 *   partição de dados) → senha → espelho `.md` → Wi-Fi ("pular") → o app (que mostra a conta, com
 *   "Escrever sem conta"). Nos usos seguintes: senha → app.
 * - `FaixaMemoria`: a faixa âmbar fixa quando os textos estão na memória (somem ao desligar).
 * - `PainelSistema` (Ctrl+Alt+S e o botão de ligar no topo): Wi-Fi, bateria, brilho, teclado, fuso,
 *   servidor, pendrives, desligar, reiniciar e "Sobre". Nada mais (§6.4).
 *
 * Toda tela tem `data-teste` (o agente de teste conta qual está aberta) e o foco começa na opção
 * padrão: Enter segue em frente (o CI digita pelo QMP do QEMU).
 */
import { INSTALAR_MAXIMO, INSTALAR_MINIMO, nomeConfere, nomeDoDisco, tipoDaParte, type Bateria, type Cabo, type Conectividade, type DiscoInterno, type DiscoUSB, type InfoInstalacao, type MarcaComputador, type PassoInstalar, type PonteSistema, type RedeWifi, type RespostaCasca, type SobreOS } from '@ekfrase/writer-nucleo';
import { FormConta, IconeEngrenagem, Janela, ponte, useConta } from '@ekfrase/interface';
import type { ComponentChildren, TargetedKeyboardEvent } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { IconeLigar } from '../icones.tsx';
import { teclaDe } from '../comandos.ts';
import { NivelDeBateria } from '../bateria.tsx';
import { aoPedido, pedir } from '../pedidos.ts';
import { t, tr } from '../textos.ts';
import { Avisos, Camada, Confirmacoes, avisar, confirmar, focaveis } from '../ui.tsx';
import { atualizacoesDaCasca, ParteAtualizacoes } from './Atualizacoes.tsx';
import { casca, gravarAgora, mudarEstado, mudarEstadoOS, noOS, sistemaOS, useEstadoCasca, useEstadoOS } from './casca.ts';
import { EscolhaServidor, Moldura, PerguntaEspelho, Senha, textoDoErroCasca } from './Telas.tsx';
import { CadeadoDaVpn, ParteVpn, useVpnLigada } from './VpnOS.tsx';

/** O sistema (só é usado com `noOS`; cada tela é desenhada só dentro do `PortaoOS`). */
const os = sistemaOS as PonteSistema;

const nomeDoFuso = (id: string): string => id.replace(/_/g, ' ').replace(/\//g, ' / ');

export const tamanho = (bytes: number): string => (bytes >= 1024 ** 3 ? `${tr.numero(Math.round(bytes / 1024 ** 3))} GB` : `${tr.numero(Math.max(1, Math.round(bytes / 1024 ** 2)))} MB`);

// ---------- o portão do Writer OS ----------

export function PortaoOS({ children }: { children: ComponentChildren }) {
  const estado = useEstadoCasca();
  const osEstado = useEstadoOS();
  const [escolhendo, setEscolhendo] = useState(false);
  const instalando = useInstalarAberto();
  if (!estado || !osEstado) return <div class="tela-cheia-carregando" aria-busy="true" />;
  // instalou no computador: o cofre fechou, só falta desligar e tirar o pendrive (PLANO §8c)
  if (osEstado.instalado) return <Instalado />;
  // a tela de instalar ocupa tudo (o app sai antes: a folha aberta grava e a sessão fecha)
  if (instalando && osEstado.boot === 'usb') return <TelaInstalar voltar={() => abrirInstalar(false)} />;
  if (!osEstado.idioma) return <EscolherIdioma />;
  // ligou pelo pendrive e ainda não respondeu: "Como você quer usar o Writer OS?" (pedido do Alcy, 18/11)
  if (osEstado.boot === 'usb' && !osEstado.usoVisto) return <EscolherUso />;
  if (!osEstado.teclado) return <EscolherTeclado />;
  if (!osEstado.fuso) return <EscolherFuso />;
  if (!estado.aberta) {
    // sem a partição de dados: outro pendrive, ou a memória (§4.5)
    if (!estado.destino || !estado.pasta || escolhendo) return <OndeGuardar motivo={osEstado.motivo} aoEscolher={() => setEscolhendo(false)} />;
    return (
      <Senha
        nova={!estado.temSenha}
        pasta={estado.pasta}
        aviso={t('writer.os.senha.aviso')}
        {...(estado.destino === 'pendrive' ? {} : { trocar: () => setEscolhendo(true) })}
      />
    );
  }
  if (estado.espelho === 'perguntar') return <PerguntaEspelho />;
  if (!osEstado.wifiVisto) return <WifiPrimeiroUso />;
  return (
    <>
      {estado.destino === 'ram' && <FaixaMemoria />}
      {children}
    </>
  );
}

/** Uma lista de escolhas: a atual (ou a primeira) começa com o foco; Enter escolhe. */
function Escolhas<T extends string>({ opcoes, atual, nome, escolher, teste, lang }: { opcoes: readonly T[]; atual: T | null; nome: (o: T) => string; escolher: (o: T) => void; teste: string; lang?: (o: T) => string }) {
  const padrao = atual && opcoes.includes(atual) ? atual : opcoes[0];
  return (
    <div class="acoes-coluna lista-os">
      {opcoes.map((o) => (
        <button
          key={o}
          type="button"
          class={o === padrao ? 'botao principal' : 'botao'}
          onClick={() => escolher(o)}
          {...(o === padrao ? { 'data-foco-inicial': true } : {})}
          {...(lang ? { lang: lang(o) } : {})}
          data-teste={`${teste}-${o}`}
        >
          {nome(o)}
        </button>
      ))}
    </div>
  );
}

function EscolherIdioma() {
  const idiomas = tr.idiomas();
  const escolher = async (codigo: string) => {
    tr.trocarIdioma(codigo);
    mudarEstadoOS(await os.usarIdioma(codigo));
  };
  return (
    <Moldura titulo={t('writer.os.idioma.titulo')} teste="os-idioma" foco="idioma">
      <p>{t('writer.os.boas-vindas')}</p>
      <Escolhas
        opcoes={idiomas.map((i) => i.codigo)}
        atual={tr.idioma()}
        nome={(c) => idiomas.find((i) => i.codigo === c)?.nome ?? c}
        lang={(c) => c}
        escolher={(c) => void escolher(c)}
        teste="os-idioma"
      />
    </Moldura>
  );
}

function EscolherTeclado() {
  const [lista, setLista] = useState<string[] | null>(null);
  const [reabrindo, setReabrindo] = useState(false);
  useEffect(() => void os.teclados().then(setLista), []);
  const escolher = async (id: string) => {
    const r = await os.usarTeclado(id);
    if (r.reabrindo) setReabrindo(true);
    else mudarEstadoOS(r.estado);
  };
  return (
    <Moldura titulo={t('writer.os.teclado.titulo')} teste="os-teclado" foco={lista ? 'teclado' : 'carregando'}>
      <p>{t('writer.os.teclado.texto')}</p>
      {reabrindo ? (
        <p role="status">{t('writer.os.teclado.reabrindo')}</p>
      ) : (
        lista && <Escolhas opcoes={lista} atual="br" nome={(id) => t(`writer.os.teclado.${id}`)} escolher={(id) => void escolher(id)} teste="os-teclado" />
      )}
    </Moldura>
  );
}

function EscolherFuso() {
  const [lista, setLista] = useState<string[] | null>(null);
  useEffect(() => void os.fusos().then(setLista), []);
  return (
    <Moldura titulo={t('writer.os.fuso.titulo')} teste="os-fuso" foco={lista ? 'fuso' : 'carregando'}>
      <p>{t('writer.os.fuso.texto')}</p>
      {lista && <Escolhas opcoes={lista} atual={null} nome={nomeDoFuso} escolher={(id) => void trocarFuso(id)} teste="os-fuso" />}
    </Moldura>
  );
}

// ---------- a hora e a data (pedido do Alcy em 18/11: em todas as telas, depois do boot) ----------

/** O fuso de antes da escolha do primeiro uso: Brasília (o mesmo padrão da imagem). */
const FUSO_PADRAO = 'America/Sao_Paulo';

const formatarRelogio = (d: Date, idioma: string, fuso: string): { hora: string; data: string } => {
  // a página não relê o fuso do sistema (o Chromium o guarda desde que abriu): a hora sai com o fuso escolhido
  const timeZone = fuso;
  try {
    return {
      hora: d.toLocaleTimeString(idioma, { hour: '2-digit', minute: '2-digit', timeZone }),
      data: d.toLocaleDateString(idioma, { weekday: 'short', day: 'numeric', month: 'short', timeZone }),
    };
  } catch {
    return { hora: d.toLocaleTimeString(idioma, { hour: '2-digit', minute: '2-digit' }), data: d.toLocaleDateString(idioma, { weekday: 'short', day: 'numeric', month: 'short' }) };
  }
};

// trocar o fuso: o ícone girando ("sincronizando") até a hora nova valer (pedido do Alcy em 20/11)
let sincronizando = false;
const ouvintesSinc = new Set<() => void>();
const mudarSinc = (v: boolean) => {
  sincronizando = v;
  for (const f of [...ouvintesSinc]) f();
};

/** Troca o fuso do sistema; o relógio mostra o ícone girando até a hora nova aparecer. */
export async function trocarFuso(id: string): Promise<void> {
  mudarSinc(true);
  try {
    mudarEstadoOS(await os.usarFuso(id));
  } finally {
    // dá um respiro para a hora nova já estar na tela quando o ícone some
    setTimeout(() => mudarSinc(false), 1200);
  }
}

/**
 * O relógio do Writer OS: a data e a hora (no fuso escolhido, Brasília antes da escolha), a bateria ao lado
 * (FB-0031) e, ao tocar, as configurações de data e hora. Em todas as telas, fixo no canto de baixo; na folha
 * de escrever (`embutido`) ele mora no rodapé, no meio, e some junto com os menus.
 */
export function RelogioOS({ embutido = false }: { embutido?: boolean }) {
  const osEstado = useEstadoOS();
  const fuso = osEstado?.fuso ?? FUSO_PADRAO;
  const [agora, setAgora] = useState(() => new Date());
  const [, setV] = useState(0);
  useEffect(() => tr.aoTrocar(() => setV((n) => n + 1)), []);
  useEffect(() => {
    const f = () => setV((n) => n + 1);
    ouvintesSinc.add(f);
    return () => void ouvintesSinc.delete(f);
  }, []);
  useEffect(() => {
    let relogio: ReturnType<typeof setTimeout>;
    const proximo = () => {
      const d = new Date();
      setAgora(d);
      relogio = setTimeout(proximo, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
    };
    proximo();
    return () => clearTimeout(relogio);
  }, []);
  // só um relógio por tela: o do canto se esconde enquanto a folha mostra o do rodapé
  useEffect(() => {
    if (!embutido) return;
    document.documentElement.classList.add('relogio-no-rodape');
    return () => document.documentElement.classList.remove('relogio-no-rodape');
  }, [embutido]);
  const { hora, data } = formatarRelogio(agora, tr.idioma(), fuso);
  // a VPN ligada: o cadeado pequeno ao lado da bateria (PLANO §7)
  const vpn = useVpnLigada();
  const rotulo = t('writer.os.relogio', { data, hora });
  const abrir = () => pedir('hora');
  return (
    <button
      type="button"
      class={`relogio-os${embutido ? ' embutido' : ''}`}
      onClick={abrir}
      title={t('writer.os.relogio.abrir')}
      aria-label={vpn ? `${rotulo} · ${t('writer.os.vpn.cadeado', { nome: vpn })}` : rotulo}
      data-teste={embutido ? 'os-relogio-rodape' : 'os-relogio'}
    >
      {sincronizando && <span class="relogio-os-girando" role="status" aria-label={t('writer.os.relogio.sincronizando')} data-teste="os-relogio-sinc" />}
      <time dateTime={agora.toISOString()}>
        <span class="relogio-os-data">{data}</span> <span class="relogio-os-hora">{hora}</span>
      </time>
      <CadeadoDaVpn nome={vpn} />
      <NivelDeBateria />
    </button>
  );
}

// ---------- como usar: só pelo pendrive ou instalar no computador (PLANO §8c) ----------

let instalarAberto = false;
const ouvintesInstalar = new Set<() => void>();

/** Abre (ou fecha) a tela de instalar no computador: do primeiro uso e do menu do sistema. */
export function abrirInstalar(sim = true): void {
  instalarAberto = sim;
  for (const f of [...ouvintesInstalar]) f();
}

function useInstalarAberto(): boolean {
  const [, setV] = useState(0);
  useEffect(() => {
    const f = () => setV((n) => n + 1);
    ouvintesInstalar.add(f);
    return () => void ouvintesInstalar.delete(f);
  }, []);
  return instalarAberto;
}

function EscolherUso() {
  return (
    <Moldura titulo={t('writer.os.uso.titulo')} teste="os-uso" foco="uso">
      <p>{t('writer.os.uso.texto')}</p>
      <div class="acoes-coluna lista-os">
        <button type="button" class="botao principal" onClick={() => void os.passarUso().then(mudarEstadoOS)} data-foco-inicial data-teste="os-uso-pendrive">
          {t('writer.os.uso.pendrive')}
        </button>
        <small class="dica">{t('writer.os.uso.pendrive.dica')}</small>
        <button type="button" class="botao" onClick={() => abrirInstalar()} data-teste="os-uso-instalar">
          {t('writer.os.uso.instalar')}
        </button>
        <small class="dica">{t('writer.os.uso.instalar.dica')}</small>
      </div>
    </Moldura>
  );
}

/** O disco onde instalar: o GPT, sem o Writer, com o maior espaço livre. */
const melhorDisco = (discos: DiscoInterno[]): DiscoInterno | undefined => [...discos].filter((d) => d.tabela === 'gpt' && !d.writer).sort((a, b) => b.livre - a.livre)[0];

/** Por que não dá para instalar ao lado do que existe (ou `null`: dá). */
function motivoDeNaoInstalar(info: InfoInstalacao): 'nao-uefi' | 'sem-disco' | 'ja-instalado' | 'vazio' | 'nao-gpt' | 'sem-espaco' | null {
  if (!info.uefi) return 'nao-uefi';
  if (!info.discos.length) return 'sem-disco';
  if (info.discos.some((d) => d.writer)) return 'ja-instalado';
  const d = melhorDisco(info.discos);
  if (!d) return info.discos.some((x) => x.tabela === 'nenhuma' && !x.partes.length) ? 'vazio' : 'nao-gpt';
  return d.livre < INSTALAR_MINIMO ? 'sem-espaco' : null;
}

/** O disco tem o Windows (ou parte dele: a recuperação, a partição reservada)? */
const temWindows = (d: DiscoInterno): boolean => d.partes.some((p) => tipoDaParte(p) === 'windows');

/**
 * Os discos que "Apagar o disco inteiro" oferece: os que cabem o Writer OS (8 GB + a partição de boot). Se o Writer OS
 * já está num disco, só ele (o serviço recusa apagar outro: a entrada de boot do de lá sairia). Os sem Windows primeiro.
 */
function discosParaApagar(info: InfoInstalacao): DiscoInterno[] {
  const cabem = info.discos.filter((d) => d.tamanho >= INSTALAR_MINIMO + 1400 * 1024 ** 2);
  const comWriter = cabem.filter((d) => d.writer);
  return [...(comWriter.length ? comWriter : cabem)].sort((a, b) => Number(temWindows(a)) - Number(temWindows(b)) || a.id.localeCompare(b.id));
}

/** A barra do disco (as cores do Guia): o que existe fica como está; o espaço livre vira o Writer OS. */
function BarraDoDisco({ disco }: { disco: DiscoInterno }) {
  const novo = Math.min(disco.livre, INSTALAR_MAXIMO);
  const pedacos: { tipo: 'windows' | 'outra' | 'novo' | 'livre'; tamanho: number; inicio: number }[] = disco.partes.map((p) => ({ tipo: p.fs === 'ntfs' && p.tamanho > 8 * 1024 ** 3 ? 'windows' : 'outra', tamanho: p.tamanho, inicio: p.inicio }));
  if (disco.livre > 0) {
    pedacos.push({ tipo: 'novo', tamanho: novo, inicio: disco.livreInicio });
    if (disco.livre > novo) pedacos.push({ tipo: 'livre', tamanho: disco.livre - novo, inicio: disco.livreInicio + novo });
  }
  pedacos.sort((a, b) => a.inicio - b.inicio);
  const total = Math.max(1, pedacos.reduce((s, p) => s + p.tamanho, 0));
  const windows = disco.partes.filter((p) => p.fs === 'ntfs').reduce((s, p) => s + p.tamanho, 0);
  return (
    <figure class="barra-disco" data-teste="os-instalar-barra">
      <div class="barra-disco-faixa" aria-hidden="true">
        {pedacos.map((p, i) => (
          <span key={i} class={`barra-disco-${p.tipo}`} style={{ flexGrow: Math.max(p.tamanho / total, 0.015) }} />
        ))}
      </div>
      <figcaption>
        <span class="legenda-disco">
          <span class="barra-disco-windows" aria-hidden="true" /> {t('writer.os.instalar.windows', { tamanho: tamanho(windows) })}
        </span>
        <span class="legenda-disco">
          <span class="barra-disco-novo" aria-hidden="true" /> {t('writer.os.instalar.novo', { tamanho: tamanho(novo) })}
        </span>
      </figcaption>
    </figure>
  );
}

/** O que existe num disco, partição por partição (o Windows em vermelho); vazio: "nenhuma partição". */
function OQueHaNoDisco({ disco }: { disco: DiscoInterno }) {
  if (!disco.partes.length) return <p class="dica">{t('writer.os.instalar.parte.nada')}</p>;
  return (
    <ul class="partes-disco">
      {disco.partes.map((p, i) => {
        const tipo = tipoDaParte(p);
        return (
          <li key={i} class={`parte-disco parte-${tipo}`} data-teste={`os-apagar-parte-${tipo}`}>
            {t(`writer.os.instalar.parte.${tipo}`, { tamanho: tamanho(p.tamanho) })}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "APAGAR O DISCO INTEIRO" (W3f; PLANO §8c item 3): só em "Outras opções", recolhido. A lista dos discos com o que há
 * em cada um (o Windows em vermelho); escolhido o disco, a pessoa digita o NOME dele (a regra do Gravador) e só então
 * o botão vermelho apaga. A casca confere o nome de novo e o serviço, o tamanho.
 */
function ApagarDisco({ info, levar, temTextos, aoLevar, aoApagar }: { info: InfoInstalacao; levar: boolean; temTextos: boolean; aoLevar: (v: boolean) => void; aoApagar: (d: DiscoInterno, nome: string) => void }) {
  const discos = discosParaApagar(info);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [errado, setErrado] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const d = discos.find((x) => x.id === escolhido);
  useEffect(() => {
    if (escolhido) campo.current?.focus();
  }, [escolhido]);
  if (!discos.length) return null;
  const enviar = (e: Event) => {
    e.preventDefault();
    if (!d) return;
    if (!nomeConfere(d, nome)) return setErrado(true);
    aoApagar(d, nome);
  };
  return (
    <details class="outras-opcoes" data-teste="os-instalar-outras">
      <summary data-teste="os-instalar-outras-abrir">{t('writer.os.instalar.outras')}</summary>
      <h2>{t('writer.os.instalar.apagar.titulo')}</h2>
      <p>{t('writer.os.instalar.apagar.texto')}</p>
      <ul class="discos-apagar">
        {discos.map((x) => (
          <li key={x.id}>
            <button
              type="button"
              class="botao"
              aria-pressed={x.id === escolhido}
              onClick={() => {
                setEscolhido(x.id);
                setNome('');
                setErrado(false);
              }}
              data-teste={`os-apagar-disco-${x.id}`}
            >
              {t('writer.os.instalar.apagar.disco', { nome: nomeDoDisco(x), tamanho: tamanho(x.tamanho) })}
            </button>
            <OQueHaNoDisco disco={x} />
          </li>
        ))}
      </ul>
      {d && (
        <form class="apagar-confirmar" onSubmit={enviar} data-teste="os-apagar-confirmar">
          <p class="ekf-erro">{t(temWindows(d) ? 'writer.os.instalar.apagar.windows' : 'writer.os.instalar.apagar.some', { nome: nomeDoDisco(d) })}</p>
          <label class="campo">
            <span>
              {t('writer.os.instalar.apagar.digite')} <strong>{nomeDoDisco(d)}</strong>
            </span>
            <input
              ref={campo}
              type="text"
              value={nome}
              autocomplete="off"
              spellcheck={false}
              onInput={(e) => {
                setNome(e.currentTarget.value);
                setErrado(false);
              }}
              data-teste="os-apagar-nome"
            />
          </label>
          {errado && (
            <p class="ekf-erro" role="alert" data-teste="os-apagar-nome-errado">
              {t('writer.os.instalar.erro.confirmacao')}
            </p>
          )}
          <label class="campo-marcar">
            <input type="checkbox" checked={levar && temTextos} disabled={!temTextos} onChange={(e) => aoLevar(e.currentTarget.checked)} data-teste="os-apagar-levar" />
            <span>{t(temTextos ? 'writer.os.instalar.levar' : 'writer.os.instalar.sem-textos')}</span>
          </label>
          <div class="acoes-linha">
            <button type="submit" class="botao principal perigo" data-teste="os-apagar-botao">
              {t('writer.os.instalar.apagar.botao')}
            </button>
          </div>
        </form>
      )}
    </details>
  );
}

/**
 * A TELA DE INSTALAR (uma só, PLANO §8c): a barra do disco, "Levar os textos deste pendrive" (marcado quando há textos),
 * Instalar e Voltar. Nada é apagado: as duas partições novas nascem no espaço livre e a ordem de boot não muda.
 * Sem espaço, explica o "preparar" do Gravador; sem UEFI, sem GPT ou já instalado, explica e só volta.
 * Embaixo, recolhido, "Outras opções" com o "Apagar o disco inteiro" (W3f), para o computador sem Windows.
 */
function TelaInstalar({ voltar }: { voltar: () => void }) {
  const estado = useEstadoCasca();
  const osEstado = useEstadoOS();
  const [info, setInfo] = useState<InfoInstalacao | null>(null);
  const [levar, setLevar] = useState<boolean | null>(null);
  const [passo, setPasso] = useState<{ passo: PassoInstalar; feito: number; total: number } | null>(null);
  const [instalando, setInstalando] = useState<'ao-lado' | 'apagar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const apagou = useRef(false);
  useEffect(() => void os.instalacao().then(setInfo), []);
  useEffect(
    () =>
      os.aoPassoDaInstalacao((p, feito, total) => {
        if (p === 'apagar') apagou.current = true;
        setPasso({ passo: p, feito, total });
      }),
    [],
  );
  const temTextos = !!estado?.temSenha;
  const marcado = levar ?? temTextos;
  const motivo = info ? motivoDeNaoInstalar(info) : null;
  const disco = info ? melhorDisco(info.discos) : undefined;
  const outras = info && info.uefi && motivo !== 'nao-uefi' && motivo !== 'sem-disco';

  const instalar = async (alvo: DiscoInterno, apagar?: string) => {
    setErro(null);
    apagou.current = false;
    setInstalando(apagar === undefined ? 'ao-lado' : 'apagar');
    setPasso({ passo: apagar === undefined ? 'particoes' : 'apagar', feito: 0, total: 0 });
    await gravarAgora();
    const r = await os.instalar(alvo.id, marcado && temTextos, apagar);
    // o cofre fechou para a cópia: a casca conta como ficou (sem a senha, de novo, se não deu certo)
    if (casca) mudarEstado(await casca.estado());
    if (r.ok) return mudarEstadoOS(r.estado);
    setInstalando(null);
    setPasso(null);
    const texto = t(`writer.os.instalar.erro.${r.erro}`);
    setErro(apagou.current ? `${texto} ${t('writer.os.instalar.apagar.depois-do-erro')}` : texto);
  };

  const pct = passo?.passo === 'copiar' && passo.total > 0 ? Math.round((passo.feito / passo.total) * 100) : null;
  const ordem: readonly PassoInstalar[] = instalando === 'apagar' ? ['apagar', 'particoes', 'copiar', 'conferir', 'textos', 'entrada'] : ['particoes', 'copiar', 'conferir', 'textos', 'entrada'];
  const geral = passo ? Math.round(((Math.max(0, ordem.indexOf(passo.passo)) + (pct ?? 0) / 100) / ordem.length) * 100) : 0;
  const teclaDoMenu = t(`writer.os.tutorial.tecla.${osEstado?.marca ?? 'outra'}`);

  return (
    <Moldura titulo={t('writer.os.instalar.titulo')} teste="os-instalar" foco={instalando ? 'instalando' : info ? `pronto-${motivo ?? 'ok'}` : 'carregando'}>
      {!info && <p aria-busy="true">{t('writer.os.instalar.procurando')}</p>}
      {info && instalando && passo && (
        <div role="status" data-teste="os-instalar-progresso">
          <p>{t(`writer.os.instalar.passo.${passo.passo}`)}</p>
          <progress max={100} value={geral} aria-label={t('writer.os.instalar.progresso')} />
          <p class="dica">{t('writer.os.instalar.nao-desligue')}</p>
        </div>
      )}
      {info && !instalando && motivo && (
        <>
          <p data-teste={`os-instalar-motivo-${motivo}`}>{t(`writer.os.instalar.motivo.${motivo}`, { tecla: teclaDoMenu })}</p>
          {motivo === 'sem-espaco' && (
            <ol class="passos-os">
              <li>{t('writer.os.instalar.preparar.1')}</li>
              <li>{t('writer.os.instalar.preparar.2')}</li>
              <li>{t('writer.os.instalar.preparar.3')}</li>
            </ol>
          )}
          <div class="acoes-linha">
            <button type="button" class="botao principal" onClick={voltar} data-foco-inicial data-teste="os-instalar-voltar">
              {t('writer.os.instalar.voltar')}
            </button>
          </div>
        </>
      )}
      {info && !instalando && !motivo && disco && (
        <>
          <p>{t('writer.os.instalar.texto', { disco: nomeDoDisco(disco) })}</p>
          <BarraDoDisco disco={disco} />
          <p class="dica">{t('writer.os.instalar.nada-apaga')}</p>
          <label class="campo-marcar">
            <input type="checkbox" checked={marcado && temTextos} disabled={!temTextos} onChange={(e) => setLevar(e.currentTarget.checked)} data-teste="os-instalar-levar" />
            <span>{t(temTextos ? 'writer.os.instalar.levar' : 'writer.os.instalar.sem-textos')}</span>
          </label>
          <div class="acoes-linha">
            <button type="button" class="botao" onClick={voltar} data-teste="os-instalar-voltar">
              {t('writer.os.instalar.voltar')}
            </button>
            <button type="button" class="botao principal" onClick={() => void instalar(disco)} data-foco-inicial data-teste="os-instalar-botao">
              {t('writer.os.instalar.botao')}
            </button>
          </div>
        </>
      )}
      {erro && (
        <p class="ekf-erro" role="alert" data-teste="os-instalar-erro">
          {erro}
        </p>
      )}
      {outras && !instalando && <ApagarDisco info={info} levar={marcado} temTextos={temTextos} aoLevar={setLevar} aoApagar={(d, nome) => void instalar(d, nome)} />}
    </Moldura>
  );
}

/**
 * A tecla do menu de ligar de cada marca, para o desenho do passo 2 (o nome da tecla não se traduz; o texto do passo,
 * com as variações, vem de `writer.os.tutorial.tecla.<marca>`). A tabela do "como bootar" do Gravador.
 */
const TECLA_DO_MENU: Record<MarcaComputador, string> = { lenovo: 'F12', dell: 'F12', hp: 'Esc', acer: 'F12', asus: 'Esc', msi: 'F11', samsung: 'F10', positivo: 'F7', outra: 'F12' };

/**
 * Os três passos para ligar no Writer OS instalado (PLANO §8c item 4), com o desenho por código; e o "ligar direto".
 * A tecla é a da marca deste computador (`EstadoOS.marca`, do `sys_vendor` do firmware); marca que o Writer OS não
 * conhece mostra a lista das outras.
 */
function Tutorial() {
  const marca = useEstadoOS()?.marca ?? 'outra';
  return (
    <div class="tutorial-os" data-teste="os-tutorial" data-marca={marca}>
      <ol class="passos-os passos-desenhados">
        <li>
          <span class="desenho-passo desenho-pendrive" aria-hidden="true" />
          <span>{t('writer.os.tutorial.1')}</span>
        </li>
        <li>
          <span class="desenho-passo desenho-tecla" aria-hidden="true" data-teste="os-tutorial-tecla">
            {TECLA_DO_MENU[marca]}
          </span>
          <span>{t('writer.os.tutorial.2', { tecla: t(`writer.os.tutorial.tecla.${marca}`) })}</span>
        </li>
        <li>
          <span class="desenho-passo desenho-menu" aria-hidden="true">
            <span />
            <span class="escolhida" />
            <span />
          </span>
          <span>{t('writer.os.tutorial.3')}</span>
        </li>
      </ol>
      {marca === 'outra' && <p class="dica">{t('writer.os.tutorial.teclas')}</p>}
      <p class="dica">{t('writer.os.tutorial.sem-escolher')}</p>
      <details class="tutorial-direto">
        <summary data-teste="os-tutorial-direto">{t('writer.os.tutorial.direto')}</summary>
        <p>{t('writer.os.tutorial.direto.texto', { config: t(`writer.os.tutorial.config.${marca}`) })}</p>
        <p class="aviso-casca">{t('writer.os.tutorial.bitlocker')}</p>
      </details>
    </div>
  );
}

/**
 * A tela final: instalado. O cofre já fechou; desligar, tirar o pendrive e ligar pelo menu do computador. Instalado
 * apagando o disco inteiro, o Writer OS já liga primeiro: basta tirar o pendrive.
 */
function Instalado() {
  const discoTodo = !!useEstadoOS()?.discoTodo;
  return (
    <Moldura titulo={t('writer.os.instalado.titulo')} teste="os-instalado" foco="instalado">
      <p data-teste={discoTodo ? 'os-instalado-todo' : 'os-instalado-ao-lado'}>{t(discoTodo ? 'writer.os.instalado.texto-todo' : 'writer.os.instalado.texto')}</p>
      {!discoTodo && <Tutorial />}
      <div class="acoes-linha">
        <button type="button" class="botao principal" onClick={() => void os.desligar()} data-foco-inicial data-teste="os-instalado-desligar">
          <IconeLigar tamanho={16} /> {t('writer.os.desligar')}
        </button>
      </div>
    </Moldura>
  );
}

// ---------- onde guardar (sem a partição de dados) ----------

/**
 * Desliga (ou reinicia) o computador: pergunta, grava o que falta e pede ao sistema. É o que o botão
 * "Desligar" do topo e o do painel do sistema fazem (PLANO §6.5 item 2); `recado` mostra o "desligando…".
 */
export async function desligarOS(reiniciar: boolean, recado?: (texto: string) => void): Promise<void> {
  if (!(await confirmar(t(reiniciar ? 'writer.os.reiniciar.confirmar' : 'writer.os.desligar.confirmar'), t(reiniciar ? 'writer.os.reiniciar' : 'writer.os.desligar')))) return;
  recado?.(t('writer.os.desligando'));
  await gravarAgora();
  await (reiniciar ? os.reiniciar() : os.desligar());
}

/**
 * O botão do menu do sistema (só no Writer OS): a engrenagem no topo de todas as telas, no lugar do antigo botão
 * de ligar (pedido do Alcy em 18/11). Abre o `MenuSistema` (Ctrl+Alt+S também).
 */
export function BotaoSistema({ tamanho }: { tamanho?: number } = {}) {
  const nome = t('writer.os.menu.titulo');
  return (
    <button type="button" class="ekf-icone" title={`${nome} (Ctrl+Alt+S)`} aria-label={nome} aria-haspopup="menu" onClick={() => pedir('sistema')} data-teste="botao-sistema">
      <IconeEngrenagem {...(tamanho ? { tamanho } : {})} />
    </button>
  );
}

/**
 * O menu do sistema FORA do app (a tela inicial e o Início, que não montam as janelas do app): a engrenagem do topo
 * (`BotaoSistema`, pelo `depoisNoTopo` do `EntradaApp`) e o Ctrl+Alt+S abrem o mesmo `MenuSistema`, sem os Ajustes do
 * Writer (só existem com os textos abertos). Sem isto, quem não entrou no app não tinha como desligar (Alcy, 18/11).
 */
export function SistemaForaDoApp() {
  const [aberta, setAberta] = useState<'sistema' | 'conta' | 'hora' | null>(null);
  useEffect(
    () =>
      aoPedido((p) => {
        if (p === 'sistema' || p === 'conta' || p === 'hora') setAberta(p);
      }),
    [],
  );
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (teclaDe(e) !== 'Ctrl+Alt+S') return;
      e.preventDefault();
      pedir('sistema');
    };
    addEventListener('keydown', tecla);
    return () => removeEventListener('keydown', tecla);
  }, []);
  const fechar = () => setAberta(null);
  return (
    <>
      {(aberta === 'sistema' || aberta === 'hora') && <MenuSistema fechar={fechar} semAjustes {...(aberta === 'hora' ? { secaoInicial: 'fuso' as const } : {})} />}
      {aberta === 'conta' && <EntrarOS fechar={fechar} />}
      <Confirmacoes />
      <Avisos />
    </>
  );
}

/** Entrar na conta Ekfrase pelo menu do sistema (no Writer OS não há o botão da conta no topo). */
export function EntrarOS({ fechar }: { fechar: () => void }) {
  return (
    <Janela titulo={t('nucleo.conta.titulo')} t={t} fechar={fechar}>
      <p>{t('nucleo.conta.ekfrase.explicacao')}</p>
      <FormConta t={t} app="ekfrase" idioma={document.documentElement.lang || 'pt-BR'} podeCriar aoEntrar={fechar} />
    </Janela>
  );
}

/** As teclas de brilho do notebook (a casca as lê, PLANO §6.4): um recado curto com o brilho novo. */
export function useAvisoDeBrilho(): void {
  useEffect(() => (noOS ? os.aoMudarBrilho((n) => avisar(t('writer.os.brilho.valor', { n }))) : undefined), []);
}

export function useDiscos(): [DiscoUSB[] | null, () => void] {
  const [discos, setDiscos] = useState<DiscoUSB[] | null>(null);
  const ler = () => void os.discos().then(setDiscos);
  useEffect(() => {
    ler();
    // um pendrive que chega agora aparece sozinho
    const i = setInterval(ler, 3000);
    return () => clearInterval(i);
  }, []);
  return [discos, ler];
}

function OndeGuardar({ motivo, aoEscolher }: { motivo: string | null; aoEscolher: () => void }) {
  const estado = useEstadoCasca();
  const [discos] = useDiscos();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const usar = async (f: () => Promise<RespostaCasca>) => {
    setOcupado(true);
    setErro(null);
    const r = await f();
    setOcupado(false);
    if (!r.ok) return setErro(r.erro === 'ja-tem' ? t('writer.os.onde.ja-tem') : textoDoErroCasca(r.erro));
    mudarEstado(r.estado);
    aoEscolher();
  };
  return (
    <Moldura titulo={t('writer.os.onde.titulo')} teste="os-onde-guardar" foco={discos?.length ?? -1}>
      <p>{t('writer.os.onde.texto')}</p>
      {motivo && <p class="dica">{t(`writer.os.onde.motivo.${motivo}`)}</p>}
      <div class="acoes-coluna">
        {(discos ?? []).map((d, i) => (
          <button
            key={d.id}
            type="button"
            class={i === 0 ? 'botao principal' : 'botao'}
            disabled={ocupado}
            onClick={() => void usar(() => os.guardarEm(d.id))}
            {...(i === 0 ? { 'data-foco-inicial': true } : {})}
            data-teste="os-guardar-disco"
          >
            {t(d.temWriter ? 'writer.os.onde.abrir-disco' : 'writer.os.onde.usar-disco', { nome: d.rotulo || d.nome || d.id, tamanho: tamanho(d.tamanho) })}
          </button>
        ))}
        {discos && !discos.length && <p class="dica">{t('writer.os.onde.sem-disco')}</p>}
        <button
          type="button"
          class={discos?.length ? 'botao' : 'botao principal'}
          disabled={ocupado || estado?.destino === 'ram'}
          onClick={() => void usar(() => os.guardarNaMemoria())}
          {...(discos?.length ? {} : { 'data-foco-inicial': true })}
          data-teste="os-guardar-memoria"
        >
          {t('writer.os.onde.memoria')}
        </button>
        <small class="dica">{t('writer.os.onde.memoria.dica')}</small>
      </div>
      {erro && (
        <p class="ekf-erro" role="alert">
          {erro}
        </p>
      )}
    </Moldura>
  );
}

/** A faixa âmbar: os textos estão só na memória. */
function FaixaMemoria() {
  const [abrir, setAbrir] = useState(false);
  return (
    <div class="faixa-memoria" role="status" data-teste="os-faixa-memoria">
      <span>{t('writer.os.memoria.faixa')}</span>
      <button type="button" class="botao pequeno" onClick={() => setAbrir(true)} data-teste="os-faixa-guardar">
        {t('writer.os.memoria.guardar')}
      </button>
      {abrir && (
        <Camada titulo={t('writer.os.onde.titulo')} fechar={() => setAbrir(false)} teste="os-levar-memoria">
          <LevarDaMemoria fechar={() => setAbrir(false)} />
        </Camada>
      )}
    </div>
  );
}

function LevarDaMemoria({ fechar }: { fechar: () => void }) {
  const [discos] = useDiscos();
  const [erro, setErro] = useState<string | null>(null);
  const levar = async (id: string) => {
    await gravarAgora();
    const r = await os.guardarEm(id);
    if (!r.ok) return setErro(r.erro === 'ja-tem' ? t('writer.os.onde.ja-tem') : textoDoErroCasca(r.erro));
    fechar();
    mudarEstado(r.estado);
  };
  return (
    <div class="acoes-coluna">
      <p>{t('writer.os.memoria.levar')}</p>
      {(discos ?? []).map((d) => (
        <button key={d.id} type="button" class="botao" onClick={() => void levar(d.id)} data-teste="os-levar-disco">
          {t('writer.os.onde.usar-disco', { nome: d.rotulo || d.nome || d.id, tamanho: tamanho(d.tamanho) })}
        </button>
      ))}
      {discos && !discos.length && <p class="dica">{t('writer.os.onde.sem-disco')}</p>}
      {erro && (
        <p class="ekf-erro" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}

// ---------- Wi-Fi ----------

/** A lista de redes; `aoMudar` recebe a lista a cada leitura (o primeiro uso troca "Seguir" por "Concluir"). */
function ListaRedes({ aoMudar }: { aoMudar?: (redes: RedeWifi[], cabo: Cabo | null) => void } = {}) {
  const [redes, setRedes] = useState<RedeWifi[] | null>(null);
  const [cabo, setCabo] = useState<Cabo | null>(null);
  const [escolhida, setEscolhida] = useState<RedeWifi | null>(null);
  const [senha, setSenha] = useState('');
  const [recado, setRecado] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // escolheu uma rede com senha: o foco vai para a senha (que fica ACIMA da lista: o Tab não chegaria lá)
  const campoSenha = useRef<HTMLInputElement>(null);
  // junto com a tela (layout), não depois de pintar: no WebKit do Writer OS o Enter seguinte já cairia no botão
  useLayoutEffect(() => {
    if (escolhida) campoSenha.current?.focus();
  }, [escolhida]);
  // a senha sumiu (Cancelar, ou conectou): o foco volta para o botão da rede, nunca fica perdido
  const raiz = useRef<HTMLDivElement>(null);
  const voltarARede = (ssid: string) =>
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected) return;
      [...(raiz.current?.querySelectorAll<HTMLElement>('[data-teste="os-rede"]') ?? [])].find((b) => b.dataset['ssid'] === ssid)?.focus();
    }, 0);
  // a internet de verdade, com uma rede conectada (PLANO §7, o portal cativo): `portal` = a rede pede login numa página
  const [internet, setInternet] = useState<Conectividade | null>(null);
  const botaoPortal = useRef<HTMLButtonElement>(null);
  // a página de login apareceu: o foco vai no botão de abri-la (menos com a senha de uma rede sendo digitada)
  useLayoutEffect(() => {
    if (internet === 'portal' && !escolhida) botaoPortal.current?.focus();
  }, [internet]);
  const perguntarInternet = (lista: RedeWifi[], c: Cabo | null) => {
    if (!lista.some((r) => r.conectada) && !c?.conectado) {
      setInternet(null);
      return;
    }
    void os
      .internet()
      .then(setInternet)
      .catch(() => setInternet(null));
  };
  const ler = () =>
    void Promise.all([os.redes(), os.cabo()]).then(([lista, c]) => {
      setRedes(lista);
      setCabo(c);
      aoMudar?.(lista, c);
      perguntarInternet(lista, c);
    });
  /** O foco, perdido (o botão sumiu ou ficou desligado), volta à rede conectada. */
  const focarConectada = () =>
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected) return;
      const conectada = [...(raiz.current?.querySelectorAll<HTMLElement>('[aria-pressed="true"]') ?? [])][0];
      (conectada ?? raiz.current?.querySelector<HTMLElement>('[data-teste="os-redes-procurar"]'))?.focus();
    }, 0);
  const abrirPortal = async () => {
    setOcupado(true);
    setRecado({ texto: t('writer.os.portal.aberta'), erro: false });
    const c = await os.abrirPortal().catch((): Conectividade => 'desconhecida');
    setOcupado(false);
    setInternet(c);
    setRecado(c === 'internet' ? { texto: t('writer.os.portal.conectou'), erro: false } : c === 'portal' ? { texto: t('writer.os.portal.ainda'), erro: false } : null);
    if (c === 'portal') setTimeout(() => botaoPortal.current?.focus(), 0);
    else focarConectada();
  };
  const ligarCabo = async () => {
    setOcupado(true);
    setRecado({ texto: t('writer.os.cabo.conectando'), erro: false });
    const r = await os.conectarCabo();
    setOcupado(false);
    setRecado(r.ok ? { texto: t('writer.os.cabo.conectou'), erro: false } : { texto: t('writer.os.cabo.erro'), erro: true });
    ler();
  };
  useEffect(ler, []);
  const conectar = async (rede: RedeWifi, comSenha: string | null) => {
    setOcupado(true);
    setRecado({ texto: t('writer.os.wifi.conectando', { rede: rede.ssid }), erro: false });
    const r = await os.conectar(rede.ssid, comSenha);
    setOcupado(false);
    if (r.ok) {
      setEscolhida(null);
      setSenha('');
      setRecado({ texto: t('writer.os.wifi.conectou', { rede: rede.ssid }), erro: false });
      ler();
      voltarARede(rede.ssid);
    } else setRecado({ texto: t(`writer.os.wifi.erro.${r.erro}`), erro: true });
  };
  const tocar = (rede: RedeWifi) => {
    if (rede.segura && !rede.conhecida) {
      setEscolhida(rede);
      setSenha('');
    } else void conectar(rede, null);
  };
  return (
    <div class="redes-os" data-teste="os-redes" ref={raiz}>
      {redes === null && <p aria-busy="true">{t('writer.os.wifi.procurando')}</p>}
      {redes && !redes.length && !cabo && <p class="dica">{t('writer.os.wifi.nenhuma')}</p>}
      {/* a senha da rede escolhida fica logo ACIMA da lista (pedido do Alcy em 18/11): à vista, sem rolar */}
      {escolhida && (
        <form
          class="form-casca"
          onSubmit={(e) => {
            e.preventDefault();
            void conectar(escolhida, senha);
          }}
          noValidate
        >
          <label class="campo">
            <span>{t('writer.os.wifi.senha', { rede: escolhida.ssid })}</span>
            <input type="password" value={senha} onInput={(e) => setSenha(e.currentTarget.value)} ref={campoSenha} data-teste="os-rede-senha" />
          </label>
          <div class="acoes-linha">
            <button type="submit" class="botao principal" disabled={ocupado || !senha} data-teste="os-rede-conectar">
              {t('writer.os.wifi.conectar')}
            </button>
            <button
              type="button"
              class="botao"
              onClick={() => {
                setEscolhida(null);
                voltarARede(escolhida.ssid);
              }}
              data-teste="os-rede-cancelar"
            >
              {t('writer.os.cancelar')}
            </button>
          </div>
        </form>
      )}
      {internet === 'portal' && (
        <div class="acoes-coluna" data-teste="os-portal">
          <p>{t('writer.os.portal.pede')}</p>
          <button type="button" class="botao principal" ref={botaoPortal} disabled={ocupado} onClick={() => void abrirPortal()} data-teste="os-portal-abrir">
            {t('writer.os.portal.abrir')}
          </button>
        </div>
      )}
      {internet === 'sem' && (
        <p class="dica" role="status" data-teste="os-sem-internet">
          {t('writer.os.portal.sem')}
        </p>
      )}
      <div class="acoes-coluna" role="list">
        {cabo && (
          <div class="linha-rede" role="listitem">
            <button type="button" class="botao" disabled={ocupado || cabo.conectado} onClick={() => void ligarCabo()} aria-pressed={cabo.conectado} data-teste="os-cabo">
              {t('writer.os.cabo.nome')}
              <small>{` · ${t(cabo.conectado ? 'writer.os.cabo.conectado' : cabo.plugado ? 'writer.os.cabo.plugado' : 'writer.os.cabo.solto')}`}</small>
            </button>
          </div>
        )}
        {(redes ?? []).map((r) => (
          <div class="linha-rede" role="listitem" key={r.ssid}>
            <button type="button" class="botao" disabled={ocupado} onClick={() => tocar(r)} aria-pressed={r.conectada} data-ssid={r.ssid} data-teste="os-rede">
              {r.ssid}
              <small>
                {' · '}
                {t('writer.os.wifi.sinal', { n: r.sinal })}
                {r.segura ? ` · ${t('writer.os.wifi.segura')}` : ''}
                {r.conectada ? ` · ${t('writer.os.wifi.conectada')}` : ''}
              </small>
            </button>
            {r.conhecida && (
              <button type="button" class="botao pequeno" disabled={ocupado} onClick={() => void os.esquecer(r.ssid).then(ler)} data-teste="os-rede-esquecer">
                {t('writer.os.wifi.esquecer')}
              </button>
            )}
          </div>
        ))}
      </div>
      <div class="acoes-linha">
        <button type="button" class="botao pequeno" disabled={ocupado} onClick={ler} data-teste="os-redes-procurar">
          {t('writer.os.wifi.procurar')}
        </button>
      </div>
      {recado && (
        <p class={recado.erro ? 'ekf-erro' : 'dica'} role={recado.erro ? 'alert' : 'status'}>
          {recado.texto}
        </p>
      )}
    </div>
  );
}

/** Sem rede conectada, "Seguir (o Wi-Fi fica para depois)"; conectou, o botão vira "Concluir" e recebe o foco. */
function WifiPrimeiroUso() {
  const [conectado, setConectado] = useState(false);
  const concluir = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (conectado) concluir.current?.focus();
  }, [conectado]);
  const seguir = () => void os.passarWifi().then(mudarEstadoOS);
  return (
    <Moldura titulo={t('writer.os.wifi.titulo')} teste="os-wifi" foco="wifi">
      <p>{t('writer.os.wifi.texto')}</p>
      <div class="acoes-coluna">
        {conectado ? (
          <button type="button" class="botao principal" onClick={seguir} ref={concluir} data-foco-inicial data-teste="os-wifi-concluir">
            {t('writer.os.wifi.concluir')}
          </button>
        ) : (
          <button type="button" class="botao principal" onClick={seguir} data-foco-inicial data-teste="os-wifi-seguir">
            {t('writer.os.wifi.seguir')}
          </button>
        )}
      </div>
      <ListaRedes aoMudar={(redes, cabo) => setConectado(redes.some((r) => r.conectada) || !!cabo?.conectado)} />
    </Moldura>
  );
}

// ---------- o menu do sistema (§6.4) ----------

/** As partes do sistema que o menu abre (PLANO §6.4); cada uma é uma tela dentro do próprio menu. */
type SecaoOS = 'wifi' | 'vpn' | 'energia' | 'teclado' | 'fuso' | 'servidor' | 'discos' | 'atualizacoes' | 'sobre' | 'tutorial';
const TITULO_TUTORIAL = 'writer.os.menu.tutorial';
const SECOES: readonly { id: Exclude<SecaoOS, 'tutorial'>; titulo: string }[] = [
  { id: 'wifi', titulo: 'writer.os.wifi.titulo' },
  // a VPN (PLANO §7, W4): logo depois do Wi-Fi
  { id: 'vpn', titulo: 'writer.os.vpn.titulo' },
  { id: 'energia', titulo: 'writer.os.energia.titulo' },
  { id: 'teclado', titulo: 'writer.os.teclado.titulo' },
  { id: 'fuso', titulo: 'writer.os.fuso.titulo' },
  { id: 'servidor', titulo: 'writer.os.servidor.titulo' },
  { id: 'discos', titulo: 'writer.os.discos.titulo' },
  // as atualizações (DEC-P072, U1): só quando a casca as tem
  ...(atualizacoesDaCasca ? [{ id: 'atualizacoes' as const, titulo: 'writer.atualizacoes.titulo' }] : []),
  { id: 'sobre', titulo: 'writer.os.sobre.titulo' },
];

/** Setas para cima e para baixo (e Home, End) andam pelos itens do menu, em roda. */
function andarPeloMenu(e: TargetedKeyboardEvent<HTMLElement>): void {
  const itens = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
  if (!itens.length) return;
  const i = itens.indexOf(document.activeElement as HTMLElement);
  const j = e.key === 'ArrowDown' ? (i + 1) % itens.length : e.key === 'ArrowUp' ? (i <= 0 ? itens.length - 1 : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? itens.length - 1 : -1;
  if (j < 0) return;
  e.preventDefault();
  itens[j]?.focus();
}

/**
 * O MENU DO SISTEMA do Writer OS (pedido do Alcy em 18/11), no estilo do Menu Iniciar: preso ao canto de cima,
 * abre pela engrenagem do topo ou por Ctrl+Alt+S. Em cima, Desligar e Reiniciar; depois a conta (quem entrou, com
 * Sair; ou Entrar); depois as partes do sistema (Wi-Fi, VPN, bateria e tela, teclado, fuso, servidor, pendrives,
 * Sobre) e os Ajustes do Writer. Cada parte abre dentro do próprio menu; Esc volta ao menu, e no menu, fecha.
 * Tudo pelo teclado: setas, Enter, Esc (e Tab, que gira dentro).
 */
export function MenuSistema({ fechar, semAjustes = false, secaoInicial = null }: { fechar: () => void; semAjustes?: boolean; secaoInicial?: SecaoOS | null }) {
  const [secao, setSecao] = useState<SecaoOS | null>(secaoInicial);
  // a volta de uma parte põe o foco no item dela
  const [ultimo, setUltimo] = useState('os-desligar');
  const [recado, setRecado] = useState<string | null>(null);
  const { conta } = useConta();
  const miolo = useRef<HTMLDivElement>(null);

  // a Camada só põe o foco ao abrir; ao trocar entre o menu e uma parte, quem põe é aqui
  const primeira = useRef(true);
  useLayoutEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    // o que a parte mostra chega aos poucos (a bateria, as redes): espera um pouco pelo primeiro campo dela
    let vezes = 0;
    const tentar = () => {
      const m = miolo.current;
      if (!m) return;
      const parte = m.querySelector<HTMLElement>('.secao-os');
      const alvo = m.querySelector<HTMLElement>('[data-foco-inicial]') ?? (parte ? focaveis(parte)[0] : undefined);
      if (alvo) alvo.focus();
      else if (++vezes < 10) setTimeout(tentar, 50);
      else focaveis(m)[0]?.focus();
    };
    tentar();
  }, [secao]);

  const abrir = (s: SecaoOS) => {
    setUltimo(`os-menu-${s}`);
    setSecao(s);
  };
  const foco = (teste: string) => (teste === ultimo ? { 'data-foco-inicial': true } : {});
  const titulo = secao ? t(secao === 'tutorial' ? TITULO_TUTORIAL : (SECOES.find((s) => s.id === secao)?.titulo ?? 'writer.os.menu.titulo')) : t('writer.os.menu.titulo');
  const osEstado = useEstadoOS();

  return (
    <Camada titulo={titulo} fechar={secao ? () => setSecao(null) : fechar} tipo="menu" teste="menu-sistema" classe="painel-sistema">
      <div ref={miolo}>
        {recado && (
          <p class="aviso-casca" role="status" data-teste="os-recado">
            {recado}
          </p>
        )}
        {secao ? (
          <>
            <ParteDoSistema secao={secao} recado={setRecado} />
            <div class="acoes-linha">
              <button type="button" class="botao" onClick={() => setSecao(null)} data-teste="os-menu-voltar">
                {t('writer.os.menu.voltar')}
              </button>
            </div>
          </>
        ) : (
          <div class="menu-sistema" role="menu" aria-label={t('writer.os.menu.titulo')} onKeyDown={andarPeloMenu}>
            <div class="menu-sistema-energia">
              <button type="button" role="menuitem" class="item-menu-os" onClick={() => void desligarOS(false, setRecado)} {...foco('os-desligar')} data-teste="os-desligar">
                <IconeLigar tamanho={16} />
                <span>{t('writer.os.desligar')}</span>
              </button>
              <button type="button" role="menuitem" class="item-menu-os" onClick={() => void desligarOS(true, setRecado)} {...foco('os-reiniciar')} data-teste="os-reiniciar">
                <span>{t('writer.os.reiniciar')}</span>
              </button>
            </div>
            <div class="menu-sistema-conta" role="group" aria-label={t('writer.os.menu.conta-titulo')} data-teste="os-menu-conta">
              <p>{conta ? t('writer.os.menu.conta', { nome: conta.nome }) : t('writer.os.menu.sem-conta')}</p>
              {conta ? (
                <button type="button" role="menuitem" class="item-menu-os" onClick={() => void ponte.sair()} {...foco('os-conta-sair')} data-teste="os-conta-sair">
                  <span>{t('nucleo.conta.sair')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  class="item-menu-os"
                  onClick={() => {
                    fechar();
                    pedir('conta');
                  }}
                  {...foco('os-conta-entrar')}
                  data-teste="os-conta-entrar"
                >
                  <span>{t('nucleo.conta.entrar.botao')}</span>
                </button>
              )}
            </div>
            <div class="menu-sistema-partes">
              {SECOES.map((s) => (
                <button key={s.id} type="button" role="menuitem" class="item-menu-os" onClick={() => abrir(s.id)} {...foco(`os-menu-${s.id}`)} data-teste={`os-menu-${s.id}`}>
                  <span>{t(s.titulo)}</span>
                </button>
              ))}
              {!semAjustes && (
                <button
                  type="button"
                  role="menuitem"
                  class="item-menu-os"
                  onClick={() => {
                    fechar();
                    pedir('ajustes');
                  }}
                  data-teste="os-menu-ajustes"
                >
                  <span>{t('writer.os.menu.ajustes')}</span>
                  <small>Ctrl+,</small>
                </button>
              )}
              {/* ligou pelo pendrive: instalar, SEMPRE (pedido do Alcy em 18/11); o último item (o qemu.py chega nele com End) */}
              {osEstado?.boot === 'usb' && (
                <button
                  type="button"
                  role="menuitem"
                  class="item-menu-os"
                  onClick={() => {
                    fechar();
                    abrirInstalar();
                  }}
                  data-teste="os-menu-instalar"
                >
                  <span>{t('writer.os.menu.instalar')}</span>
                </button>
              )}
              {/* ligou pelo disco do computador: como escolher o Writer OS ou o Windows ao ligar */}
              {osEstado?.boot === 'computador' && (
                <button type="button" role="menuitem" class="item-menu-os" onClick={() => abrir('tutorial')} {...foco('os-menu-tutorial')} data-teste="os-menu-tutorial">
                  <span>{t(TITULO_TUTORIAL)}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Camada>
  );
}

/**
 * A conta no próprio "Servidor e conta" (pedido do Alcy em 18/11): quem entrou vê o nome e Sair; quem não entrou, o
 * formulário de entrar (ou criar a conta) ali mesmo, no servidor escolhido acima.
 */
function ContaNoServidor() {
  const { conta } = useConta();
  return (
    <div class="conta-servidor" role="group" aria-label={t('writer.os.menu.conta-titulo')} data-teste="os-servidor-conta">
      <h3>{t('writer.os.menu.conta-titulo')}</h3>
      {conta ? (
        <>
          {/* Sem conta, o formulário de entrar já traz a escolha do servidor (`definirAntesDoEntrar`): uma só. */}
          <EscolhaServidor />
          <p>{t('writer.os.menu.conta', { nome: conta.nome })}</p>
          <div class="acoes-linha">
            <button type="button" class="botao" onClick={() => void ponte.sair()} data-teste="os-servidor-sair">
              {t('nucleo.conta.sair')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{t('writer.os.menu.sem-conta')}</p>
          <FormConta t={t} app="ekfrase" idioma={document.documentElement.lang || 'pt-BR'} podeCriar aoEntrar={() => undefined} />
        </>
      )}
    </div>
  );
}

function Secao({ titulo, children, teste }: { titulo: string; children: ComponentChildren; teste: string }) {
  return (
    <section class="secao-os" data-teste={teste} aria-label={titulo}>
      {children}
    </section>
  );
}

/** Uma parte do sistema, aberta pelo menu (§6.4). O foco começa no primeiro campo dela. */
function ParteDoSistema({ secao, recado }: { secao: SecaoOS; recado: (texto: string) => void }) {
  const osEstado = useEstadoOS();
  const [bateria, setBateria] = useState<Bateria | null | undefined>(undefined);
  const [luz, setLuz] = useState<number | null | undefined>(undefined);
  const [teclados, setTeclados] = useState<string[]>([]);
  const [fusos, setFusos] = useState<string[]>([]);
  const [sobre, setSobre] = useState<SobreOS | null>(null);
  useEffect(() => {
    if (secao === 'energia') {
      void os.bateria().then(setBateria);
      void os.brilho().then(setLuz);
      // as teclas de brilho do notebook mudam o número aqui também
      return os.aoMudarBrilho(setLuz);
    }
    if (secao === 'teclado') void os.teclados().then(setTeclados);
    if (secao === 'fuso') void os.fusos().then(setFusos);
    if (secao === 'sobre') void os.sobre().then(setSobre);
    return undefined;
  }, [secao]);

  const trocarTeclado = async (id: string) => {
    if (id === osEstado?.teclado) return;
    if (!(await confirmar(t('writer.os.teclado.confirmar'), t('writer.os.teclado.trocar')))) return;
    await gravarAgora();
    const r = await os.usarTeclado(id);
    if (r.reabrindo) recado(t('writer.os.teclado.reabrindo'));
    else mudarEstadoOS(r.estado);
  };

  switch (secao) {
    case 'wifi':
      return (
        <Secao titulo={t('writer.os.wifi.titulo')} teste="os-painel-wifi">
          <ListaRedes />
        </Secao>
      );
    case 'vpn':
      return <ParteVpn />;
    case 'energia':
      return (
        <Secao titulo={t('writer.os.energia.titulo')} teste="os-painel-energia">
          <p>{bateria === undefined ? '…' : bateria ? t(bateria.carregando ? 'writer.os.bateria.carregando' : 'writer.os.bateria.nivel', { n: bateria.nivel }) : t('writer.os.bateria.sem')}</p>
          {luz !== null && (
            <div class="acoes-linha" role="group" aria-label={t('writer.os.brilho')}>
              <span>{t('writer.os.brilho.valor', { n: luz ?? 0 })}</span>
              <button type="button" class="botao pequeno" onClick={() => void os.brilho(-10).then(setLuz)} data-teste="os-brilho-menos">
                {t('writer.os.brilho.menos')}
              </button>
              <button type="button" class="botao pequeno" onClick={() => void os.brilho(10).then(setLuz)} data-foco-inicial data-teste="os-brilho-mais">
                {t('writer.os.brilho.mais')}
              </button>
            </div>
          )}
          {luz !== null && <p class="dica">{t('writer.os.brilho.dica')}</p>}
        </Secao>
      );
    case 'teclado':
      return (
        <Secao titulo={t('writer.os.teclado.titulo')} teste="os-painel-teclado">
          <label class="campo">
            <span>{t('writer.os.teclado.rotulo')}</span>
            <select value={osEstado?.teclado ?? 'br'} onChange={(e) => void trocarTeclado(e.currentTarget.value)} data-teste="os-painel-teclado-lista">
              {teclados.map((id) => (
                <option key={id} value={id}>
                  {t(`writer.os.teclado.${id}`)}
                </option>
              ))}
            </select>
          </label>
        </Secao>
      );
    case 'fuso':
      return (
        <Secao titulo={t('writer.os.fuso.titulo')} teste="os-painel-fuso">
          <label class="campo">
            <span>{t('writer.os.fuso.rotulo')}</span>
            <select value={osEstado?.fuso ?? ''} onChange={(e) => void trocarFuso(e.currentTarget.value)} data-teste="os-painel-fuso-lista">
              {fusos.map((id) => (
                <option key={id} value={id}>
                  {nomeDoFuso(id)}
                </option>
              ))}
            </select>
          </label>
        </Secao>
      );
    case 'servidor':
      return (
        <Secao titulo={t('writer.os.servidor.titulo')} teste="os-painel-servidor">
          <ContaNoServidor />
        </Secao>
      );
    case 'discos':
      return <ParteDosDiscos recado={recado} />;
    case 'atualizacoes':
      return <ParteAtualizacoes />;
    case 'tutorial':
      return (
        <Secao titulo={t(TITULO_TUTORIAL)} teste="os-painel-tutorial">
          <Tutorial />
        </Secao>
      );
    case 'sobre':
      return (
        <Secao titulo={t('writer.os.sobre.titulo')} teste="os-painel-sobre">
          {sobre && (
            <p>
              {t('writer.os.sobre.texto', { sistema: sobre.sistema, app: sobre.app, kernel: sobre.kernel })}
              <br />
              {t(`writer.os.sobre.secure-boot.${sobre.secureBoot}`)}
            </p>
          )}
          <p>{t('writer.os.sobre.licenca')}</p>
          <p>{t('writer.os.sobre.privacidade')}</p>
        </Secao>
      );
  }
}

function ParteDosDiscos({ recado }: { recado: (texto: string) => void }) {
  const [discos, lerDiscos] = useDiscos();
  const ejetar = async (d: DiscoUSB) => {
    const r = await os.ejetar(d.id);
    recado(r.ok ? t('writer.os.discos.pode-tirar', { nome: d.rotulo || d.nome }) : t(`writer.os.discos.erro.${r.erro}`));
    lerDiscos();
  };
  return (
    <Secao titulo={t('writer.os.discos.titulo')} teste="os-painel-discos">
      {discos && !discos.length && <p class="dica">{t('writer.os.onde.sem-disco')}</p>}
      {(discos ?? []).map((d) => (
        <div class="linha-rede" key={d.id}>
          <span>
            {d.rotulo || d.nome || d.id} · {tamanho(d.tamanho)}
          </span>
          {d.montado && (
            <button type="button" class="botao pequeno" onClick={() => void ejetar(d)} data-teste="os-ejetar">
              {t('writer.os.discos.ejetar')}
            </button>
          )}
        </div>
      ))}
    </Secao>
  );
}
