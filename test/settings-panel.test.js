'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalModuleLoader = Module._load;
Module._load = function loadWithVscodeMock(request, parentModule, isMainModule) {
  if (request === 'vscode') return {};
  return originalModuleLoader.call(this, request, parentModule, isMainModule);
};
const { SettingsPanel, validateSettings } = require('../src/settings-panel');
Module._load = originalModuleLoader;

function createValidSettings() {
  return {
    provider: 'codex',
    ollamaModel: 'qwen3.5:9b',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    openRouterModel: 'openai/gpt-4.1-mini',
    openRouterBaseUrl: 'https://openrouter.ai/api/v1',
    openCodeExecutable: 'opencode',
    codexExecutable: 'codex',
    requestTimeoutSeconds: '180',
  };
}

test('gera o painel com configuracao, teste e diagnostico', () => {
  const panelContext = { diagnostics: { getHistory: () => [] } };
  const configuration = { get: (configurationKey, defaultValue) => defaultValue };
  const html = SettingsPanel.prototype.getHtml.call(panelContext, configuration, false);

  assert.match(html, /id="test"/);
  assert.match(html, /id="generate"/);
  assert.match(html, /id="terminal"/);
  assert.match(html, /<select id="ollamaModel"/);
  assert.match(html, /<select id="openRouterModel"/);
  assert.match(html, /<select id="openCodeModel"/);
  assert.match(html, /<select id="codexModel"/);
  assert.doesNotMatch(html, /<input id="codexModel"/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /undefined/);
});

test('aceita configuracao valida', () => {
  assert.doesNotThrow(() => validateSettings(createValidSettings()));
});

test('rejeita URL invalida e timeout fora do limite', () => {
  const invalidUrlSettings = { ...createValidSettings(), openRouterBaseUrl: 'arquivo-local' };
  assert.throws(() => validateSettings(invalidUrlSettings), /URL invalida/);

  const invalidTimeoutSettings = { ...createValidSettings(), requestTimeoutSeconds: '5' };
  assert.throws(() => validateSettings(invalidTimeoutSettings), /tempo limite/);
});
