'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCodexArguments, buildOpenCodeArguments, joinEndpoint, normalizeModelIds } = require('../src/providers');

test('preserva o caminho base da API do OpenRouter', () => {
  const endpoint = joinEndpoint('https://openrouter.ai/api/v1', '/chat/completions');
  assert.equal(endpoint.toString(), 'https://openrouter.ai/api/v1/chat/completions');
});

test('monta o Codex exec com argumentos aceitos pela versao atual', () => {
  const argumentsList = buildCodexArguments('gpt-5');
  assert.deepEqual(argumentsList, [
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
    '--model',
    'gpt-5',
    '-',
  ]);
  assert.equal(argumentsList.includes('--ask-for-approval'), false);
});

test('omite o modelo do Codex quando o campo esta vazio', () => {
  const argumentsList = buildCodexArguments('');
  assert.equal(argumentsList.includes('--model'), false);
  assert.equal(argumentsList.at(-1), '-');
});

test('nao registra o prompt do OpenCode na lista segura para exibicao', () => {
  const prompt = 'diff confidencial';
  const argumentsList = buildOpenCodeArguments('openai/gpt-5', prompt);
  assert.equal(argumentsList.at(-1), prompt);
  assert.deepEqual(argumentsList.slice(0, -1), ['run', '--format', 'json', '--thinking', '--model', 'openai/gpt-5']);
});

test('remove modelos duplicados e ordena o catalogo', () => {
  assert.deepEqual(normalizeModelIds(['zeta/model', ' alpha/model ', 'zeta/model', '']), ['alpha/model', 'zeta/model']);
});
