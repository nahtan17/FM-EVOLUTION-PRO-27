# FM Evolution PRO 27 · Edição pessoal

Versão **0.5.3-personal.28** para Windows x64, baseada no FMLibreEditor 0.5.3 e no FM27 Trainer 0.2.8.

## Interface FM Evolution PRO 27

- Clubes organizado em abas, com campos editáveis de acordo com o suporte do jogo. O plantel e os olheiros abrem a ficha do jogador na página Jogadores.
- Use **Salvar alterações** ou **Ctrl+S** para aplicar campos pendentes. A barra superior indica o estado e avisa se alguma gravação foi interrompida. O Histórico continua disponível.
- No Centro de Transferências, selecione uma proposta e edite os campos disponíveis. Use **Aplicar na proposta**, **Salvar alterações** ou **Ctrl+S**. **Conferir alterações** abre uma prévia opcional. O valor à vista de uma proposta de compra identificada fica disponível durante a negociação. A data passa a ser editável quando o FM confirma a transferência e existe um agendamento futuro identificado.
- Jogadores e comissão técnica abrem a ficha em toda a área principal. As listas têm busca por nome ou ID e paginação. Os rascunhos acompanham as abas de registros abertos.


## Abrir

1. Extraia o ZIP inteiro. Mantenha `FMEvolutionPRO27.exe` e `WebView2Loader.dll` na mesma pasta.
2. Faça uma cópia do seu save e carregue essa cópia no Football Manager 27.
3. Abra `FMEvolutionPRO27.exe` e clique em **Carregar jogo**. Confira se clube, jogadores e valores correspondem ao jogo. Durante o teste, use somente este editor.
4. Abra um perfil, edite os campos disponíveis e use **Salvar alterações** ou **Ctrl+S**.
5. Salve a carreira **dentro do Football Manager**, preferencialmente com outro nome, para gravar as alterações no arquivo `.fm`.

Requer Windows 10/11 de 64 bits e Microsoft Edge WebView2 Runtime. O pacote inclui o carregador x64 do WebView2.

## Alterações da .28

- Em **Países → seleção aberta → Entendimento tático da seleção**, informe um valor inteiro de 0 a 100% para cada área que você quer ajustar. Campos vazios mantêm os valores da área. Clique em **Ver prévia da tática ativa**, escolha os convocados e confirme a aplicação.
- A edição ajusta as entradas existentes e identificadas nas seis áreas de instruções. Os campos começam em 100% para acesso à maximização. O registro é compartilhado com o clube. Formação, função e histórico de treino ficam fora da edição. Quando a tática ativa ou os registros estão indisponíveis, o editor informa o motivo.
- Use **Desfazer** no resultado ou no **Histórico** enquanto a carreira continuar carregada e os registros estiverem nas mesmas posições e com os valores gravados. A aplicação e o desfazer passaram em dados simulados. O efeito na tela de tática e a persistência em um save real aguardam teste.
- Em **Treino → Elenco → Central de condição física**, **Modo avançado experimental** permite escolher um valor bruto independente para condição e ritmo, ou conservar cada campo. Confira a prévia e aplique somente as linhas prontas. As predefinições acima de 10000 podem ser conferidas na prévia e são recusadas pela validação da gravação.
- **Carregar e selecionar elenco inteiro** consulta todos os plantéis do clube atual. A Central continua permitindo seleção individual e restauração dos lotes confirmados na mesma conexão.

O **RELATORIO_0.5.3-personal.28.md** documenta a base usada para este pacote.

## Alterações da .27

- **Treino → Desenvolvimento → Desenvolvimento Avançado** usa o multiplicador efetivo como mínimo semanal quando **Crescimento semanal garantido** está ativo. 1× permite +1 CA, 5× permite +5 CA e 10× permite +10 CA com ganho natural zero e margem suficiente.
- **Treino → Elenco → Central de condição física** tem **Modo avançado**, com condição bruta e ritmo separados. 10000 equivale a 100%. Faça a prévia, aplique e, se for preciso, restaure os valores anteriores na mesma conexão.
- **Países → seleção aberta** tem a prévia **Maximizar entendimento tático — 100**. A disponibilidade é indicada por campo. A gravação nacional está bloqueada até a validação do contexto tático da seleção.

Consulte **RELATORIO_0.5.3-personal.27.md** para testes, limites e evidências.

