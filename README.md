# AI Commit

Gera mensagens de commit em portugues diretamente no Controle de Codigo-Fonte.

## Provedores

- Ollama local
- OpenRouter
- OpenCode CLI
- Codex CLI / GPT

Use o botao de engrenagem na aba Git para abrir a configuracao.

Na tela voce pode:

- escolher e configurar o provedor;
- carregar e selecionar os modelos disponiveis em cada provedor;
- testar a conexao antes de gerar;
- acompanhar atividade, respostas HTTP e encerramento dos processos;
- gerar a mensagem e revisar o resultado no campo de commit do Git.

O painel mostra eventos e resumos fornecidos pelos provedores. Ele nao exibe raciocinio privado interno dos modelos.

A chave do OpenRouter fica no SecretStorage do VS Code e nao aparece no `settings.json`.

## Diagnostico local

- Codex precisa estar autenticado e disponivel no `PATH`.
- OpenCode precisa estar instalado, autenticado e disponivel no `PATH`.
- Ollama precisa estar em execucao e com o modelo configurado instalado.
