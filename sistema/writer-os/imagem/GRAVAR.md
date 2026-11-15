# Gravar o Ekfrase Writer OS num pendrive (enquanto o Gravador não existe)

O Gravador do Ekfrase (fase 3b) vai fazer isto em 3 cliques. Até lá, servem o **Rufus** (Windows) ou o
**balenaEtcher** (Windows, Linux, Mac). Os dois gravam a imagem como ela é (o "modo DD").

**Antes:** use um pendrive (ou SSD/HD externo, USB) de **4 GB ou mais** (8 GB ou mais, USB 3, é o
recomendado). **Tudo o que estiver nele será apagado.** O Writer OS nunca mexe no disco do notebook,
mas faça backup do que importa antes do primeiro teste (PLANO §10c).

## 1. Baixar a imagem
1. No GitHub, abra o repositório → **Actions** → **Writer OS** → a execução mais recente com o sinal verde.
2. Lá embaixo, em **Artifacts**, baixe **writer-os-imagem** (um `.zip`; ele fica 7 dias lá).
3. Descompacte. Dentro estão `ekfrase-writer-os-<versão>.img.xz` (a imagem; **não precisa descompactar
   o `.xz`**) e o `.sha256`.
4. (Opcional) Confira se o arquivo chegou inteiro. No PowerShell, na pasta dele:
   `Get-FileHash .\ekfrase-writer-os-0.1.0.img.xz -Algorithm SHA256` e compare com o número do `.sha256`.

## 2a. Gravar com o Rufus (Windows)
1. Baixe o Rufus em `rufus.ie` (a versão "Portable" nem precisa instalar) e abra.
2. Ligue o pendrive. Em **Dispositivo**, escolha o pendrive (confira o nome e o tamanho!).
3. Em **Seleção de boot**, clique **SELECIONAR** e escolha o `ekfrase-writer-os-<versão>.img.xz`.
   O Rufus reconhece que é uma imagem de disco e deixa o resto cinza: está certo.
4. **INICIAR**. Se ele perguntar "modo ISO ou modo DD", escolha **DD**. Confirme que vai apagar o pendrive.
5. Espere o "PRONTO" e feche. O Windows pode reclamar que "precisa formatar o disco": **não formate**
   (é a partição do sistema, que o Windows não lê). Clique em Cancelar.

## 2b. Ou gravar com o balenaEtcher
1. Baixe em `etcher.balena.io` e abra.
2. **Flash from file** → o `.img.xz`. **Select target** → o pendrive. **Flash!** Espere o "Flash Complete".

## 3. Ligar o notebook pelo pendrive (Lenovo 82VY, Secure Boot LIGADO)
1. Desligue o notebook (desligar de verdade, não "reiniciar"). Ligue o pendrive numa porta USB.
2. Ligue e aperte **F12** várias vezes até aparecer o **Boot Menu** (em alguns IdeaPad, com o notebook
   desligado, aperte o botãozinho **Novo** ao lado do carregador e escolha "Boot Menu").
3. Escolha o pendrive (aparece como "USB HDD" ou com o nome do fabricante) e Enter.
4. Não há menu: a tela fica azul-escura com a logo do Writer e, em 20 a 60 segundos, aparece o Writer.
   **O Secure Boot fica ligado.** Se a BIOS recusar o pendrive ("Secure Boot violation"), entre na BIOS
   (**F2** ao ligar) → **Security** → **Secure Boot** e procure a opção de aceitar certificados de
   terceiros ("Allow Microsoft 3rd Party UEFI CA"). Anote o que apareceu e conte.

## 4. O primeiro uso (tudo pelo teclado: Tab, setas e Enter)
1. **Idioma** → **Teclado** (o padrão é o ABNT2, com ç) → **Fuso** (o padrão é São Paulo). Enter aceita o padrão.
2. **Senha do pendrive**, duas vezes. **Anote num lugar seguro: sem ela, os textos não abrem**, nem
   neste pendrive nem em outro computador.
3. A pergunta da cópia `.md` (Enter = não) → **Wi-Fi** (escolha a rede e a senha, ou "Seguir").
4. **Começar a escrever** (sem conta) ou **Entrar** com a conta do ekfrase.com. Pronto: escreva.

Da segunda vez em diante: liga → a senha → a estante.

## 5. Usar e desligar
- **Ctrl+Alt+S** (ou o botão de ligar, no alto à direita) abre o **painel do sistema**: Wi-Fi, bateria,
  brilho, teclado, fuso, servidor, pendrives (ejetar), **Desligar** e **Reiniciar**, e "Sobre" (as
  versões e se o Secure Boot está ligado).
- Desligue sempre pelo painel. (Tirar o pendrive com o Writer ligado não estraga o texto já gravado,
  mas o que você digitou nos últimos instantes pode ficar de fora.)

## 6. Os textos no Windows
O pendrive aparece no Windows como a unidade **EKFR-DADOS**, com a pasta **Ekfrase Writer**. No Writer
do computador (`ekfrase.com/writer/#/computador`), use "Escolher outra pasta…", aponte para essa pasta e
use **a mesma senha**: são os mesmos textos.

## Se algo der errado
Tire uma foto da tela e mande pelo balão de feedback do site, dizendo em que passo parou. Se o notebook
nem mostrar o pendrive no Boot Menu, grave de novo (pelo Rufus, em modo DD) e tente outra porta USB.
