# SPDX-License-Identifier: MPL-2.0
#
# O FILTRO do diagnóstico (Bloco F, 25/11/2026): o diagnóstico fica em claro no pendrive (o Windows lê), então
# sai dele o que diz onde a pessoa esteve: os nomes das redes Wi-Fi e os endereços das placas (MAC, BSSID).
# Lê a entrada e escreve a saída; `REDES` = um arquivo com um nome de rede por linha (o `nmcli -g` escapa `:` e `\`).
#   - nome com 4 letras ou mais: trocado em qualquer lugar por <rede>;
#   - nome mais curto: só entre aspas (senão "ab" apagaria meio journal);
#   - qualquer `ssid 'X'`, `SSID "X"`, `ssid=X`: o X vira <rede>, mesmo de rede que não está na lista;
#   - endereço de placa (6 pares de hexa com `:` ou `-`): xx:xx:xx:xx:xx:xx; o IPv6 local (fe80::, feito do MAC): fe80::x.
# Byte a byte (sem `use utf8`): o nome e o journal vêm iguais, com acento ou não.
# Rodar: perl /usr/lib/ekfrase/ekfrase-sem-redes.pl < entrada > saida
use strict;
use warnings;

my @nomes;
if (defined $ENV{REDES} && open(my $f, '<', $ENV{REDES})) {
  while (my $l = <$f>) {
    chomp $l;
    $l =~ s/\\(.)/$1/g;
    push @nomes, $l if length $l;
  }
  close $f;
}
my %visto;
@nomes = grep { !$visto{$_}++ } sort { length($b) <=> length($a) } @nomes;
my $longos = join '|', map { quotemeta($_) } grep { length($_) >= 4 } @nomes;
my $curtos = join '|', map { quotemeta($_) } grep { length($_) < 4 } @nomes;

while (my $l = <STDIN>) {
  $l =~ s/(?:$longos)/<rede>/g if $longos ne '';
  $l =~ s/(["'])(?:$curtos)\1/$1<rede>$1/g if $curtos ne '';
  $l =~ s/\b(ssid)([ =:]+)(["'])(?:(?!\3).)*\3/$1$2$3<rede>$3/gi;
  $l =~ s/\b(ssid=)(?!["'<])\S+/$1<rede>/gi;
  $l =~ s/\b[0-9A-Fa-f]{2}(?:([:-])[0-9A-Fa-f]{2})(?:\1[0-9A-Fa-f]{2}){4}\b/xx:xx:xx:xx:xx:xx/g;
  # o IPv6 local sai do MAC (EUI-64): fe80::5054:ff:fe12:3456
  $l =~ s/\bfe80::[0-9A-Fa-f:]+/fe80::x/gi;
  print $l;
}
