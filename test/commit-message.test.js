'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildPrompt, cleanCommitMessage, isValidCommitMessage } = require('../src/commit-message');

test('aplica as mesmas regras de commit a todos os provedores', () => {
  const prompt = buildPrompt('diff de exemplo');

  assert.match(prompt, /tipo\(escopo\): descricao/);
  assert.match(prompt, /Tipos permitidos: feat, fix, refactor, docs, test, chore, perf, build, ci/);
  assert.match(prompt, /Use verbo no presente/);
  assert.match(prompt, /corpo obrigatorio com 1 a 6 topicos/);
  assert.match(prompt, /considere todos os arquivos do diff/);
  assert.match(prompt, /Agrupe alteracoes relacionadas/);
  assert.doesNotMatch(prompt, /unica linha|style|revert|escopo opcional/);
});

test('extrai a mensagem completa quando o modelo inclui explicacao', () => {
  const response = [
    'Mensagem sugerida:',
    'fix(ollama): corrige a resposta do modelo.',
    '',
    '- Preserva o corpo explicativo da mensagem.',
    '* Reforca a validacao da resposta.',
    'Espero ter ajudado',
  ].join('\n');

  assert.equal(cleanCommitMessage(response), [
    'fix(ollama): corrige a resposta do modelo',
    '',
    '- Preserva o corpo explicativo da mensagem',
    '- Reforca a validacao da resposta',
  ].join('\n'));
});

test('remove Markdown de uma mensagem de commit completa', () => {
  assert.equal(
    cleanCommitMessage('```text\n**fix(ollama): corrige a resposta do modelo**\n\n- **Mantem os detalhes relevantes**\n```'),
    'fix(ollama): corrige a resposta do modelo\n\n- Mantem os detalhes relevantes',
  );
});

test('rejeita resumo em ingles com Markdown sem mensagem convencional', () => {
  const response = 'The provided changes primarily focus on:\n1. **API Integration:** Adding authentication logic.';

  assert.equal(isValidCommitMessage(cleanCommitMessage(response)), false);
});

test('reforca as regras quando a primeira resposta e invalida', () => {
  const correctionPrompt = buildPrompt('diff de exemplo', true);

  assert.match(correctionPrompt, /^A resposta anterior foi invalida/);
  assert.match(correctionPrompt, /Escreva em portugues do Brasil/);
});

test('exige cabecalho, linha vazia e corpo explicativo', () => {
  const validMessage = 'fix(ollama): corrige a resposta do modelo\n\n- Preserva os detalhes relevantes\n- Valida o formato completo';

  assert.equal(isValidCommitMessage(validMessage), true);
  assert.equal(isValidCommitMessage('fix(ollama): corrige a resposta do modelo'), false);
  assert.equal(isValidCommitMessage('style(ollama): ajusta a resposta\n\n- Detalha a alteracao'), false);
  assert.equal(isValidCommitMessage('fix: corrige a resposta\n\n- Detalha a alteracao'), false);
  assert.equal(isValidCommitMessage('fix(ollama): corrige a resposta.\n\n- Detalha a alteracao'), false);
  assert.equal(isValidCommitMessage('fix(ollama): corrige a resposta\n- Detalha a alteracao'), false);
  assert.equal(isValidCommitMessage('fix(ollama): corrige a resposta\n\nDetalha a alteracao'), false);
});
