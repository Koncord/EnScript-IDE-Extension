import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { marked } from 'marked';
import { getNonce } from '../util';

/**
 * Manages documentation webview panels.
 * 
 * This demonstrates:
 * - Creating simple webview panels (not custom editors)
 * - Reusing existing panels for the same content
 * - Loading HTML from template files
 * - Proper CSP configuration
 */
export class DocumentationWebview {
    /**
     * Tracks all active documentation panels
     */
    private readonly panels = new Map<string, vscode.WebviewPanel>();

    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Register all webview-related commands
     */
    public static registerCommands(context: vscode.ExtensionContext): vscode.Disposable {
        const manager = new DocumentationWebview(context);
        
        const commandDisposable = vscode.commands.registerCommand(
            'enscript.showDocumentation.client',
            async (documentation: string, ruleId: string) => {
                await manager.showDocumentation(documentation, ruleId);
            }
        );
        
        return commandDisposable;
    }

    /**
     * Show documentation for a diagnostic rule in a webview panel
     */
    private async showDocumentation(
        documentation: string,
        ruleId: string
    ): Promise<void> {
        if (!documentation || !ruleId) {
            vscode.window.showErrorMessage('Invalid documentation data received');
            return;
        }

        const ruleName = ruleId.replace(/[-_]/g, ' ').toUpperCase();
        const panelKey = ruleId;

        // If panel already exists for this rule, reveal it
        const existingPanel = this.panels.get(panelKey);
        if (existingPanel) {
            existingPanel.reveal(vscode.ViewColumn.Beside);
            // Update content in case documentation changed
            existingPanel.webview.html = this.getHtmlForWebview(existingPanel.webview, documentation, ruleName);
            return;
        }

        // Create a webview panel for rich markdown display
        const panel = vscode.window.createWebviewPanel(
            'enscriptDocumentation',
            `📖 ${ruleName} - Documentation`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: false,
                retainContextWhenHidden: false,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'media', 'documentation')
                ]
            }
        );

        // Store panel
        this.panels.set(panelKey, panel);

        // Set HTML content
        panel.webview.html = this.getHtmlForWebview(panel.webview, documentation, ruleName);

        // Clean up when panel is disposed
        panel.onDidDispose(() => {
            this.panels.delete(panelKey);
        });
    }

    /**
     * Get the static HTML for the documentation webview.
     */
    private getHtmlForWebview(webview: vscode.Webview, documentation: string, ruleName: string): string {
        // Configure marked for better rendering
        marked.setOptions({
            breaks: true,
            gfm: true,
        });

        // Parse markdown to HTML
        const parsedContent = marked.parse(documentation);

        // Use a nonce to only allow specific scripts to run
        const nonce = getNonce();

        // Get URIs for resources
        const commonStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'common.css'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'documentation', 'style.css'));
        
        // Load HTML template
        const htmlPath = path.join(this.context.extensionPath, 'media', 'documentation', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        
        // Replace placeholders
        html = html.replace(/{{cspSource}}/g, webview.cspSource);
        html = html.replace(/{{nonce}}/g, nonce);
        html = html.replace(/{{ruleName}}/g, ruleName);
        html = html.replace(/{{content}}/g, parsedContent as string);
        html = html.replace(/{{commonStyleUri}}/g, commonStyleUri.toString());
        html = html.replace(/{{styleUri}}/g, styleUri.toString());
        
        return html;
    }
}
