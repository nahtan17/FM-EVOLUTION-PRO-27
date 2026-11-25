# FM Evolution PRO 27 · 0.5.3-personal.11

## Fase 1 · Comparação técnica

Referência inspecionada no tag v1.5.2, commit `a3b7f0ab2131549cb2449587731d13e478ebc9e1`.
A interface de referência usa Avalonia e C#. `MainWindow.cs` organiza navegação e documentos abertos. `CityView.cs` usa o editor genérico de entidades com um rascunho por registro, e `StadiumView.cs` e `NationView.cs` organizam campos, relações e seleções por seção. `PlayerWriter.cs`, `StadiumWriter` e os escritores de países validam dados antes de escrever e operam com perfis de endereços por build. `VerifiedWriteMemory` e `ChangeJournal` tratam verificação e histórico. O leitor da referência tem perfis próprios por plataforma e edição do FM, inclusive no Mac.

O Evolution usa React e TypeScript sobre comandos Tauri. Os perfis Rust selecionam a representação compatível, os comandos do jogo relocalizam registros e o histórico registra alterações e desfaz quando suportado. Mantivemos sua arquitetura e adaptamos a organização de navegação e edição. A referência traz o texto da GPL versão 3. A edição Evolution distribui a licença do projeto-base e os avisos já incluídos no pacote. Esta revisão não incorporou código C# nem perfis de memória da referência.

## Fases 2 e 3 · Navegação, temas e jogadores

- Navegação horizontal, atalhos existentes e botões para início, Histórico e tema. O tema escolhido persiste no navegador ou no WebView da instalação.
- Abas abertas mantêm os componentes e rascunhos montados. A ação global valida todos os drafts e rejeita dois drafts para o mesmo campo da mesma entidade antes de iniciar a escrita.
- Ficha de jogador com visão geral agrupada, menu interno lateral em telas largas e navegação horizontal em telas compactas. Visão geral inclui atributos técnicos ou de goleiro conforme a posição, mentais, físicos, personalidade e ocultos. As ações continuam ligadas aos comandos existentes.

## Fases 4 e 5 · Estádios, cidades e países

- Estádios usa a localização do estádio via clube e reutiliza os comandos de leitura, renomeação e capacidades. A busca desta versão é pelo clube. O desenho do campo é ilustrativo. O ID do estádio, proprietário, cidade, cadastro global e arquibancadas exigem mapeamento adicional validado no Evolution. Os setores da referência usam uma tabela própria de índices com capacidade e bits de cobertura, assentos e túnel.
- Cidades consulta o catálogo já lido dos locais de nascimento da carreira. Mostra o nome e os IDs disponíveis. A referência tem modelos de população, atração, coordenadas, altitude e vínculos. O perfil Rust atual desse catálogo só valida nome, ID e país. Os demais campos e a escrita da cidade permanecem indisponíveis.
- Países expõe diretamente as seleções nacionais existentes, incluindo categorias de base e reputação onde disponíveis. Ranking FIFA, pontuação, finanças da federação e público exigem leitores e validação próprios. Competições e premiação da liga continuam na área de clube onde havia suporte. Catálogos próprios de competições, prêmios, árbitros e tipos de lesão ficam pendentes.

## Fase 6 · Plantéis

O fluxo de ações de elenco já suportadas aceita checkboxes, mostra os nomes elegíveis e exige confirmação. O comando Tauri relê os jogadores do time e recusa o pedido se algum ID da seleção já não pertencer ao plantel. Mantém o histórico em lote. As automações existentes continuam usando o fluxo anterior sem seleção explícita. O painel de edição em massa e os demais módulos permanecem.

## Fase 7 · Verificação

Veja `VERIFICACAO.txt` no pacote. Ficam pendentes no FM27 aberto: conferir leitura por edição e build, gravar e reler nome/capacidade do estádio, verificar ações seletivas de plantel com desfazer e confirmar que as alterações persistem após avançar e salvar/reabrir a carreira. Novos mapeamentos só devem ser habilitados depois dessa validação. A prévia usa dados demonstrativos e o servidor Vite mantém Hot Reload durante o desenvolvimento.