## Alteração da .26

- **Treino → Desenvolvimento → Desenvolvimento Avançado** oferece **Crescimento semanal garantido**. Marque a opção para permitir +1 CA a jogadores elegíveis sem ganho natural positivo na verificação da nova semana. O diagnóstico mostra o CA antes e depois e o motivo do bônus.

Consulte **RELATORIO_0.5.3-personal.26.md** para os testes e a auditoria de atributos.

## Alterações da .25

- **Desenvolvimento Avançado** aplica o foco por posição, função ou atributos ao ganho que o FM já registrou. A tela mostra o foco usado e os atributos efetivamente alterados. O multiplicador, o teto, o orçamento semanal e o PA continuam limitando o bônus.
- **Clube → Entendimento tático** tem a opção **Monitorar coesão semanalmente em segundo plano**. Ative por plantel. O histórico da conexão continua a receber leituras enquanto outra aba está aberta. Ao recarregar os dados da carreira, ative o monitoramento de novo.
- **Centro de Transferências** mostra evidências do vínculo da proposta, contagem de contratos e agendamentos, diagnóstico copiável e parcelas reconhecidas em registros e builds documentados. O gestor de empréstimos ativos reúne registros do clube e abre a ficha existente para ações.
- **Desenvolvimento → Grupos, perfis e listas** pode gerar backup em JSON e carregar seções selecionadas como rascunho. Use **Guardar configurações** após conferir.
- **Clube → Finanças → Histórico financeiro** registra saldo, orçamento de transferências e orçamento salarial da data atual. Escolha um perfil nomeado da carreira em Desenvolvimento antes de registrar.
- **Buscar / Ctrl+K** oferece filtro por categoria, ações rápidas, Central de alertas e Verificador de integridade. **Alertas** também tem acesso direto pela barra superior.

Consulte **RELATORIO_0.5.3-personal.25.md** para os detalhes da edição anterior.

## Alterações da .24

- **Clubes → Centro de Transferências** mostra a data da proposta e a data da transferência em colunas separadas. Busque pelo número da proposta ou abra **Mais filtros** para escolher tipo, situação, data ou valor mínimo. Abaixo de cada campo, confira sua disponibilidade.
- **Treino → Desenvolvimento** oferece 5× semanal, seleção manual, diagnóstico individual, grupos, perfis e listas. A aba **Gráfico de evolução** compara até cinco jogadores.
- **Evolução Imediata**, **Gestor de Contratos** e **Copiar atributos** ficam em **Treino → Desenvolvimento**. Escolha os jogadores, ajuste os campos, use **Conferir alterações** e depois **Aplicar alterações conferidas**. A Central de condição física fica em **Treino → Elenco**.
- **Clubes → Entendimento tático** inclui a Central de Entrosamento. Escolha quem participa da operação. A verificação semanal compara as leituras enquanto a aba estiver aberta.
- **Histórico** registra as gravações bem-sucedidas dos novos módulos com o campo, os valores, a origem e o lote.

## Recursos das versões anteriores

- **Finanças** exibe valores como `R$ 8.510.926.013,00` em reais. Digite o valor simples ou formatado. O campo formata a entrada ao perder o foco. Valores de jogo em libras inteiras continuam seguindo a conversão monetária da edição anterior.
- **Clubes → Torcida** aceita atributos de 1 a 20 e percentuais que somem 100% nos clubes com suporte à escrita. A barra acompanha o rascunho. Use **Restaurar valores originais**, **Conferir alterações** e **Aplicar alterações**. O Histórico permite reverter uma gravação válida.
- **Jogadores → Busca avançada** combina filtros de identificação, habilidade, contrato e características. Selecione posições no campo, escolha qualquer uma ou todas e ajuste a familiaridade. A lista permite guardar filtros, ordenar, exportar e abrir o jogador.
- **Compatibilidade**. Empréstimos e registros encerrados ou ambíguos ficam somente para leitura. O editor exige um contrato futuro identificado para editar seus termos e um agendamento futuro coerente para editar a data.

