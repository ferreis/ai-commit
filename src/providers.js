'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const OPENROUTER_SECRET_KEY = 'openRouterApiKey';
const activeProcesses = new Set();

function joinEndpoint(baseUrl, endpointPath) {
  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, '');
  const normalizedEndpointPath = String(endpointPath).replace(/^\/+/, '');
  return new URL(`${normalizedBaseUrl}/${normalizedEndpointPath}`);
}

function createProcessEnvironment() {
  const homeDirectory = os.homedir();
  const additionalPaths = [
    path.join(homeDirectory, '.local', 'bin'),
    path.join(homeDirectory, '.npm-global', 'bin'),
    path.join(homeDirectory, '.bun', 'bin'),
  ];
  const currentPath = process.env.PATH || '';
  return { ...process.env, PATH: [...additionalPaths, currentPath].join(path.delimiter) };
}

function attachCancellation(cancellationToken, cancelAction) {
  if (!cancellationToken) return { dispose() {} };
  if (cancellationToken.isCancellationRequested) cancelAction();
  return cancellationToken.onCancellationRequested(cancelAction);
}

function createStreamMonitor(providerName, diagnostics) {
  let responseCharacterCount = 0;
  let reasoningCharacterCount = 0;
  let nextResponseUpdate = 120;
  let nextReasoningUpdate = 250;

  return {
    addResponse(fragment) {
      responseCharacterCount += String(fragment || '').length;
      if (responseCharacterCount >= nextResponseUpdate) {
        diagnostics.write(`${providerName}: resposta em andamento (${responseCharacterCount} caracteres).`, 'activity');
        nextResponseUpdate += 120;
      }
    },
    addReasoning(fragment) {
      reasoningCharacterCount += String(fragment || '').length;
      if (reasoningCharacterCount >= nextReasoningUpdate) {
        diagnostics.write(`${providerName}: raciocinio em andamento (${reasoningCharacterCount} caracteres recebidos).`, 'activity');
        nextReasoningUpdate += 250;
      }
    },
    finish() {
      diagnostics.write(`${providerName}: fluxo concluido. Resposta: ${responseCharacterCount} caracteres; raciocinio sinalizado: ${reasoningCharacterCount} caracteres.`, 'success');
    },
  };
}

function requestText(endpoint, requestOptions, requestBody, timeoutMilliseconds, cancellationToken, diagnostics) {
  return new Promise((resolve, reject) => {
    const requestClient = endpoint.protocol === 'https:' ? https : http;
    let settled = false;
    const finishWithError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = requestClient.request(endpoint, {
      method: requestOptions.method || 'GET',
      headers: requestOptions.headers,
      timeout: timeoutMilliseconds,
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        if (settled) return;
        diagnostics.write(`HTTP ${response.statusCode} recebido de ${endpoint.host}.`);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          finishWithError(new Error(`HTTP ${response.statusCode}: ${responseBody.slice(0, 500)}`));
          return;
        }
        settled = true;
        resolve(responseBody);
      });
    });

    const cancellationSubscription = attachCancellation(cancellationToken, () => request.destroy(new Error('Operacao cancelada.')));
    request.on('timeout', () => request.destroy(new Error(`A requisicao excedeu ${Math.round(timeoutMilliseconds / 1000)} segundos.`)));
    request.on('error', finishWithError);
    request.on('close', () => cancellationSubscription.dispose());
    if (requestBody) request.write(requestBody);
    request.end();
  });
}

function requestStreaming(endpoint, requestOptions, requestBody, timeoutMilliseconds, cancellationToken, diagnostics, onLine) {
  return new Promise((resolve, reject) => {
    const requestClient = endpoint.protocol === 'https:' ? https : http;
    let settled = false;
    const finishWithError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const processLine = (line) => {
      if (settled) return;
      try {
        onLine(line);
      } catch (error) {
        finishWithError(error instanceof Error ? error : new Error(String(error)));
        request.destroy();
      }
    };
    const request = requestClient.request(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        ...requestOptions.headers,
      },
      timeout: timeoutMilliseconds,
    }, (response) => {
      let pendingText = '';
      let errorBody = '';
      response.setEncoding('utf8');
      diagnostics.write(`HTTP ${response.statusCode} recebido de ${endpoint.host}.`);
      response.on('data', (chunk) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          errorBody += chunk;
          return;
        }
        pendingText += chunk;
        const lines = pendingText.split(/\r?\n/);
        pendingText = lines.pop() || '';
        for (const line of lines) processLine(line);
      });
      response.on('end', () => {
        if (settled) return;
        if (response.statusCode < 200 || response.statusCode >= 300) {
          finishWithError(new Error(`HTTP ${response.statusCode}: ${errorBody.slice(0, 500)}`));
          return;
        }
        if (pendingText.trim()) processLine(pendingText);
        if (settled) return;
        settled = true;
        resolve();
      });
    });

    const cancellationSubscription = attachCancellation(cancellationToken, () => request.destroy(new Error('Operacao cancelada.')));
    request.on('timeout', () => request.destroy(new Error(`A requisicao excedeu ${Math.round(timeoutMilliseconds / 1000)} segundos.`)));
    request.on('error', finishWithError);
    request.on('close', () => cancellationSubscription.dispose());
    request.end(requestBody);
  });
}

