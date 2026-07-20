'use strict';

const vscode = require('vscode');
const { buildPrompt, cleanCommitMessage, isValidCommitMessage } = require('./src/commit-message');
const { Diagnostics } = require('./src/diagnostics');
const { callProvider, listProviderModels, stopActiveProcesses, testProvider } = require('./src/providers');
const { SettingsPanel } = require('./src/settings-panel');

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

    let commitMessage = '';
    const maximumAttempts = 2;
    for (let attemptNumber = 1; attemptNumber <= maximumAttempts; attemptNumber += 1) {
      progress.report({ message: attemptNumber === 1 ? 'Aguardando o modelo...' : 'Corrigindo resposta do modelo...' });
      const generatedMessage = await callProvider(provider, {
        configuration,
        prompt: buildPrompt(diff.content, attemptNumber > 1),
        workingDirectory: repository.rootUri.fsPath,
        secrets: extensionContext.secrets,
        cancellationToken,
        diagnostics,
      });
      if (!generatedMessage) throw new Error('O modelo nao gerou uma mensagem.');

      commitMessage = cleanCommitMessage(generatedMessage);
      if (isValidCommitMessage(commitMessage)) break;
      diagnostics.write(`Tentativa ${attemptNumber}: resposta fora do formato obrigatorio.`, 'error');
    }

    if (!isValidCommitMessage(commitMessage)) {
      throw new Error('O modelo nao gerou uma mensagem valida com cabecalho e corpo explicativo.');
    }

    repository.inputBox.value = commitMessage;
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
