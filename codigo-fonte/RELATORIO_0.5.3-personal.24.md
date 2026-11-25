# FM Evolution PRO 27 · Relatório da .24

Edição portátil **0.5.3-personal.24**, atualização da **.23**. A cópia original foi preservada durante o trabalho. O tema grafite e roxo, a navegação do editor e as licenças acompanham o pacote.

## Auditoria e correções

| Área | Achado na base .23 | Alteração na .24 |
|---|---|---|
| Desenvolvimento | O bônus exigia que CA e atributos crescessem juntos. Um erro ao gravar podia interromper os próximos jogadores. | A verificação semanal usa o aumento positivo de CA observado. Cada jogador gera um resultado e o processamento continua após uma falha individual. |
| Seleção | Mudanças no estado da conexão podiam apagar escolhas. A ação de pausar na troca de plantel omitia a seleção obrigatória. | Filtros preservam marcações manuais, inclusive acima da idade. A chamada de pausa inclui a seleção vazia. O perfil local pode recuperar a seleção aplicada. |
| Propostas | A interface não distinguia a data da negociação da data de transferência. O tipo 1 era apresentado como definitivo antes da classe contratual ser identificada. O valor à vista era decodificado com sinal. | Colunas e diagnósticos próprios para valor, data da proposta e dia da transferência. A modalidade sem classe conclusiva aparece como proposta entre clubes. A parcela usa a largura sem sinal documentada e o salário mantém sua faixa de validação. Identificadores repetidos bloqueiam a edição. |
| Coesão e tática | O ajuste tático recebia a seleção, mas aplicava planos a todo o plantel. Coesão, exposição tática e parcerias em campo são registros diferentes. | Ajuste tático respeita a seleção. Coesão tem prévia por atleta, níveis 60/85/100 e nova leitura após a operação. A ação usa apenas atletas do plantel e exclui empréstimos de entrada. |
| Ficha | CA, PA e identidade podiam vir da linha indexada na conexão. | A leitura detalhada atualiza CA, PA, nascimento, clube, idade, posições e valor de mercado. |
| Finanças | A .23 já fazia a conversão e a formatação brasileiras. | A apresentação mantém separadores e centavos. O valor original permanece armazenado em libras inteiras. O arredondamento de exibição não gera gravação. |

A aplicação React se comunica com o Tauri em **app/src-tauri/src/lib.rs**. Os perfis, as verificações de leitura e a releitura após escrita ficam em **crates/fmlibre-core**. O acompanhamento usa **development.rs**, **development_store.rs** e **growth.rs**. **player_tools.rs** centraliza os novos lotes no histórico existente. **transfer_center.rs** e **fmlibre-deals** validam as propostas. **ClubTactics.tsx**, **cohesion.rs** e **familiarity.rs** tratam os indicadores de entrosamento e seu escopo.

## Comparação com os editores enviados

| Recurso | Evidência externa | FM Evolution PRO 27 .24 |
|---|---|---|
| Cópia seletiva | O FMRTE 27.1.0-build14 inclui uma captura do Clone Center com origem, vários destinos e categorias. | Cópia por categoria ou atributo com prévia, proteção de CA/PA e resultado por destino. |
| Coesão e tática | A documentação visual do FMRTE mostra áreas táticas e coesão média em controles distintos. | Coesão por atleta e níveis na tela existente. Indicadores de tática e treino são lidos separadamente. |
| Empréstimos | A documentação visual do FMRTE mostra prazo, contribuição salarial, taxas mensais e opções e obrigações de compra. | A edição de empréstimos ativos e as cláusulas reconhecidas da base foram mantidas. Ficam pendentes as propostas de empréstimo e os termos adicionais. |
| Histórico e perfis | O FMRTE distribui capturas de histórico e edição em massa e inclui presets. | Gravações identificadas por operação no histórico, perfis de desenvolvimento e presets físicos próprios. |
| Propostas e transferências futuras | Fm27Editor(1).exe é um aplicativo Windows x64 com manifesto Fm27Editor.App. Foram encontradas referências textuais a transferências futuras. | O fluxo e o comportamento do executável externo não foram confirmados. As leituras e escritas seguem os perfis e a documentação já presentes no projeto. |

A inspeção externa teve como fontes os metadados, os arquivos distribuídos e as capturas de documentação do FMRTE. Nenhum dos executáveis externos foi iniciado neste ambiente. A implementação usa o código existente do projeto. Os arquivos externos serviram como referência e não acompanham a distribuição.

## Estado da entrega

| Estado | Confirmação |
|---|---|
| Concluído no código | O modo 5× está configurado para verificação semanal. Cada jogador da seleção validada é avaliado individualmente quando chega sua semana. Falhas por atleta aparecem no diagnóstico. O bônus usa o ganho positivo observado e respeita PA, teto de CA e limite semanal. Isso corrige as duas causas encontradas na .23, mas a frequência de evolução em uma temporada real ainda precisa ser medida. |
| Parcialmente concluído | A Central de Entrosamento tem seleção individual corrigida no backend, prévia de coesão e releitura. O acompanhamento semanal desta versão funciona enquanto a aba está aberta. Regras posicionais de desenvolvimento continuam como prévia. A Central de Transferências separa a parcela, a data da proposta, a data agendada e a identidade contratual. A data é editável após confirmação e identificação do agendamento. |
| Pendente de validação no FM27 | Reproduzir as propostas de Montoro e Gabriel Barbosa, verificar valor e data no jogo, avançar várias semanas com jogadores selecionados, testar a coesão e confirmar persistência após salvar e recarregar. |

## Matriz de funcionalidades

