// SPDX-License-Identifier: MPL-2.0

import type { Tradutor } from '@ekfrase/nucleo';
import logoEkfrase from '@ekfrase/nucleo/estilo/img/ekfrase-logo.png';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { BotaoTema } from './BotaoTema.tsx';
import { BotaoFeedback } from './Feedback.tsx';
import { IconePasseio, IconePessoa } from './icones.tsx';
import { Menu } from './Menu.tsx';
import { FormConta } from './Conta.tsx';
import { Janela } from './Janela.tsx';
import { ambienteFechado } from './ambiente.ts';
import { site } from './enderecos.ts';
import { aoMudarConta, aoMudarPerfil, contaAtual, eu, sair, verPerfil, type Conta } from './ponte.ts';
import { SeletorIdioma } from './SeletorIdioma.tsx';
import type { T } from './tipos.ts';

/** A conta de quem está usando, sempre atual (a mesma em todo o site). */
export function useConta(): { carregando: boolean; conta: Conta | null } {
  const [, setV] = useState(0);
  useEffect(() => {
    const parar = aoMudarConta(() => setV((n) => n + 1));
    void eu();
    return parar;
  }, []);
  const e = contaAtual();
  return e.carregando ? { carregando: true, conta: null } : { carregando: false, conta: e.conta };
}

/**
 * O passeio deste app: a torre dele no castelo do Ekfrase (DEC-P040). Com uma função no lugar do endereço
 * (o Writer no computador, onde o castelo só existe com o Motor), o botão chama a função em vez de navegar.
 */
export function BotaoPasseio({ t, href }: { t: T; href: string | (() => void) }) {
  const rotulo = t('nucleo.passeio.titulo');
  if (typeof href === 'function') {
    return (
      <button type="button" class="ekf-icone" title={rotulo} aria-label={rotulo} onClick={href} data-teste="botao-passeio">
        <IconePasseio />
      </button>
    );
  }
  return (
    <a class="ekf-icone" href={href} title={rotulo} aria-label={rotulo}>
      <IconePasseio />
    </a>
  );
}

/** A foto de perfil de quem entrou (ou null), sempre atual. */
export function useFoto(): string | null {
  const [foto, setFoto] = useState<string | null>(null);
  useEffect(() => {
    const parar = aoMudarPerfil((p) => setFoto(p?.foto ?? null));
    void verPerfil().then((p) => setFoto(p?.foto ?? null));
    return parar;
  }, []);
  return foto;
}

/**
 * Quem entrou: a foto (ou o ícone), o nome, a conta Ekfrase (personagem, foto, inventário, apps),
 * a área da equipe (feedback, pedidos de escola; só a equipe) e Sair. Sem conta: nada, ou, com `comEntrar`, o botão Entrar
 * (a conta Ekfrase é opcional: passear e baixar não pedem conta, DEC-P050).
 */
export function BotaoConta({ t, aoSair, comEntrar }: { t: T; aoSair?: () => void; comEntrar?: boolean }) {
  const { conta, carregando } = useConta();
  const foto = useFoto();
  const [entrando, setEntrando] = useState(false);
  if (!conta) {
    if (!comEntrar || carregando) return null;
    const rotulo = t('nucleo.conta.entrar.ekfrase');
    return (
      <>
        <button type="button" class="ekf-icone" title={rotulo} aria-label={rotulo} onClick={() => setEntrando(true)}>
          <IconePessoa />
        </button>
        {entrando && (
          <Janela titulo={t('nucleo.conta.titulo')} t={t} fechar={() => setEntrando(false)}>
            <p>{t('nucleo.conta.ekfrase.explicacao')}</p>
            <FormConta t={t} app="ekfrase" idioma={document.documentElement.lang || 'pt-BR'} podeCriar aoEntrar={() => setEntrando(false)} />
          </Janela>
        )}
      </>
    );
  }
  return (
    <Menu rotulo={t('nucleo.conta.menu', { nome: conta.nome })} icone={foto ? <img class="ekf-foto" src={foto} alt="" width={20} height={20} /> : <IconePessoa />}>
      {(fechar) => (
        <>
          <p class="ekf-menu-cabeca">
            {foto && <img class="ekf-foto grande" src={foto} alt="" width={40} height={40} />}
            <strong>{conta.nome}</strong>
            <small>{conta.email}</small>
          </p>
          {!ambienteFechado() && (
            <>
              <a role="menuitem" href={site.conta}>
                {t('nucleo.conta.ekfrase.link')}
              </a>
              <a role="menuitem" href={site.inventario}>
                {t('nucleo.inventario.titulo')}
              </a>
              {conta.equipe && (
                <a role="menuitem" href={site.equipe}>
                  {t('nucleo.equipe.titulo')}
                </a>
              )}
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              fechar();
              void sair().then(() => aoSair?.());
            }}
          >
            {t('nucleo.conta.sair')}
          </button>
        </>
      )}
    </Menu>
  );
}

export interface AcoesTopoProps {
  t: T;
  tr: Tradutor;
  /** O app de onde vem o feedback ("castelo", "maker"…). */
  app: string;
  /** Endereço do passeio deste app (sem = sem botão); uma função = o botão faz isso em vez de navegar. */
  passeio?: string | (() => void);
  /** Botões a mais, antes dos de sempre (o "Lugares" do castelo). */
  antes?: ComponentChildren;
  /** Botões a mais, depois de todos (na ponta direita): a engrenagem do menu do sistema no Writer OS (pedido do Alcy, 18/11). */
  depois?: ComponentChildren;
  aoTrocarIdioma?: (codigo: string) => void;
  aoSair?: () => void;
  /** Sem conta, mostrar o botão Entrar (conta Ekfrase). */
  entrar?: boolean;
  /** Sem o botão da conta (o Writer OS põe a conta no menu do sistema). */
  semConta?: boolean;
}

/** Os botões do topo, iguais em todo app: [antes] passeio · idioma · tema · feedback · conta [depois]. */
export function AcoesTopo(p: AcoesTopoProps) {
  return (
    <div class="ekf-acoes">
      {p.antes}
      {p.passeio !== undefined && <BotaoPasseio t={p.t} href={p.passeio} />}
      <SeletorIdioma tr={p.tr} {...(p.aoTrocarIdioma ? { aoTrocar: p.aoTrocarIdioma } : {})} />
      <BotaoTema t={p.t} />
      <BotaoFeedback t={p.t} app={p.app} />
      {!p.semConta && <BotaoConta t={p.t} {...(p.aoSair ? { aoSair: p.aoSair } : {})} {...(p.entrar ? { comEntrar: true } : {})} />}
      {p.depois}
    </div>
  );
}

/** O topo do Ekfrase (a entrada do site, a tela inicial de cada app): a marca e os botões. */
export function TopoEkfrase(p: AcoesTopoProps) {
  return (
    <header class="ekf-topo">
      {ambienteFechado() ? (
        <span class="ekf-marca">
          <img src={logoEkfrase} width={48} height={36} alt="" />
          <span>Ekfrase</span>
        </span>
      ) : (
        <a class="ekf-marca" href="/">
          <img src={logoEkfrase} width={48} height={36} alt="" />
          <span>Ekfrase</span>
        </a>
      )}
      <AcoesTopo {...p} />
    </header>
  );
}
