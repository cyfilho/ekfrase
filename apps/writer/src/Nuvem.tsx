// SPDX-License-Identifier: MPL-2.0

/**
 * O INDICADOR da nuvem (PLANO §4.4): nuvem cheia = tudo na nuvem; nuvem com a seta = enviando; nuvem
 * apagada = sem internet ou sem conta (salvo só no aparelho); aviso = o servidor recusou; aviso
 * âmbar "RAM" = só na memória (o navegador não deixou gravar: some ao fechar).
 *
 * Nada só no `title` (§2.4: nada que só funcione com hover): com problema, a palavra "Problema"
 * aparece ao lado do ícone; apertar (dedo, mouse ou teclado) mostra o motivo inteiro num aviso e,
 * com conta, sincroniza agora.
 */
import { IconeNuvem } from '@ekfrase/interface';
import type { EstadoSinc } from '@ekfrase/writer-nucleo';
import { useSessao, useSinc } from './estado.ts';
import { IconeAviso, IconeSobe } from './icones.tsx';
import { t, textoDoErro } from './textos.ts';
import { avisar } from './ui.tsx';

export function textoDaNuvem(e: EstadoSinc, soMemoria: boolean): string {
  if (soMemoria) return t('writer.nuvem.memoria');
  if (e.situacao === 'erro') return t('writer.nuvem.erro', { erro: textoDoErro(e.erro) });
  if (e.situacao === 'enviando' && e.pendentes > 0) return t('writer.nuvem.pendentes', { count: e.pendentes, n: e.pendentes });
  return t(`writer.nuvem.${e.situacao}`);
}

/** Duas frases juntas, sem ponto dobrado ("…enviar.. Apertar"). */
const juntar = (a: string, b: string): string => `${/[.!?…]$/.test(a) ? a : `${a}.`} ${b}`;

export function Nuvem() {
  const s = useSessao();
  const e = useSinc();
  const texto = textoDaNuvem(e, s.soMemoria);
  const situacao = s.soMemoria ? 'memoria' : e.situacao;
  const problema = situacao === 'erro' || situacao === 'memoria';
  const icone = problema ? <IconeAviso tamanho={16} /> : e.situacao === 'enviando' ? <IconeSobe tamanho={16} /> : <IconeNuvem tamanho={20} />;
  const titulo = s.conta ? juntar(texto, t('writer.nuvem.agora')) : texto;
  const apertar = () => {
    avisar(texto, problema ? 'erro' : 'ok');
    if (s.conta) void s.sinc.sincronizar();
  };
  return (
    <button type="button" class={`nuvem ${situacao}`} title={titulo} aria-label={titulo} onClick={apertar} data-teste="nuvem" data-situacao={situacao}>
      <span class="nuvem-icone">{icone}</span>
      {problema && (
        <span class="nuvem-texto" aria-hidden="true">
          {t('writer.nuvem.problema')}
        </span>
      )}
    </button>
  );
}