- Paleta grafite e roxo recuperada dos estilos da versão .17, com modo claro disponível no cabeçalho.
- **CA Recomendada** estima a habilidade pelos atributos e pela posição principal. Clique no valor e confirme para adicioná-lo ao rascunho. O editor avisa quando a estimativa excede o PA positivo. Consulte `docs/ca-recomendada.md` no código-fonte para verificar o modelo e seus limites.
- Os movimentos reconhecidos foram traduzidos incluindo a descrição dos estados ativos. Os bits 62 e 63 continuam identificados por número.

- **Maximizar atributos** está disponível nas fichas individuais de jogadores e funcionários. Selecione uma função de referência na ficha do jogador para destacar os atributos relacionados.
- Aba **Olheiros** traduzida: seis seções, filtros, funções, oportunidades, comparação, saídas, base e relatórios. Abreviações de posições adaptadas. Nomes próprios e dados do jogo são preservados.
- Clube dividido em **Informação**, **Plantéis**, **Finanças**, **Entendimento tático**, **Parcerias em campo**, **Comissão técnica** e **Estádio**.
- Entendimento tático com oito áreas, leituras separadas da exposição e do treino e coesão média. Informação indisponível aparece como “—”.
- Chave **Manter melhorias do elenco** no Meu clube, nos Plantéis e no Entendimento tático.
- **Treino** reúne planejamento, leitura de eficácia tática, análise da escalação e ações de elenco. Finanças e Centro de Transferências ficam no perfil do clube.

## Manter melhorias do elenco

Marque a chave no plantel desejado. A cada 3 segundos, o módulo nativo reaplica as cinco ações:

1. Inspirar: moral máxima e remoção das insatisfações tratadas pela ação original.
2. Recuperar condição: condição e ritmo em 100%, com desgaste reduzido.
3. Curar as lesões atuais.
4. Melhorar coesão nas entradas existentes para o clube.
5. Melhorar entendimento tático nos registros validados.

A chave começa desligada. Funciona com a janela minimizada, enquanto o aplicativo estiver aberto e conectado. Desmarcar interrompe as próximas reaplicações; os valores já escritos permanecem. Para desfazer, desligue a manutenção e use o **Histórico**.

A manutenção é vinculada ao clube, plantel e conexão. Troca de save, retorno da data, desconexão, modo somente leitura ou falha pausam a manutenção. Confira o aviso antes de reativar. As cinco ações juntas exigem registros da tática do plantel; times sem tática de treinador humano podem não tê-los. As ações abrangem a lista da base, incluindo emprestados quando nela constam.

## Parcerias em campo

**Ver plano de entrosamento** permite conferir o calendário. **Programar convívio agora** adiciona até uma sessão de *Team Bonding* por semana, somente em um horário futuro de descanso. Preserva jogos, viagens, férias e as demais sessões. Sem horário livre, ou com convívio já presente, a semana permanece como está.

**Manter treino coletivo de entrosamento** reaplica essa regra enquanto o editor estiver aberto. Usa o time principal do clube selecionado no Trainer e recusa outro clube. O planejamento automático do Trainer respeita esse foco quando ambos estão ligados.

As linhas verdes no esquema tático representam parcerias entre duplas. A edição direta dessas parcerias segue indisponível. O efeito do convívio depende do treino no jogo.

## Treino

- **Eficácia e treinos** permite ler a tela do FM, importar uma captura PNG de até 12 MB ou preencher os 17 fatores manualmente. A leitura automática aceita somente os 17 indicadores e as quatro barras identificadas, com o intervalo ajustável de 5 a 120 segundos. Medições incertas são indicadas na leitura manual para conferência.
- **Plantel de treino** permite escolher o treinador do clube e a equipe. Para planejar treinos de uma equipe da base ou do time B, ela precisa ter calendário próprio no FM. A troca de plantel pausa as automações e limpa a prévia para que o próximo plano use a equipe escolhida.
- **Proteger esta semana** preserva suas sessões nas aplicações manuais e automáticas da aba Treino, durante a sessão e para o plantel escolhido. Você pode liberar a semana na própria prévia. O intervalo de reavaliação do foco vale para a exportação e para o calendário real.
- **Tática e escalação** mostra as oito áreas pelos respectivos nomes e sugere alternativas disponíveis fora do onze atual. As notas são estimativas.
- **Elenco** tem moral, lesões, suspensões, registro e numeração. Use **Desfazer última ação** para edições feitas no Treino e **Histórico** para as edições do editor.
- **Exportação** em HTML, CSV e JSON em `Documentos/FM Livre 27/Trainer`. A exportação usa as datas escolhidas. O botão de aplicar usa o calendário do jogo.

