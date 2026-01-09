/// <reference types="@types/vscode-webview" />

interface ExecuteMessage {
    command: 'execute';
    module: string;
}

interface FocusEditorMessage {
    command: 'focusEditor';
}

interface ClearEditorMessage {
    command: 'clearEditor';
}

interface ReadyMessage {
    command: 'ready';
}

interface ResultMessage {
    command: 'result';
    success: boolean;
    message: string;
    timestamp: string;
    module?: string;
    code?: string;
}

interface ConnectionStatusMessage {
    command: 'connectionStatus';
    connected: boolean;
}

type IncomingMessage = ResultMessage | ConnectionStatusMessage;

const vscode = acquireVsCodeApi();
const moduleSelect = document.getElementById('module') as HTMLSelectElement;
const executeBtn = document.getElementById('executeBtn') as HTMLButtonElement;
const focusEditorBtn = document.getElementById('focusEditorBtn') as HTMLButtonElement;
const clearInputBtn = document.getElementById('clearInputBtn') as HTMLButtonElement;
const outputContent = document.getElementById('outputContent') as HTMLDivElement;
const statusDot = document.getElementById('statusDot') as HTMLSpanElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const executionCount = document.getElementById('executionCount') as HTMLSpanElement;

let executions = 0;
let isConnected = false;

// Execute code from editor
if (executeBtn) {
    executeBtn.addEventListener('click', executeCode);
}

function executeCode(): void {
    if (!isConnected) {
        addOutputEntry({
            command: 'result',
            success: false,
            message: 'Not connected to DayZ. Start debugging first.',
            timestamp: new Date().toISOString()
        });
        return;
    }

    const module = moduleSelect.value;
    vscode.postMessage({
        command: 'execute',
        module: module
    } as ExecuteMessage);
}

// Focus editor
if (focusEditorBtn) {
    focusEditorBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'focusEditor' } as FocusEditorMessage);
    });
}

// Clear editor
if (clearInputBtn) {
    clearInputBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'clearEditor' } as ClearEditorMessage);
    });
}

// Handle messages from extension
window.addEventListener('message', (event: MessageEvent<IncomingMessage>) => {
    const message = event.data;

    switch (message.command) {
        case 'result':
            addOutputEntry(message);
            break;
        case 'connectionStatus':
            updateConnectionStatus(message.connected);
            break;
    }
});

function addOutputEntry(data: ResultMessage): void {
    // Remove empty state
    const emptyOutput = outputContent.querySelector('.empty-output');
    if (emptyOutput) {
        emptyOutput.remove();
    }

    const entry = document.createElement('div');
    entry.className = 'output-entry ' + (data.success ? 'success' : 'error');

    const time = new Date(data.timestamp).toLocaleTimeString();
    const moduleBadge = data.module ? `<span class="output-module">${data.module}</span>` : '';

    entry.innerHTML = `
            <div class="output-meta">
                <span>${time} ${moduleBadge}</span>
                <span>${data.success ? '✓ Success' : '✗ Error'}</span>
            </div>
            ${data.code ? `<div class="output-code">${escapeHtml(data.code)}</div>` : ''}
            <div class="output-message">${escapeHtml(data.message)}</div>
        `;

    outputContent.insertBefore(entry, outputContent.firstChild);
    executions++;
    updateExecutionCount();
}

function updateConnectionStatus(connected: boolean): void {
    isConnected = connected;
    if (statusDot && statusText && executeBtn) {
        if (connected) {
            statusDot.classList.add('connected');
            statusText.textContent = 'Connected to DayZ';
            executeBtn.disabled = false;
        } else {
            statusDot.classList.remove('connected');
            statusText.textContent = 'Not connected';
            executeBtn.disabled = true;
        }
    }
}

function updateExecutionCount(): void {
    if (executionCount) {
        executionCount.textContent = `${executions} execution${executions !== 1 ? 's' : ''}`;
    }
}

function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Notify extension that webview is ready and request connection status
vscode.postMessage({ command: 'ready' } as ReadyMessage);

export { };
