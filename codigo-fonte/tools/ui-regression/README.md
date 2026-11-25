# Regressão de interface da edição .25

O teste inicia o Vite e usa dados simulados. Ele cobre navegação, seleção 5×, grupos, gráfico, prévia de lotes, transferências e seleção de coesão. Não conecta o FM27.

Com Node.js e as dependências do diretório **app** instaladas, execute **node tools/ui-regression/development25.cjs** a partir da raiz. O script requer Playwright e Chromium. Use **PLAYWRIGHT_MODULE** para informar o módulo instalado fora do projeto e **UI_CHROMIUM_BIN** para escolher um Chromium compatível.
