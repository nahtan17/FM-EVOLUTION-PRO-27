# FM Evolution PRO 27 · Relatório da .25

A edição portátil **0.5.3-personal.25** deriva dos fontes da .24. O ZIP da .24 foi usado como referência e mantido separado. Os checkpoints registraram a base, Desenvolvimento e Entrosamento, Transferências e Empréstimos e os recursos de produtividade.

## Alterações e limites

| Recurso | Entregue na .25 | Limite atual |
|---|---|---|
| Desenvolvimento Avançado 5× | O foco automático usa a posição principal lida da ficha. Regras por posição, função ou atributo limitam quais ganhos naturais de atributos recebem amplificação. O diagnóstico lista o foco e as alterações. | O bônus de CA continua exigindo ganho positivo de CA. Atributos sem ganho observado não recebem bônus. PA, teto e limite semanal continuam aplicados. O recálculo e a persistência depois que o FM avança precisam ser verificados em um save real. |
| Entrosamento | A coleta semanal de coesão roda no processo do editor por plantel e continua com a aba fechada. As amostras registram quantidade de jogadores medidos e variação semanal. A seleção individual e as ações manuais da .24 seguem no mesmo painel. | A coleta é de leitura, mantém até 60 amostras por plantel na conexão atual e precisa ser reativada ao reconectar. O monitor detecta mudança de save ou recuo da data. |
| Familiaridade posicional | Os campos de posição já reconhecidos mantêm a edição existente na ficha do jogador. | O comportamento de um campo independente de familiaridade posicional ainda precisa de evidência de leitura e gravação. A .25 não usa a aptidão em uma posição para simular esse campo. |
| Transferências | A proposta exibe as evidências de classificação e de disponibilidade para edição. O editor bloqueia o uso de contrato ou agendamento quando existem propostas abertas com o mesmo número para o mesmo jogador. Valor à vista e reagendamento continuam sujeitos aos vínculos e estados elegíveis. | Os casos do Montoro e do Gabriel Barbosa precisam ser reproduzidos no FM. A edição de bônus, revenda, parcelas e novos tipos de cláusulas permanece pendente. |
| Parcelas | A composição exibe total, período e intervalo quando a lista ativa passa a validação de formato nos builds Windows documentados, Steam 26340721 e Game Pass 0.9.2435.0. | Somente leitura. As duas listas de adicionais ainda carecem de classificação segura. Registros encerrados podem conter valores diferentes dos exibidos pelo FM. |
| Empréstimos | O gestor reúne contratos ativos de entrada e saída, vencimento, opção de compra e taxas mensais lidas do contrato. A ficha do jogador segue como entrada para as ações já suportadas. | Propostas de empréstimo, termos adicionais e cláusulas novas permanecem pendentes. |
| Busca e ações rápidas | A busca geral filtra por jogadores, comissão ou clubes. A paleta existente oferece acesso direto a Alertas e Integridade, além das ações e atalhos atuais. | Os filtros avançados específicos continuam nas listas. Sua unificação completa no campo de busca geral permanece pendente. |
| Alertas e integridade | Painéis centralizam alertas de conexão, compatibilidade, gravação, mudança de save e falhas do Desenvolvimento. O Verificador exibe as verificações nativas da conexão e permite copiar o diagnóstico. | O painel mostra o estado atual, com o último resultado do Desenvolvimento. Histórico de alertas e fontes dos demais módulos ainda pendem. |
| Restauração seletiva | Backup JSON de listas e favoritos, grupos, perfis e regras individuais do Desenvolvimento. As seções escolhidas passam pela validação e entram no rascunho antes da confirmação. | Escopo restrito ao Desenvolvimento. As dependências entre grupos, perfis e jogadores precisam continuar válidas para salvar. |
| Histórico financeiro | Registros manuais por clube e data do jogo, com saldo, orçamento de transferências, orçamento salarial e variação em relação à leitura anterior. O perfil nomeado separa as carreiras. | O histórico começa na primeira captura feita pelo usuário. Leituras financeiras do jogo não são reconstruídas retroativamente. |
| Diretoria e propriedade | Os campos de clube suportados pela base permanecem disponíveis. | Campos adicionais dependem de mapeamento sustentado pelo FM27. |
| Distribuição | Executável portátil Windows x64, fontes, WebView2Loader e licenças. | O instalador NSIS não foi gerado. O ambiente Linux não fornecia o compilador de instalador. |

## Verificação no FM27

1. Use uma cópia da carreira. Ative o Desenvolvimento 5×, compare atletas com foco distinto e acompanhe as verificações semanais. Anote o CA, o PA, os ganhos naturais e os bônus registrados. Avance e recarregue o save para verificar o que persistiu.
2. Ative o monitoramento de coesão em um plantel, feche a aba e avance para a semana seguinte. Ao voltar, compare a nova leitura e o número de jogadores medidos. Após recarregar a carreira, reative a coleta.
3. Na proposta **9199 do Montoro**, copie o diagnóstico e confira o estado, o vínculo dos clubes e a disponibilidade do valor à vista. Uma proposta que ainda aguarda o clube pode ter data da proposta e continuar sem agendamento para reagendar.
4. Na proposta de **Gabriel Barbosa**, compare o tipo da proposta com a classe do contrato vinculado. O código do tipo, isolado, pode ser compartilhado por propostas definitivas e empréstimos. O motivo específico exige o registro real.
5. Para qualquer campo de transferência ou empréstimo editado, releia a ficha após aplicar, salve a carreira e recarregue. Compare os valores e os demais termos.

## Validação da entrega

| Verificação | Resultado |
|---|---|
| Desenvolvimento | 7 testes de lógica passaram, incluindo ganho observado, foco seletivo, limite semanal, PA e recuperação após queda. |
| Regras de transferência | 18 testes passaram, incluindo estados, datas, faixas de valor e interpretação do total parcelado. |
| Trainer | 20 testes passaram. |
| Interface | 11 cenários em Chromium com dados simulados passaram, incluindo retomada da leitura de coesão ao reabrir a aba, histórico financeiro, busca e ações globais, validação visual e restauração seletiva. |
| Windows x64 | Compilação cruzada do executável portátil em Linux. O ZIP é conferido contra o binário, seus recursos e os fontes. |
| FM27 em execução | Sem teste direto. A abertura no Windows, a conexão com o jogo, os casos 9199 e Gabriel Barbosa, as escritas e a persistência precisam de validação com o FM27 real. |

Checkpoints locais: 4f4a742 (.24), 6a3f47a (Desenvolvimento e Coesão), 77618b3 (Transferências e Empréstimos), e196e5b (produtividade e configurações).