function getTimeoutMilliseconds(configuration) {
  const timeoutSeconds = Number(configuration.get('requestTimeoutSeconds', 180));
  return Math.max(10, Math.min(timeoutSeconds, 600)) * 1000;
}

function buildCodexArguments(model) {
  const argumentsList = [
    'exec',
    '--json',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
  ];
  if (model) argumentsList.push('--model', model);
  argumentsList.push('-');
  return argumentsList;
}

function buildOpenCodeArguments(model, prompt) {
  const argumentsList = ['run', '--format', 'json', '--thinking'];
  if (model) argumentsList.push('--model', model);
  argumentsList.push(prompt);
  return argumentsList;
}

async function requestOllama(configuration, prompt, cancellationToken, diagnostics) {
  const baseUrl = configuration.get('ollamaBaseUrl', 'http://127.0.0.1:11434');
  const model = configuration.get('ollamaModel', 'qwen3.5:9b');
  const endpoint = joinEndpoint(baseUrl, 'api/generate');
  const streamMonitor = createStreamMonitor('Ollama', diagnostics);
  let generatedResponse = '';

  diagnostics.write(`Ollama: iniciando o modelo ${model}.`, 'activity');
  await requestStreaming(endpoint, {}, JSON.stringify({ model, prompt, stream: true, think: true }), getTimeoutMilliseconds(configuration), cancellationToken, diagnostics, (line) => {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error('O Ollama retornou um evento JSON invalido.');
    }
    if (event.error) throw new Error(`Ollama: ${event.error}`);
    if (event.thinking) streamMonitor.addReasoning(event.thinking);
    if (event.response) {
      generatedResponse += event.response;
      streamMonitor.addResponse(event.response);
    }
  });
  streamMonitor.finish();
  return generatedResponse.trim();
}

async function requestOpenRouter(configuration, prompt, secrets, cancellationToken, diagnostics) {
  const apiKey = await secrets.get(OPENROUTER_SECRET_KEY);
  if (!apiKey) throw new Error('Configure a chave do OpenRouter na tela da extensao.');
  const baseUrl = configuration.get('openRouterBaseUrl', 'https://openrouter.ai/api/v1');
  const model = configuration.get('openRouterModel', 'openai/gpt-4.1-mini');
  const endpoint = joinEndpoint(baseUrl, 'chat/completions');
  const streamMonitor = createStreamMonitor('OpenRouter', diagnostics);
  let generatedResponse = '';

  diagnostics.write(`OpenRouter: solicitando resposta do modelo ${model}.`, 'activity');
  await requestStreaming(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/event-stream',
      'HTTP-Referer': 'https://github.com/local/ai-commit',
      'X-Title': 'AI Commit',
    },
  }, JSON.stringify({ model, stream: true, messages: [{ role: 'user', content: prompt }] }), getTimeoutMilliseconds(configuration), cancellationToken, diagnostics, (line) => {
    if (!line.startsWith('data:')) return;
    const eventContent = line.slice(5).trim();
    if (!eventContent || eventContent === '[DONE]') return;
    let event;
    try {
      event = JSON.parse(eventContent);
    } catch {
      throw new Error('O OpenRouter retornou um evento JSON invalido.');
    }
    if (event.error) throw new Error(`OpenRouter: ${event.error.message || JSON.stringify(event.error)}`);
    const responseDelta = event.choices?.[0]?.delta;
    if (responseDelta?.reasoning) streamMonitor.addReasoning(responseDelta.reasoning);
    if (responseDelta?.content) {
      generatedResponse += responseDelta.content;
      streamMonitor.addResponse(responseDelta.content);
    }
  });
  streamMonitor.finish();
  return generatedResponse.trim();
}

