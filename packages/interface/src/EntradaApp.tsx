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
import { useState } from 'preact/hooks';
import { FormConta, type ModoConta } from './Conta.tsx';
import { IconeBaixar, IconeNuvem, IconeTroca } from './icones.tsx';
import { Janela } from './Janela.tsx';
import type { Conta } from './ponte.ts';
import { RodapeEkfrase } from './Rodape.tsx';
import { TopoEkfrase } from './Topo.tsx';
import type { T } from './tipos.ts';

export interface EntradaAppProps {
  t: T;
  tr: Tradutor;
  /** "maker", "vernakula"… (feedback, e-mail de senha, passeio). */
  app: string;
  logo: string;
  nome: string;
  descricao: string;
  /** Quem chega pode criar a própria conta (no Vernákula, quem cria é a escola). */
  podeCriar: boolean;
  /** O app guarda arquivos que se exportam e importam (o .ekfr do Maker). */
  arquivos: boolean;
  /** Entrou: o app abre. */
  aoEntrar: (c: Conta) => void;
  /** Em vez da janela de entrar, o app tem a própria tela (o Vernákula). */
  entrarProprio?: () => void;
  aoTrocarIdioma?: (codigo: string) => void;
}

export function EntradaApp(p: EntradaAppProps) {
  const { t } = p;
  const [janela, setJanela] = useState<ModoConta | null>(null);
  const abrir = (m: ModoConta) => (p.entrarProprio ? p.entrarProprio() : setJanela(m));
  return (
    <div class="ekf-entrada-app">
      <TopoEkfrase t={t} tr={p.tr} app={p.app} passeio={`/#/torre/${p.app}`} {...(p.aoTrocarIdioma ? { aoTrocarIdioma: p.aoTrocarIdioma } : {})} />
      <main class="ekf-entrada-miolo">
        <section class="ekf-heroi">
          <img class="ekf-heroi-logo" src={p.logo} width={96} height={96} alt="" />
          <div>
            <h1>{p.nome}</h1>
            <p>{p.descricao}</p>
          </div>
        </section>
        <ul class="ekf-formas">
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
          <li class="ekf-forma">
            <IconeBaixar tamanho={36} />
            <h2>{t('nucleo.entrada.computador.titulo')}</h2>
            <p>{t('nucleo.entrada.computador.texto')}</p>
            <div class="ekf-linha">
              <button type="button" class="ekf-botao" disabled>
                {t('nucleo.entrada.computador.breve')}
              </button>
            </div>
          </li>
          {p.arquivos && (
            <li class="ekf-forma">
              <IconeTroca tamanho={36} />
              <h2>{t('nucleo.entrada.arquivos.titulo')}</h2>
              <p>{t('nucleo.entrada.arquivos.texto')}</p>
            </li>
          )}
        </ul>
      </main>
      <RodapeEkfrase t={t} />
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
