# FM Evolution PRO 27 · Relatório técnico da .28

Base direta da edição portátil **0.5.3-personal.27**. Esta atualização modifica a Central de condição física e o painel de tática das seleções. O pacote inclui o executável Windows x64, o carregador WebView2, os fontes, as licenças e os testes.

| Recurso | Situação da .28 |
|---|---|
| Tática nacional | Diagnóstico dos convocados e leitura condicional do registro geral para seis opções. Maximização nacional indisponível. |
| Condição física bruta | Edição implementada na faixa comprovada no código de leitura e gravação. |
| Ritmo de jogo bruto | Edição independente implementada na faixa comprovada no código de leitura e gravação. |
| 12000, 12479, 12749 e outros valores acima de 10000 | Disponíveis para conferência na prévia. A gravação é recusada com indicação de campo, valor e faixa. |

## Seleções nacionais

**Maximizar entendimento tático — 100**, no perfil da seleção, dispara uma nova leitura diagnóstica. O código usa o UID do país e a categoria do plantel, verifica os vínculos de memória já usados para convocados e confere se o plantel, a lista, a data e a tática permanecem os mesmos durante a leitura. A interface indica quantos convocados foram identificados e informa quando a tática ativa está indisponível.

Com uma tática ativa no mapa reconhecido, a rotina decodifica as seis opções táticas e busca, para cada atleta, uma entrada única e exata no registro geral de familiaridade. Valores com leitura válida mantêm o valor bruto na faixa 0–10000, exibido na escala 0–100. Uma entrada ausente, ambígua ou inválida aparece como indisponível. O diagnóstico não usa a estimativa do clube pelo tipo de opção mais próximo, o máximo genérico da lista de formações ou o histórico de treino do clube.

| Indicadores | Leitura na .28 | Gravação nacional |
|---|---|---|
| Estilo de passe, construção e criação de oportunidades | Entrada exata condicional no registro geral do jogador | Indisponível |
| Linha de pressão, intensidade da pressão e armadilha de pressão | Entrada exata condicional no registro geral do jogador | Indisponível |
| Formação com posse, formação sem posse e posição/função | Indisponível no contexto nacional | Indisponível |

A captura e o manual do FMRTE são referências funcionais. O manual descreve exposição em jogo separada de contribuição do treino e coesão. O código da .27 e a documentação pública consultada não estabelecem se as entradas encontradas pelo FM Evolution correspondem às que o FMRTE altera no contexto nacional. A meta 100 da prévia expressa o objetivo da operação. Nenhuma gravação tática ou restauração nacional é oferecida nesta edição. [Manual do FMRTE sobre entendimento tático](https://docs.fmrte.com/clubs/tactical-understanding/)

## Condição física e ritmo de jogo

| Campo do editor | Tipo | Faixa plausível de leitura no projeto | Faixa de gravação existente |
|---|---|---|---|
| Condição física `condition` | U16 | 0–10000 | 0–10000 |
| Ritmo de jogo `match_sharpness` | U16 | 0–10000 | 3500–10000 |

Os campos têm localizações distintas no layout do jogador. O modo avançado apresenta os brutos e os percentuais, permite conservar cada campo e envia os valores escolhidos como inteiros independentes. A prévia mantém o valor solicitado. Qualquer campo marcado fora de sua faixa bloqueia todos os campos propostos para aquele jogador. Para valores aceitos, o processamento verifica o alvo e os valores da prévia e usa a gravação com releitura por campo. A restauração se vincula ao lote gravado na conexão atual e é recusada quando o valor atual diverge do valor gravado.

A documentação do FMRTE 27 também distingue os dois campos e descreve 10000 como 100%. Relatos de uso de valores maiores em outras versões não demonstram aceitação, normalização, comportamento em partida ou persistência para este build e os dois campos. O tamanho do inteiro permite representar 12749, mas não comprova que o jogo aceite a gravação. As verificações existentes seguem ativas. [Manual do FMRTE sobre condição e ritmo](https://docs.fmrte.com/players/condition-and-happiness/)

## Resultado individual dos testes

| Cenário | Ambiente | Resultado |
|---|---|---|
| 1×, 2×, 5× e 10×, seleção manual e ganho natural no diagnóstico | Chromium com dados simulados | Passou |
| Seleção de grupo existente e parada explícita em 1× | Chromium com dados simulados | Passou |
| 10000/10000: prévia, aplicação em elenco, releitura e restauração simuladas | Chromium com dados simulados | Passou |
| 10000/9301 e manter/9301: gravação individual simulada e independência dos campos | Chromium com dados simulados | Passou |
| 12749/12749: prévia bloqueou aplicação sem alterar valores | Chromium com dados simulados | Passou |
| 12749/10000: prévia bloqueou aplicação sem alterar valores | Chromium com dados simulados | Passou |
| 10000/12749: prévia bloqueou aplicação sem alterar valores | Chromium com dados simulados | Passou |
| 12749/manter: prévia bloqueou aplicação sem alterar valores | Chromium com dados simulados | Passou |
| manter/12749: prévia bloqueou aplicação sem alterar valores | Chromium com dados simulados | Passou |
| 12000/12479: prévia bloqueou aplicação sem alterar valores | Chromium com dados simulados | Passou |
| 15001 personalizado: limite do formulário respeitado | Chromium com dados simulados | Passou |
| Seleção e convocados simulados, leitura de 83,75 no registro geral e bloqueio dos nove indicadores | Chromium com dados simulados | Passou |
| Crescimento existente | Linux, 10 testes Rust | Passou |
| Negociação e Trainer existentes | Linux, 18 e 20 testes Rust | Passou |
| Tipos e faixas, gravação e reversão física em memória isolada | Windows x64 | Compilado, execução pendente |
| Entrada tática exata, ausente, ambígua ou inválida | Windows x64, dados isolados | Compilado, execução pendente |
| Gravação e restauração tática nacional | FM27 real | Sem rotina nacional validada |
| Gravação acima de 10000 e comportamento em partida ou após recarregar | FM27 real | Pendente |
| Gravação de campos físicos dentro das faixas e persistência após recarregar | FM27 real | Pendente |

O teste de memória isolada usa um processo de teste Windows. Ele verifica tipos, localizações distintas, releitura de 10000 nos dois campos, alterações individuais, reversão e rejeição de valores fora das duas faixas pelas definições de campo. O teste Rust da tática verifica entrada exata, duplicidade, ausência de opção e faixa. Ambos foram **compilados** para Windows x64 e a execução nativa está pendente.

## Validação com FM27 real

Não houve FM27 em execução neste ambiente. A equivalência da leitura tática nacional, sua gravação e persistência, e uma eventual aceitação de valores físicos superiores a 10000 antes, durante ou após a partida continuam sem teste real. Os testes de rejeição verificam a decisão do editor, sem afirmar que o motor do jogo rejeita, limita ou preserva tais valores. A abertura do executável no Windows e o teste dos valores aceitos em uma carreira real também permanecem pendentes.
