// SPDX-License-Identifier: MPL-2.0

/**
 * Os AJUSTES (Ctrl+,): a meta de palavras do dia, os modos da folha (máquina de escrever, foco), o
 * tamanho da letra e onde os textos estão guardados. Tudo vale só neste aparelho.
 */
import { useEffect, useState } from 'preact/hooks';
import { pulsar, textosLocais, useSessao, useVivo } from './estado.ts';
import { pedir } from './pedidos.ts';
import { LETRA_MAX, LETRA_MIN, mudarPrefs, usePrefs } from './prefs.ts';
import { t } from './textos.ts';
import { Camada, Campo } from './ui.tsx';
import { naCasca } from './computador/casca.ts';
import { AjustesDaCasca } from './computador/Telas.tsx';

export function Ajustes({ fechar }: { fechar: () => void }) {
  const s = useSessao();
  const p = usePrefs();
  const meta = useVivo((x) => x.escrita.metaDoDia(), []);
  const [locais, setLocais] = useState<{ historias: number; ideias: number } | null>(null);
  useEffect(() => {
    if (s.conta) void textosLocais().then(setLocais);
  }, [s.conta?.id]);

  return (
    <Camada titulo={t('writer.ajustes.titulo')} fechar={fechar} teste="ajustes">
      <Campo
        rotulo={t('writer.ajustes.meta-dia')}
        valor={meta ?? 0}
        tipo="numero"
        dica={t('writer.meta.zero')}
        gravar={async (v) => {
          await s.escrita.definirMetaDoDia(Number(v) || 0);
          pulsar();
        }}
        focoInicial
        teste="ajuste-meta"
      />
      <fieldset class="grupo-ajustes">
        <legend>{t('writer.ajustes.folha')}</legend>
        <label class="marcar">
          <input type="checkbox" checked={p.maquina} onChange={(e) => mudarPrefs({ maquina: e.currentTarget.checked })} data-teste="ajuste-maquina" />
          {t('writer.modo.maquina')}
        </label>
        <small class="dica">{t('writer.ajustes.maquina-dica')}</small>
        <label class="marcar">
          <input type="checkbox" checked={p.foco} onChange={(e) => mudarPrefs({ foco: e.currentTarget.checked })} data-teste="ajuste-foco" />
          {t('writer.modo.foco')}
        </label>
        <small class="dica">{t('writer.ajustes.foco-dica')}</small>
        <label>
          {t('writer.ajustes.letra', { n: p.letra })}
          <input type="range" min={LETRA_MIN} max={LETRA_MAX} step={1} value={p.letra} onInput={(e) => mudarPrefs({ letra: Number(e.currentTarget.value) })} data-teste="ajuste-letra" />
        </label>
        <p class="amostra-letra" style={{ fontSize: `${p.letra}px` }}>
          {t('writer.ajustes.amostra')}
        </p>
      </fieldset>
      <fieldset class="grupo-ajustes">
        <legend>{t('writer.ajustes.onde')}</legend>
        <p>{s.soMemoria ? t('writer.ajustes.onde-memoria') : s.conta ? t('writer.ajustes.onde-conta', { nome: s.conta.nome }) : t(naCasca ? 'writer.computador.ajustes.onde-local' : 'writer.ajustes.onde-local')}</p>
        {s.conta && locais && (locais.historias > 0 || locais.ideias > 0) && (
          <button
            type="button"
            class="botao"
            onClick={() => {
              fechar();
              setTimeout(() => pedir('levar'), 0);
            }}
            data-teste="ajuste-levar"
          >
            {t('writer.levar.botao')}
          </button>
        )}
        {!s.conta && p.semConta && (
          <button
            type="button"
            class="botao pequeno"
            onClick={() => {
              mudarPrefs({ semConta: false });
              fechar();
            }}
          >
            {t('writer.ajustes.ver-entrada')}
          </button>
        )}
      </fieldset>
      <AjustesDaCasca fechar={fechar} />
    </Camada>
  );
}
