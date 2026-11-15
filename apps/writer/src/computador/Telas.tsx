// SPDX-License-Identifier: MPL-2.0

/**
 * As telas do WRITER NO COMPUTADOR (a casca Electron; PLANO §10, fase 2). No site, nenhuma delas
 * aparece, menos a página de download (`Baixar`).
 *
 * - `PortaoDaCasca`: antes do app, a pasta dos dados → a senha (criar, numa pasta nova; abrir, numa
 *   com textos; DEC-P063: não existe pasta sem senha) → a pergunta do espelho `.md` (a cada pasta
 *   aberta, menos quando a resposta foi "sempre nesta pasta").
 * - `EscolhaServidor`: "Servidor: ekfrase.com / Outro…" acima do formulário de entrar (na casca não
 *   há CORS: quem confere é o processo principal).
 * - `AjustesDaCasca`: a pasta, o espelho e "fechar os textos" dentro dos Ajustes (Ctrl+,).
 * - `Baixar`: a página de download (`#/computador`), com o passo a passo do aviso do SmartScreen
 *   (sem certificado de assinatura, DEC-P064).
 */
import { LINKS, PaginaApp, definirAntesDoEntrar } from '@ekfrase/interface';
import { SENHA_MINIMA, type ErroCasca, type EscolhaEspelho, type InfoServidor, type PonteCasca, type RespostaCasca } from '@ekfrase/writer-nucleo';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import logo from '../img/logo-writer.png';
import { enderecoDe, useRelease } from './releases.ts';
import { t, tr } from '../textos.ts';
import { casca as pontePossivel, mudarEstado, naCasca, trancar, useEstadoCasca } from './casca.ts';

/** A ponte da casca (só é usada com `naCasca`; cada tela confere antes, em tempo de execução). */
const casca = pontePossivel as PonteCasca;

export const textoDoErroCasca = (e: ErroCasca | 'diferentes'): string => t(`writer.computador.erro.${e}`, { n: SENHA_MINIMA });

/** Põe o foco no primeiro campo (ou botão) da tela que acabou de aparecer. */
export function useFocoInicial(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const alvo = ref.current?.querySelector<HTMLElement>('[data-foco-inicial]') ?? ref.current?.querySelector<HTMLElement>('input, button');
    alvo?.focus();
  }, [dep]);
  return ref;
}

export function Moldura({ titulo, children, teste, foco }: { titulo: string; children: ComponentChildren; teste: string; foco: unknown }) {
  const ref = useFocoInicial(foco);
  return (
    <main class="tela-casca" data-teste={teste}>
      <div class="caixa-casca" ref={ref}>
        <img class="logo-casca" src={logo} alt="" width={64} height={64} />
        <h1>{titulo}</h1>
        {children}
      </div>
    </main>
  );
}

// ---------- o portão: pasta → senha → espelho ----------

export function PortaoDaCasca({ children }: { children: ComponentChildren }) {
  const estado = useEstadoCasca();
  const [escolhendo, setEscolhendo] = useState(false);
  if (!naCasca) return <>{children}</>;
  if (!estado) return <div class="tela-cheia-carregando" aria-busy="true" />;
  if (!estado.aberta) {
    if (escolhendo || !estado.pasta) return <EscolherPasta aoEscolher={() => setEscolhendo(false)} {...(estado.pasta ? { voltar: () => setEscolhendo(false) } : {})} />;
    return <Senha nova={!estado.temSenha} pasta={estado.pasta} trocar={() => setEscolhendo(true)} />;
  }
  if (estado.espelho === 'perguntar') return <PerguntaEspelho />;
  return <>{children}</>;
}

