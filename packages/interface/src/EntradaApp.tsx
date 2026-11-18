// SPDX-License-Identifier: MPL-2.0

/**
 * A tela inicial de um app para quem ainda não entrou (e não está no passeio):
 * o topo do Ekfrase, o app em poucas palavras e as formas de usar —
 *   1. o app para o computador (baixar; chega com o Motor Ekfrase),
 *   2. o online (precisa entrar; os arquivos ficam na nuvem),
 *   3. exportar e importar arquivos (só nos apps que têm arquivo).
 * No passeio, o mesmo papel é do hall da torre do app no castelo.
 */
import type { Tradutor } from '@ekfrase/nucleo';
import type { ComponentChildren, VNode } from 'preact';
import { useState } from 'preact/hooks';
import { FormConta, type ModoConta } from './Conta.tsx';
import { IconeBaixar, IconeNuvem, IconePendrive, IconeTroca } from './icones.tsx';
import { Janela } from './Janela.tsx';
import { jogo } from './enderecos.ts';
import type { Conta } from './ponte.ts';
import { RodapeEkfrase } from './Rodape.tsx';
import { TopoEkfrase } from './Topo.tsx';
import type { T } from './tipos.ts';

export interface EntradaAppProps {
  t: T;
  tr: Tradutor;
  /** "maker", "vernakula"… (feedback, e-mail de senha, passeio). */
  app: string;
  /** Sem o botão do passeio (o modo jogo): só o Writer OS, onde nada leva para fora do app. */
  semPasseio?: boolean;
  /** Em vez de levar ao castelo, o botão do passeio faz isto (o Writer no computador, até o castelo existir lá). */
  aoPasseio?: () => void;
  /** Botões a mais no topo, antes dos de sempre (a engrenagem do sistema no Writer OS: Desligar sem entrar no app). */
  antesNoTopo?: ComponentChildren;
  logo: string;
  nome: string;
  descricao: string;
  /** Quem chega pode criar a própria conta (no Vernákula também, desde as escolas pedidas: DEC-P059). */
  podeCriar: boolean;
  /** O app guarda arquivos que se exportam e importam (o .ekfr do Maker). */
  arquivos: boolean;
  /** Entrou: o app abre. */
  aoEntrar: (c: Conta) => void;
  /** Em vez da janela de entrar, o app tem a própria tela (o Vernákula). */
  entrarProprio?: (modo: ModoConta) => void;
  aoTrocarIdioma?: (codigo: string) => void;
  /**
   * Mais uma forma de usar, própria do app (os textos vêm dele): o "escrever sem conta" do Writer,
   * que guarda tudo só neste aparelho. Aparece como o primeiro cartão.
   */
  outraForma?: { icone?: VNode; titulo: string; texto: string; botao: string; aoEscolher: () => void };
  /**
   * O app para o computador: sem isto, o cartão diz "Em breve" (até o Motor); com `aoEscolher`, o
   * botão Baixar leva à página de download do app; `null` esconde o cartão (já está no computador).
   */
  computador?: { aoEscolher: () => void } | null;
  /** O app num pendrive (o Writer OS): botão que leva à página dele; sem isto, o cartão não aparece. */
  pendrive?: { aoEscolher: () => void; titulo?: string; texto?: string } | null;
  /**
   * Quem já tem onde escrever (conta ou "sem conta") e voltou ao hall: no lugar de "Escrever sem conta"
   * e "Online" (entrar), um só cartão que abre o app.
   */
  emCasa?: { icone?: VNode; titulo: string; texto: string; botao: string; aoEscolher: () => void };
  /** Atalho do `emCasa` com os textos comuns (`nucleo.entrada.casa.*`): quem já pode entrar no app (conta, ou app sem conta) vê "Abrir <app>". */
  aoAbrir?: () => void;
}

