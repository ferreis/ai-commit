'use strict';

const MAX_HISTORY_ENTRIES = 400;

class Diagnostics {
  constructor(outputChannel) {
    this.outputChannel = outputChannel;
    this.entries = [];
    this.listeners = new Set();
  }

  write(message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const entry = { timestamp, level, message: String(message) };
    this.entries.push(entry);
    if (this.entries.length > MAX_HISTORY_ENTRIES) this.entries.shift();

    const levelLabel = level === 'error' ? 'ERRO' : level === 'success' ? 'OK' : level === 'activity' ? 'MODELO' : 'INFO';
    this.outputChannel.appendLine(`[${timestamp}] [${levelLabel}] ${entry.message}`);
    for (const listener of this.listeners) listener(entry);
  }

  clear() {
    this.entries = [];
    this.outputChannel.clear();
    for (const listener of this.listeners) listener({ type: 'clear' });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  getHistory() {
    return [...this.entries];
  }

  show(preserveFocus = true) {
    this.outputChannel.show(preserveFocus);
  }
}

module.exports = { Diagnostics };