| Área | Estado na .24 | Validação ou lacuna |
|---|---|---|
| Desenvolvimento 5× | Frequência semanal inicial, filtro de idade automático, seleção manual, diagnóstico JSON e limites por teto e PA. O bônus é o ganho positivo vezes o multiplicador menos um. | Ganho natural zero gera bônus zero. Um salto de várias semanas restabelece a referência. Persistência após salvar depende de teste no FM. |
| Evolução Imediata | Aumenta por pontos ou até um CA desejado. Inclui prévia e checagem de teto. | A persistência do CA após eventual recálculo do jogo ainda precisa ser verificada. |
| Posição, grupos e perfis | Grupos nomeados, regras de jogador e perfil, seleção de grupo principal e foco automático, por função ou por atributos. | O foco por posição vale para a prévia. Alterar crescimento por posição depende de comprovação no FM. |
| Gráfico e organização | Compara até cinco atletas por CA, PA, distância do PA e atributos. Favoritos, listas e regras ficam no perfil nomeado da carreira. | O nome do save é escolhido e reassociado manualmente. O gráfico começa na primeira leitura feita pelo editor. |
| Condição física | Condição, ritmo, fadiga e leitura de lesões e recuperação quando disponíveis. Presets com prévia. | Prontidão e recuperação clínica dependem do FM. A cura de lesões da base continua nas ações de Plantéis. |
| Gestor de Contratos | Vencimento, extensão em anos, salário fixo ou percentual de contratos integral e parcial. Verifica identidade, clube, datas, salário e registros pendentes identificados. | Cláusulas continuam no editor específico. A renovação em lote modifica termos de um contrato ativo. |
| Cópia de atributos | Técnicos, mentais, físicos, de goleiro, ocultos e individuais, com prévia. | Aumentos visíveis exigem posição principal igual, CA da origem até o CA do destino e margem no PA. O recálculo após combinar atributos ainda precisa ser validado no FM. |
| Histórico e lotes | Campo, antes/depois, data, módulo e lote para gravações confirmadas. Progresso e cancelamento dos jogadores restantes. | Falhas aparecem no resultado da operação. O histórico persistente guarda gravações efetivas. |
| Transferências | Busca pelo número, jogador e clubes. Filtros por tipo, situação, data e valor. Valor disponível em propostas elegíveis e data quando há agendamento validado. | Uma proposta “Aguardando clube” ainda não tem data confirmada para reagendar. Parcelas, bônus, estados e percentuais de revenda continuam sem novas escritas. |
| Entrosamento | Níveis de coesão com seleção, prévia e releitura. Acompanhamento semanal enquanto a aba está aberta. Familiaridade tática usa os planos existentes, com a seleção corrigida. | O convívio no calendário é a ferramenta da base para parcerias. Monitoramento em segundo plano e mudança de familiaridade posicional ainda precisam ser concluídos. |
| Funcionários, comparação e pesquisa | A base mantém funcionários, filtros e edição, comparador de até quatro jogadores, filtros salvos, busca e atalhos. | Busca unificada com todos os filtros e menu contextual global permanecem pendentes. |
| Clube, finanças e nacionalidades | A base mantém relações reconhecidas, nacionalidades, instalações, categorias de base, patrocínios, premiações e dívidas. | Expansão de diretoria e propriedade, cláusulas extras, gestor completo de empréstimos e histórico financeiro longitudinal ainda estão pendentes. |
| Administração | Diagnóstico, automações por área e cópia de saves existentes. Versão exibida, ZIP e fontes completos. | Central unificada de alertas, restauração seletiva e verificador global não entraram. O instalador não foi gerado neste ambiente. |

## Verificação em uma carreira

- Em uma cópia do save, busque **9199** ou **Montoro** na Central de Transferências. Confira o diagnóstico do valor à vista. Teste a data em uma proposta confirmada para o futuro, com agendamento identificado.
- Compare o antes e depois no FM. Abra a tela de novo. Salve em outro arquivo no FM, recarregue e confirme os valores.
- Para o 5×, selecione de cinco a dez jogadores com PA acima do CA e inclua um jogador acima do filtro de idade. Use um jogador no teto como controle. Avance semana a semana e confira o diagnóstico e o limite. Atualize no mesmo dia para conferir se a operação não se repete.
- Teste um lote com jogadores elegível e bloqueado. Confira o estado no Histórico e exercite o desfazer. Mude de partida e confirme que a prévia antiga expirou.

### Resultados de testes

| Verificação | Resultado |
|---|---|
| Compilação de produção | Tauri e Rust compilaram o executável Windows x64 por MinGW. O arquivo é PE32+ GUI x86-64, inclui a versão .24 e referencia os arquivos da interface desta compilação. |
| Interface | TypeScript e Vite concluídos. Sete cenários automatizados em Chromium com dados simulados passaram, sem erros de execução no navegador. Cobrem seleção 5× acima da idade, diagnóstico individual, grupos e teto, gráfico semanal e mensal, prévia e aplicação em lote, condição física, valor/data de propostas e seleção da coesão. |
| Testes de lógica | 43 passaram. São 6 de crescimento, 17 de regras de transferências e 20 do Trainer. Incluem limite de PA, teto, ganho natural e duplicação por queda e recuperação, valor sem sinal, estados fechados, data passada e agendamento inexistente. |
| Integração Windows | A verificação cruzada de código e dos alvos de teste de fmlibre-core e fmlibre-app concluiu. Os testes que exigem Windows e FM27 continuam pendentes. |
| Distribuição | O ZIP contém o executável, o carregador WebView2 x64, a documentação, os fontes e as licenças. O pacote inclui SHA-256 dos arquivos. |

Os casos reais de Álvaro Montoro e Gabriel Barbosa, a abertura do executável em Windows e a persistência após salvar e recarregar no FM27 ficaram pendentes neste ambiente de compilação Linux.
