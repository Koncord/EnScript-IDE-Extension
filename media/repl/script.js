(function () {
    // eslint-disable-next-line no-undef
    const vscode = acquireVsCodeApi();
    const moduleSelect = document.getElementById('module');
    const executeBtn = document.getElementById('executeBtn');
    const focusEditorBtn = document.getElementById('focusEditorBtn');
    const clearInputBtn = document.getElementById('clearInputBtn');
    const outputContent = document.getElementById('outputContent');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const executionCount = document.getElementById('executionCount');

    let executions = 0;
    let isConnected = false;

    // Execute code from editor
    if (executeBtn) {
        executeBtn.addEventListener('click', executeCode);
    }

    function executeCode() {
        if (!isConnected) {
            addOutputEntry({
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
        });
    }

    // Focus editor
    if (focusEditorBtn) {
        focusEditorBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'focusEditor' });
        });
    }

    // Clear editor
    if (clearInputBtn) {
        clearInputBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'clearEditor' });
        });
    }

    // Handle messages from extension
    window.addEventListener('message', event => {
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

    function addOutputEntry(data) {
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

    function updateConnectionStatus(connected) {
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

    function updateExecutionCount() {
        if (executionCount) {
            executionCount.textContent = `${executions} execution${executions !== 1 ? 's' : ''}`;
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Notify extension that webview is ready and request connection status
    vscode.postMessage({ command: 'ready' });
})();
