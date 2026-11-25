# FM Evolution PRO 27 · Relatório técnico da .26

A versão **0.5.3-personal.26** deriva diretamente dos fontes do pacote **0.5.3-personal.25** fornecido. A alteração funcional está no **Crescimento semanal garantido** em **Treino → Desenvolvimento → Desenvolvimento Avançado**. A distribuição é portátil para Windows x64, com o carregador WebView2 e os fontes completos.

## Cálculo e processamento

| Situação | Resultado |
|---|---|
| Opção desmarcada e ganho natural zero | Bônus zero. É a configuração inicial. |
| Opção marcada e ganho natural zero na nova semana | +1 CA para cada jogador selecionado e elegível com margem de crescimento. |
| Ganho natural de +1 CA no modo 5× | Até +4 CA do editor. O ganho natural e o bônus totalizam até +5 CA. |
| Verificação diária com +1 já concedido na semana | O ponto anterior é descontado da próxima amplificação natural da mesma semana. |
| PA atingido, teto atingido ou limite semanal esgotado | A margem disponível limita a gravação. Com margem zero, o editor registra a situação sem gravar. |
| Salto de mais de uma semana entre leituras | Com a opção ativa, o ponto mínimo vale somente para a semana atual. A leitura restabelece a referência de crescimento natural. |

A ativação registra a referência de cada jogador. A primeira oportunidade de receber o mínimo é a próxima semana do calendário do FM. A rotina conserva a seleção manual, as regras dos grupos e as frequências individuais. O monitor nativo acompanha a carreira em segundo plano enquanto o editor está conectado. Uma troca de save exige recarregar os dados e reativar a rotina.

O editor registra o período por UID e data de nascimento. A reserva é feita antes da gravação para que uma tentativa com resultado incerto não seja repetida na mesma semana. A rotina usa o estado da conexão e grava os períodos no disco quando há um perfil de carreira nomeado. Se a ficha estiver temporariamente indisponível na virada da semana, o monitor pode conferir novamente em outra data dessa semana.

A gravação reutiliza a rotina da .25 que verifica a ficha, a data e os bytes anteriores. Cada campo gravado é relido e comparado antes de o bônus ser registrado como confirmado. O diagnóstico e a exportação JSON apresentam o CA antes do bônus (`caBefore`), o CA confirmado (`ca`), o PA, a semana, o ganho observado, o bônus e seu motivo. O Histórico registra os valores de cada campo alterado. A exportação também inclui o último período registrado por jogador.

## Atributos

A auditoria da **Evolução Imediata** confirmou que sua rotina planeja somente a gravação do campo `current_ability`. O 5× já tem uma rotina que amplifica ganhos de atributos observados simultaneamente ao crescimento natural de CA, respeitando o foco e os limites dos campos. Essa rotina foi reaproveitada para os ganhos observados.

Para o bônus mínimo, a gravação confirmada é exclusivamente de CA. Os fontes da .25 não fornecem uma rotina validada que converta um aumento isolado de CA em novos valores de atributos. O efeito do recálculo interno do FM sobre esse ponto e sua persistência após salvar e recarregar a carreira continuam sem validação em jogo.

## Verificação

| Verificação | Resultado |
|---|---|
| Lógica de desenvolvimento | 10 testes passaram. Cobrem ganho natural zero, +1 CA, PA, limite de 200 CA, orçamento, repetição de semana, crédito no modo diário e amplificação de atributos observados. |
| Testes de regressão existentes | 18 testes de regras de negociação e 20 testes do Trainer passaram. |
| Interface | Cenário Chromium com dados simulados passou. Verificou opção inicialmente desmarcada, seleção manual, +1 CA, 5× natural, alternância de aba, CA antes e depois e retorno ao modo tradicional. |
| Windows x64 | Compilação cruzada em Linux com Rust 1.100.0 e MinGW-w64 GCC 14, usando o modo portátil. O executável é PE32+ x86-64. |
| Execução real | A abertura no Windows, a conexão com o FM27 e a persistência das alterações no save exigem validação com o jogo em execução. |

Para testar em jogo, extraia o ZIP, mantenha `FMEvolutionPRO27.exe` e `WebView2Loader.dll` juntos e abra uma cópia da carreira. Selecione atletas abaixo do PA, ative o 5× semanal com a nova opção e avance para a próxima semana. Compare o Histórico e o diagnóstico com as fichas. Salve e recarregue a carreira no FM para conferir a persistência.

A compilação e os créditos estão em `BUILD_EDICAO_PESSOAL.md` e `AVISOS_DE_TERCEIROS.txt`.
