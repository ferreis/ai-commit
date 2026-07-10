'use strict';

const crypto = require('node:crypto');
const vscode = require('vscode');
const { OPENROUTER_SECRET_KEY } = require('./providers');

const VALID_PROVIDERS = new Set(['ollama', 'openrouter', 'opencode', 'codex']);
const CONFIGURATION_KEYS = [
  'provider',
  'ollamaModel',
  'ollamaBaseUrl',
  'openRouterModel',
  'openRouterBaseUrl',
  'openCodeExecutable',
  'openCodeModel',
  'codexExecutable',
  'codexModel',
  'requestTimeoutSeconds',
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function validateSettings(values) {
  if (!VALID_PROVIDERS.has(values.provider)) throw new Error('Provedor invalido.');
  if (!values.ollamaModel) throw new Error('Informe o modelo do Ollama.');
  if (!values.openRouterModel) throw new Error('Informe o modelo do OpenRouter.');
  if (!values.openCodeExecutable) throw new Error('Informe o executavel do OpenCode.');
  if (!values.codexExecutable) throw new Error('Informe o executavel do Codex.');
  for (const urlKey of ['ollamaBaseUrl', 'openRouterBaseUrl']) {
    try {
      const parsedUrl = new URL(values[urlKey]);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
    } catch {
      throw new Error(`URL invalida no campo ${urlKey}.`);
    }
  }
  const timeoutSeconds = Number(values.requestTimeoutSeconds);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 600) {
    throw new Error('O tempo limite deve ficar entre 10 e 600 segundos.');
  }
}

class SettingsPanel {
  static currentPanel;

  static async createOrShow(extensionContext, diagnostics, actions) {
    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      await SettingsPanel.currentPanel.refresh();
      return SettingsPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiCommitSettings',
      'AI Commit: configuracao',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    SettingsPanel.currentPanel = new SettingsPanel(panel, extensionContext, diagnostics, actions);
    await SettingsPanel.currentPanel.refresh();
    return SettingsPanel.currentPanel;
  }

  constructor(panel, extensionContext, diagnostics, actions) {
    this.panel = panel;
    this.extensionContext = extensionContext;
    this.diagnostics = diagnostics;
    this.actions = actions;
    this.disposables = [];

    this.disposables.push(panel.onDidDispose(() => this.dispose()));
    this.disposables.push(panel.webview.onDidReceiveMessage((message) => this.receiveMessage(message)));
    this.disposables.push(diagnostics.subscribe((entry) => {
      if (entry.type === 'clear') panel.webview.postMessage({ type: 'clearDiagnostics' });
      else panel.webview.postMessage({ type: 'diagnostic', entry });
    }));
  }

  async refresh() {
    const hasOpenRouterKey = Boolean(await this.extensionContext.secrets.get(OPENROUTER_SECRET_KEY));
    const configuration = vscode.workspace.getConfiguration('aiCommit');
    this.panel.webview.html = this.getHtml(configuration, hasOpenRouterKey);
  }

  async saveSettings(values) {
    validateSettings(values);
    const configuration = vscode.workspace.getConfiguration('aiCommit');
    const normalizedValues = {
      ...values,
      requestTimeoutSeconds: Number(values.requestTimeoutSeconds),
    };
    await Promise.all(CONFIGURATION_KEYS.map((key) => configuration.update(key, normalizedValues[key], vscode.ConfigurationTarget.Global)));
    if (values.openRouterApiKey) await this.extensionContext.secrets.store(OPENROUTER_SECRET_KEY, values.openRouterApiKey);
    this.diagnostics.write(`Configuracoes salvas. Provedor ativo: ${values.provider}.`, 'success');
  }

