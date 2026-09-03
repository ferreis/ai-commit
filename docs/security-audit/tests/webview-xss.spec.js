'use strict';

const { test, expect } = require('@playwright/test');
const Module = require('node:module');
const path = require('node:path');

function loadSettingsPanel() {
  const originalLoader = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === 'vscode') return {};
    return originalLoader.call(this, request, parent, isMain);
  };
  try {
    return require(path.resolve(__dirname, '../../../src/settings-panel.js')).SettingsPanel;
  } finally {
    Module._load = originalLoader;
  }
}

test('webview não executa payloads vindos da configuração ou diagnóstico', async ({ page }) => {
  const SettingsPanel = loadSettingsPanel();
  const payload = '</script><script>window.__aiCommitXss = true</script><img src=x onerror="window.__aiCommitXss=true">';
  const configuration = {
    get(key, defaultValue) {
      if (key === 'ollamaModel' || key === 'openRouterModel' || key === 'openCodeModel' || key === 'codexModel') return payload;
      return defaultValue;
    },
  };
  const html = SettingsPanel.prototype.getHtml.call({
    diagnostics: { getHistory: () => [{ timestamp: '10:00', level: 'error', message: payload }] },
  }, configuration, false);

  await page.addInitScript(() => {
    window.acquireVsCodeApi = () => ({ postMessage() {} });
  });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  await expect.poll(() => page.evaluate(() => window.__aiCommitXss)).toBeUndefined();
  await expect(page.locator('#terminal')).toContainText('</script>');
});