function runCli({ executable, argumentsList, standardInput, workingDirectory, timeoutMilliseconds, cancellationToken, diagnostics, parseLine, displayArguments, getFailureMessage }) {
  return new Promise((resolve, reject) => {
    diagnostics.write(`Executando: ${executable} ${(displayArguments || argumentsList).join(' ')}`);
    const childProcess = spawn(executable, argumentsList, {
      cwd: workingDirectory,
      env: createProcessEnvironment(),
      shell: false,
      windowsHide: true,
    });
    activeProcesses.add(childProcess);

    let standardOutput = '';
    let standardError = '';
    let pendingLine = '';
    let settled = false;
    const finishWithError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const processOutputLine = (line) => {
      if (!parseLine || settled) return;
      try {
        parseLine(line);
      } catch (error) {
        const parsingError = error instanceof Error ? error : new Error(String(error));
        diagnostics.write(`${executable}: falha ao interpretar a saida: ${parsingError.message}`, 'error');
        finishWithError(parsingError);
        childProcess.kill('SIGTERM');
      }
    };
    const timeoutHandle = setTimeout(() => {
      diagnostics.write(`${executable}: tempo limite excedido; encerrando processo.`, 'error');
      childProcess.kill('SIGTERM');
      setTimeout(() => {
        if (childProcess.exitCode === null) childProcess.kill('SIGKILL');
      }, 2000).unref();
    }, timeoutMilliseconds);
    const cancellationSubscription = attachCancellation(cancellationToken, () => {
      diagnostics.write(`${executable}: cancelamento solicitado.`, 'info');
      childProcess.kill('SIGTERM');
    });

    childProcess.stdout.on('data', (chunk) => {
      const outputFragment = chunk.toString();
      standardOutput += outputFragment;
      if (!parseLine) return;
      pendingLine += outputFragment;
      const completeLines = pendingLine.split(/\r?\n/);
      pendingLine = completeLines.pop() || '';
      for (const line of completeLines) processOutputLine(line);
    });
    childProcess.stderr.on('data', (chunk) => {
      const errorFragment = chunk.toString();
      standardError += errorFragment;
      const trimmedError = errorFragment.trim().slice(0, 1200);
      if (trimmedError) diagnostics.write(`${executable}: ${trimmedError}`, 'info');
    });
    childProcess.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') finishWithError(error);
    });
    childProcess.on('error', (error) => finishWithError(new Error(`Nao foi possivel executar ${executable}: ${error.message}`)));
    childProcess.on('close', (exitCode, signal) => {
      activeProcesses.delete(childProcess);
      clearTimeout(timeoutHandle);
      cancellationSubscription.dispose();
      if (parseLine && pendingLine.trim()) processOutputLine(pendingLine);
      diagnostics.write(`${executable}: processo finalizado com codigo ${exitCode}${signal ? ` e sinal ${signal}` : ''}.`, exitCode === 0 ? 'success' : 'error');
      if (settled) return;
      if (cancellationToken?.isCancellationRequested) {
        finishWithError(new Error('Operacao cancelada.'));
        return;
      }
      if (exitCode !== 0) {
        const parsedFailureMessage = getFailureMessage?.();
        finishWithError(new Error(`${executable} falhou: ${parsedFailureMessage || standardError.trim() || `codigo ${exitCode}`}`));
        return;
      }
      settled = true;
      resolve({ standardOutput: standardOutput.trim(), standardError: standardError.trim() });
    });

    if (standardInput) childProcess.stdin.end(standardInput);
    else childProcess.stdin.end();
  });
}

