// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { criarTradutor, montarCatalogo } from '../src/i18n.ts';

const arquivos = {
  '/locales/pt-BR/nucleo.json': { 'idioma.nome': 'Português (Brasil)', ola: 'Olá, {nome}', 'aula.one': '{count} aula', 'aula.other': '{count} aulas', 'aula.zero': 'nenhuma aula' },
  '/locales/pt-BR/vernakula.json': { titulo: 'Vernákula', so_pt: 'só em português' },
  '/locales/en/nucleo.json': { 'idioma.nome': 'English', ola: 'Hello, {nome}', 'aula.one': '{count} class', 'aula.other': '{count} classes' },
  '/locales/en/vernakula.json': { titulo: 'Vernákula' },
  'C:\\Projetos\\x\\locales\\es\\nucleo.json': { 'idioma.nome': 'Español', ola: 'Hola, {nome}' },
  '/outra/coisa.json': { ignorar: 'sim' },
};

describe('idiomas', () => {
  const cat = montarCatalogo(arquivos);

  it('cada arquivo vira um espaço de nomes, inclusive com caminho do Windows', () => {
    expect(cat['pt-BR']!['vernakula.titulo']).toBe('Vernákula');
    expect(cat['es']!['nucleo.ola']).toBe('Hola, {nome}');
    expect(Object.keys(cat).sort()).toEqual(['en', 'es', 'pt-BR']);
  });

  it('recusa valor que não é texto', () => {
    expect(() => montarCatalogo({ '/locales/pt-BR/x.json': { a: 1 } })).toThrow(/não é texto/);
  });

  it('troca parâmetros, plural e o zero opcional', () => {
    const tr = criarTradutor(cat);
    expect(tr.t('nucleo.ola', { nome: 'Alcy' })).toBe('Olá, Alcy');
    expect(tr.t('nucleo.aula', { count: 1 })).toBe('1 aula');
    expect(tr.t('nucleo.aula', { count: 3 })).toBe('3 aulas');
    expect(tr.t('nucleo.aula', { count: 0 })).toBe('nenhuma aula');
    tr.trocarIdioma('en');
    expect(tr.t('nucleo.aula', { count: 0 })).toBe('0 classes');
  });

  it('chave que falta no idioma escolhido cai no português; inexistente aparece crua', () => {
    const tr = criarTradutor(cat, 'en');
    expect(tr.t('vernakula.so_pt')).toBe('só em português');
    expect(tr.t('nao.existe')).toBe('nao.existe');
  });

  it('lista os idiomas pelo nome, português primeiro, e avisa quem escuta a troca', () => {
    const tr = criarTradutor(cat);
    expect(tr.idiomas().map((i) => i.nome)).toEqual(['Português (Brasil)', 'English', 'Español']);
    let avisos = 0;
    tr.aoTrocar(() => avisos++);
    tr.trocarIdioma('es');
    tr.trocarIdioma('es');
    tr.trocarIdioma('xx');
    expect(avisos).toBe(1);
    expect(tr.idioma()).toBe('es');
  });

  it('detecta o idioma pela ordem de preferência', () => {
    const tr = criarTradutor(cat);
    expect(tr.detectar(['pt-PT', 'en'])).toBe('pt-BR');
    expect(tr.detectar(['en-US'])).toBe('en');
    expect(tr.detectar(['ja'])).toBe('pt-BR');
  });
});

describe('textos da escola (por cima do padrão)', () => {
  const cat = montarCatalogo({
    '/locales/pt-BR/nucleo.json': { 'idioma.nome': 'Português', ola: 'Olá, {nome}', 'aula.one': '{count} aula', 'aula.other': '{count} aulas' },
    '/locales/en/nucleo.json': { 'idioma.nome': 'English', ola: 'Hello, {nome}', 'aula.one': '{count} class', 'aula.other': '{count} classes' },
  });

  it('a troca vale no idioma dela, inclusive no plural; o padrão continua acessível', () => {
    const tr = criarTradutor(cat);
    let avisos = 0;
    tr.aoTrocar(() => avisos++);
    tr.sobrepor({ 'pt-BR': { 'nucleo.ola': 'Bem-vindo, {nome}', 'nucleo.aula.other': '{count} encontros' } });
    expect(avisos).toBe(1);
    expect(tr.t('nucleo.ola', { nome: 'Ana' })).toBe('Bem-vindo, Ana');
    expect(tr.t('nucleo.aula', { count: 3 })).toBe('3 encontros');
    expect(tr.t('nucleo.aula', { count: 1 })).toBe('1 aula');
    expect(tr.padrao('nucleo.ola')).toBe('Olá, {nome}');
    tr.trocarIdioma('en');
    expect(tr.t('nucleo.ola', { nome: 'Ana' })).toBe('Hello, Ana');
  });

  it('{} limpa as trocas; chaves() lista o português em ordem', () => {
    const tr = criarTradutor(cat);
    tr.sobrepor({ 'pt-BR': { 'nucleo.ola': 'Oi' } });
    tr.sobrepor({});
    expect(tr.t('nucleo.ola', { nome: 'Ana' })).toBe('Olá, Ana');
    expect(tr.chaves()).toEqual(['nucleo.aula.one', 'nucleo.aula.other', 'nucleo.idioma.nome', 'nucleo.ola']);
  });
});
