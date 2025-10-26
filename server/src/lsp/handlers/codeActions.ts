import { CodeAction, CodeActionKind, Range, Diagnostic, WorkspaceEdit } from 'vscode-languageserver/node';
import { DiagnosticRule, DiagnosticRuleResult, DiagnosticRuleContext } from '../../server/diagnostics/rules';
import { globalDiagnosticRegistry } from '../../server/diagnostics/registry';
import { diagnosticsCache } from '../../server/cache';
import { IHandlerRegistration, Connection, TextDocuments, TextDocument } from './handler-interfaces';
import { inject, injectable } from 'inversify';
import { IDiagnosticsProvider, TYPES } from '../../server/di';
import { IWorkspaceManager } from '../../server/workspace/workspace-interfaces';

/**
 * Register Code Actions handler
 */
@injectable()
export class CodeActionsHandler implements IHandlerRegistration {
    constructor(
        @inject(TYPES.IDiagnosticsProvider) private diagnosticsProvider: IDiagnosticsProvider,
        @inject(TYPES.IWorkspaceManager) private workspaceManager: IWorkspaceManager
    ) { }
    register(connection: Connection, documents: TextDocuments<TextDocument>): void {
        connection.onCodeAction(async (params) => {
            const document = documents.get(params.textDocument.uri);
            if (!document) {
                return [];
            }

            // If diagnostics provider is not initialized, return empty actions
            if (!this.diagnosticsProvider) {
                return [];
            }

            // Get cached diagnostics only (don't trigger diagnostics run)
            // Code actions are triggered frequently, we don't want to run diagnostics on every request
            const diagnostics = diagnosticsCache.getCachedDiagnosticsOnly(document);

            const actions: CodeAction[] = [];

            // Filter diagnostics that overlap with the requested range
            const relevantDiagnostics = diagnostics.filter((diag: Diagnostic) =>
                rangesOverlap(diag.range, params.range)
            );

            for (const diagnostic of relevantDiagnostics) {
                // Only handle diagnostics from our semantic analyzer
                if (diagnostic.source !== 'enscript.semantic' || !diagnostic.code) {
                    continue;
                }

                // Find the diagnostic rule that created this diagnostic
                const rule = findRuleByCode(diagnostic.code as string);

                if (rule) {
                    // Create actions from actionable suggestions (preferred)
                    if (rule.getActionableSuggestions) {
                        try {
                            const ruleResult: DiagnosticRuleResult = {
                                severity: diagnostic.severity || 1,
                                message: diagnostic.message,
                                range: diagnostic.range,
                                source: diagnostic.source || '',
                                code: diagnostic.code as string,
                                data: diagnostic.data || {}
                            };
                            // Minimal context - some rules may not use all properties
                            const context: DiagnosticRuleContext = {
                                document,
                                ast: {
                                    kind: 'File',
                                    body: [],
                                    version: 1,
                                    uri: document.uri,
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 0 }
                                },
                                workspaceRoot: '',
                                includePaths: [],
                                openedDocumentUris: this.workspaceManager.getOpenedDocuments()
                            };
                            // Use unknown for node since we don't have AST context in code actions
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const suggestions = rule.getActionableSuggestions(ruleResult, null as any, context);

                            for (const suggestion of suggestions) {
                                const action: CodeAction = {
                                    title: suggestion.title,
                                    kind: CodeActionKind.QuickFix,
                                    diagnostics: [diagnostic]
                                };

                                // Add text edit if provided
                                if (suggestion.newText !== undefined) {
                                    const range = suggestion.range || diagnostic.range;
                                    const edit: WorkspaceEdit = {
                                        changes: {
                                            [document.uri]: [{
                                                range,
                                                newText: suggestion.newText
                                            }]
                                        }
                                    };
                                    action.edit = edit;
                                }

                                actions.push(action);
                            }
                        } catch (error) {
                            // Fallback to legacy suggestions if actionable suggestions fail
                            console.warn('Error getting actionable suggestions:', error);
                        }
                    }

                    // Fallback to legacy suggestions if no actionable suggestions
                    if (actions.length === 0 && rule.getSuggestions) {
                        try {
                            // Minimal context for legacy suggestions
                            const context: DiagnosticRuleContext = {
                                document,
                                ast: {
                                    kind: 'File',
                                    body: [],
                                    version: 1,
                                    uri: document.uri,
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 0 }
                                },
                                workspaceRoot: '',
                                includePaths: [],
                                openedDocumentUris: this.workspaceManager.getOpenedDocuments()
                            };
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const suggestions = rule.getSuggestions(null as any, context);

                            for (const suggestion of suggestions) {
                                actions.push({
                                    title: suggestion,
                                    kind: CodeActionKind.QuickFix,
                                    diagnostics: [diagnostic],
                                    // No edit - just informational
                                });
                            }
                        }

                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        catch (error) {
                            // Ignore errors from getSuggestions for now
                        }
                    }

                    // Add "Show Rule Documentation" action
                    if (rule.getDocumentation) {
                        try {
                            const documentation = rule.getDocumentation();

                            const action = {
                                title: `Learn more about: ${rule.name}`,
                                kind: CodeActionKind.QuickFix,
                                diagnostics: [diagnostic],
                                command: {
                                    title: 'Show Documentation',
                                    command: 'enscript.showDocumentation.client',
                                    arguments: [documentation, rule.id]
                                }
                            };

                            actions.push(action);
                        } catch {
                            // Silently ignore documentation errors to avoid cluttering logs
                        }
                    }
                }
            }

            return actions;
        });
    }
}

function rangesOverlap(a: Range, b: Range): boolean {
    return !(
        a.end.line < b.start.line ||
        b.end.line < a.start.line ||
        (a.end.line === b.start.line && a.end.character < b.start.character) ||
        (b.end.line === a.start.line && b.end.character < a.start.character)
    );
}

function findRuleByCode(code: string): DiagnosticRule | null {
    // Get the rule from the global diagnostic registry
    const rules = globalDiagnosticRegistry.getAllRules();
    return rules.find((rule: DiagnosticRule) => rule.id === code) || null;
}
