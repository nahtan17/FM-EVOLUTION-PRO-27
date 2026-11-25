# Compilar a edição pessoal 0.5.3-personal.29

Base: FMLibreEditor 0.5.3, commit `53498c489ac25ae65ed96e82f68e95aa1cf4744f`, GPL-3.0-or-later. Trainer: FM27 Trainer 0.2.8 de Sem Hiel, commit `3d09fc039ea6d7305cb65b39dcbe046e3a8cbe7e`, MIT, incluído em `vendor/fm27-trainer`.

Alterações: interface React/CSS, tradução, configurações, leitura detalhada das áreas táticas e manutenção nativa do elenco em `app/src-tauri/src/clubcare.rs`. `crates/fmlibre-trainer` integra os módulos originais e acrescenta ponte de operações, automações e foco no treino de convívio. A edição .7 integra escolha de plantel, leitura PNG, proteção de semanas e reavaliação do foco no calendário real. Os controles de compatibilidade e validação das escritas são preservados.

A revisão `.22` inclui formatação financeira em BRL, atalhos de edição de torcida, seleção por jogador no Desenvolvimento e filtros nativos na Busca Avançada. A revisão `.17` acrescenta a apresentação visual dos atributos, a consulta ao catálogo de funções e os ícones do FM Evolution PRO 27. Os arquivos otimizados para a compilação já estão incluídos. Para regenerá-los a partir da arte original, use `app/src-tauri/icons/make-icon.py` com Python e Pillow instalados.

## Windows

Instale Node.js 22 ou posterior, Rust estável (mínimo 1.90) e Visual Studio Build Tools com o workload C++. No diretório `app`:

```powershell
npm ci
npm run build
npm run tauri -- build --no-bundle
```

Saída: `target/release/FMEvolutionPRO27.exe` na raiz do projeto. O alvo MSVC normalmente usa o carregador estático do WebView2.

## Compilação do pacote entregue

Em Linux para `x86_64-pc-windows-gnu`, com Rust 1.100.0 e MinGW-w64 GCC 14.2.0:

```bash
rustup target add x86_64-pc-windows-gnu
cd app
npm ci
npm run tauri -- build --target x86_64-pc-windows-gnu --no-bundle
```

Saída: `target/x86_64-pc-windows-gnu/release/FMEvolutionPRO27.exe`. O alvo GNU precisa de `WebView2Loader.dll` x64 do pacote `webview2-com-sys` fixado em `Cargo.lock`, na mesma pasta. A DLL e sua licença estão incluídas.

## Verificação e desenvolvimento

```bash
cargo test --locked -p fmlibre-trainer -p fmlibre-deals
cd app
npm run build
npm run dev
```

No Linux, a biblioteca principal do editor é condicionada a Windows/macOS; seus testes não executam nesse alvo. Os testes do módulo Trainer verificam planejamento, validação e automações sem tocar um jogo real. A compilação Windows valida a integração nativa completa.

No aplicativo Tauri os comandos seguem para os módulos Rust e para o processo do FM. `Cargo.lock` e `app/package-lock.json` fixam as dependências.

A .24 acrescenta a verificação semanal de desenvolvimento, ferramentas em lote e revisão das datas e diagnósticos de propostas. A compilação entregue é portátil. O cálculo do desenvolvimento pode ser testado separadamente com `rustc --test --edition 2024 crates/fmlibre-core/src/growth.rs`.

O pacote contém fontes completos e licenças para recompilação e modificações nos termos da GPL-3.0-or-later e das licenças das dependências.

## Testes adicionados na .27

- Lógica de crescimento em qualquer plataforma com `rustc --test --edition 2024 crates/fmlibre-core/src/growth.rs`.
- No Windows, `cargo test --locked -p fmlibre-core -p fmlibre-app` inclui os testes de memória isolada e regras de grupos.
- Após `npm ci` no diretório `app`, execute `node tests/three-improvements.cjs` a partir da raiz dos fontes com o módulo Playwright e um Chromium disponíveis. A variável opcional `FM_CHROMIUM` indica o caminho do navegador. O cenário usa dados simulados.
