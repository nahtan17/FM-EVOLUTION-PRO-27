# Análise estática com REA — FMRTE 27.1.0 build14

Foi usado o REA 6.10.1, do repositório https://github.com/morluto/rea. Referência consultada: a125d37bfad92fc3b5e472c6c18ee71654037221. Foram executados inspect-managed-artifact e inspect-desktop-application, com saída JSON. O programa analisado não foi executado.

## Evidências

Arquivo recebido: FMRTE 27.1.0-build14.rar. O pacote contém um iniciador e um executável principal em current/FMRTE.exe. O principal tem 127948768 bytes, SHA-256 1da8b1891a029e526ee471be97aa2f1c0573e931bd55f4eb091ed886d546e93f.

O REA identificou PE32+ x86_64 com seis seções. A classificação retornada por inspect-managed-artifact foi not-managed, com cli-directory-absent. Não foram encontrados metadados CLI/CIL que essa operação pudesse usar para listar classes e métodos. Isso não permite concluir, por si só, qual linguagem produziu o binário nem que uma análise nativa posterior seja impossível.

Os recursos de idioma contêm referências à nota média e a pedidos à direção, com resposta e datas. Esses textos permitem identificar os controles da interface, mas não demonstram os endereços ou a estrutura dos dados no processo do Football Manager.

## Resultado desta edição

A organização dos campos de público foi corrigida para Máximo, Médio e Mínimo, juntos e em ordem vertical. As funções existentes da versão .4 foram preservadas.

A nota média permanece por importação de uma exportação do FM. A leitura automática de notas e a edição individual dos pedidos à direção ainda não foram implementadas: faltam os dados de execução necessários para validar a ligação entre os registros e o jogo real. Os nomes dos controles extraídos dos recursos não foram usados como prova de funcionamento.

O ambiente de trabalho não tem uma instância do FM em execução. A compilação e a interface podem ser verificadas aqui; o comportamento dos novos campos em um save real depende de validação no computador com o jogo.