function EscolherPasta({ aoEscolher, voltar }: { aoEscolher: () => void; voltar?: () => void }) {
  const estado = useEstadoCasca();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!casca || !estado) return null;
  const usar = async (caminho: string | null) => {
    if (!caminho) return;
    setOcupado(true);
    setErro(null);
    const r = await casca.usarPasta(caminho);
    setOcupado(false);
    if (!r.ok) return setErro(textoDoErroCasca(r.erro));
    mudarEstado(r.estado);
    aoEscolher();
  };
  return (
    <Moldura titulo={t('writer.computador.pasta.titulo')} teste="casca-pasta" foco="pasta">
      <p>{t('writer.computador.pasta.texto')}</p>
      {estado.sumiu && (
        <p class="aviso-casca" role="status">
          {t('writer.computador.pasta.sumiu', { pasta: estado.sumiu })}
        </p>
      )}
      <div class="acoes-coluna">
        {estado.sumiu && (
          <button type="button" class="botao principal" disabled={ocupado} onClick={() => void usar(estado.sumiu)} data-foco-inicial data-teste="casca-tentar">
            {t('writer.computador.pasta.tentar')}
          </button>
        )}
        <button
          type="button"
          class={estado.sumiu ? 'botao' : 'botao principal'}
          disabled={ocupado}
          onClick={() => void usar(estado.sugerida)}
          {...(estado.sumiu ? {} : { 'data-foco-inicial': true })}
          data-teste="casca-sugerida"
        >
          {t('writer.computador.pasta.sugerida')}
        </button>
        <small class="dica pasta-casca">{estado.sugerida}</small>
        <button type="button" class="botao" disabled={ocupado} onClick={() => void casca.escolherPasta().then(usar)} data-teste="casca-outra-pasta">
          {t('writer.computador.pasta.outra')}
        </button>
        {voltar && (
          <button type="button" class="botao" onClick={voltar} data-teste="casca-voltar">
            {t('writer.baixar.voltar')}
          </button>
        )}
      </div>
      {erro && (
        <p class="ekf-erro" role="alert">
          {erro}
        </p>
      )}
    </Moldura>
  );
}

export function Senha({ nova, pasta, trocar, aviso }: { nova: boolean; pasta: string; trocar?: () => void; aviso?: string }) {
  const [senha, setSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!casca) return null;
  const enviar = async (e: Event) => {
    e.preventDefault();
    setErro(null);
    if (nova && senha.length < SENHA_MINIMA) return setErro(textoDoErroCasca('senha-curta'));
    if (nova && senha !== repetir) return setErro(textoDoErroCasca('diferentes'));
    setOcupado(true);
    const r: RespostaCasca = nova ? await casca.criarSenha(senha) : await casca.abrir(senha);
    setOcupado(false);
    if (!r.ok) {
      setSenha('');
      setRepetir('');
      return setErro(textoDoErroCasca(r.erro));
    }
    mudarEstado(r.estado);
  };
  return (
    <Moldura titulo={t(nova ? 'writer.computador.criar.titulo' : 'writer.computador.abrir.titulo')} teste={nova ? 'casca-criar-senha' : 'casca-abrir'} foco={`${nova}-${pasta}`}>
      <p>{t(nova ? 'writer.computador.criar.texto' : 'writer.computador.abrir.texto')}</p>
      {nova && aviso && <p class="aviso-casca">{aviso}</p>}
      <p class="dica pasta-casca">{t('writer.computador.pasta.em-uso', { pasta })}</p>
      <form class="form-casca" onSubmit={(e) => void enviar(e)} noValidate>
        <label class="campo">
          <span>{t('writer.computador.senha')}</span>
          <input
            type="password"
            autoComplete={nova ? 'new-password' : 'current-password'}
            value={senha}
            onInput={(e) => setSenha(e.currentTarget.value)}
            data-foco-inicial
            data-teste="casca-senha"
            aria-describedby={nova ? 'casca-senha-ajuda' : undefined}
          />
          {nova && (
            <small id="casca-senha-ajuda" class="dica">
              {t('writer.computador.senha.ajuda', { n: SENHA_MINIMA })}
            </small>
          )}
        </label>
        {nova && (
          <label class="campo">
            <span>{t('writer.computador.senha.repetir')}</span>
            <input type="password" autoComplete="new-password" value={repetir} onInput={(e) => setRepetir(e.currentTarget.value)} data-teste="casca-senha-repetir" />
          </label>
        )}
        {erro && (
          <p class="ekf-erro" role="alert" data-teste="casca-erro">
            {erro}
          </p>
        )}
        <div class="acoes-coluna">
          <button type="submit" class="botao principal" disabled={ocupado} aria-busy={ocupado} data-teste="casca-entrar">
            {t(nova ? 'writer.computador.criar.botao' : 'writer.computador.abrir.botao')}
          </button>
          {trocar && (
            <button type="button" class="botao" onClick={trocar} data-teste="casca-trocar-pasta">
              {t('writer.computador.trocar-pasta')}
            </button>
          )}
        </div>
      </form>
    </Moldura>
  );
}

