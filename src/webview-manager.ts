import * as vscode from 'vscode';
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
            const htmlContent = WebviewManager.generateDocumentationHTML(documentation, ruleId);
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
     * Generate HTML content for class dump webview
     */
    public static generateClassDumpHTML(classes: Record<string, unknown[]>, totalClasses: number): string {
        let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Enscript Class Dump</title>
        <style>
            body { 
                font-family: var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif); 
                padding: 20px; 
                color: var(--vscode-editor-foreground);
                background-color: var(--vscode-editor-background);
                line-height: 1.4;
            }
            .header {
                border-bottom: 2px solid var(--vscode-textSeparator-foreground);
                padding-bottom: 15px;
                margin-bottom: 25px;
            }
            .file-section { 
                margin-bottom: 30px; 
                border: 1px solid var(--vscode-panel-border); 
                border-radius: 5px; 
                background-color: var(--vscode-editor-background);
            }
            .file-header { 
                background-color: var(--vscode-sideBar-background); 
                padding: 10px; 
                font-weight: bold; 
                font-size: 14px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            .class-item { 
                padding: 15px; 
                border-bottom: 1px solid var(--vscode-panel-border); 
            }
            .class-item:last-child {
                border-bottom: none;
            }
            .class-name { 
                font-size: 18px; 
                font-weight: bold; 
                color: var(--vscode-symbolIcon-classForeground, #0066cc); 
                margin-bottom: 5px;
            }
            .class-info { 
                margin: 5px 0; 
                color: var(--vscode-descriptionForeground); 
                font-size: 13px;
            }
            .members-list { 
                margin-top: 10px; 
                background-color: var(--vscode-textCodeBlock-background);
                border-radius: 3px;
                padding: 10px;
            }
            .member-item { 
                padding: 3px 0; 
                padding-left: 20px; 
                font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
                font-size: 12px;
            }
            .member-name { 
                font-weight: bold; 
                color: var(--vscode-symbolIcon-fieldForeground, #6a9955);
            }
            .member-type { 
                color: var(--vscode-symbolIcon-typeParameterForeground, #4ec9b0); 
                margin-left: 8px;
            }
            .inheritance { 
                color: var(--vscode-symbolIcon-keywordForeground, #569cd6); 
                font-style: italic; 
            }
            .stats {
                background-color: var(--vscode-textCodeBlock-background);
                padding: 10px;
                border-radius: 5px;
                margin-bottom: 20px;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>📋 Indexed Classes Overview</h1>
        </div>
        <div class="stats">
            <strong>Statistics:</strong> ${totalClasses} classes found in ${Object.keys(classes).length} files
        </div>
    `;

        if (Object.keys(classes).length === 0) {
            html += '<p><em>No classes found in indexed files.</em></p>';
        } else {
            for (const [fileUri, classList] of Object.entries(classes)) {
                html += `
            <div class="file-section">
                <div class="file-header">📁 ${fileUri}</div>
            `;

                for (const cls of classList) {
                    const classObj = cls as {
                        name: string;
                        type: string;
                        base?: { identifier: string };
                        members?: unknown[]
                    };

                    html += `
                <div class="class-item">
                    <div class="class-name">${classObj.name}</div>
                    <div class="class-info">
                        Type: ${classObj.type}
                        ${classObj.base ? `<span class="inheritance">extends ${classObj.base.identifier}</span>` : ''}
                    </div>
                    <div class="class-info">Members: ${classObj.members?.length || 0}</div>
                `;

                    if (classObj.members && classObj.members.length > 0) {
                        html += '<div class="members-list">';
                        for (const member of classObj.members) {
                            const memberObj = member as { name: string; type: string | { identifier: string } };
                            const memberType = typeof memberObj.type === 'string' ? memberObj.type :
                                memberObj.type?.identifier || 'unknown';
                            html += `
                        <div class="member-item">
                            <span class="member-name">${memberObj.name}</span>
                            <span class="member-type">(${memberType})</span>
                        </div>
                        `;
                        }
                        html += '</div>';
                    }

                    html += '</div>';
                }

                html += '</div>';
            }
        }

        html += `
        </body>
    </html>
    `;

        return html;
    }

    /**
     * Generate HTML content for rule documentation display
     */
    private static generateDocumentationHTML(documentation: string, ruleId: string): string {
        const ruleName = ruleId.replace(/[-_]/g, ' ').toUpperCase();

        // Configure marked for better rendering
        marked.setOptions({
            breaks: true,
            gfm: true,
        });

        // Parse markdown to HTML
        const parsedContent = marked.parse(documentation);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EnScript Rule Documentation</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
        }
        
        /* Header styling */
        .header {
            border-bottom: 2px solid var(--vscode-textSeparator-foreground);
            padding-bottom: 15px;
            margin-bottom: 25px;
        }
        .rule-id {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-widget-border);
            padding: 4px 8px;
            border-radius: 4px;
            display: inline-block;
            margin-bottom: 10px;
        }
        .rule-title {
            font-size: 28px;
            font-weight: 600;
            margin: 0;
            color: var(--vscode-editor-foreground);
        }
        
        /* Markdown content styling */
        .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
            color: var(--vscode-editor-foreground);
            margin-top: 24px;
            margin-bottom: 12px;
            font-weight: 600;
            line-height: 1.25;
        }
        .content h1 { font-size: 24px; border-bottom: 1px solid var(--vscode-textSeparator-foreground); padding-bottom: 8px; }
        .content h2 { font-size: 20px; }
        .content h3 { font-size: 18px; }
        .content h4 { font-size: 16px; }
        
        .content p {
            margin: 16px 0;
            line-height: 1.7;
        }
        
        .content ul, .content ol {
            margin: 16px 0;
            padding-left: 24px;
        }
        .content li {
            margin: 4px 0;
            line-height: 1.6;
        }
        
        /* Code styling */
        .content code {
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-widget-border);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
            font-size: 13px;
            color: var(--vscode-textPreformat-foreground);
        }
        
        .content pre {
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            padding: 16px;
            margin: 16px 0;
            overflow-x: auto;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.5;
        }
        
        .content pre code {
            background: none;
            border: none;
            padding: 0;
            color: var(--vscode-textPreformat-foreground);
        }
        
        .content blockquote {
            border-left: 4px solid var(--vscode-textLink-foreground);
            margin: 16px 0;
            padding-left: 16px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        
        .content strong {
            font-weight: 600;
            color: var(--vscode-editor-foreground);
        }
        
        .content em {
            font-style: italic;
            color: var(--vscode-descriptionForeground);
        }
        
        .content a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        .content a:hover {
            text-decoration: underline;
        }
        
        /* Footer styling */
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-textSeparator-foreground);
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            text-align: center;
        }
        
        /* Dark mode adjustments */
        @media (prefers-color-scheme: dark) {
            .content pre {
                background: rgba(255, 255, 255, 0.05);
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="rule-id">Rule ID: ${ruleId}</div>
        <h1 class="rule-title">${ruleName}</h1>
    </div>
    <div class="content">
        ${parsedContent}
    </div>
    <div class="footer">
        EnScript Language Server - Diagnostic Rule Documentation
    </div>
</body>
</html>`;
    }
}
