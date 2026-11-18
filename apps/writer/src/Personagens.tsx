// SPDX-License-Identifier: MPL-2.0

/**
 * PERSONAGENS (simples, PLANO §2.1 item 5): nome, papel, desejo, necessidade, medo e notas. Cada
 * personagem é um <details> (abre com Enter ou Espaço) com os campos que gravam sozinhos.
 */
import type { Personagem } from '@ekfrase/writer-nucleo';
import { useRef } from 'preact/hooks';
import { useComandos } from './comandos.ts';
import { useSessao, useVivo } from './estado.ts';
import { IconeMais } from './icones.tsx';
import { useHistoriaDeAgora } from './pedidos.ts';
import { t, textoDoErro } from './textos.ts';
import { Campo, avisar, confirmar } from './ui.tsx';
import { noApp } from '@ekfrase/interface';

const falhou = (e: unknown) => avisar(textoDoErro((e as { codigo?: string }).codigo), 'erro');

type CampoP = 'nome' | 'papel' | 'desejo' | 'necessidade' | 'medo' | 'notas';

export function Personagens({ historia }: { historia: string }) {
  const s = useSessao();
  useHistoriaDeAgora(historia);
  const dados = useVivo(async (x) => ({ historia: await x.escrita.historia(historia), personagens: await x.escrita.personagens(historia) }), [historia]);
  const novo = useRef<string | null>(null);

  const criar = async () => {
    try {
      const p = await s.escrita.criarPersonagem(historia, { nome: t('writer.personagem.novo') });
      novo.current = p.id;
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>(`[data-personagem="${p.id}"] input`);
        el?.focus();
        el?.select();
      }, 50);
    } catch (e) {
      falhou(e);
    }
  };
  useComandos(() => [{ id: 'novo-personagem', rotulo: t('writer.personagem.criar'), fazer: () => void criar() }]);

  if (dados === null) return <p class="vazio">{t('writer.historia.nao-existe')}</p>;
  if (!dados) return <p class="carregando">{t('writer.carregando')}</p>;

  const apagar = async (p: Personagem) => {
    if (!(await confirmar(t('writer.personagem.apagar-pergunta', { nome: p.nome }), t('writer.apagar'), true))) return;
    await s.escrita.apagarPersonagem(p.id).catch(falhou);
    avisar(t('writer.apagado'));
  };
  const editar = (p: Personagem, campo: CampoP) => (v: string) => s.escrita.editarPersonagem(p.id, { [campo]: v });

  return (
    <div class="tela-personagens" data-teste="tela-personagens">
      <header class="cabeca-tela">
        <h1>{t('writer.personagens.titulo')}</h1>
        <button type="button" class="botao principal" onClick={() => void criar()} data-teste="novo-personagem">
          <IconeMais tamanho={14} /> {t('writer.personagem.criar')}
        </button>
      </header>
      <p>
        <a href={noApp('writer', `historia/${historia}`)}>{t('writer.voltar-para', { titulo: dados.historia.titulo || t('writer.historia.sem-titulo') })}</a>
      </p>
      {dados.personagens.length === 0 && (
        <div class="vazio">
          <p>{t('writer.personagens.vazio')}</p>
        </div>
      )}
      <ul class="personagens">
        {dados.personagens.map((p) => (
          <li key={p.id} data-personagem={p.id}>
            <details class="personagem" open={novo.current === p.id || dados.personagens.length === 1}>
              <summary data-teste="personagem">
                <strong>{p.nome || t('writer.personagem.sem-nome')}</strong>
                {p.papel && <span class="dica"> · {p.papel}</span>}
              </summary>
              <div class="personagem-campos">
                <Campo rotulo={t('writer.personagem.nome')} valor={p.nome} gravar={editar(p, 'nome')} teste="personagem-nome" />
                <Campo rotulo={t('writer.personagem.papel')} valor={p.papel} gravar={editar(p, 'papel')} />
                <Campo rotulo={t('writer.personagem.desejo')} valor={p.desejo} tipo="area" linhas={2} gravar={editar(p, 'desejo')} />
                <Campo rotulo={t('writer.personagem.necessidade')} valor={p.necessidade} tipo="area" linhas={2} gravar={editar(p, 'necessidade')} />
                <Campo rotulo={t('writer.personagem.medo')} valor={p.medo} tipo="area" linhas={2} gravar={editar(p, 'medo')} />
                <Campo rotulo={t('writer.personagem.notas')} valor={p.notas} tipo="area" linhas={4} gravar={editar(p, 'notas')} />
                <div class="acoes-linha">
                  <button type="button" class="botao perigo" onClick={() => void apagar(p)}>
                    {t('writer.apagar')}
                  </button>
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
