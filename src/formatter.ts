import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { diff_match_patch, DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL } from 'diff-match-patch';

export class AstyleFormatter implements vscode.DocumentFormattingEditProvider {
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('EnScript Formatter');
    }

    public provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        _options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): Promise<vscode.TextEdit[]> {
        return new Promise((resolve, reject) => {
            const config = vscode.workspace.getConfiguration('enscript.formatting');
            const astyleBinPath = config.get<string>('astylePath') || 'astyle';
            const astyleRcPath = config.get<string>('astyleRcPath');
            const extraArgs = config.get<string[]>('arguments') || [];

            const args = [...extraArgs];

            if (!args.includes('--stdin=')) {
                args.push('--mode=c');
            }

            if (astyleRcPath) {
                const resolvedRcPath = this.resolvePath(astyleRcPath);
                if (fs.existsSync(resolvedRcPath)) {
                    args.push(`--options=${resolvedRcPath}`);
                } else {
                    this.outputChannel.appendLine(`Warning: .astylerc file not found at ${resolvedRcPath}`);
                }
            }

            const resolvedBinPath = this.resolvePath(astyleBinPath);
            const fileSize = document.getText().length;
            const maxBufferSize = Math.max(200 * 1024, fileSize * 2);

            this.outputChannel.appendLine(`Running: ${resolvedBinPath} ${args.join(' ')}`);

            // Let's start the process
            const child = cp.execFile(resolvedBinPath, args, { maxBuffer: maxBufferSize }, (err, stdout, stderr) => {
                if (token.isCancellationRequested) {
                    return;
                }

                if (err) {
                    if ((err as any).code === 'ENOENT') {
                        const message = `Astyle not found at "${resolvedBinPath}". Code formatting requires Astyle.`;
                        vscode.window.showErrorMessage(message, 'Download Astyle', 'Configure Path').then(selection => {
                            if (selection === 'Download Astyle') {
                                vscode.env.openExternal(vscode.Uri.parse('https://sourceforge.net/projects/astyle/files/latest/download'));
                            } else if (selection === 'Configure Path') {
                                vscode.commands.executeCommand('workbench.action.openSettings', 'enscript.formatting.astylePath');
                            }
                        });
                    } else {
                        vscode.window.showErrorMessage(`Astyle formatting failed: ${err.message}`);
                        this.outputChannel.appendLine(`Error: ${stderr}`);
                    }
                    return reject(err);
                }

                try {
                    const edits = this.generateTextEdits(document, stdout);
                    resolve(edits);
                } catch (e) {
                    reject(e);
                }
            });

            token.onCancellationRequested(() => {
                child.kill();
                reject(new Error('Formatting cancelled'));
            });

            if (child.stdin) {
                child.stdin.write(document.getText());
                child.stdin.end();
            }
        });
    }

    /**
     * Resolves variables like ${workspaceFolder} and normalizes the path
     */
    private resolvePath(inputPath: string): string {
        if (!inputPath) return inputPath;

        let res = inputPath;
        if (inputPath.includes('${workspaceFolder}') || inputPath.includes('${workspaceRoot}')) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                res = inputPath.replace(/\${workspaceFolder}|\${workspaceRoot}/g, workspaceFolders[0].uri.fsPath);
            }
        }

        return path.normalize(res);
    }

    /**
     * Calculates the minimum set of changes (TextEdits) using diff-match-patch
     */
    private generateTextEdits(document: vscode.TextDocument, formattedText: string): vscode.TextEdit[] {
        const dmp = new diff_match_patch();
        const diffs = dmp.diff_main(document.getText(), formattedText);
        const edits: vscode.TextEdit[] = [];

        let line = 0;
        let character = 0;

        diffs.forEach(diff => {
            const op = diff[0];
            const text = diff[1];

            const start = new vscode.Position(line, character);
            const lines = text.split(/\r\n|\r|\n/);
            const lineCount = lines.length - 1;
            const lastLineLength = lines[lines.length - 1].length;

            switch (op) {
                case DIFF_INSERT:
                    edits.push(vscode.TextEdit.insert(start, text));
                    break;

                case DIFF_DELETE:
                    let endLine = line + lineCount;
                    let endChar = (lineCount === 0 ? character : 0) + lastLineLength;
                    const end = new vscode.Position(endLine, endChar);

                    edits.push(vscode.TextEdit.delete(new vscode.Range(start, end)));

                    line = endLine;
                    character = endChar;
                    break;

                case DIFF_EQUAL:
                    line += lineCount;
                    if (lineCount > 0) {
                        character = lastLineLength;
                    } else {
                        character += lastLineLength;
                    }
                    break;
            }
        });

        return edits;
    }
}

/**
 * Helper to register the formatter
 */
export function registerFormatter(context: vscode.ExtensionContext) {
    const formatter = new AstyleFormatter();
    const provider = vscode.languages.registerDocumentFormattingEditProvider('enscript', formatter);
    context.subscriptions.push(provider);
}
