// SPDX-License-Identifier: MPL-2.0

import { useState } from 'preact/hooks';
import { api, type Conta } from '../api.ts';
import { avisoDoErro, type Aviso } from '../avisos.ts';
import { t } from '../textos.ts';

export function MostrarAviso({ aviso }: { aviso: Aviso | undefined }) {
  if (!aviso) return null;
  return (
    <p class={aviso.tipo === 'ok' ? 'aviso-ok' : 'erro'} role={aviso.tipo === 'ok' ? 'status' : 'alert'}>
      {t(aviso.chave, aviso.p)}
    </p>
  );
}

export function Entrar({ aviso, aoEntrar }: { aviso?: string | undefined; aoEntrar: (c: Conta) => void }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<Aviso | undefined>(aviso ? { chave: aviso } : undefined);

  async function enviar(e: Event) {
    e.preventDefault();
    if (!email.trim() || !senha) return setErro({ chave: 'vernakula.entrar.erro.vazio' });
    setOcupado(true);
    setErro(undefined);
    const r = await api.entrar(email.trim(), senha);
    setOcupado(false);
    if (r.ok) return aoEntrar(r.conta);
    setErro(avisoDoErro(r, 'vernakula.entrar.erro', ['dados', 'vazio']));
  }

  return (
    <section class="painel entrar" aria-labelledby="titulo-entrar">
      <h1 id="titulo-entrar">{t('vernakula.entrar.titulo')}</h1>
      <p class="lema">{t('vernakula.lema')}</p>
      <form onSubmit={enviar} noValidate>
        <label>
          {t('vernakula.entrar.email')}
          <input type="email" autocomplete="username" inputMode="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label>
          {t('vernakula.entrar.senha')}
          <input type="password" autocomplete="current-password" value={senha} onInput={(e) => setSenha(e.currentTarget.value)} />
        </label>
        <MostrarAviso aviso={erro} />
        <button type="submit" class="botao principal" disabled={ocupado} aria-busy={ocupado}>
          {ocupado ? t('vernakula.entrar.ocupado') : t('vernakula.entrar.botao')}
        </button>
      </form>
      <p class="link-abaixo">
        <a href="#/esqueci">{t('vernakula.entrar.esqueci')}</a>
      </p>
    </section>
  );
}

/**
 * Site recém-instalado, sem conta nenhuma: cria a conta de administração.
 * O código de instalação é o que o dono escreveu no arquivo de segredos do servidor.
 */
export function PrimeiroAcesso({ aoCriar }: { aoCriar: (c: Conta) => void }) {
  const [d, setD] = useState({ codigo: '', organizacao: '', nome: '', email: '', senha: '', repetir: '' });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<Aviso | undefined>();
  const campo = (k: keyof typeof d) => ({
    value: d[k],
    onInput: (e: Event) => setD({ ...d, [k]: (e.currentTarget as HTMLInputElement).value }),
  });

  async function enviar(e: Event) {
    e.preventDefault();
    if (Object.values(d).some((v) => v.trim() === '')) return setErro({ chave: 'vernakula.primeiro.erro.vazio' });
    if (d.senha !== d.repetir) return setErro({ chave: 'vernakula.primeiro.erro.repetir' });
    setOcupado(true);
    setErro(undefined);
    const r = await api.primeira({ codigo: d.codigo.trim(), organizacao: d.organizacao.trim(), nome: d.nome.trim(), email: d.email.trim(), senha: d.senha });
    setOcupado(false);
    if (r.ok) return aoCriar(r.conta);
    setErro(avisoDoErro(r, 'vernakula.primeiro.erro', ['codigo', 'sem_codigo', 'ja_instalado', 'email', 'senha_curta', 'vazio']));
  }

  return (
    <section class="painel entrar" aria-labelledby="titulo-primeiro">
      <h1 id="titulo-primeiro">{t('vernakula.primeiro.titulo')}</h1>
      <p class="lema">{t('vernakula.primeiro.explicacao')}</p>
      <form onSubmit={enviar} noValidate>
        <label>
          {t('vernakula.primeiro.codigo')}
          <input type="password" autocomplete="off" {...campo('codigo')} />
        </label>
        <label>
          {t('vernakula.primeiro.organizacao')}
          <input type="text" autocomplete="organization" {...campo('organizacao')} />
        </label>
        <label>
          {t('vernakula.primeiro.nome')}
          <input type="text" autocomplete="name" {...campo('nome')} />
        </label>
        <label>
          {t('vernakula.entrar.email')}
          <input type="email" autocomplete="username" inputMode="email" {...campo('email')} />
        </label>
        <label>
          {t('vernakula.primeiro.senha')}
          <input type="password" autocomplete="new-password" {...campo('senha')} />
        </label>
        <label>
          {t('vernakula.primeiro.repetir')}
          <input type="password" autocomplete="new-password" {...campo('repetir')} />
        </label>
        <MostrarAviso aviso={erro} />
        <button type="submit" class="botao principal" disabled={ocupado} aria-busy={ocupado}>
          {ocupado ? t('vernakula.primeiro.ocupado') : t('vernakula.primeiro.botao')}
        </button>
      </form>
    </section>
  );
}