export function EntradaApp(p: EntradaAppProps) {
  const { t } = p;
  const [janela, setJanela] = useState<ModoConta | null>(null);
  const casa =
    p.emCasa ??
    (p.aoAbrir
      ? { titulo: t('nucleo.entrada.casa.titulo'), texto: t('nucleo.entrada.casa.texto', { nome: p.nome }), botao: t('nucleo.entrada.casa.botao', { nome: p.nome }), aoEscolher: p.aoAbrir }
      : undefined);
  const abrir = (m: ModoConta) => (p.entrarProprio ? p.entrarProprio(m) : setJanela(m));
  return (
    <div class="ekf-entrada-app">
      <TopoEkfrase t={t} tr={p.tr} app={p.app} {...(p.semPasseio ? {} : { passeio: p.aoPasseio ?? jogo.hall(p.app) })} {...(p.aoTrocarIdioma ? { aoTrocarIdioma: p.aoTrocarIdioma } : {})} {...(p.antesNoTopo ? { antes: p.antesNoTopo } : {})} />
      <main class="ekf-entrada-miolo">
        <section class="ekf-heroi">
          <img class="ekf-heroi-logo" src={p.logo} width={96} height={96} alt="" />
          <div>
            <h1>{p.nome}</h1>
            <p>{p.descricao}</p>
          </div>
        </section>
        <ul class="ekf-formas">
          {casa && (
            <li class="ekf-forma">
              {casa.icone ?? <IconeNuvem tamanho={36} />}
              <h2>{casa.titulo}</h2>
              <p>{casa.texto}</p>
              <div class="ekf-linha">
                <button type="button" class="ekf-botao principal" data-teste="entrada-abrir" onClick={casa.aoEscolher}>
                  {casa.botao}
                </button>
              </div>
            </li>
          )}
          {!casa && p.outraForma && (
            <li class="ekf-forma">
              {p.outraForma.icone}
              <h2>{p.outraForma.titulo}</h2>
              <p>{p.outraForma.texto}</p>
              <div class="ekf-linha">
                <button type="button" class="ekf-botao principal" data-teste="entrada-outra-forma" onClick={p.outraForma.aoEscolher}>
                  {p.outraForma.botao}
                </button>
              </div>
            </li>
          )}
          {!casa && (
          <li class="ekf-forma">
            <IconeNuvem tamanho={36} />
            <h2>{t('nucleo.entrada.online.titulo')}</h2>
            <p>{t('nucleo.entrada.online.texto')}</p>
            <div class="ekf-linha">
              <button type="button" class="ekf-botao principal" onClick={() => abrir('entrar')}>
                {t('nucleo.conta.entrar.botao')}
              </button>
              {p.podeCriar && (
                <button type="button" class="ekf-botao" onClick={() => abrir('criar')}>
                  {t('nucleo.conta.criar.botao')}
                </button>
              )}
            </div>
          </li>
          )}
          {p.computador !== null && (
            <li class="ekf-forma">
              <IconeBaixar tamanho={36} />
              <h2>{t('nucleo.entrada.computador.titulo')}</h2>
              <p>{t('nucleo.entrada.computador.texto')}</p>
              <div class="ekf-linha">
                {p.computador ? (
                  <button type="button" class="ekf-botao" data-teste="entrada-computador" onClick={p.computador.aoEscolher}>
                    {t('nucleo.entrada.computador.baixar')}
                  </button>
                ) : (
                  <button type="button" class="ekf-botao" disabled>
                    {t('nucleo.entrada.computador.breve')}
                  </button>
                )}
              </div>
            </li>
          )}
          {p.pendrive && (
            <li class="ekf-forma">
              <IconePendrive tamanho={36} />
              <h2>{p.pendrive.titulo ?? t('nucleo.entrada.pendrive.titulo')}</h2>
              <p>{p.pendrive.texto ?? t('nucleo.entrada.pendrive.texto')}</p>
              <div class="ekf-linha">
                <button type="button" class="ekf-botao" data-teste="entrada-pendrive" onClick={p.pendrive.aoEscolher}>
                  {t('nucleo.entrada.pendrive.ver')}
                </button>
              </div>
            </li>
          )}
          {p.arquivos && (
            <li class="ekf-forma">
              <IconeTroca tamanho={36} />
              <h2>{t('nucleo.entrada.arquivos.titulo')}</h2>
              <p>{t('nucleo.entrada.arquivos.texto')}</p>
            </li>
          )}
        </ul>
      </main>
      <RodapeEkfrase t={t} completo />
      {janela && (
        <Janela titulo={t('nucleo.conta.titulo')} t={t} fechar={() => setJanela(null)}>
          <FormConta
            t={t}
            app={p.app}
            idioma={p.tr.idioma()}
            inicial={janela}
            podeCriar={p.podeCriar}
            aoEntrar={(c) => {
              setJanela(null);
              p.aoEntrar(c);
            }}
          />
        </Janela>
      )}
    </div>
  );
}
