# Casos de conformidade do SERVIDOR da escrita (protocolo 1)

Cada arquivo `NN-nome.json` desta pasta é um caso: uma lista de pedidos e a resposta que um
servidor da escrita do Ekfrase Writer tem de dar. São **dados puros**, sem código: a ponte PHP
(`ponte/src/Escrita.php`) passa por todos eles em `tests/ponte.test.ts` (bloco "escrita (Writer)"),
e qualquer outro servidor (o futuro Servidor Ekfrase em TypeScript, ou o de quem hospedar o seu)
roda os mesmos arquivos com um executor igual. O plano está em `docs/writer/PLANO.md` §4.3 e §5.

## As rotas (todas em `/api/v1/`)

| Rota | Quem | Resposta |
|---|---|---|
| `GET escrita/servidor` | qualquer um, sem login | `{ok, nome, versaoProtocolo: 1, aceitaCadastro: true}` |
| `GET escrita/mudancas?desde=<inteiro ≥ 0; padrão 0>&limite=<1 a 500; padrão 500>` | conta (401 `login`) | `{ok, registros: [{id, colecao, versao, apagado, dados, seq}], cursor, mais}` |
| `POST escrita/enviar` com `{registros: [{id, colecao, versao, apagado, dados, base}]}` | conta + CSRF (403 `csrf`, 401 `login`) | `{ok, resultados: [...], cursor}` |

- **Coleções:** `historias`, `capitulos`, `cenas`, `ideias`, `personagens`.
- **`id`:** UUID v7 em minúsculas. **`versao` e `base`:** relógio híbrido (HLC),
  `^\d{13}-[0-9a-f]{4}-[0-9a-f]{8}$`, comparado como texto. `base` é a versão do servidor que o
  aparelho conhecia, ou `null` se para ele o registro é novo (o campo tem de vir).
- **`dados`:** um objeto JSON que o servidor **não lê**. Volta com o mesmo conteúdo (o JSON é
  regravado: a ordem das chaves, `{}` e `[]` ficam; espaços somem). As versões por campo ficam
  dentro dele, em `dados._v`.
- **`seq`:** número crescente do servidor, por conta, que muda a cada gravação aceita. `cursor` é o
  maior `seq` devolvido (em `mudancas`, o próprio `desde` se não veio nada; em `enviar`, o maior
  `seq` da conta depois de gravar).
- **Garantia do cursor:** as gravações de uma conta ficam visíveis na ordem do `seq`. Quem já
  recebeu o cursor N nunca verá surgir depois um registro com `seq` ≤ N.
- **Cada resultado de `enviar`** (na ordem do pedido; cada registro é decidido sozinho):
  - `{id, estado: "aceito", seq}`: gravou, ou já estava com essa mesma `versao`;
  - `{id, estado: "conflito", servidor: {…a linha do servidor…}}`: não gravou; o aparelho mescla e
    reenvia com `base` = `servidor.versao`;
  - `{id, estado: "recusado", erro: "invalido" | "grande_demais"}`: registro malformado (ou coleção
    diferente da gravada para esse `id`), ou `dados` com mais de 5 MB de JSON.
- **A regra:** não existe (conta, id) → grava. Existe com a mesma `versao` → aceito sem regravar.
  `base` igual à `versao` gravada e `versao` recebida maior → regrava com `seq` novo. Qualquer outro
  caso → conflito. A chave é (conta, id): o mesmo `id` em outra conta é outro registro.
- **Erros do pedido inteiro** (`{ok: false, erro}`): `vazio` (sem lista, lista vazia ou corpo que
  não é JSON), `muitos` (mais de 500; vem `limite`), `dados` (parâmetro de `mudancas` fora da
  faixa), `cota` (413; o pedido faria a conta passar do espaço dela; nada é gravado; vem
  `cota_mb`), `grande` (413; o corpo do pedido passa do que o servidor lê; vem `limite_bytes`),
  `login`, `csrf`.

## O que é da ponte PHP, e não do contrato

