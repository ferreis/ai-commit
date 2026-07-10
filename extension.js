'use strict';

const vscode = require('vscode');
const { Diagnostics } = require('./src/diagnostics');
const { callProvider, listProviderModels, stopActiveProcesses, testProvider } = require('./src/providers');
const { SettingsPanel } = require('./src/settings-panel');

const MAX_DIFF_LENGTH = 60000;
let diagnostics;

async function getGitApi() {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension) throw new Error('A extensao Git integrada nao esta disponivel.');
  const gitExports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
  return gitExports.getAPI(1);
}

function selectRepository(repositories) {
  if (repositories.length === 0) throw new Error('Nenhum repositorio Git aberto.');
  const activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
  return repositories.find((repository) => activeFilePath?.startsWith(repository.rootUri.fsPath)) || repositories[0];
}

async function getRepository() {
  const gitApi = await getGitApi();
  return selectRepository(gitApi.repositories);
}

async function getDiff(repository) {
  const stagedDiff = await repository.diff(true);
  if (stagedDiff.trim()) return { content: stagedDiff, source: 'stage' };
  const workingTreeDiff = await repository.diff(false);
  if (!workingTreeDiff.trim()) throw new Error('Nenhuma alteracao encontrada para descrever.');
  return { content: workingTreeDiff, source: 'diretorio de trabalho' };
}

function buildPrompt(diffContent) {
  return [
    'Gere uma mensagem de commit em portugues do Brasil para o diff abaixo.',
    'Use Conventional Commits: tipo(escopo opcional): descricao curta.',
    'Tipos: feat, fix, refactor, chore, docs, test, style, perf, build, ci, revert.',
    'Se a mudanca for simples, gere somente a primeira linha.',
    'Se precisar de corpo, use uma linha vazia e frases curtas.',
    'Nao use ferramentas, nao altere arquivos e nao execute comandos.',
    'Nao invente informacoes. Nao use Markdown, aspas ou explicacoes.',
    'Responda somente com a mensagem final do commit.',
    '',
    'DIFF:',
    diffContent.slice(0, MAX_DIFF_LENGTH),
  ].join('\n');
}

function cleanCommitMessage(message) {
  return String(message)
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

async function generateCommitMessage(extensionContext) {
  const startTime = Date.now();
  const configuration = vscode.workspace.getConfiguration('aiCommit');
  const provider = configuration.get('provider', 'ollama');
  diagnostics.clear();
  diagnostics.write(`Geracao iniciada. Provedor: ${provider}.`);

  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `AI Commit: ${provider}`,
    cancellable: true,
  }, async (progress, cancellationToken) => {
    progress.report({ message: 'Lendo alteracoes do Git...' });
    const repository = await getRepository();
    const diff = await getDiff(repository);
    diagnostics.write(`Repositorio: ${repository.rootUri.fsPath}`);
    diagnostics.write(`Diff: ${diff.source}, ${diff.content.length} caracteres.`);

    progress.report({ message: 'Aguardando o modelo...' });
    const generatedMessage = await callProvider(provider, {
      configuration,
      prompt: buildPrompt(diff.content),
      workingDirectory: repository.rootUri.fsPath,
      secrets: extensionContext.secrets,
      cancellationToken,
      diagnostics,
    });
    if (!generatedMessage) throw new Error('O modelo nao gerou uma mensagem.');

    repository.inputBox.value = cleanCommitMessage(generatedMessage);
    diagnostics.write(`Mensagem recebida em ${((Date.now() - startTime) / 1000).toFixed(1)} segundos.`, 'success');
    diagnostics.write(`Resultado:\n${repository.inputBox.value}`, 'success');
    await vscode.commands.executeCommand('workbench.view.scm');
    return repository.inputBox.value;
  });
}

async function testSelectedProvider(extensionContext, provider) {
  const configuration = vscode.workspace.getConfiguration('aiCommit');
  let workingDirectory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  try {
    workingDirectory = (await getRepository()).rootUri.fsPath;
  } catch {
    diagnostics.write('Teste executado fora de um repositorio Git.', 'info');
  }
  return testProvider(provider, {
    configuration,
    secrets: extensionContext.secrets,
    workingDirectory,
    diagnostics,
  });
}

async function listSelectedProviderModels(extensionContext, provider) {
  const configuration = vscode.workspace.getConfiguration('aiCommit');
  let workingDirectory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  try {
    workingDirectory = (await getRepository()).rootUri.fsPath;
  } catch {
    diagnostics.write('Catalogo carregado fora de um repositorio Git.', 'info');
  }
  return listProviderModels(provider, {
    configuration,
    secrets: extensionContext.secrets,
    workingDirectory,
    diagnostics,
  });
}

function showCommandError(error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  diagnostics.write(errorMessage, 'error');
  diagnostics.show(true);
  vscode.window.showErrorMessage(`AI Commit: ${errorMessage}`);
}

function activate(extensionContext) {
  const outputChannel = vscode.window.createOutputChannel('AI Commit');
  diagnostics = new Diagnostics(outputChannel);

  const generateCommand = vscode.commands.registerCommand('aiCommit.generate', async () => {
    try {
      await generateCommitMessage(extensionContext);
    } catch (error) {
      showCommandError(error);
    }
  });
  const settingsCommand = vscode.commands.registerCommand('aiCommit.openSettings', async () => {
    try {
      await SettingsPanel.createOrShow(extensionContext, diagnostics, {
        generate: () => generateCommitMessage(extensionContext),
        listModels: (provider) => listSelectedProviderModels(extensionContext, provider),
        testProvider: (provider) => testSelectedProvider(extensionContext, provider),
      });
    } catch (error) {
      showCommandError(error);
    }
  });
  const logsCommand = vscode.commands.registerCommand('aiCommit.showLogs', () => diagnostics.show(true));
  const testCommand = vscode.commands.registerCommand('aiCommit.testProvider', async () => {
    try {
      const configuration = vscode.workspace.getConfiguration('aiCommit');
      const result = await testSelectedProvider(extensionContext, configuration.get('provider', 'ollama'));
      diagnostics.write(result, 'success');
      vscode.window.showInformationMessage(`AI Commit: ${result}`);
    } catch (error) {
      showCommandError(error);
    }
  });

  extensionContext.subscriptions.push(generateCommand, settingsCommand, logsCommand, testCommand, outputChannel);
}

function deactivate() {
  stopActiveProcesses();
}

module.exports = { activate, buildPrompt, cleanCommitMessage, deactivate };