export function PerguntaEspelho() {
  const [ocupado, setOcupado] = useState(false);
  if (!casca) return null;
  const responder = async (r: EscolhaEspelho) => {
    setOcupado(true);
    mudarEstado(await casca.responderEspelho(r));
  };
  return (
    <Moldura titulo={t('writer.computador.espelho.titulo')} teste="casca-espelho" foco="espelho">
      <p>{t('writer.computador.espelho.texto')}</p>
      <p class="aviso-casca">{t('writer.computador.espelho.aviso')}</p>
      <div class="acoes-coluna">
        <button type="button" class="botao" disabled={ocupado} onClick={() => void responder('sim')} data-teste="casca-espelho-sim">
          {t('writer.computador.espelho.sim')}
        </button>
        <button type="button" class="botao" disabled={ocupado} onClick={() => void responder('sempre')} data-teste="casca-espelho-sempre">
          {t('writer.computador.espelho.sempre')}
        </button>
        <button type="button" class="botao principal" disabled={ocupado} onClick={() => void responder('nao')} data-foco-inicial data-teste="casca-espelho-nao">
          {t('writer.computador.espelho.nao')}
        </button>
      </div>
    </Moldura>
  );
}

// ---------- o servidor (acima do formulário de entrar) ----------

const hostDe = (base: string): string => {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
};