O editor e a aba Treino têm controles de compatibilidade próprios. Os dados do Treino ficam em `%APPDATA%/io.github.fmlivre27.personal/trainer`.

## Desenvolvimento dos jogadores

1. Abra **Treino → Desenvolvimento → Grupos, perfis e listas** e associe a sessão a um nome exclusivo para esse save caso queira guardar as observações. Reabra essa área com o mesmo nome ao retornar à mesma carreira.
2. Em **Desenvolvimento Avançado**, deixe **5×** e **Verificação semanal** selecionados. Confira o clube ou o plantel e marque os atletas. O limite de idade muda a seleção automática. Marcações e exclusões manuais ficam preservadas com a opção correspondente ativa.
3. Clique em **Aplicar aos selecionados**. A primeira leitura estabelece a referência. Se o FM registrar +1 CA desde a referência, o editor pode acrescentar +4, respeitando o PA válido, o teto e o orçamento semanal. Se o FM registrar +0, o bônus solicitado equivale ao multiplicador efetivo do jogador com **Crescimento semanal garantido** marcado. A margem de CA, o PA e o orçamento semanal limitam a gravação. O padrão continua sendo 5× sobre ganhos naturais.
4. Mantenha editor e jogo abertos, avance para uma nova semana do FM e abra o **Diagnóstico de desenvolvimento**. Ali estão o CA antes e depois do bônus confirmado, o PA, o ganho natural e o motivo da alteração, do bloqueio ou da falha. **Exportar diagnóstico** produz um arquivo JSON.
5. Salve dentro do FM. Após recarregar a carreira, associe o perfil, restaure os jogadores guardados se desejar e ative a rotina de novo. O gráfico exibe a última observação de cada semana ou mês.

A semana vai de segunda a domingo no calendário do FM. O bônus mínimo grava apenas CA. Quando há ganho natural de CA e de atributos, os atributos elegíveis podem receber a amplificação já suportada pelo foco configurado.

## Calendário de treino

**Eficácia e treinos → Pré-visualizar treino** abre o calendário com manhã, tarde e extra. Use **Aplicar treinos no FM** para gravar. Você pode proteger dias e semanas do planejamento automático ou guardar um modelo.

## Disponibilidade e validação

As informações, instalações, torcida, estádio, elenco, finanças, patrocínios e premiação da liga são lidos do jogo. A edição .6 acrescenta dívidas e empréstimos, demonstrativo financeiro, clubes afiliados e central de cláusulas em perfis compatíveis. Consulte **NOVOS_RECURSOS.md** para detalhes dos campos e das operações disponíveis.

Reais são a moeda inicial, usando a conversão do banco de dados do jogo. Salários semanais continuam semanais. Algumas mensagens avançadas da base e nomes de sessões do Trainer podem aparecer em inglês; a tradução integral desta atualização cobre Olheiros.

A compilação para Windows x64, os testes de lógica e as verificações de interface foram realizados em Linux. A abertura do executável no Windows e a conexão, gravação e persistência em uma carreira real ainda dependem de validação. Veja **RELATORIO_0.5.3-personal.28.md** para os testes e as limitações.

## Fontes e créditos

O diretório `codigo-fonte` contém os fontes completos, perfis, arquivos de dependências e o Trainer em `vendor/fm27-trainer`. Consulte `BUILD_EDICAO_PESSOAL.md`. Atualizações automáticas estão desativadas para preservar esta adaptação.

- FMLibreEditor e colaboradores: https://github.com/tozmoz/FMLibreEditor — commit `53498c489ac25ae65ed96e82f68e95aa1cf4744f`, GPL-3.0-or-later. Consulte `LICENSE`.
- FM27 Trainer, Sem Hiel: https://github.com/SemHiel2003/fm27-trainer — commit `3d09fc039ea6d7305cb65b39dcbe046e3a8cbe7e`, MIT. Consulte `FM27_Trainer_LICENSE.txt` e `codigo-fonte/vendor/fm27-trainer/LICENSE`.
- Demais avisos: `AVISOS_DE_TERCEIROS.txt` e `licencas`.

Esta adaptação não é afiliada ao FMRTE, à Sports Interactive ou à SEGA.
