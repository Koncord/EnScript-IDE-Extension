import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { marked } from 'marked';

/**
 * Manages webview panels for displaying documentation and class information
 */
export class WebviewManager {
    /**
     * Register all webview-related commands
     */
    public static registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('enscript.showDocumentation.client',
                async (documentation: string, ruleId: string) => {
                    WebviewManager.showDocumentation(context, documentation, ruleId);
                }
            )
        );
    }

    /**
     * Show documentation for a diagnostic rule in a webview panel
     */
    private static async showDocumentation(
        context: vscode.ExtensionContext,
        documentation: string,
        ruleId: string
    ): Promise<void> {
        if (!documentation || !ruleId) {
            vscode.window.showErrorMessage('Invalid documentation data received');
            return;
        }

        try {
            const ruleName = ruleId.replace(/[-_]/g, ' ').toUpperCase();

            // Create a webview panel for rich markdown display
            const panel = vscode.window.createWebviewPanel(
                'enscriptDocumentation',
                `📖 ${ruleName} - Documentation`,
                vscode.ViewColumn.Beside,
                {
                    enableScripts: false,
                    retainContextWhenHidden: true,
                    localResourceRoots: []
                }
            );

            // Generate HTML content
            const htmlContent = WebviewManager.generateDocumentationHTML(documentation, ruleId, context);
            panel.webview.html = htmlContent;

            // Clean up when panel is disposed
            context.subscriptions.push(panel);
        } catch {
            // Fallback to a simple markdown document
            try {
                const doc = await vscode.workspace.openTextDocument({
                    language: 'markdown',
                    content: `# ${ruleId.replace(/[-_]/g, ' ').toUpperCase()}\n\n${documentation}`
                });
                await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
            } catch {
                vscode.window.showInformationMessage(documentation);
            }
        }
    }

    /**
     * Generate HTML content for rule documentation display
     */
    private static generateDocumentationHTML(documentation: string, ruleId: string, context: vscode.ExtensionContext): string {
        const ruleName = ruleId.replace(/[-_]/g, ' ').toUpperCase();

        // Configure marked for better rendering
        marked.setOptions({
            breaks: true,
            gfm: true,
        });

        // Parse markdown to HTML
        const parsedContent = marked.parse(documentation);
        
        // Load HTML template
        const htmlPath = path.join(context.extensionPath, 'media', 'documentation.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        
        // Replace placeholders
        html = html.replace(/{{ruleName}}/g, ruleName);
        html = html.replace(/{{content}}/g, parsedContent as string);
        
        return html;
    }
}