export function EscolhaServidor() {
  const estado = useEstadoCasca();
  const [aberto, setAberto] = useState(false);
  const [endereco, setEndereco] = useState('');
  const [achado, setAchado] = useState<{ base: string; servidor: InfoServidor } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!casca || !estado) return null;
  const conferir = async (e: Event) => {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    setAchado(null);
    const r = await casca.conferirServidor(endereco);
    setOcupado(false);
    if (r.ok) setAchado({ base: r.base, servidor: r.servidor });
    else setErro(t(`writer.computador.servidor.erro.${r.erro}`));
  };
  return (
    <div class="servidor-casca" data-teste="casca-servidor">
      <p>
        <strong>{t('writer.computador.servidor.rotulo', { nome: hostDe(estado.servidor) })}</strong>
      </p>
      {!aberto && (
        <div class="acoes-linha">
          <button type="button" class="botao pequeno" onClick={() => setAberto(true)} data-teste="casca-servidor-outro">
            {t('writer.computador.servidor.outro')}
          </button>
          {!estado.servidorPadrao && (
            <button type="button" class="botao pequeno" onClick={() => void casca.usarServidor(null)} data-teste="casca-servidor-padrao">
              {t('writer.computador.servidor.voltar')}
            </button>
          )}
        </div>
      )}
      {aberto && (
        <form onSubmit={(e) => void conferir(e)} noValidate>
          <label class="campo">
            <span>{t('writer.computador.servidor.endereco')}</span>
            <input type="url" inputMode="url" autoComplete="url" value={endereco} onInput={(e) => setEndereco(e.currentTarget.value)} autoFocus data-teste="casca-servidor-endereco" />
          </label>
          <div class="acoes-linha">
            <button type="submit" class="botao" disabled={ocupado || !endereco.trim()} aria-busy={ocupado} data-teste="casca-servidor-conferir">
              {t('writer.computador.servidor.conferir')}
            </button>
            <button
              type="button"
              class="botao"
              onClick={() => {
                setAberto(false);
                setAchado(null);
                setErro(null);
              }}
            >
              {t('writer.computador.servidor.cancelar')}
            </button>
          </div>
          {erro && (
            <p class="ekf-erro" role="alert">
              {erro}
            </p>
          )}
          {achado && (
            <div role="status">
              <p>{t('writer.computador.servidor.achou', { nome: achado.servidor.nome })}</p>
              {!achado.servidor.aceitaCadastro && <p class="dica">{t('writer.computador.servidor.sem-cadastro')}</p>}
              <button type="button" class="botao principal" onClick={() => void casca.usarServidor(achado.base)} data-teste="casca-servidor-usar">
                {t('writer.computador.servidor.usar')}
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

// na casca, o servidor aparece acima do formulário de entrar e de criar conta (não no "esqueci a senha")
if (naCasca) definirAntesDoEntrar((modo) => (modo === 'esqueci' ? null : <EscolhaServidor />));

// ---------- dentro dos Ajustes ----------

export function AjustesDaCasca({ fechar }: { fechar: () => void }) {
  const estado = useEstadoCasca();
  if (!casca || !estado) return null;
  const ligado = estado.espelho === 'sim' || estado.espelho === 'sempre';
  return (
    <fieldset class="grupo-ajustes" data-teste="ajustes-casca">
      <legend>{t('writer.computador.ajustes.titulo')}</legend>
      <p>{t('writer.computador.ajustes.versao', { versao: casca.versao })}</p>
      {estado.pasta && <p class="pasta-casca">{t('writer.computador.pasta.em-uso', { pasta: estado.pasta })}</p>}
      <p>{ligado ? t('writer.computador.ajustes.espelho-ligado', { pasta: estado.pastaEspelho ?? '' }) : t('writer.computador.ajustes.espelho-desligado')}</p>
      {ligado && !estado.espelhoEmDia && <p class="dica">{t('writer.computador.ajustes.espelho-atrasado')}</p>}
      <div class="acoes-coluna">
        <button
          type="button"
          class="botao"
          onClick={() => void casca.responderEspelho(ligado ? 'nao' : 'sim').then(mudarEstado)}
          data-teste={ligado ? 'ajuste-espelho-desligar' : 'ajuste-espelho-ligar'}
        >
          {t(ligado ? 'writer.computador.ajustes.desligar-espelho' : 'writer.computador.ajustes.ligar-espelho')}
        </button>
        <button
          type="button"
          class="botao"
          onClick={() => {
            fechar();
            void trancar();
          }}
          data-teste="ajuste-trancar"
        >
          {t('writer.computador.ajustes.trancar')}
        </button>
      </div>
    </fieldset>
  );
}

// ---------- a página de download (no site) ----------

export function Baixar() {
  const ref = useFocoInicial('baixar');
  const rel = useRelease('writer-v', ['Ekfrase-Writer-Setup.exe', 'Ekfrase-Writer.AppImage']);
  return (
    <div ref={ref}>
      <PaginaApp t={t} tr={tr} app="writer" logo={logo} titulo={t('writer.baixar.titulo')} dataTeste="tela-baixar">
        <section class="ekf-pagina">
          <p>{t('writer.baixar.texto')}</p>
          <div class="ekf-linha">
            <a class="ekf-botao principal" href={enderecoDe(rel, 'Ekfrase-Writer-Setup.exe')} data-teste="baixar-windows">
              {t('writer.baixar.windows')}
            </a>
            <a class="ekf-botao" href={enderecoDe(rel, 'Ekfrase-Writer.AppImage')} data-teste="baixar-linux">
              {t('writer.baixar.linux')}
            </a>
          </div>
        </section>
        <section class="ekf-pagina">
          <h2>{t('writer.baixar.windows.titulo')}</h2>
          <p>{t('writer.baixar.windows.texto')}</p>
          <ol>
            <li>{t('writer.baixar.windows.1')}</li>
            <li>{t('writer.baixar.windows.2')}</li>
            <li>{t('writer.baixar.windows.3')}</li>
          </ol>
          <h2>{t('writer.baixar.linux.titulo')}</h2>
          <p>{t('writer.baixar.linux.texto')}</p>
        </section>
        <section class="ekf-pagina">
          <p>
            <a href="#/os" data-teste="baixar-ir-os">
              {t('writer.baixar.ir-os')}
            </a>
          </p>
          <p>
            <a href={LINKS.codigo} rel="noopener">
              {t('writer.baixar.codigo')}
            </a>
          </p>
        </section>
        <p class="ekf-voltar">
          <a class="ekf-botao" href="#/inicio" data-teste="baixar-voltar">
            {t('writer.inicio.voltar')}
          </a>
        </p>
      </PaginaApp>
    </div>
  );
}