- **Tamanho do pedido.** 500 registros de 5 MB não cabem num pedido. A ponte lê no máximo o menor
  entre o `post_max_size` do PHP, um quarto do `memory_limit` e 64 MB; acima disso responde `grande`
  com `limite_bytes`, sem gravar nada. O aparelho deve mandar lotes pequenos em bytes (poucos MB) e,
  se receber `grande`, dividir o lote.
- **Página de `mudancas`.** Além do `limite`, a página fecha quando os registros somam 8 MB (leva
  sempre ao menos um). `mais: true` avisa; o aparelho pede de novo a partir do `cursor`.
- **`max_allowed_packet` do banco.** Se o MariaDB aceitar comandos menores que 5 MB (o XAMPP vem
  com 1 MB), o limite de `dados` desce para o que cabe, e o registro maior é `grande_demais`.
- **Cota.** `segredos[cota_mb]` (padrão 200), por conta: a soma do JSON de `dados` de todos os
  registros, lápides inclusive. O que não cresce (reenvio igual, encolher, apagar) passa sempre.
- **`nome` do servidor.** `segredos[nome_servidor]`; sem ele, o domínio de `segredos[site]`.
- **CORS.** A ponte não manda cabeçalho CORS: o app do site fala com a própria origem. "Conectar a
  outro servidor" pelo navegador fica para a casca do computador (fase 2), que não passa pelo CORS.

## Formato de um caso

```json
{
  "caso": "nome-curto",
  "descricao": "O que o caso prova.",
  "exige": { "cota_mb": 1 },
  "passos": [
    {
      "nota": "opcional, para quem lê",
      "quem": "ana",
      "metodo": "POST",
      "rota": "escrita/enviar",
      "corpo": { "registros": [] },
      "espera": { "status": 200, "corpo": { "ok": true } }
    }
  ]
}
```

- **Cada caso começa com o servidor sem nenhum registro de escrita** (e o `seq` das contas em zero).
  Os passos rodam na ordem, um por vez.
- **`quem`:** `ana` e `bia` são duas contas diferentes, já com login; `anonimo` é um visitante sem
  conta (mas com sessão e token CSRF, como o app ao abrir).
- **`corpo`** vai como JSON. **`corpoBruto`** (texto) vai como está, para corpo que não é JSON.
- **`csrf: false`:** o POST vai sem o cabeçalho `X-CSRF-Token`. Sem isso, todo POST leva o token.
- **`exige`:** o que o servidor precisa ter para o caso valer. Hoje só `cota_mb` (a cota da conta,
  em MB).
- **`espera.corpo`** é comparado **exatamente**: os mesmos campos (nenhum a mais), listas do mesmo
  tamanho e na mesma ordem. As exceções são os curingas abaixo.

### Curingas (só em `espera.corpo`)

| Curinga | Aceita |
|---|---|
| `"$texto"` | qualquer texto não vazio |
| `"$n"` | qualquer inteiro ≥ 0 |
| `"$n=s1"` | um inteiro; na primeira vez **guarda** com o nome `s1`; depois tem de ser **igual** ao guardado |
| `"$n>0=s1"` | um inteiro maior que 0, guardado (ou conferido) como `s1` |
| `"$n>s1=s2"` | um inteiro maior que o `s1` já guardado, guardado (ou conferido) como `s2` |

Os nomes valem dentro do caso. Numa **`rota`**, `{s1}` é trocado pelo número guardado
(`escrita/mudancas?desde={s1}`).

### Repetição (em `corpo` e em `espera.corpo`)

`{ "$repete": <modelo>, "vezes": <n> }` vira:
- o texto repetido `n` vezes, se o modelo é um texto (para montar um `dados` grande);
- uma lista de `n` itens, se o modelo é um objeto. Dentro dele, `{i}` em qualquer texto é trocado
  pelo número do item, de 1 a `n`, com 12 dígitos (`000000000001`).

## Para acrescentar um caso

Arquivo novo com o próximo número; `caso` único; ids de exemplo no formato
`0193a000-0000-7000-8000-<12 dígitos>` e versões `17314000000NN-0000-aaaaaaaa`. O teste da ponte
lê a pasta inteira: não há lista para atualizar.
