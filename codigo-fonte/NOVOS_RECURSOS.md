# Atualização 0.5.3-personal.4

## Centro de Transferências
Abra Clubes, escolha o clube e entre em Centro de Transferências. As propostas são lidas do processo do jogo. Escolha uma linha, altere os campos disponíveis, clique em Conferir alterações e depois em Aplicar na proposta. Alterar o formulário invalida a prévia anterior.

O valor editado é a parcela à vista. Parcelamentos e bônus existentes são preservados. Salário, fim e tipo do contrato ficam disponíveis quando existe um contrato futuro identificado. A data fica disponível em transferências confirmadas, com proposta, contrato e agendamento coerentes; a edição sincroniza esses registros. Não força aceitação de propostas. Operações encerradas, empréstimos e dados ambíguos ficam em leitura. Desfazer depende de os registros continuarem iguais aos escritos e de a transferência ainda não ter ocorrido.

## Informações do clube
Na aba Informação, use os campos de Visão geral e funcionários adicionais, depois Salvar informações adicionais. Inclui público mínimo, médio e máximo, moral, situação, fundação, presidência, propriedade, cores, importância da base e permissões adicionais de funcionários quando o jogo mantém esses registros. Público mínimo deve ser menor ou igual ao médio, e este menor ou igual ao máximo. Esses valores não são a capacidade física do estádio; a capacidade continua na aba Estádio.

Os campos adicionais e o editor de patrocínios usam perfis correspondentes ao tamanho do módulo e à classe do clube. Há mapeamentos para Steam e Game Pass 27.1.0+2505117. A edição recusa perfis diferentes; a adaptação ainda não foi testada numa instância real do FM. Alguns controles dos prints, incluindo orçamento de observação, próximo jogo e escudo personalizado, continuam sem implementação nesta edição.

## Patrocínios
Em Finanças, abra Patrocínios e outros. É possível alterar tipo, total, valor por temporada, datas, percentual e as opções Renovar receitas e Valor fixo, quando identificadas. Existem botões para adicionar, remover e desfazer. O jogo processa a receita no seu calendário; editar um contrato não deposita imediatamente seu valor total no saldo. Tipos sem identificação ficam com seu código original.

## Nota média
A coluna Nota média aparece no elenco. Use Importar notas do FM com um arquivo HTML, CSV ou TSV exportado pelo jogo, contendo ID único ou nome e Nota Média/Average Rating. Notas decimais com vírgula são aceitas. Nomes ambíguos, IDs fora do clube e notas inválidas são ignorados. Os arquivos são processados localmente, sem alterar o jogo.

As notas são importadas, não uma leitura automática da memória. A interface informa o arquivo e a data da importação. Importe novamente para atualizar. Sem arquivo, o valor aparece como —. Não se usa média de atributos como nota de partida.

## Validação e fontes
Compilação Windows x64 e testes de validação e interface com dados fictícios; não houve teste com o FM real neste ambiente. Teste em uma cópia do save.

Foram acrescentados mapeamentos e referências do projeto GPL-3.0 Football-Manager-27-Editor, Jackhamerp24 e colaboradores: https://github.com/Jackhamerp24/Football-Manager-27-Editor , commit 045bfc37b27fe290dd91029721d5020d8b6295e3. Licença, perfis e referências relevantes estão em codigo-fonte/vendor/fm27-reference. O código adaptado completo está nos fontes.

## Edição .5
Público máximo, médio e mínimo agrupados nesta ordem vertical. A análise com REA está documentada em ANALISE_REA.md. Notas automáticas e pedidos à direção continuam pendentes; as funções da edição .4 foram preservadas.


## Edição .6

- **Finanças → Dívidas e empréstimos.** Escolha um credor ou tipo na lista para abrir o registro. Edite valor original, prestação, juros e datas nos tipos compatíveis. Em empréstimos com juros capitalizados (PIK), o quadro mostra o valor no vencimento e os juros totais. Esses dois campos ficam em consulta para esse tipo.
- **Finanças → Demonstrativo financeiro.** Consulte até cinco períodos recentes. O resultado indica a diferença entre as receitas e despesas exibidas. Os dados são de consulta e representam as rubricas identificadas pelo perfil.
- **Clubes afiliados.** Selecione um acordo existente para editar a taxa anual, as datas, as condições para amistosos e empréstimos, a preferência de compra, a contribuição salarial e a observação compartilhada. Os campos disponíveis variam com o registro.
- **Central de cláusulas.** Reúne cláusulas de transferências reconhecidas no clube. Edita percentual de revenda, valor da contratação, bônus, metas de jogos ou gols e datas de validade quando aplicáveis.
- **Plantéis e Meu clube.** Clique em Nota média ou Fim do contrato para ordenar. Use Mostrar jogadores para filtrar lesionados e contratos que vencem em até seis meses a partir da data do save. A nota ainda é importada de um arquivo do FM.

As edições das listas aparecem no Histórico. O editor verifica o registro de novo ao salvar e ao desfazer. Se o jogo tiver alterado os dados, atualize a lista.

As quatro novas abas de dados usam os perfis de referência Steam e Game Pass do FM 27.1.0 build 2505117. O código e as referências dos leitores e editores estão em `codigo-fonte/crates/fmlibre-core/src/club_records.rs` e `codigo-fonte/vendor/fm27-reference`. A compilação e a interface com dados de demonstração foram verificadas. O teste com um save real deve ser feito em uma cópia.