  async receiveMessage(message) {
    try {
      if (message.type === 'ready') {
        this.panel.webview.postMessage({ type: 'diagnosticHistory', entries: this.diagnostics.getHistory() });
        return;
      }
      if (message.type === 'logs') {
        this.diagnostics.show(true);
        return;
      }
      if (message.type === 'clear') {
        this.diagnostics.clear();
        return;
      }
      if (message.type === 'models') {
        this.panel.webview.postMessage({ type: 'modelsBusy', provider: message.provider, busy: true });
        const models = await this.actions.listModels(message.provider);
        this.panel.webview.postMessage({ type: 'models', provider: message.provider, models });
        this.diagnostics.write(`${models.length} modelo(s) carregado(s) de ${message.provider}.`, 'success');
        return;
      }
      if (message.type === 'removeOpenRouterKey') {
        await this.extensionContext.secrets.delete(OPENROUTER_SECRET_KEY);
        this.panel.webview.postMessage({ type: 'result', status: 'success', message: 'Chave do OpenRouter removida.' });
        return;
      }
      if (message.type === 'save') {
        await this.saveSettings(message.values);
        this.panel.webview.postMessage({ type: 'result', status: 'success', message: 'Configuracoes salvas.' });
        return;
      }
      if (message.type === 'test') {
        await this.saveSettings(message.values);
        this.panel.webview.postMessage({ type: 'busy', busy: true, message: 'Testando provedor...' });
        const testResult = await this.actions.testProvider(message.values.provider);
        this.diagnostics.write(testResult, 'success');
        this.panel.webview.postMessage({ type: 'result', status: 'success', message: testResult });
        return;
      }
      if (message.type === 'generate') {
        await this.saveSettings(message.values);
        this.panel.webview.postMessage({ type: 'busy', busy: true, message: 'Gerando mensagem...' });
        await this.actions.generate();
        this.panel.webview.postMessage({ type: 'result', status: 'success', message: 'Mensagem inserida no campo de commit.' });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.diagnostics.write(errorMessage, 'error');
      this.panel.webview.postMessage({ type: 'result', status: 'error', message: errorMessage });
    } finally {
      if (['test', 'generate'].includes(message.type)) this.panel.webview.postMessage({ type: 'busy', busy: false });
      if (message.type === 'models') this.panel.webview.postMessage({ type: 'modelsBusy', provider: message.provider, busy: false });
    }
  }

  dispose() {
    if (SettingsPanel.currentPanel !== this) return;
    SettingsPanel.currentPanel = undefined;
    while (this.disposables.length) this.disposables.pop().dispose();
  }

  getHtml(configuration, hasOpenRouterKey) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const selectedProvider = configuration.get('provider', 'ollama');
    const configurationValue = (key, defaultValue) => escapeHtml(configuration.get(key, defaultValue));
    const selected = (provider) => selectedProvider === provider ? 'aria-selected="true" class="provider-tab active"' : 'aria-selected="false" class="provider-tab"';
    const visible = (provider) => selectedProvider === provider ? 'provider-fields active' : 'provider-fields';
    const modelSelect = (fieldId, provider, currentModel, defaultLabel = '') => {
      const defaultOption = defaultLabel ? `<option value="" ${currentModel ? '' : 'selected'}>${escapeHtml(defaultLabel)}</option>` : '';
      const currentOption = currentModel ? `<option value="${escapeHtml(currentModel)}" selected>${escapeHtml(currentModel)}</option>` : '';
      return `<div class="select-row"><select id="${fieldId}" data-model-select="${provider}">${defaultOption}${currentOption}</select><button class="compact-button refresh-models" data-model-provider="${provider}" type="button" title="Atualizar modelos" aria-label="Atualizar modelos">↻</button></div>`;
    };
    const history = JSON.stringify(this.diagnostics.getHistory()).replace(/</g, '\\u003c');

    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>AI Commit</title>
  <style>
    :root{--space:18px;--line:var(--vscode-panel-border);--muted:var(--vscode-descriptionForeground);--panel:var(--vscode-sideBar-background);--accent:var(--vscode-button-background);--ok:var(--vscode-testing-iconPassed);--danger:var(--vscode-testing-iconFailed)}
    *{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:13px/1.5 var(--vscode-font-family);letter-spacing:.01em}.shell{width:min(920px,100%);margin:0 auto;padding:38px 28px 56px}.masthead{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:30px}.eyebrow{margin:0 0 6px;color:var(--vscode-textLink-foreground);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}h1{font-size:28px;line-height:1.1;margin:0 0 9px;font-weight:650}.subtitle{max-width:600px;margin:0;color:var(--muted)}.live-badge{display:flex;align-items:center;gap:8px;border:1px solid var(--line);padding:7px 10px;background:var(--panel);white-space:nowrap}.live-dot{width:8px;height:8px;border-radius:50%;background:var(--muted)}.live-dot.busy{background:var(--vscode-charts-yellow);box-shadow:0 0 0 4px color-mix(in srgb,var(--vscode-charts-yellow) 18%,transparent)}.live-dot.success{background:var(--ok)}.live-dot.error{background:var(--danger)}.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.85fr);gap:18px}.card{border:1px solid var(--line);background:var(--panel)}.card-header{padding:16px 18px;border-bottom:1px solid var(--line)}.card-header h2{font-size:14px;margin:0 0 3px}.card-header p{margin:0;color:var(--muted);font-size:12px}.provider-tabs{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line)}button{font:inherit}.provider-tab{border:0;border-right:1px solid var(--line);padding:12px 8px;color:var(--muted);background:transparent;cursor:pointer}.provider-tab:last-child{border-right:0}.provider-tab:hover{color:var(--vscode-foreground);background:var(--vscode-list-hoverBackground)}.provider-tab.active{color:var(--vscode-foreground);background:var(--vscode-list-activeSelectionBackground);box-shadow:inset 0 -2px var(--vscode-focusBorder)}.form-body{padding:18px}.provider-fields{display:none}.provider-fields.active{display:block}.field{margin:0 0 16px}.field:last-child{margin-bottom:0}label{display:flex;align-items:center;justify-content:space-between;font-weight:600;margin-bottom:6px}.hint{font-size:11px;font-weight:400;color:var(--muted)}input,select{width:100%;height:34px;padding:7px 9px;border:1px solid var(--vscode-input-border,var(--line));outline:none;color:var(--vscode-input-foreground);background:var(--vscode-input-background);font-family:var(--vscode-editor-font-family)}input:focus,select:focus{border-color:var(--vscode-focusBorder)}.select-row,.secret-row{display:flex;gap:8px}.select-row select,.secret-row input{flex:1;min-width:0}.compact-button{border:1px solid var(--vscode-button-secondaryBackground);padding:6px 10px;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);cursor:pointer}.refresh-models{width:34px;font-size:17px;line-height:1}.shared{margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}.actions{display:flex;flex-wrap:wrap;gap:8px;padding:16px 18px;border-top:1px solid var(--line)}.action{border:0;padding:8px 14px;color:var(--vscode-button-foreground);background:var(--accent);cursor:pointer}.action:hover{background:var(--vscode-button-hoverBackground)}.action.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}.action:disabled,.compact-button:disabled{opacity:.55;cursor:wait}.console{min-height:420px;display:flex;flex-direction:column}.console-toolbar{display:flex;gap:6px}.icon-button{border:0;padding:3px 7px;color:var(--muted);background:transparent;cursor:pointer}.icon-button:hover{color:var(--vscode-foreground);background:var(--vscode-toolbar-hoverBackground)}.terminal{flex:1;min-height:330px;max-height:530px;overflow:auto;padding:14px;background:var(--vscode-terminal-background,var(--vscode-editor-background));font:12px/1.55 var(--vscode-editor-font-family);white-space:pre-wrap;word-break:break-word}.entry{display:grid;grid-template-columns:64px 1fr;gap:9px;margin-bottom:7px}.time{color:var(--muted)}.entry.activity .message{color:var(--vscode-charts-blue)}.entry.success .message{color:var(--ok)}.entry.error .message{color:var(--danger)}.empty{color:var(--muted)}.notice{padding:10px 14px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}.status-line{min-height:22px;margin-top:14px;padding:0 2px;color:var(--muted)}.status-line.success{color:var(--ok)}.status-line.error{color:var(--danger)}@media(max-width:760px){.shell{padding:24px 16px}.masthead{display:block}.live-badge{display:inline-flex;margin-top:16px}.layout{grid-template-columns:1fr}.provider-tabs{grid-template-columns:repeat(2,1fr)}.console{min-height:330px}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="masthead">
      <div><p class="eyebrow">Controle de codigo-fonte</p><h1>AI Commit</h1><p class="subtitle">Configure o provedor, valide a conexao e acompanhe a execucao antes de usar a mensagem no Git.</p></div>
      <div class="live-badge"><span id="liveDot" class="live-dot"></span><span id="liveLabel">Pronto</span></div>
    </header>
    <div class="layout">
      <section class="card">
        <div class="card-header"><h2>Provedor</h2><p>Escolha apenas o ambiente que sera usado nesta execucao.</p></div>
        <nav class="provider-tabs" aria-label="Provedores">
          <button type="button" data-provider="ollama" ${selected('ollama')}>Ollama</button>
          <button type="button" data-provider="openrouter" ${selected('openrouter')}>OpenRouter</button>
          <button type="button" data-provider="opencode" ${selected('opencode')}>OpenCode</button>
          <button type="button" data-provider="codex" ${selected('codex')}>Codex / GPT</button>
        </nav>
        <div class="form-body">
          <input id="provider" type="hidden" value="${escapeHtml(selectedProvider)}">
          <div class="${visible('ollama')}" data-fields="ollama">
            <div class="field"><label for="ollamaModel">Modelo <span class="hint">instalado localmente</span></label>${modelSelect('ollamaModel', 'ollama', configuration.get('ollamaModel', 'qwen3.5:9b'))}</div>
            <div class="field"><label for="ollamaBaseUrl">URL do servidor</label><input id="ollamaBaseUrl" value="${configurationValue('ollamaBaseUrl', 'http://127.0.0.1:11434')}"></div>
          </div>
          <div class="${visible('openrouter')}" data-fields="openrouter">
            <div class="field"><label for="openRouterModel">Modelo <span class="hint">provedor/modelo</span></label>${modelSelect('openRouterModel', 'openrouter', configuration.get('openRouterModel', 'openai/gpt-4.1-mini'))}</div>
            <div class="field"><label for="openRouterBaseUrl">URL da API</label><input id="openRouterBaseUrl" value="${configurationValue('openRouterBaseUrl', 'https://openrouter.ai/api/v1')}"></div>
            <div class="field"><label for="openRouterApiKey">Chave API <span class="hint">${hasOpenRouterKey ? 'armazenada com seguranca' : 'nao configurada'}</span></label><div class="secret-row"><input id="openRouterApiKey" type="password" autocomplete="off" placeholder="${hasOpenRouterKey ? 'Deixe vazio para manter' : 'sk-or-...'}"><button id="removeKey" class="compact-button" type="button" ${hasOpenRouterKey ? '' : 'disabled'}>Remover</button></div></div>
          </div>
          <div class="${visible('opencode')}" data-fields="opencode">
            <div class="field"><label for="openCodeExecutable">Executavel</label><input id="openCodeExecutable" value="${configurationValue('openCodeExecutable', 'opencode')}"></div>
            <div class="field"><label for="openCodeModel">Modelo <span class="hint">provedor/modelo</span></label>${modelSelect('openCodeModel', 'opencode', configuration.get('openCodeModel', ''), 'Padrao do OpenCode')}</div>
          </div>
          <div class="${visible('codex')}" data-fields="codex">
            <div class="field"><label for="codexExecutable">Executavel</label><input id="codexExecutable" value="${configurationValue('codexExecutable', 'codex')}"></div>
            <div class="field"><label for="codexModel">Modelo GPT <span class="hint">catalogo local</span></label>${modelSelect('codexModel', 'codex', configuration.get('codexModel', ''), 'Padrao do Codex')}</div>
          </div>
          <div class="shared"><div class="field"><label for="requestTimeoutSeconds">Tempo limite <span class="hint">10 a 600 segundos</span></label><input id="requestTimeoutSeconds" type="number" min="10" max="600" value="${configurationValue('requestTimeoutSeconds', 180)}"></div></div>
        </div>
        <div class="actions"><button id="save" class="action" type="button">Salvar</button><button id="test" class="action secondary" type="button">Testar conexao</button><button id="generate" class="action secondary" type="button">Gerar commit agora</button></div>
      </section>
      <section class="card console">
        <div class="card-header" style="display:flex;justify-content:space-between;gap:12px"><div><h2>Atividade do modelo</h2><p>Eventos ao vivo, respostas HTTP e processos locais.</p></div><div class="console-toolbar"><button id="clear" class="icon-button" type="button">Limpar</button><button id="logs" class="icon-button" type="button">Saida</button></div></div>
        <div id="terminal" class="terminal" role="log" aria-live="polite"><span id="empty" class="empty">Nenhuma execucao nesta sessao.</span></div>
        <div class="notice">Mostra sinais de atividade e resumos fornecidos pelos CLIs. Nao exibe raciocinio privado interno dos modelos.</div>
      </section>
    </div>
    <div id="statusLine" class="status-line" role="status"></div>
  </main>
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    const initialHistory = ${history};
    const fieldIds = ['provider','ollamaModel','ollamaBaseUrl','openRouterModel','openRouterBaseUrl','openRouterApiKey','openCodeExecutable','openCodeModel','codexExecutable','codexModel','requestTimeoutSeconds'];
    const terminal = document.getElementById('terminal');
    const statusLine = document.getElementById('statusLine');
    const liveDot = document.getElementById('liveDot');
    const liveLabel = document.getElementById('liveLabel');
    const actionButtons = [...document.querySelectorAll('.action')];

    function collectValues() {
      return Object.fromEntries(fieldIds.map((fieldId) => [fieldId, document.getElementById(fieldId).value.trim()]));
    }
    function selectProvider(provider) {
      document.getElementById('provider').value = provider;
      document.querySelectorAll('.provider-tab').forEach((button) => {
        const isActive = button.dataset.provider === provider;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', String(isActive));
      });
      document.querySelectorAll('.provider-fields').forEach((fields) => fields.classList.toggle('active', fields.dataset.fields === provider));
    }
    function updateModels(provider, models) {
      const modelSelect = document.querySelector('[data-model-select="' + provider + '"]');
      if (!modelSelect) return;
      const currentModel = modelSelect.value;
      const allowsDefault = provider === 'codex' || provider === 'opencode';
      const defaultLabel = provider === 'codex' ? 'Padrao do Codex' : 'Padrao do OpenCode';
      modelSelect.textContent = '';
      if (allowsDefault) modelSelect.add(new Option(defaultLabel, ''));
      const availableModels = [...new Set([currentModel, ...models].filter(Boolean))];
      availableModels.forEach((model) => modelSelect.add(new Option(model, model)));
      modelSelect.value = currentModel || '';
      statusLine.className = 'status-line success';
      statusLine.textContent = models.length + ' modelo(s) carregado(s).';
    }
    function appendEntry(entry) {
      document.getElementById('empty')?.remove();
      const row = document.createElement('div');
      row.className = 'entry ' + (entry.level || 'info');
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = entry.timestamp || '';
      const message = document.createElement('span');
      message.className = 'message';
      message.textContent = entry.message || '';
      row.append(time, message);
      terminal.appendChild(row);
      while (terminal.children.length > 400) terminal.firstElementChild.remove();
      terminal.scrollTop = terminal.scrollHeight;
    }
    function clearTerminal() {
      terminal.textContent = '';
      const empty = document.createElement('span');
      empty.id = 'empty';
      empty.className = 'empty';
      empty.textContent = 'Nenhuma execucao nesta sessao.';
      terminal.appendChild(empty);
    }
    function setBusy(isBusy, message) {
      actionButtons.forEach((button) => { button.disabled = isBusy; });
      liveDot.className = 'live-dot' + (isBusy ? ' busy' : '');
      liveLabel.textContent = isBusy ? (message || 'Executando') : 'Pronto';
    }
    function showResult(status, message) {
      setBusy(false);
      statusLine.className = 'status-line ' + status;
      statusLine.textContent = message || '';
      liveDot.className = 'live-dot ' + status;
      liveLabel.textContent = status === 'success' ? 'Concluido' : 'Falhou';
    }

    document.querySelectorAll('.provider-tab').forEach((button) => button.addEventListener('click', () => selectProvider(button.dataset.provider)));
    document.querySelectorAll('.refresh-models').forEach((button) => button.addEventListener('click', () => vscodeApi.postMessage({ type: 'models', provider: button.dataset.modelProvider })));
    document.getElementById('save').addEventListener('click', () => vscodeApi.postMessage({ type: 'save', values: collectValues() }));
    document.getElementById('test').addEventListener('click', () => vscodeApi.postMessage({ type: 'test', values: collectValues() }));
    document.getElementById('generate').addEventListener('click', () => vscodeApi.postMessage({ type: 'generate', values: collectValues() }));
    document.getElementById('clear').addEventListener('click', () => vscodeApi.postMessage({ type: 'clear' }));
    document.getElementById('logs').addEventListener('click', () => vscodeApi.postMessage({ type: 'logs' }));
    document.getElementById('removeKey').addEventListener('click', () => vscodeApi.postMessage({ type: 'removeOpenRouterKey' }));
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'diagnostic') appendEntry(message.entry);
      if (message.type === 'diagnosticHistory') { clearTerminal(); message.entries.forEach(appendEntry); }
      if (message.type === 'clearDiagnostics') clearTerminal();
      if (message.type === 'models') updateModels(message.provider, message.models || []);
      if (message.type === 'modelsBusy') {
        const refreshButton = document.querySelector('[data-model-provider="' + message.provider + '"]');
        if (refreshButton) refreshButton.disabled = message.busy;
      }
      if (message.type === 'busy') setBusy(message.busy, message.message);
      if (message.type === 'result') showResult(message.status, message.message);
    });
    initialHistory.forEach(appendEntry);
    vscodeApi.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

module.exports = { SettingsPanel, escapeHtml, validateSettings };
