# FM Evolution PRO 27 · Relatório técnico da .27

Base direta do pacote **0.5.3-personal.26 experimental**. O pacote .27 contém o executável portátil Windows x64, WebView2Loader x64, fontes, testes e licenças.

| Recurso | Situação | Resultado |
|---|---|---|
| Crescimento semanal proporcional | Implementado | Mínimo igual ao multiplicador efetivo, inclusive 1×. Seleção manual, regras de grupos e limites do jogador continuam ativos. |
| Condição física avançada | Implementado para a faixa validada | 10000 permitido. Exibição do bruto e do percentual, ritmo independente, prévia, releitura e restauração do lote. |
| Entendimento tático da seleção | Parcial | Identificação do país, do plantel escolhido e dos convocados. Painel informa a disponibilidade de cada indicador e mantém a gravação bloqueada. |
| Bruto 12479 e modo incansável | Indisponíveis | 12479 está fora da faixa validada do campo de condição. Falta evidência de um mecanismo seguro de manutenção de condição dentro da partida. |

## Desenvolvimento semanal

O objetivo semanal é `máximo(ganho natural × multiplicador, multiplicador)`. O bônus solicitado é a diferença entre o objetivo e o ganho natural já realizado. O editor limita a gravação pelo PA, pelo teto de CA e pelo saldo do orçamento semanal. Com ganho natural zero, 1×, 2×, 5× e 10× solicitam respectivamente +1, +2, +5 e +10. Com +1 natural em 5×, o editor solicita +4 e o total pode chegar a +5.

A ativação lê a referência dos selecionados. O modo garantido verifica cada atleta uma vez por semana do FM, a partir da próxima semana. As regras de frequência diária voltam a valer no modo tradicional. Grupos, perfis e regras individuais continuam determinando o multiplicador efetivo, o teto, o orçamento e a pausa. O monitor funciona em segundo plano enquanto a conexão com o save é válida.

A reserva é registrada antes da gravação. O arquivo de semanas garantidas segue a identidade de carreira do Histórico e independe do nome do perfil de Desenvolvimento. Cada registro vincula UID e data de nascimento à semana. Quando o caminho do Histórico está indisponível, o controle fica na conexão atual. O diagnóstico apresenta CA anterior, CA relido, ganho natural, bônus aplicado e a parcela do bônus vinda do mínimo. Uma falha de gravação fica registrada como falha, sem bônus confirmado.

O caminho existente de atributos amplifica ganhos observados quando houve evolução natural e os campos passam pelas verificações. O mínimo de CA usa a gravação existente de habilidade atual. A auditoria da Evolução Imediata e do Desenvolvimento não identificou uma rotina validada para redistribuir atributos a partir de um aumento isolado de CA.

## Condição física e ritmo

No build mapeado, **condição** é um inteiro de 16 bits sem sinal. A definição do campo e a verificação de plausibilidade cobrem 0 a 10000. A exibição converte a escala bruta para percentual. **Ritmo de jogo** é um campo separado, com faixa de gravação de 3500 a 10000. No modo avançado, deixe o ritmo vazio para conservá-lo. A fadiga continua disponível no modo normal e fica fora do lote avançado.

A Central usa seleção individual e em lote. O editor mostra os valores atuais e propostos, revalida identidade, carreira, data e valores no processamento, e utiliza a gravação existente com releitura por campo. **Restaurar valores anteriores** é associado ao lote e à sessão que o gravou. Se o jogo ou outra edição mudou o valor desde então, a restauração recusa o campo.

A auditoria do congelamento existente mostra uma proteção de campos da ficha. Os fontes não demonstram manutenção validada do consumo de energia dentro da partida. O modo incansável permanece indisponível.

## Seleção nacional

A captura do FMRTE 27.1.0-build14 serviu para identificar os indicadores solicitados e a meta 100. A referência não fornece evidência sobre o armazenamento nem sobre a gravação. A .26 já lê a seleção, seus plantéis e os jogadores associados. O painel da .27 utiliza esse contexto e exibe o estado de estilo de passe, construção, criação de oportunidades, linha de pressão, intensidade e armadilha da pressão, formações com e sem posse e posição/função.

A rotina tática existente está documentada para clubes. Ela usa o contexto da tática do clube e combina o registro do jogador com o histórico de treino. A auditoria não confirmou que esses registros sejam exclusivos da seleção ou que reproduzam a exposição em jogo da captura. Nenhum indicador nacional passou o critério de gravação. Coesão e aptidão posicional continuam como conceitos distintos.

## Validação

- **Lógica executada em Linux:** 10 testes de crescimento e 2 testes das regras de seleção e dos registros semanais. Incluem 1×, 2×, 5× e 10×, zero natural, PA, teto do CA, limite semanal, identidade do jogador, grupos e duplicidade.
- **Regressões existentes:** 18 testes de negociação e 20 testes do Trainer passaram.
- **Chromium, dados simulados:** verificação das quatro intensidades, seleção manual e por grupo, modo tradicional, condição e ritmo, prévia, releitura e restauração simuladas, além da exibição do bloqueio tático por indicador.
- **Memória isolada, Windows:** teste automatizado de leitura, gravação confirmada, distinção de ritmo, bloqueio de 12479 e restauração segura. O binário de testes foi compilado para Windows x64. A execução exige Windows.
- **Pacote:** compilação cruzada de produção em Linux para Windows x64 (PE32+) com Rust 1.100.0 e MinGW-w64 GCC 14. O ZIP é verificado por SHA-256 e inclui as fontes e os recursos do pacote .26.
- **FM27 real:** a execução do aplicativo em Windows, a conexão com a carreira, as gravações e a persistência após salvar e recarregar dependem de validação em jogo. Os dados de navegador e os testes isolados não executam o FM27.

Para abrir, extraia o ZIP e mantenha `FMEvolutionPRO27.exe` e `WebView2Loader.dll` na mesma pasta.
