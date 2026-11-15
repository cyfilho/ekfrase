// SPDX-License-Identifier: MPL-2.0

/**
 * A PALETA DE COMANDOS (Ctrl+K) e a LISTA DE ATALHOS (F1 ou ?), PLANO §2.4. A paleta mostra todos
 * os comandos da tela aberta e os gerais, mais "ir para" cada história; a busca ignora acentos.
 * ↑ ↓ escolhem, Enter faz, Esc fecha.
 */
import type { TargetedKeyboardEvent } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { atalhoBonito, buscarComandos, comandosDeAgora, type Comando } from './comandos.ts';
import { useSessao } from './estado.ts';
import { ir } from './rotas.ts';
import { t } from './textos.ts';
import { Camada } from './ui.tsx';

export function Paleta({ fechar }: { fechar: () => void }) {
  const s = useSessao();
  const [busca, setBusca] = useState('');
  const [ativo, setAtivo] = useState(0);
  const [historias, setHistorias] = useState<Comando[]>([]);
  const lista = useRef<HTMLUListElement>(null);
  const comandos = useMemo(() => comandosDeAgora(), []);

  useEffect(() => {
    void s.escrita.historias().then((hs) =>
      setHistorias(
        hs.map((h) => ({
          id: `ir-historia-${h.id}`,
          rotulo: t('writer.cmd.ir-historia', { titulo: h.titulo || t('writer.historia.sem-titulo') }),
          fazer: () => ir({ tela: 'historia', id: h.id }),
        })),
      ),
    );
  }, []);

  const achados = useMemo(() => buscarComandos([...comandos, ...historias], busca), [comandos, historias, busca]);
  useEffect(() => setAtivo(0), [busca]);
  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-indice="${ativo}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [ativo]);

  const fazer = (c: Comando | undefined) => {
    if (!c) return;
    fechar();
    // depois de a paleta fechar (e devolver o foco), o comando pode levar o foco para onde quiser
    setTimeout(c.fazer, 0);
  };

  const tecla = (e: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = achados.length;
      if (n) setAtivo((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      fazer(achados[ativo]);
    }
  };

  const idAtivo = achados[ativo] ? `paleta-${achados[ativo]!.id}` : undefined;
  return (
    <Camada titulo={t('writer.paleta.titulo')} fechar={fechar} teste="paleta" classe="paleta">
      <label class="so-leitor" for="paleta-busca">
        {t('writer.paleta.buscar')}
      </label>
      <input
        id="paleta-busca"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls="paleta-lista"
        aria-activedescendant={idAtivo}
        autocomplete="off"
        placeholder={t('writer.paleta.buscar')}
        value={busca}
        onInput={(e) => setBusca(e.currentTarget.value)}
        onKeyDown={tecla}
        data-foco-inicial
        data-teste="paleta-busca"
      />
      <ul id="paleta-lista" class="paleta-lista" role="listbox" ref={lista} aria-label={t('writer.paleta.titulo')}>
        {achados.map((c, i) => (
          <li
            key={c.id}
            id={`paleta-${c.id}`}
            role="option"
            aria-selected={i === ativo}
            data-indice={i}
            data-teste={`cmd-${c.id}`}
            class={i === ativo ? 'ativo' : undefined}
            onClick={() => fazer(c)}
            onMouseMove={() => setAtivo(i)}
          >
            <span>{c.rotulo}</span>
            {c.atalho && <kbd>{atalhoBonito(c.atalho)}</kbd>}
          </li>
        ))}
        {!achados.length && <li class="dica">{t('writer.paleta.nada')}</li>}
      </ul>
    </Camada>
  );
}

/** Os atalhos que não são comandos da paleta (os do texto e os da árvore). */
const FIXOS: readonly [atalho: string, chave: string][] = [
  ['Ctrl+B', 'writer.atalho.negrito'],
  ['Ctrl+E', 'writer.atalho.italico'],
  ['--', 'writer.atalho.travessao'],
  ['Ctrl+Z', 'writer.atalho.desfazer'],
  ['Ctrl+Y', 'writer.atalho.refazer'],
  ['Tab', 'writer.atalho.tab'],
  ['↑ ↓', 'writer.atalho.setas'],
  ['Alt+↑ ↓', 'writer.atalho.mover'],
  ['Alt+→', 'writer.atalho.entrar'],
  ['Alt+←', 'writer.atalho.sair'],
  ['Enter', 'writer.atalho.abrir'],
  ['F2', 'writer.atalho.renomear'],
  ['Delete', 'writer.atalho.apagar'],
  ['Esc', 'writer.atalho.esc'],
];

export function Atalhos({ fechar }: { fechar: () => void }) {
  const comandos = comandosDeAgora().filter((c) => c.atalho);
  return (
    <Camada titulo={t('writer.atalhos.titulo')} fechar={fechar} teste="atalhos">
      <h3>{t('writer.atalhos.gerais')}</h3>
      <dl class="atalhos">
        {comandos.map((c) => (
          <div key={c.id}>
            <dt>
              <kbd>{atalhoBonito(c.atalho!)}</kbd>
              {c.atalho === 'F1' && (
                <>
                  {' '}
                  <kbd>?</kbd>
                </>
              )}
            </dt>
            <dd>{c.rotulo}</dd>
          </div>
        ))}
      </dl>
      <h3>{t('writer.atalhos.texto-arvore')}</h3>
      <dl class="atalhos">
        {FIXOS.map(([a, chave]) => (
          <div key={a}>
            <dt>
              <kbd>{a}</kbd>
            </dt>
            <dd>{t(chave)}</dd>
          </div>
        ))}
      </dl>
    </Camada>
  );
}
