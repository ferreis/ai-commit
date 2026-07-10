# AI Commit

Extensão para VS Code que gera mensagens de commit em português do Brasil a partir das alterações do Git.

O resultado é inserido no campo de mensagem do Controle de Código-Fonte. A extensão não executa o commit automaticamente.

## Recursos

- Geração baseada nas alterações em stage ou no diretório de trabalho.
- Mensagens no padrão Conventional Commits.
- Suporte a Ollama, OpenRouter, OpenCode e Codex CLI.
- Seleção dos modelos disponíveis em cada provedor.
- Teste de conexão antes da geração.
- Cancelamento e tempo limite para as execuções.
- Painel com atividade do modelo, respostas HTTP e saída dos processos locais.
- Armazenamento seguro da chave do OpenRouter pelo VS Code.

## Provedores

| Provedor | Requisito | Catálogo de modelos |
| --- | --- | --- |
| Ollama | Serviço em execução e modelo instalado | Modelos instalados no Ollama |
| OpenRouter | Chave de API válida | Modelos retornados pela API |
| OpenCode | CLI instalada e autenticada | Saída do comando `opencode models` |
| Codex | CLI instalada e autenticada | Catálogo local do Codex |

## Instalação

Instale um pacote `.vsix` pelo terminal:

```bash
code --install-extension ai-commit-x.y.z.vsix
```

Depois, execute `Desenvolvedor: Recarregar Janela` na Paleta de Comandos do VS Code.

O arquivo `.vsix` é um artefato de build e não é versionado no repositório.

## Como usar

1. Abra um repositório Git no VS Code.
2. Faça alterações ou adicione arquivos ao stage.
3. Abra o Controle de Código-Fonte.
4. Clique no botão de configuração do AI Commit.
5. Escolha o provedor e atualize a lista de modelos.
6. Salve e teste a conexão.
7. Clique em **Gerar commit agora** ou use o botão de geração na barra do Git.
8. Revise a mensagem antes de executar o commit.

A extensão prioriza as alterações em stage. Quando o stage está vazio, ela usa as alterações do diretório de trabalho.

## Comandos

- `Gerar mensagem de commit com IA`
- `Configurar gerador de commit`
- `Testar provedor do AI Commit`
- `Mostrar diagnóstico do gerador`

## Privacidade e segurança

A extensão precisa enviar o conteúdo do diff ao provedor escolhido para gerar a mensagem.

- Com o Ollama no endereço local padrão, o processamento permanece na máquina.
- OpenRouter envia o diff para o serviço remoto.
- Codex e OpenCode podem usar serviços remotos, conforme a autenticação e a configuração desses CLIs.
- Use apenas URLs, executáveis e modelos em que você confia.
- As configurações usam escopo de máquina e não podem ser sobrescritas pelo `settings.json` do workspace.

A chave do OpenRouter é armazenada no `SecretStorage` do VS Code. Ela não é gravada no `settings.json`, no código-fonte ou nos logs da extensão.

O diagnóstico pode mostrar o caminho local do repositório, o nome do modelo, mensagens de erro e a mensagem de commit gerada. Revise o conteúdo antes de compartilhar logs publicamente.

O painel mostra eventos de execução e resumos fornecidos pelos provedores. Ele não expõe o raciocínio privado interno dos modelos.

## Configurações

| Configuração | Padrão | Descrição |
| --- | --- | --- |
| `aiCommit.provider` | `ollama` | Provedor usado na geração |
| `aiCommit.ollamaModel` | `qwen3.5:9b` | Modelo instalado no Ollama |
| `aiCommit.ollamaBaseUrl` | `http://127.0.0.1:11434` | Endereço do Ollama |
| `aiCommit.openRouterModel` | `openai/gpt-4.1-mini` | Modelo do OpenRouter |
| `aiCommit.openRouterBaseUrl` | `https://openrouter.ai/api/v1` | Endereço da API do OpenRouter |
| `aiCommit.openCodeExecutable` | `opencode` | Executável do OpenCode |
| `aiCommit.openCodeModel` | vazio | Modelo específico do OpenCode |
| `aiCommit.codexExecutable` | `codex` | Executável do Codex |
| `aiCommit.codexModel` | vazio | Modelo específico do Codex |
| `aiCommit.requestTimeoutSeconds` | `180` | Tempo limite entre 10 e 600 segundos |

## Desenvolvimento

Requisitos:

- Node.js 18 ou superior.
- VS Code 1.90 ou superior.

Valide a sintaxe:

```bash
npm run check
```

Execute os testes:

```bash
npm test
```

Estrutura principal:

```text
extension.js              Ativação e integração com o Git
src/providers.js          Ollama, OpenRouter, OpenCode e Codex
src/settings-panel.js     Painel de configuração e diagnóstico
src/diagnostics.js        Histórico e canal de saída
test/                     Testes automatizados
```

## Limitações

- O diff enviado ao modelo é limitado a 60.000 caracteres.
- A extensão gera a mensagem, mas não executa `git commit`.
- A qualidade do resultado depende do modelo selecionado.
- Ollama e CLIs locais precisam estar iniciados ou autenticados separadamente.

## Licença

Este projeto ainda não possui uma licença definida. Antes de aceitar contribuições ou permitir redistribuição, adicione um arquivo `LICENSE` com a licença escolhida.
