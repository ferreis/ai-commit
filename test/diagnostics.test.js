'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Diagnostics } = require('../src/diagnostics');

function createOutputChannel() {
  return {
    lines: [],
    appendLine(message) { this.lines.push(message); },
    clear() { this.lines = []; },
    show() {},
  };
}

test('publica diagnosticos para o canal e para a tela', () => {
  const outputChannel = createOutputChannel();
  const diagnostics = new Diagnostics(outputChannel);
  const receivedEntries = [];
  diagnostics.subscribe((entry) => receivedEntries.push(entry));

  diagnostics.write('Codex iniciou.', 'activity');

  assert.equal(diagnostics.getHistory().length, 1);
  assert.match(outputChannel.lines[0], /\[MODELO\] Codex iniciou\./);
  assert.equal(receivedEntries[0].message, 'Codex iniciou.');
});

test('limpa o historico e avisa a tela', () => {
  const diagnostics = new Diagnostics(createOutputChannel());
  const receivedEntries = [];
  diagnostics.subscribe((entry) => receivedEntries.push(entry));
  diagnostics.write('Mensagem');

  diagnostics.clear();

  assert.deepEqual(diagnostics.getHistory(), []);
  assert.equal(receivedEntries.at(-1).type, 'clear');
});