async function requestCodex(configuration, prompt, workingDirectory, cancellationToken, diagnostics) {
  const executable = configuration.get('codexExecutable', 'codex');
  const model = configuration.get('codexModel', '');
  const argumentsList = buildCodexArguments(model);

  let finalMessage = '';
  let providerError = '';
  const parseCodexLine = (line) => {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      diagnostics.write(`Codex: saida nao estruturada recebida.`, 'info');
      return;
    }
    if (event.type === 'thread.started') diagnostics.write('Codex: sessao temporaria iniciada.', 'activity');
    if (event.type === 'turn.started') diagnostics.write('Codex: modelo iniciou o processamento.', 'activity');
    if (event.type === 'item.completed' && event.item?.type === 'reasoning') {
      diagnostics.write('Codex: etapa de raciocinio concluida.', 'activity');
    }
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      finalMessage = event.item.text || finalMessage;
      diagnostics.write(`Codex: resposta final recebida (${finalMessage.length} caracteres).`, 'activity');
    }
    if (event.type === 'item.completed' && event.item?.type === 'error') providerError = event.item.message || providerError;
    if (event.type === 'turn.completed') {
      const tokenUsage = event.usage?.output_tokens;
      diagnostics.write(`Codex: processamento concluido${tokenUsage ? ` com ${tokenUsage} tokens de saida` : ''}.`, 'success');
    }
    if (event.type === 'error') providerError = event.message || providerError;
    if (event.type === 'turn.failed') {
      providerError = event.error?.message || providerError || 'execucao falhou.';
      diagnostics.write(`Codex: ${providerError}`, 'error');
    }
  };

  const result = await runCli({
    executable,
    argumentsList,
    standardInput: prompt,
    workingDirectory,
    timeoutMilliseconds: getTimeoutMilliseconds(configuration),
    cancellationToken,
    diagnostics,
    parseLine: parseCodexLine,
    getFailureMessage: () => providerError,
  });
  return (finalMessage || result.standardOutput).trim();
}

async function requestOpenCode(configuration, prompt, workingDirectory, cancellationToken, diagnostics) {
  const executable = configuration.get('openCodeExecutable', 'opencode');
  const model = configuration.get('openCodeModel', '');
  const argumentsList = buildOpenCodeArguments(model, prompt);

  let finalMessage = '';
  let providerError = '';
  const parseOpenCodeLine = (line) => {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      diagnostics.write('OpenCode: saida nao estruturada recebida.', 'info');
      return;
    }
    const eventPart = event.part || event.data?.part;
    const eventType = event.type || eventPart?.type;
    if (eventType === 'step_start') diagnostics.write('OpenCode: modelo iniciou uma etapa.', 'activity');
    if (eventPart?.type === 'reasoning') diagnostics.write('OpenCode: atividade de raciocinio recebida.', 'activity');
    if (eventPart?.type === 'text' && eventPart.text) {
      finalMessage = eventPart.text;
      diagnostics.write(`OpenCode: resposta recebida (${finalMessage.length} caracteres).`, 'activity');
    }
    if (eventType === 'step_finish') diagnostics.write('OpenCode: etapa concluida.', 'success');
    if (event.error) providerError = event.error.message || String(event.error);
  };

  const displayArguments = argumentsList.slice(0, -1).concat('[PROMPT OMITIDO]');
  const result = await runCli({
    executable,
    argumentsList,
    standardInput: '',
    workingDirectory,
    timeoutMilliseconds: getTimeoutMilliseconds(configuration),
    cancellationToken,
    diagnostics,
    parseLine: parseOpenCodeLine,
    displayArguments,
    getFailureMessage: () => providerError,
  });
  return (finalMessage || result.standardOutput).trim();
}

async function callProvider(provider, options) {
  const { configuration, prompt, workingDirectory, secrets, cancellationToken, diagnostics } = options;
  if (provider === 'ollama') return requestOllama(configuration, prompt, cancellationToken, diagnostics);
  if (provider === 'openrouter') return requestOpenRouter(configuration, prompt, secrets, cancellationToken, diagnostics);
  if (provider === 'opencode') return requestOpenCode(configuration, prompt, workingDirectory, cancellationToken, diagnostics);
  if (provider === 'codex') return requestCodex(configuration, prompt, workingDirectory, cancellationToken, diagnostics);
  throw new Error(`Provedor desconhecido: ${provider}`);
}

