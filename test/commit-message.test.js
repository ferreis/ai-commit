'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildPrompt, cleanCommitMessage, isValidCommitMessage } = require('../src/commit-message');

test('aplica as mesmas regras de commit a todos os provedores', () => {
  const prompt = buildPrompt('diff de exemplo');

  assert.match(prompt, /Formato: tipo\(escopo\): descricao/);
  assert.match(prompt, /Tipos permitidos: feat, fix, refactor, docs, test, chore, perf, build, ci/);
  assert.match(prompt, /Use verbo no presente/);
  assert.match(prompt, /Nao use ponto final/);
  assert.match(prompt, /Retorne apenas a mensagem do commit em uma unica linha/);
  assert.doesNotMatch(prompt, /style|revert|escopo opcional|linha vazia/);
});

test('extrai somente a mensagem valida quando o modelo inclui explicacao', () => {
  const response = 'Mensagem sugerida:\nfix(ollama): corrige a resposta do modelo.\nEspero ter ajudado';

  assert.equal(cleanCommitMessage(response), 'fix(ollama): corrige a resposta do modelo');
});

test('valida tipo, escopo, linha unica e ausencia de ponto final', () => {
  assert.equal(isValidCommitMessage('fix(ollama): corrige a resposta do modelo'), true);
  assert.equal(isValidCommitMessage('style(ollama): ajusta a resposta'), false);
  assert.equal(isValidCommitMessage('fix: corrige a resposta'), false);
  assert.equal(isValidCommitMessage('fix(ollama): corrige a resposta.'), false);
  assert.equal(isValidCommitMessage('fix(ollama): corrige\na resposta'), false);
});
