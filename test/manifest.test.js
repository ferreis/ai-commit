'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const extensionManifest = require('../package.json');

test('protege configuracoes sensiveis contra sobrescrita do workspace', () => {
  const configurationProperties = extensionManifest.contributes.configuration.properties;

  for (const [configurationName, configurationDefinition] of Object.entries(configurationProperties)) {
    assert.equal(configurationDefinition.scope, 'machine', `${configurationName} precisa usar escopo de maquina`);
  }
});