async function testProvider(provider, options) {
  const { configuration, secrets, cancellationToken, diagnostics, workingDirectory } = options;
  diagnostics.write(`Teste iniciado para ${provider}.`);
  if (provider === 'ollama') {
    const baseUrl = configuration.get('ollamaBaseUrl', 'http://127.0.0.1:11434');
    const model = configuration.get('ollamaModel', 'qwen3.5:9b');
    const responseBody = await requestText(joinEndpoint(baseUrl, 'api/tags'), { method: 'GET' }, '', 10000, cancellationToken, diagnostics);
    const models = JSON.parse(responseBody).models || [];
    const hasModel = models.some((modelEntry) => modelEntry.name === model || modelEntry.model === model);
    if (!hasModel) throw new Error(`O Ollama respondeu, mas o modelo ${model} nao esta instalado.`);
    return `Ollama conectado. Modelo ${model} disponivel.`;
  }
  if (provider === 'openrouter') {
    const apiKey = await secrets.get(OPENROUTER_SECRET_KEY);
    if (!apiKey) throw new Error('Informe e salve a chave do OpenRouter antes do teste.');
    const baseUrl = configuration.get('openRouterBaseUrl', 'https://openrouter.ai/api/v1');
    await requestText(joinEndpoint(baseUrl, 'models'), { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } }, '', 15000, cancellationToken, diagnostics);
    return 'OpenRouter conectado e chave aceita.';
  }
  const verificationPrompt = 'Teste de conexao. Nao use ferramentas. Responda somente com: conexao ok';
  const generatedResponse = provider === 'codex'
    ? await requestCodex(configuration, verificationPrompt, workingDirectory, cancellationToken, diagnostics)
    : await requestOpenCode(configuration, verificationPrompt, workingDirectory, cancellationToken, diagnostics);
  if (!generatedResponse) throw new Error(`${provider === 'codex' ? 'Codex' : 'OpenCode'} iniciou, mas nao retornou uma resposta.`);
  return `${provider === 'codex' ? 'Codex' : 'OpenCode'} conectado e respondendo.`;
}

function normalizeModelIds(modelIds) {
  return [...new Set(modelIds.filter(Boolean).map((modelId) => String(modelId).trim()).filter(Boolean))]
    .sort((firstModel, secondModel) => firstModel.localeCompare(secondModel));
}

async function listProviderModels(provider, options) {
  const { configuration, secrets, cancellationToken, diagnostics, workingDirectory } = options;
  diagnostics.write(`Carregando modelos de ${provider}.`);

  if (provider === 'ollama') {
    const baseUrl = configuration.get('ollamaBaseUrl', 'http://127.0.0.1:11434');
    const responseBody = await requestText(joinEndpoint(baseUrl, 'api/tags'), { method: 'GET' }, '', 10000, cancellationToken, diagnostics);
    const response = JSON.parse(responseBody);
    return normalizeModelIds((response.models || []).map((modelEntry) => modelEntry.name || modelEntry.model));
  }

  if (provider === 'openrouter') {
    const apiKey = await secrets.get(OPENROUTER_SECRET_KEY);
    if (!apiKey) throw new Error('Informe e salve a chave do OpenRouter antes de carregar os modelos.');
    const baseUrl = configuration.get('openRouterBaseUrl', 'https://openrouter.ai/api/v1');
    const responseBody = await requestText(
      joinEndpoint(baseUrl, 'models'),
      { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
      '',
      15000,
      cancellationToken,
      diagnostics,
    );
    const response = JSON.parse(responseBody);
    return normalizeModelIds((response.data || []).map((modelEntry) => modelEntry.id)).slice(0, 1000);
  }

  if (provider === 'opencode') {
    const executable = configuration.get('openCodeExecutable', 'opencode');
    const result = await runCli({
      executable,
      argumentsList: ['models'],
      standardInput: '',
      workingDirectory,
      timeoutMilliseconds: 30000,
      cancellationToken,
      diagnostics,
    });
    const outputLines = result.standardOutput.split(/\r?\n/).map((line) => line.trim());
    return normalizeModelIds(outputLines.filter((line) => /^[^\s/]+\/[^\s/]+$/.test(line)));
  }

  if (provider === 'codex') {
    try {
      const modelCachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
      const modelCache = JSON.parse(await fs.readFile(modelCachePath, 'utf8'));
      return normalizeModelIds((modelCache.models || [])
        .filter((modelEntry) => modelEntry.visibility !== 'hide')
        .map((modelEntry) => modelEntry.slug));
    } catch (error) {
      throw new Error(`Nao foi possivel ler o catalogo local do Codex: ${error.message}`);
    }
  }

  throw new Error(`Provedor desconhecido: ${provider}`);
}

function stopActiveProcesses() {
  for (const childProcess of activeProcesses) childProcess.kill('SIGTERM');
  activeProcesses.clear();
}

module.exports = {
  OPENROUTER_SECRET_KEY,
  buildCodexArguments,
  buildOpenCodeArguments,
  callProvider,
  joinEndpoint,
  listProviderModels,
  normalizeModelIds,
  stopActiveProcesses,
  testProvider,
};
