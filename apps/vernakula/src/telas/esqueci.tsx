// SPDX-License-Identifier: MPL-2.0

import { useState } from 'preact/hooks';
import { api, type Conta } from '../api.ts';
import { avisoDoErro, type Aviso } from '../avisos.ts';
import { enderecoDe, irPara } from '../rotas.ts';
import { t, tr } from '../textos.ts';
import { MostrarAviso } from './entrar.tsx';

/** Pede o link de senha nova. A resposta é a mesma tenha ou não conta (ninguém descobre quem tem). */
export function Esqueci() {
  const [email, setEmail] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | undefined>();

  async function enviar(e: Event) {
    e.preventDefault();
    if (!email.trim()) return setAviso({ chave: 'vernakula.esqueci.erro.email' });
    setOcupado(true);
    setAviso(undefined);
    const r = await api.esqueci(email.trim(), tr.idioma());
    setOcupado(false);
    setAviso(r.ok ? { chave: 'vernakula.esqueci.enviado', tipo: 'ok' } : avisoDoErro(r, 'vernakula.esqueci.erro', ['email', 'email_desligado']));
  }

  return (
    <section class="painel entrar" aria-labelledby="titulo-esqueci">
      <h1 id="titulo-esqueci">{t('vernakula.esqueci.titulo')}</h1>
      <p class="lema">{t('vernakula.esqueci.explicacao')}</p>
      <form onSubmit={enviar} noValidate>
        <label>
          {t('vernakula.entrar.email')}
          <input type="email" autocomplete="username" inputMode="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <MostrarAviso aviso={aviso} />
        <button type="submit" class="botao principal" disabled={ocupado} aria-busy={ocupado}>
          {ocupado ? t('vernakula.esqueci.ocupado') : t('vernakula.esqueci.botao')}
        </button>
      </form>
      <p class="link-abaixo">
        <a href="#">← {t('vernakula.esqueci.voltar')}</a>
      </p>
    </section>
  );
}

/** Chega pelo link do e-mail (/vernakula/redefinir/<código>): grava a senha nova e já entra. */
export function Redefinir({ codigo, aoEntrar }: { codigo: string; aoEntrar: (c: Conta) => void }) {
  const [nova, setNova] = useState('');
  const [repetir, setRepetir] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | undefined>();

  async function enviar(e: Event) {
    e.preventDefault();
    if (!nova || !repetir) return setAviso({ chave: 'vernakula.redefinir.erro.vazio' });
    if (nova !== repetir) return setAviso({ chave: 'vernakula.redefinir.erro.repetir' });
    setOcupado(true);
    setAviso(undefined);
    const r = await api.redefinir(codigo, nova);
    setOcupado(false);
    if (r.ok) {
      irPara('inicio');
      return aoEntrar(r.conta);
    }
    setAviso(avisoDoErro(r, 'vernakula.redefinir.erro', ['senha_curta', 'codigo_invalido']));
  }

  const vencido = aviso?.chave === 'vernakula.redefinir.erro.codigo_invalido';
  return (
    <section class="painel entrar" aria-labelledby="titulo-redefinir">
      <h1 id="titulo-redefinir">{t('vernakula.redefinir.titulo')}</h1>
      <p class="lema">{t('vernakula.redefinir.explicacao')}</p>
      <form onSubmit={enviar} noValidate>
        <label>
          {t('vernakula.redefinir.nova')}
          <input type="password" autocomplete="new-password" value={nova} onInput={(e) => setNova(e.currentTarget.value)} />
        </label>
        <label>
          {t('vernakula.redefinir.repetir')}
          <input type="password" autocomplete="new-password" value={repetir} onInput={(e) => setRepetir(e.currentTarget.value)} />
        </label>
        <MostrarAviso aviso={aviso} />
        {vencido ? (
          <a class="botao principal" href={enderecoDe('esqueci')}>
            {t('vernakula.redefinir.pedir_outro')}
          </a>
        ) : (
          <button type="submit" class="botao principal" disabled={ocupado} aria-busy={ocupado}>
            {ocupado ? t('vernakula.redefinir.ocupado') : t('vernakula.redefinir.botao')}
          </button>
        )}
      </form>
    </section>
  );
}
